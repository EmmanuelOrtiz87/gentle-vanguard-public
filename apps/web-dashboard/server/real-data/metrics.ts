import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { ROOT, readJson, countSkills as _countSkills } from '../shared.ts';
import type {
  CloudMetrics,
  CostInsight,
  DashboardData,
  ModelCost,
} from '../../src/types/dashboard.ts';
import { DEFAULT_TENANT_ID } from '../database/manager.ts';
import { getAggregatedDashboardMetrics } from '@gentle-vanguard/core/metrics-aggregator';
import { OperationalMetricsTracker } from '@gentle-vanguard/core/operational-metrics-tracker';
import { classifyDashboardSource } from '../dashboard-source-provenance.ts';
import { getOrLoad } from '../cache/tenant-lru-cache.ts';
import {
  CONSOLIDATED_PATH,
  STATS_PATH,
  REGISTRY_PATH,
  SESSIONS_HISTORY_PATH,
  CONTEXT_LOG_DIR,
  SYSTEM_WIDE_FILESYSTEM_METADATA,
  getConfiguredSessionTokenLimit,
  readWithCache,
  execGit,
  getDb,
  dbAvailable,
  getFreshActiveSessions,
  MODEL_PRICING,
} from './helpers.ts';
import { getSwarmWorkers } from './swarm.ts';
import { getTraces } from './traces.ts';
import { getStackCapabilities } from './capabilities.ts';

// ─── Public Functions ─────────────────────────────────────────────────

export function getGitStats(): { commits: number; prsMerged: number; contributors: number } {
  const gitFile = readJson<{ totalCommits: number; authorCount: number }>(
    join(ROOT, '.runtime', 'metrics', 'git.json'),
  );
  return {
    commits: gitFile?.totalCommits ?? (parseInt(execGit('rev-list --count HEAD'), 10) || 0),
    prsMerged: 0,
    contributors: gitFile?.authorCount ?? 0,
  };
}

export function getOSMetrics() {
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  return {
    memory: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      total: Math.round(totalMem / 1024 / 1024),
      free: Math.round(freeMem / 1024 / 1024),
      usagePercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
    },
    cpu: {
      user: Math.round(cpu.user / 1000),
      system: Math.round(cpu.system / 1000),
      cores: cpus.length,
      loadAverage: os.loadavg(),
    },
    uptime: Math.round(process.uptime()),
    pid: process.pid,
    platform: os.platform(),
    arch: os.arch(),
  };
}

// ─── getRealMetrics — Primary dashboard data source ───────────────────

export function getRealMetrics(): DashboardData {
  // PRIMARY: Use unified metrics aggregator ( SessionContextLog + live metrics )
  try {
    const aggregated = getAggregatedDashboardMetrics();
    if (aggregated.sessionsTotal > 0 || aggregated.totalTokens > 0) {
      return buildDashboardDataFromAggregated(aggregated);
    }
  } catch (err) {
    console.error('[real-data] Error from aggregated metrics:', err);
  }

  // FALLBACK: Try DB
  if (dbAvailable()) {
    return getRealMetricsFromDb();
  }

  // LAST RESORT: consolidated JSON
  return getRealMetricsFromJson();
}

export type MetricHistoryRange = '5m' | '1h' | '24h' | '7d' | '30d';

export function getMetricHistory(
  limit = 120,
  range?: MetricHistoryRange,
): Array<Record<string, unknown>> {
  if (!dbAvailable()) return [];
  const boundedLimit = Math.max(1, Math.min(2000, Math.floor(limit)));
  const since = range
    ? (
        {
          '5m': '-5 minutes',
          '1h': '-1 hours',
          '24h': '-24 hours',
          '7d': '-7 days',
          '30d': '-30 days',
        } as const
      )[range]
    : undefined;
  return getDb().getMetricHistory(boundedLimit, since).reverse() as unknown as Array<
    Record<string, unknown>
  >;
}

// Build DashboardData from aggregated metrics (unified source)
export function buildDashboardDataFromAggregated(
  aggregated: ReturnType<typeof getAggregatedDashboardMetrics>,
): DashboardData {
  // Note: We use aggregated data, not DB directly
  // const db = getDb(); // Available if needed
  const gitStats = getGitStats();
  const osMetrics = getOSMetrics();

  // Session cleanup can temporarily leave the live context directory empty.
  // Keep real counts from SQLite visible while the next live state arrives.
  let dbSessionTotal = 0;
  let dbSessionActive = 0;
  try {
    if (dbAvailable()) {
      const db = getDb();
      dbSessionTotal = db.getAllSessions().length;
      dbSessionActive = getFreshActiveSessions().length;
    }
  } catch {
    // The aggregated source remains valid when SQLite is unavailable.
  }
  const sessionTotal = Math.max(aggregated.sessionsTotal, dbSessionTotal);
  const sessionActive = Math.max(aggregated.sessionsActive, dbSessionActive);

  // Get operational metrics (velocity, efficiency, productivity)
  const operationalMetrics = OperationalMetricsTracker.calculateMetrics();

  // Get MCP stats
  const skillStats = readJson<{
    totalCalls: number;
    callsByTool: Record<string, number>;
    callsBySkill: Record<string, number>;
    lastCall: string | null;
  }>(STATS_PATH) || { totalCalls: 0, callsByTool: {}, callsBySkill: {}, lastCall: null };

  const topSkills = Object.entries(skillStats.callsBySkill || {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([name]) => name);
  const traceData = getTraces();
  const traceStats = traceData.stats;
  const traceDurations = traceData.traces
    .map((trace) => trace.duration || 0)
    .filter((duration) => duration > 0)
    .sort((a, b) => a - b);
  const tracePercentile = (percentile: number): number => {
    if (traceDurations.length === 0) return 0;
    const index = Math.min(
      traceDurations.length - 1,
      Math.ceil((percentile / 100) * traceDurations.length) - 1,
    );
    return traceDurations[Math.max(0, index)];
  };
  const checkpointDir = join(ROOT, '.session', 'checkpoints');
  const auditDir = join(ROOT, '.session', 'audit', 'logs');
  const traceDir = join(ROOT, '.telemetry', 'traces');
  const checkpointCount = existsSync(checkpointDir)
    ? readdirSync(checkpointDir).filter((d) => !d.includes('.')).length
    : 0;
  const auditFileCount = existsSync(auditDir)
    ? readdirSync(auditDir).filter((f) => f.endsWith('.jsonl')).length
    : 0;
  const traceFileCount = existsSync(traceDir)
    ? readdirSync(traceDir).filter((f) => f.endsWith('.jsonl')).length
    : 0;
  const cloudMetricsFile = readJson<{ executions?: unknown[] }>(
    join(ROOT, '.session', 'cloud-metrics.json'),
  );
  let sqliteMetrics = {
    skillCount: 0,
    skillAvgCost: 0,
    tokenTotalCost: 0,
    contractPassRate: 0,
    routingTotalHits: 0,
  };
  try {
    if (dbAvailable()) {
      const db = getDb();
      const topSkillsRows = db.getTopSkills(100, DEFAULT_TENANT_ID);
      const tokenRow = db
        .getDb()
        .prepare('SELECT COALESCE(SUM(cost), 0) as totalCost FROM token_usage')
        .get() as { totalCost?: number };
      const contractRows = db
        .getDb()
        .prepare(
          'SELECT status, result, COUNT(*) as cnt FROM contract_results GROUP BY status, result',
        )
        .all() as Array<{ status?: string; result?: string; cnt: number }>;
      const totalContracts = contractRows.reduce((sum, row) => sum + row.cnt, 0);
      const passedContracts = contractRows
        .filter(
          (row) =>
            ['pass', 'valid', 'success'].includes(row.status || '') ||
            ['pass', 'valid', 'success'].includes(row.result || ''),
        )
        .reduce((sum, row) => sum + row.cnt, 0);
      const routingRow = db
        .getDb()
        .prepare(
          'SELECT COALESCE(SUM(hit_count), 0) as totalHits FROM routing_rules WHERE tenant_id = ?',
        )
        .get(DEFAULT_TENANT_ID) as { totalHits?: number };
      sqliteMetrics = {
        skillCount: topSkillsRows.length,
        skillAvgCost:
          topSkillsRows.length > 0
            ? topSkillsRows.reduce((sum: number, skill: any) => sum + (skill.cost || 0), 0) /
              topSkillsRows.length
            : 0,
        tokenTotalCost: tokenRow.totalCost ?? 0,
        contractPassRate: totalContracts > 0 ? passedContracts / totalContracts : 0,
        routingTotalHits: routingRow.totalHits ?? 0,
      };
    }
  } catch {
    // Optional SQLite tables remain explicitly unavailable when empty.
  }

  // Aggregated session logs do not contain model attribution. Never manufacture a
  // model split: model-level trace rows are required before this view is shown.
  const byModel: ModelCost[] = [];
  const costInsights: CostInsight[] = [];

  return {
    timestamp: new Date().toISOString(),
    source: 'aggregated',
    sourceClassification: classifyDashboardSource({
      source: 'mixed',
      filesystemMetadata: SYSTEM_WIDE_FILESYSTEM_METADATA,
    }),
    tokens: {
      used: aggregated.totalTokens,
      limit: getConfiguredSessionTokenLimit(),
      cost: aggregated.totalCost,
      byModel,
    },
    sessions: {
      total: sessionTotal,
      active: sessionActive,
      today: aggregated.sessionsToday || (dbAvailable() ? getDb().getSessionsToday().length : 0),
      avgDuration: traceStats.avgDuration || aggregated.avgLatency,
    },
    git: gitStats,
    health: {
      status: skillStats.totalCalls > 0 || sessionTotal > 0 ? 'healthy' : 'unknown',
      routing: skillStats.totalCalls > 0 ? Math.min(100, skillStats.totalCalls) : 0,
    },
    latency: {
      avg: aggregated.avgLatency || traceStats.avgDuration,
      p50: aggregated.p50Latency || tracePercentile(50),
      p95: aggregated.p95Latency || tracePercentile(95),
      p99: tracePercentile(99),
      max: traceDurations[traceDurations.length - 1] || 0,
      samples: aggregated.sloTotal || traceStats.totalTraces,
      responseTimes: {},
    },
    mcp: {
      skills: {
        total: Object.keys(skillStats.callsBySkill || {}).length,
        byAgent: {},
        recentlyUsed: topSkills,
      },
      calls: {
        total: skillStats.totalCalls,
        byTool: skillStats.callsByTool || {},
        bySkill: skillStats.callsBySkill || {},
        lastCall: skillStats.lastCall,
      },
      performance: {
        avgResponseTime: aggregated.avgLatency || traceStats.avgDuration,
        errorRate: traceStats.errorRate,
        responseTimes: {},
      },
    },
    cloud: {
      executions: cloudMetricsFile?.executions?.length || 0,
      totalCost: 0,
    },
    checkpoints: checkpointCount,
    auditLogs: auditFileCount,
    traceFiles: traceFileCount,
    sqlite: sqliteMetrics,
    swarmWorkers: getSwarmWorkers(),
    system: osMetrics,
    // Note: cost prop moved to tokens.cost - DashboardData doesn't have top-level cost
    sla: {
      uptime:
        aggregated.sloTotal > 0
          ? aggregated.sloCompliance
          : traceStats.totalTraces > 0
            ? (1 - traceStats.errorRate) * 100
            : 0,
      incidents: aggregated.sloViolations,
      lastIncident: null,
      sloCompliance:
        aggregated.sloTotal > 0
          ? aggregated.sloCompliance
          : traceStats.totalTraces > 0
            ? (1 - traceStats.errorRate) * 100
            : 0,
      responseTime95th: aggregated.p95Latency || traceStats.avgDuration,
      throughput: sessionTotal,
    },
    feedback: {
      total: aggregated.feedbackTotal,
      thumbsUp: aggregated.feedbackUp,
      thumbsDown: aggregated.feedbackDown,
      score:
        aggregated.feedbackTotal > 0 ? (aggregated.feedbackUp / aggregated.feedbackTotal) * 100 : 0,
    },
    costInsights,
    operational: operationalMetrics || {
      velocity: {
        commitsPerHour: 0,
        filesModifiedPerSession: 0,
        linesAdded: 0,
        linesDeleted: 0,
        avgTimeBetweenCommits: 0,
      },
      efficiency: {
        avgToolLatency: 0,
        successRate: 0,
        fastestTool: 'No data',
        slowestTool: 'No data',
        responseTimeP95: 0,
      },
      productivity: {
        skillsUsed: 0,
        uniqueSkills: [],
        agentsActive: 0,
        tasksCompleted: 0,
        sessionsCompleted: 0,
      },
      quality: {
        buildSuccessRate: 0,
        testPassRate: 0,
        errorsDetected: 0,
        autoCorrections: 0,
        typeCheckFailures: 0,
      },
      totalOperations: 0,
      lastUpdated: new Date().toISOString(),
    },
    globalHealth: {
      repositories: [],
      overallStatus: 'healthy',
      totalRepos: 1,
      healthyRepos: 1,
      degradedRepos: 0,
      criticalRepos: 0,
      avgCoverage: 100,
      totalOpenPRs: 0,
      lastUpdated: new Date().toISOString(),
    },
    stackCapabilities: getStackCapabilities(),
  };
}

// Zero-filled operational metrics shape. Shared by the JSON and DB metric
// paths so /api/metrics always exposes `operational` regardless of tenant scope.
export function defaultOperationalMetrics(): DashboardData['operational'] {
  return {
    velocity: {
      commitsPerHour: 0,
      filesModifiedPerSession: 0,
      linesAdded: 0,
      linesDeleted: 0,
      avgTimeBetweenCommits: 0,
    },
    efficiency: {
      avgToolLatency: 0,
      successRate: 0,
      fastestTool: 'No data',
      slowestTool: 'No data',
      responseTimeP95: 0,
    },
    productivity: {
      skillsUsed: 0,
      uniqueSkills: [],
      agentsActive: 0,
      tasksCompleted: 0,
      sessionsCompleted: 0,
    },
    quality: {
      buildSuccessRate: 0,
      testPassRate: 0,
      errorsDetected: 0,
      autoCorrections: 0,
      typeCheckFailures: 0,
    },
    totalOperations: 0,
    lastUpdated: new Date().toISOString(),
  } as DashboardData['operational'];
}

export function getRealMetricsFromDb(tenantId = DEFAULT_TENANT_ID): DashboardData {
  const db = getDb();
  const snapshot = db.getLatestMetricSnapshot(tenantId);
  const activeSessions = db
    .getActiveSessions(tenantId)
    .filter((s) => Date.now() - new Date(s.updated_at).getTime() < 3600000);
  const allSessions = db.getAllSessions(tenantId);
  const latencyStats = db.getLatencyStats(tenantId);
  const feedbackStats = db.getFeedbackStats(tenantId);
  const gitStats = getGitStats();
  const osMetrics = getOSMetrics();

  // MCP stats from skill-stats.json (still JSON-based as it's write-only)
  const skillStats = readJson<{
    totalCalls: number;
    callsByTool: Record<string, number>;
    callsBySkill: Record<string, number>;
    lastCall: string | null;
  }>(STATS_PATH) || { totalCalls: 0, callsByTool: {}, callsBySkill: {}, lastCall: null };

  const topSkills = Object.entries(skillStats.callsBySkill || {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([name]) => name);

  const skills = _countSkills(REGISTRY_PATH);

  // Compute byModel from traces in DB
  const traces = db
    .getDb()
    .prepare(
      'SELECT model, SUM(input_tokens) as inputTokens, SUM(output_tokens) as outputTokens, SUM(input_tokens + output_tokens) as totalTokens, SUM(cost) as cost, COUNT(*) as calls FROM traces WHERE tenant_id = ? AND model IS NOT NULL GROUP BY model',
    )
    .all(tenantId) as Array<{
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
    calls: number;
  }>;

  const byModel =
    traces.length > 0
      ? traces.map((t) => ({
          model: t.model,
          inputTokens: t.inputTokens,
          outputTokens: t.outputTokens,
          totalTokens: t.totalTokens,
          cost: t.cost,
          calls: t.calls,
        }))
      : [];

  // Snapshots are the fast path, but the token ledger is the source of truth
  // while the writer is catching up or after a zero-valued legacy snapshot.
  let recentTokenTotals = { tokens: 0, cost: 0 };
  try {
    recentTokenTotals = db
      .getDb()
      .prepare(
        `SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS tokens,
                COALESCE(SUM(cost), 0) AS cost
         FROM token_usage
         WHERE tenant_id = ? AND timestamp >= datetime('now', '-24 hours')`,
      )
      .get(tenantId) as typeof recentTokenTotals;
  } catch {
    // Token usage remains optional for older databases.
  }
  const totalTokens = snapshot?.tokens_used || recentTokenTotals.tokens || 0;
  const totalCost = snapshot?.cost || recentTokenTotals.cost || 0;

  // Cost insights
  const costInsights = byModel
    .map((m) => {
      const pct = totalCost > 0 ? Math.round((m.cost / totalCost) * 100) : 0;
      const pricing = MODEL_PRICING[m.model] || MODEL_PRICING['default'];
      const estimatedCost =
        (m.inputTokens / 1_000_000) * pricing.input + (m.outputTokens / 1_000_000) * pricing.output;
      const savings =
        estimatedCost > 0 ? Math.round(((estimatedCost - m.cost) / estimatedCost) * 100) : 0;
      let suggestedAction: string | undefined;
      if (pct > 50 && m.model !== 'big-pickle' && m.model !== 'claude-3-haiku') {
        suggestedAction = `Consider ${m.model} → big-pickle or claude-3-haiku for cost reduction`;
      } else if (m.inputTokens > m.outputTokens * 3 && m.outputTokens > 0) {
        suggestedAction = 'High input/output ratio — review prompt compression';
      }
      return {
        model: m.model,
        cost: m.cost,
        tokens: m.totalTokens,
        pct,
        estimatedCost,
        savingsPct: savings,
        suggestedAction,
        potentialSavings: estimatedCost - m.cost,
        roi: estimatedCost > 0 ? Math.round(((estimatedCost - m.cost) / estimatedCost) * 100) : 0,
      };
    })
    .sort((a, b) => b.cost - a.cost);

  // SLA
  const sla = {
    uptime: 0,
    incidents: 0,
    lastIncident: null,
    sloCompliance: 0,
    responseTime95th: latencyStats.p95,
    throughput: allSessions.length,
  };

  // Health
  const healthStatus = snapshot?.health_status ?? 'unknown';

  // Checkpoint / audit / trace counts (from filesystem, still JSON-based)
  const checkpointDir = join(ROOT, '.session', 'checkpoints');
  const checkpointCount = existsSync(checkpointDir)
    ? readdirSync(checkpointDir).filter((d) => !d.includes('.')).length
    : 0;
  const auditDir = join(ROOT, '.session', 'audit', 'logs');
  const auditFileCount = existsSync(auditDir)
    ? readdirSync(auditDir).filter((f) => f.endsWith('.jsonl')).length
    : 0;
  const traceDir = join(ROOT, '.telemetry', 'traces');
  const traceFileCount = existsSync(traceDir)
    ? readdirSync(traceDir).filter((f) => f.endsWith('.jsonl')).length
    : 0;
  const cloudMetricsFile = readJson<{ executions: unknown[] }>(
    join(ROOT, '.session', 'cloud-metrics.json'),
  );

  // ─── SQLite Stack Tables Metrics (Wave 37) ─────────────────────────
  let sqliteSkillCount = 0;
  let sqliteSkillAvgCost = 0;
  let sqliteTokenTotalCost = 0;
  let sqliteContractPassRate = 0;
  let sqliteRoutingTotalHits = 0;
  try {
    const topSkills = db.getTopSkills(100, tenantId);
    sqliteSkillCount = topSkills.length;
    sqliteSkillAvgCost =
      topSkills.length > 0
        ? topSkills.reduce((s: number, sk: any) => s + (sk.cost || 0), 0) / topSkills.length
        : 0;

    const tokenRows = db
      .getDb()
      .prepare('SELECT COALESCE(SUM(cost), 0) as totalCost FROM token_usage WHERE tenant_id = ?')
      .get(tenantId) as any;
    sqliteTokenTotalCost = tokenRows?.totalCost ?? 0;

    const contractRows = db
      .getDb()
      .prepare('SELECT result, COUNT(*) as cnt FROM contract_results GROUP BY result')
      .all() as Array<{ result: string; cnt: number }>;
    const totalContracts = contractRows.reduce((s: number, r: any) => s + (r.cnt || 0), 0);
    const passContracts = contractRows
      .filter((r: any) => r.result === 'pass' || r.result === 'valid' || r.result === 'success')
      .reduce((s: number, r: any) => s + (r.cnt || 0), 0);
    sqliteContractPassRate = totalContracts > 0 ? passContracts / totalContracts : 1;

    const routingHits = db
      .getDb()
      .prepare(
        'SELECT COALESCE(SUM(hit_count), 0) as totalHits FROM routing_rules WHERE tenant_id = ?',
      )
      .get(tenantId) as any;
    sqliteRoutingTotalHits = routingHits?.totalHits ?? 0;
  } catch {
    // Non-fatal — SQLite metrics default to 0
  }

  return {
    timestamp: new Date().toISOString(),
    source: 'sqlite',
    sourceClassification: classifyDashboardSource({ source: 'database', tenantId }),
    tokens: {
      used: totalTokens,
      limit: getConfiguredSessionTokenLimit(),
      cost: totalCost,
      byModel,
    },
    sessions: {
      total: allSessions.length,
      active: activeSessions.length,
      today: snapshot?.sessions_today ?? 0,
      avgDuration: latencyStats.avg,
    },
    latency: {
      avg: latencyStats.avg,
      p50: latencyStats.p50,
      p95: latencyStats.p95,
      p99: 0,
      max: 0,
      samples: latencyStats.count,
      responseTimes: {},
    },
    feedback: feedbackStats,
    costInsights,
    sla,
    git: gitStats,
    system: osMetrics,
    health: {
      status: healthStatus,
      routing: skillStats.totalCalls > 0 ? Math.min(100, skillStats.totalCalls) : 0,
    },
    mcp: {
      skills: { total: skills.total, byAgent: skills.byAgent, recentlyUsed: topSkills },
      calls: {
        total: skillStats.totalCalls,
        byTool: skillStats.callsByTool,
        bySkill: skillStats.callsBySkill,
        lastCall: skillStats.lastCall,
      },
      performance: {
        avgResponseTime: skillStats.totalCalls > 0 ? latencyStats.avg : 0,
        errorRate: 0,
        responseTimes: {},
      },
    },
    cloud: {
      executions: cloudMetricsFile?.executions?.length || 0,
      totalCost:
        cloudMetricsFile?.executions?.reduce((s: number, e: any) => s + (e.cost || 0), 0) || 0,
    },
    checkpoints: checkpointCount,
    auditLogs: auditFileCount,
    traceFiles: traceFileCount,
    sqlite: {
      skillCount: sqliteSkillCount,
      skillAvgCost: sqliteSkillAvgCost,
      tokenTotalCost: sqliteTokenTotalCost,
      contractPassRate: sqliteContractPassRate,
      routingTotalHits: sqliteRoutingTotalHits,
    },
    swarmWorkers: getSwarmWorkers(),
    stackCapabilities: getStackCapabilities(),
  };
}

export function getRealMetricsFromJson(): DashboardData {
  // Fallback: read from consolidated.json when DB is empty
  const consolidated = readJson<any>(CONSOLIDATED_PATH);
  const skillStats = readJson<{
    totalCalls: number;
    callsByTool: Record<string, number>;
    callsBySkill: Record<string, number>;
    lastCall: string | null;
  }>(STATS_PATH) || { totalCalls: 0, callsByTool: {}, callsBySkill: {}, lastCall: null };
  const tokenUsage = readJson<{ totalTokens?: number }>(join(ROOT, '.session', 'token-usage.json'));

  const gitLive = getGitStats();
  const osMetrics = getOSMetrics();
  const skills = _countSkills(REGISTRY_PATH);

  const topSkills = Object.entries(skillStats.callsBySkill || {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([name]) => name);

  const t = consolidated?.token || { usedToday: 0, budget: 120000, estCost: 0 };
  // Fallback chain for token usage: consolidated (MetricsWriter) →
  // .session/token-usage.json → Nexus token_usage (source of truth).
  if (!t.usedToday) {
    const fileTotal = tokenUsage?.totalTokens ?? 0;
    if (fileTotal > 0) {
      t.usedToday = fileTotal;
    } else if (dbAvailable()) {
      try {
        const row = getDb()
          .getDb()
          .prepare(
            'SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS total FROM token_usage WHERE tenant_id = ? AND timestamp >= ?',
          )
          .get(DEFAULT_TENANT_ID, new Date(Date.now() - 24 * 3600_000).toISOString()) as {
          total: number;
        };
        if (row.total > 0) {
          t.usedToday = row.total;
        }
      } catch {
        /* keep 0 */
      }
    }
  }
  const s = consolidated?.sessions || { total: 0, active: 0, today: 0 };

  // Try to get session counts from history file
  let sessionsTotal = s.total;
  let sessionsActive = s.active;
  let sessionsToday = s.today;
  try {
    const sessionsHistory =
      readJson<Array<{ id: string; status: string; createdAt: string }>>(SESSIONS_HISTORY_PATH) ||
      [];
    const today = new Date().toISOString().slice(0, 10);
    sessionsTotal = Math.max(s.total, sessionsHistory.length);
    sessionsActive = Math.max(
      s.active,
      sessionsHistory.filter((sh) => sh.status === 'active' || sh.status === 'awaiting_input')
        .length,
    );
    sessionsToday = Math.max(
      s.today,
      sessionsHistory.filter((sh) => (sh.createdAt || '').startsWith(today)).length,
    );
  } catch {
    // best-effort
  }

  // Context states for traces
  let latencyAvg = 0;
  let latencyP50 = 0;
  let latencyP95 = 0;
  let latencyCount = 0;
  try {
    if (existsSync(CONTEXT_LOG_DIR)) {
      const dirs = readdirSync(CONTEXT_LOG_DIR, { withFileTypes: true });
      const allDurations: number[] = [];
      for (const d of dirs) {
        if (!d.isDirectory()) continue;
        const stateFile = join(CONTEXT_LOG_DIR, d.name, '.state.json');
        if (!existsSync(stateFile)) continue;
        const state = JSON.parse(readWithCache(stateFile)) as {
          turns?: Array<{ totalTokens?: number }>;
        };
        if (state?.turns) {
          for (const turn of state.turns) {
            if (turn.totalTokens) allDurations.push(turn.totalTokens);
          }
        }
      }
      if (allDurations.length > 0) {
        allDurations.sort((a, b) => a - b);
        latencyAvg = Math.round(allDurations.reduce((a, b) => a + b, 0) / allDurations.length);
        latencyP50 = allDurations[Math.floor(allDurations.length * 0.5)] || 0;
        latencyP95 = allDurations[Math.floor(allDurations.length * 0.95)] || 0;
        latencyCount = allDurations.length;
      }
    }
  } catch {
    // best-effort
  }

  return {
    timestamp: new Date().toISOString(),
    source: 'json',
    sourceClassification: classifyDashboardSource({
      source: 'filesystem',
      filesystemMetadata: SYSTEM_WIDE_FILESYSTEM_METADATA,
    }),
    tokens: {
      used: t.usedToday || tokenUsage?.totalTokens || 0,
      limit: getConfiguredSessionTokenLimit(),
      cost: t.estCost || 0,
      byModel: [],
    },
    sessions: {
      total: sessionsTotal,
      active: sessionsActive,
      today: sessionsToday,
      avgDuration: 0,
    },
    latency: {
      avg: latencyAvg,
      p50: latencyP50,
      p95: latencyP95,
      p99: latencyP95,
      max: 0,
      samples: latencyCount,
      responseTimes: {},
    },
    feedback: { thumbsUp: 0, thumbsDown: 0, total: 0, score: 0 },
    costInsights: [],
    sla: {
      uptime: 0,
      incidents: 0,
      lastIncident: null,
      sloCompliance: 0,
      responseTime95th: 0,
      throughput: 0,
    },
    git: gitLive,
    system: osMetrics,
    health: {
      status: consolidated?.live?.trafficLight === 'GREEN' ? 'healthy' : 'degraded',
      routing: skillStats.totalCalls > 0 ? Math.min(100, skillStats.totalCalls) : 0,
    },
    mcp: {
      skills: { total: skills.total, byAgent: skills.byAgent, recentlyUsed: topSkills },
      calls: {
        total: skillStats.totalCalls,
        byTool: skillStats.callsByTool,
        bySkill: skillStats.callsBySkill,
        lastCall: skillStats.lastCall,
      },
      performance: {
        avgResponseTime: 0,
        errorRate: 0,
        responseTimes: {},
      },
    },
    cloud: { executions: 0, totalCost: 0 },
    checkpoints: 0,
    auditLogs: 0,
    traceFiles: 0,
    stackCapabilities: getStackCapabilities(),
  };
}

// ─── Cloud Metrics ────────────────────────────────────────────────────

export function getCloudMetrics(): CloudMetrics {
  const cloudPath = join(ROOT, '.session', 'cloud-metrics.json');
  const cloudData = readJson<{
    executions: Array<{
      provider: string;
      timestamp: string;
      duration: number;
      success: boolean;
      cost: number;
    }>;
  }>(cloudPath);
  const execs = cloudData?.executions || [];

  const byProvider: Record<
    string,
    { executions: number[]; costs: number[]; successes: boolean[] }
  > = {};
  for (const ex of execs) {
    if (!byProvider[ex.provider])
      byProvider[ex.provider] = { executions: [], costs: [], successes: [] };
    byProvider[ex.provider].executions.push(ex.duration);
    byProvider[ex.provider].costs.push(ex.cost);
    byProvider[ex.provider].successes.push(ex.success);
  }

  const stats = {
    totalExecutions: execs.length,
    totalCost: execs.reduce((s, e) => s + e.cost, 0),
    successRate: execs.length > 0 ? execs.filter((e) => e.success).length / execs.length : 1,
    avgLatency:
      execs.length > 0 ? Math.round(execs.reduce((s, e) => s + e.duration, 0) / execs.length) : 0,
    byProvider: {} as Record<
      string,
      { executions: number; cost: number; successRate: number; avgLatency: number }
    >,
    circuitBreakerStates: { AWS: 'CLOSED', Azure: 'CLOSED' },
  };

  for (const [provider, data] of Object.entries(byProvider)) {
    stats.byProvider[provider] = {
      executions: data.executions.length,
      cost: data.costs.reduce((s, c) => s + c, 0),
      successRate: data.successes.filter(Boolean).length / data.successes.length,
      avgLatency: Math.round(data.executions.reduce((s, d) => s + d, 0) / data.executions.length),
    };
  }

  return {
    executions: execs,
    stats,
    sourceClassification: classifyDashboardSource({
      source: 'filesystem',
      filesystemMetadata: SYSTEM_WIDE_FILESYSTEM_METADATA,
    }),
  };
}

// ─── Tenant-Scoped Metrics ────────────────────────────────────────────

export function getTenantScopedMetrics(tenantId: string): DashboardData {
  // LRU-cached (TTL 3s < WS push interval): absorbs REST bursts between pushes.
  return getOrLoad('tenant-metrics', tenantId, () => computeTenantScopedMetrics(tenantId));
}

export function computeTenantScopedMetrics(tenantId: string): DashboardData {
  const registryPath = join(ROOT, 'config', 'tenant-registry.json');
  let tenantName = tenantId;
  try {
    if (existsSync(registryPath)) {
      const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
      const found = (registry.tenants || []).find((t: any) => t.id === tenantId);
      if (found) tenantName = found.name || tenantId;
    }
  } catch {
    /* fallback to tenantId */
  }

  const base = dbAvailable() ? getRealMetricsFromDb(tenantId) : emptyTenantMetrics(tenantId);

  // Try DB for tenant-specific session count
  let sessionCount = 0;
  if (dbAvailable()) {
    try {
      const db = getDb();
      const result = db
        .getDb()
        .prepare('SELECT COUNT(*) as count FROM sessions WHERE tenant_id = ?')
        .get(tenantId) as { count: number };
      sessionCount = result.count;
    } catch {
      // fallback
    }
  }

  return {
    ...base,
    sessions: { ...base.sessions, total: sessionCount || base.sessions.total },
    operational: OperationalMetricsTracker.calculateMetrics() || defaultOperationalMetrics(),
    tenantId,
    tenantName,
  };
}

export function emptyTenantMetrics(tenantId: string): DashboardData {
  return {
    timestamp: new Date().toISOString(),
    source: 'sqlite',
    sourceClassification: classifyDashboardSource({ source: 'database', tenantId }),
    tenantId,
    tenantName: tenantId,
    tokens: { used: 0, limit: getConfiguredSessionTokenLimit(), cost: 0, byModel: [] },
    sessions: { total: 0, active: 0, today: 0, avgDuration: 0 },
    latency: { avg: 0, p50: 0, p95: 0, p99: 0, max: 0, samples: 0, responseTimes: {} },
    feedback: { total: 0, thumbsUp: 0, thumbsDown: 0, score: 0 },
  } as unknown as DashboardData;
}
