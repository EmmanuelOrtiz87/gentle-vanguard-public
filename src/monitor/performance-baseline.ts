#!/usr/bin/env node
/** Baseline real de latencia, tokens y cache desde Nexus; nunca fabrica muestras. */
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface MetricSeries {
  samples: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface PerformanceBaseline {
  generatedAt: string;
  source: 'nexus';
  windowDays: number;
  latency: MetricSeries & { byRoute: Array<{ route: string; samples: number; p95: number }> };
  tokens: {
    samples: number;
    total: number;
    averagePerTransaction: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    byAgent: Array<{ agent: string; samples: number; average: number; total: number }>;
  };
  cache: {
    requests: number;
    hits: number;
    misses: number;
    hitRate: number;
    responseEntries: number;
    responseEntryHits: number;
    expiredEntries: number;
  };
  quality: {
    minSamples: number;
    latency: 'sufficient' | 'insufficient';
    tokens: 'sufficient' | 'insufficient';
    cache: 'sufficient' | 'insufficient';
  };
}

export interface RegressionResult {
  status: 'PASS' | 'NEUTRAL' | 'FAIL';
  checks: Array<{ metric: string; status: 'PASS' | 'NEUTRAL' | 'FAIL'; detail: string }>;
}

export function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

function summarize(values: number[]): MetricSeries {
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    samples: values.length,
    avg: values.length > 0 ? Math.round(total / values.length) : 0,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
  };
}

export function collectPerformanceBaseline(
  db: Database.Database,
  options: { windowDays?: number; minSamples?: number } = {},
): PerformanceBaseline {
  const windowDays = options.windowDays ?? 30;
  const minSamples = options.minSamples ?? 20;
  const cutoffMs = Date.now() - windowDays * 86_400_000;
  const cutoffIso = new Date(cutoffMs).toISOString();
  const tenant = 'gentle-vanguard';

  const traces = db
    .prepare(
      `SELECT name, duration FROM traces
       WHERE tenant_id = ? AND start_time >= ? AND status = 'completed'
         AND duration > 0 AND duration <= 600000`,
    )
    .all(tenant, cutoffMs) as Array<{ name: string; duration: number }>;
  const latency = summarize(traces.map((row) => row.duration));
  const routeBuckets = new Map<string, number[]>();
  for (const trace of traces) {
    const route = trace.name || 'unknown';
    const bucket = routeBuckets.get(route) ?? [];
    bucket.push(trace.duration);
    routeBuckets.set(route, bucket);
  }
  const byRoute = [...routeBuckets.entries()]
    .map(([route, values]) => ({ route, samples: values.length, p95: percentile(values, 95) }))
    .sort((a, b) => b.samples - a.samples)
    .slice(0, 20);

  const tokenRows = db
    .prepare(
      `SELECT COALESCE(NULLIF(agent, ''), 'unknown') agent,
              COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0) + COALESCE(reasoning_tokens, 0) total,
              COALESCE(cache_read_tokens, 0) cache_read,
              COALESCE(cache_write_tokens, 0) cache_write
       FROM token_transactions WHERE tenant_id = ? AND created_at >= ?`,
    )
    .all(tenant, cutoffIso) as Array<{
    agent: string;
    total: number;
    cache_read: number;
    cache_write: number;
  }>;
  const agentBuckets = new Map<string, number[]>();
  for (const row of tokenRows) {
    const bucket = agentBuckets.get(row.agent) ?? [];
    bucket.push(row.total);
    agentBuckets.set(row.agent, bucket);
  }
  const tokenTotal = tokenRows.reduce((sum, row) => sum + row.total, 0);
  const byAgent = [...agentBuckets.entries()]
    .map(([agent, values]) => ({
      agent,
      samples: values.length,
      average: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
      total: values.reduce((sum, value) => sum + value, 0),
    }))
    .sort((a, b) => b.total - a.total);

  const cacheTelemetry = db
    .prepare(
      `SELECT COALESCE(SUM(cache_hits), 0) hits, COALESCE(SUM(cache_misses), 0) misses
       FROM metric_snapshots WHERE tenant_id = ? AND timestamp >= ?`,
    )
    .get(tenant, cutoffIso) as { hits: number; misses: number };
  const cacheEntries = db
    .prepare(
      `SELECT COUNT(*) entries, COALESCE(SUM(hit_count), 0) hits,
              SUM(CASE WHEN expires_at IS NOT NULL AND expires_at < datetime('now') THEN 1 ELSE 0 END) expired
       FROM response_cache WHERE tenant_id = ?`,
    )
    .get(tenant) as { entries: number; hits: number; expired: number };
  const cacheRequests = cacheTelemetry.hits + cacheTelemetry.misses;

  return {
    generatedAt: new Date().toISOString(),
    source: 'nexus',
    windowDays,
    latency: { ...latency, byRoute },
    tokens: {
      samples: tokenRows.length,
      total: tokenTotal,
      averagePerTransaction: tokenRows.length > 0 ? Math.round(tokenTotal / tokenRows.length) : 0,
      cacheReadTokens: tokenRows.reduce((sum, row) => sum + row.cache_read, 0),
      cacheWriteTokens: tokenRows.reduce((sum, row) => sum + row.cache_write, 0),
      byAgent,
    },
    cache: {
      requests: cacheRequests,
      hits: cacheTelemetry.hits,
      misses: cacheTelemetry.misses,
      hitRate:
        cacheRequests > 0 ? Number(((cacheTelemetry.hits / cacheRequests) * 100).toFixed(2)) : 0,
      responseEntries: cacheEntries.entries,
      responseEntryHits: cacheEntries.hits,
      expiredEntries: cacheEntries.expired ?? 0,
    },
    quality: {
      minSamples,
      latency: traces.length >= minSamples ? 'sufficient' : 'insufficient',
      tokens: tokenRows.length >= minSamples ? 'sufficient' : 'insufficient',
      cache: cacheRequests >= minSamples ? 'sufficient' : 'insufficient',
    },
  };
}

export function evaluateRegression(
  current: PerformanceBaseline,
  accepted: PerformanceBaseline | null,
): RegressionResult {
  if (!accepted) {
    return {
      status: 'NEUTRAL',
      checks: [{ metric: 'baseline', status: 'NEUTRAL', detail: 'No accepted baseline' }],
    };
  }
  const checks: RegressionResult['checks'] = [];
  const compareIncrease = (
    metric: string,
    currentValue: number,
    baselineValue: number,
    ready: boolean,
    maxIncreasePct: number,
  ) => {
    if (!ready || baselineValue <= 0) {
      checks.push({ metric, status: 'NEUTRAL', detail: 'Insufficient comparable samples' });
      return;
    }
    const increase = ((currentValue - baselineValue) / baselineValue) * 100;
    checks.push({
      metric,
      status: increase > maxIncreasePct ? 'FAIL' : 'PASS',
      detail: `${increase.toFixed(2)}% change (limit +${maxIncreasePct}%)`,
    });
  };
  compareIncrease(
    'latency.p95',
    current.latency.p95,
    accepted.latency.p95,
    current.quality.latency === 'sufficient' && accepted.quality.latency === 'sufficient',
    20,
  );
  compareIncrease(
    'tokens.averagePerTransaction',
    current.tokens.averagePerTransaction,
    accepted.tokens.averagePerTransaction,
    current.quality.tokens === 'sufficient' && accepted.quality.tokens === 'sufficient',
    20,
  );
  const cacheReady =
    current.quality.cache === 'sufficient' && accepted.quality.cache === 'sufficient';
  const cacheDrop = accepted.cache.hitRate - current.cache.hitRate;
  checks.push({
    metric: 'cache.hitRate',
    status: !cacheReady ? 'NEUTRAL' : cacheDrop > 10 ? 'FAIL' : 'PASS',
    detail: cacheReady
      ? `${cacheDrop.toFixed(2)} point drop (limit 10)`
      : 'Insufficient comparable samples',
  });
  return {
    status: checks.some((check) => check.status === 'FAIL')
      ? 'FAIL'
      : checks.every((check) => check.status === 'NEUTRAL')
        ? 'NEUTRAL'
        : 'PASS',
    checks,
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const dbPath = resolve('.runtime', 'gentle-vanguard.db');
  const acceptedPath = resolve('.runtime', 'performance-baseline-accepted.json');
  const db = new Database(dbPath, { readonly: true });
  try {
    const current = collectPerformanceBaseline(db);
    const accepted = existsSync(acceptedPath)
      ? (JSON.parse(readFileSync(acceptedPath, 'utf8')) as PerformanceBaseline)
      : null;
    const regression = evaluateRegression(current, accepted);
    const result = { baseline: current, regression };
    if (args.includes('--write') || args.includes('--accept')) {
      const reportsDir = resolve('reports', 'audits');
      mkdirSync(reportsDir, { recursive: true });
      writeFileSync(
        join(reportsDir, 'performance-baseline-latest.json'),
        `${JSON.stringify(result, null, 2)}\n`,
      );
    }
    if (args.includes('--accept')) {
      mkdirSync(resolve('.runtime'), { recursive: true });
      writeFileSync(acceptedPath, `${JSON.stringify(current, null, 2)}\n`);
    }
    console.log(JSON.stringify(result, null, 2));
    if (args.includes('--gate') && regression.status === 'FAIL') process.exitCode = 1;
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
