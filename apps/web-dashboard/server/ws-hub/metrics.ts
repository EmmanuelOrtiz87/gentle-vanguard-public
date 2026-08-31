import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { getGlobalHealth } from '../global-health-api.ts';
import { getOtelPipeline } from '../otel-pipeline.ts';
import {
  defaultOperationalMetrics,
  getRealMetrics,
  getMetricHistory,
  getTenantScopedMetrics,
  getConfiguredSessionTokenLimit,
} from '../real-data.ts';
import type { DashboardData } from '../../src/types/dashboard.ts';
import { readJson, ROOT } from '../shared.ts';
import { clients, deploymentTenant, STATS_PATH } from './context.ts';

const otelPipeline = getOtelPipeline();

export function loadStats() {
  const content = readJson<{
    totalCalls: number;
    callsByTool: Record<string, number>;
    callsBySkill: Record<string, number>;
    lastCall: string | null;
  }>(STATS_PATH);
  return content || { totalCalls: 0, callsByTool: {}, callsBySkill: {}, lastCall: null };
}

export function generateMetrics(tenantId?: string) {
  const effectiveTenantId = tenantId ?? deploymentTenant.tenantId;
  const real = (
    effectiveTenantId ? getTenantScopedMetrics(effectiveTenantId) : getRealMetrics()
  ) as Partial<DashboardData> | undefined;
  return {
    ...real,
    tokens: real?.tokens ?? {
      used: 0,
      limit: getConfiguredSessionTokenLimit(),
      cost: 0,
      byModel: [],
    },
    operational: real?.operational ?? defaultOperationalMetrics(),
    globalHealth: getGlobalHealth(),
    tenantScope: deploymentTenant.configured
      ? { type: deploymentTenant.scopeLabel, tenantId: deploymentTenant.tenantId }
      : {
          type: deploymentTenant.scopeLabel,
          warning: 'Metrics are system-wide; no tenant boundary is configured.',
        },
  };
}

export function readAuditEntries(limit = 100, query = ''): Array<Record<string, unknown>> {
  const auditDir = join(ROOT, '.session', 'audit', 'logs');
  if (!existsSync(auditDir)) return [];
  const needle = query.trim().toLowerCase();
  const entries: Array<Record<string, unknown>> = [];
  const files = readdirSync(auditDir)
    .filter((file) => file.endsWith('.jsonl'))
    .sort()
    .reverse();
  for (const file of files) {
    try {
      const lines = readFileSync(join(auditDir, file), 'utf-8')
        .split(/\r?\n/)
        .filter(Boolean)
        .reverse();
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as Record<string, unknown>;
          if (!needle || JSON.stringify(entry).toLowerCase().includes(needle)) entries.push(entry);
          if (entries.length >= limit) return entries;
        } catch {
          // Ignore incomplete JSONL lines while a writer is appending.
        }
      }
    } catch {
      // Audit viewer is best-effort and must not affect the metrics API.
    }
  }
  return entries;
}

export function prometheusMetrics(): string {
  const metrics = generateMetrics() as Record<string, any>;
  const health = getGlobalHealth() as Record<string, any>;
  const otel = otelPipeline.getStats();
  const number = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const lines = [
    '# HELP gentle_vanguard_dashboard_up Dashboard process health.',
    '# TYPE gentle_vanguard_dashboard_up gauge',
    'gentle_vanguard_dashboard_up 1',
    '# HELP gentle_vanguard_dashboard_uptime_seconds Dashboard process uptime.',
    '# TYPE gentle_vanguard_dashboard_uptime_seconds gauge',
    `gentle_vanguard_dashboard_uptime_seconds ${process.uptime()}`,
    '# HELP gentle_vanguard_dashboard_ws_connections Current WebSocket clients.',
    '# TYPE gentle_vanguard_dashboard_ws_connections gauge',
    `gentle_vanguard_dashboard_ws_connections ${clients.size}`,
    '# HELP gentle_vanguard_tokens_used Current real token consumption.',
    '# TYPE gentle_vanguard_tokens_used gauge',
    `gentle_vanguard_tokens_used ${number(metrics.tokens?.used)}`,
    '# HELP gentle_vanguard_active_sessions Current active sessions.',
    '# TYPE gentle_vanguard_active_sessions gauge',
    `gentle_vanguard_active_sessions ${number(metrics.sessions?.active)}`,
    '# HELP gentle_vanguard_health_status Health status encoded as 1 healthy, 0 otherwise.',
    '# TYPE gentle_vanguard_health_status gauge',
    `gentle_vanguard_health_status ${health.status === 'healthy' || health.status === 'ok' ? 1 : 0}`,
    // ── OTel pipeline self-observability ──
    '# HELP gentle_vanguard_otel_pipeline_running Whether the unified OTel pipeline is running.',
    '# TYPE gentle_vanguard_otel_pipeline_running gauge',
    `gentle_vanguard_otel_pipeline_running ${otel.running ? 1 : 0}`,
    '# HELP gentle_vanguard_otel_spans_ingested_total Total spans ingested into Nexus since process start.',
    '# TYPE gentle_vanguard_otel_spans_ingested_total counter',
    `gentle_vanguard_otel_spans_ingested_total ${number(otel.spansIngestedTotal)}`,
    '# HELP gentle_vanguard_otel_ingest_errors Total ingest cycle errors since process start.',
    '# TYPE gentle_vanguard_otel_ingest_errors counter',
    `gentle_vanguard_otel_ingest_errors ${number(otel.ingestErrors)}`,
    '# HELP gentle_vanguard_otel_last_ingest_age_seconds Seconds since the last successful ingest cycle.',
    '# TYPE gentle_vanguard_otel_last_ingest_age_seconds gauge',
    `gentle_vanguard_otel_last_ingest_age_seconds ${
      otel.lastIngestAt ? Math.max(0, (Date.now() - Date.parse(otel.lastIngestAt)) / 1000) : -1
    }`,
  ];
  return `${lines.join('\n')}\n`;
}

export interface TenantSloObjectives {
  availabilityTargetPct: number;
  latencyTargetMs: number;
  errorBudgetPct: number;
}

/** SLO defaults; overridable per tenant via config/tenant-registry.json. */
const SLO_DEFAULTS: TenantSloObjectives = {
  availabilityTargetPct: 99.9,
  latencyTargetMs: 2000,
  errorBudgetPct: 0.1,
};

export function getTenantSloObjectives(tenantId?: string): TenantSloObjectives {
  const effective = tenantId || deploymentTenant.tenantId;
  try {
    const registryPath = join(ROOT, 'config', 'tenant-registry.json');
    if (existsSync(registryPath)) {
      const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
      // Registry-level defaults first…
      const base: TenantSloObjectives = {
        ...SLO_DEFAULTS,
        ...(registry.sloDefaults ?? {}),
      };
      // …then tenant-specific overrides.
      const tenant = (registry.tenants ?? []).find((t: any) => t.id === effective);
      if (tenant?.slo) return { ...base, ...tenant.slo };
      return base;
    }
  } catch {
    /* fall through to defaults */
  }
  return { ...SLO_DEFAULTS };
}

export function calculateBurnRate(tenantId?: string) {
  const objectives = getTenantSloObjectives(tenantId);
  const errorBudget = objectives.errorBudgetPct / 100;
  const windows = [
    { label: '1h', range: '1h' as const },
    { label: '6h', range: '7d' as const, hours: 6 },
    { label: '24h', range: '24h' as const },
    { label: '72h', range: '7d' as const, hours: 72 },
  ];
  return windows.map(({ label, range, hours }) => {
    const history = getMetricHistory(2000, range).filter((row: any) => {
      if (!hours) return true;
      const timestamp = Date.parse(String(row.timestamp || ''));
      return Number.isFinite(timestamp) && Date.now() - timestamp <= hours * 60 * 60 * 1000;
    });
    const total = history.length;
    const errors = history.filter(
      (row: any) =>
        !['healthy', 'ok', 'pass'].includes(String(row.health_status || '').toLowerCase()),
    ).length;
    const errorRate = total > 0 ? errors / total : null;
    return {
      window: label,
      samples: total,
      errors,
      errorRate,
      burnRate: errorRate === null ? null : errorBudget > 0 ? errorRate / errorBudget : null,
      status:
        total === 0
          ? 'NO_DATA'
          : errorRate !== null && errorRate > errorBudget
            ? 'BREACH'
            : 'WITHIN_BUDGET',
    };
  });
}
