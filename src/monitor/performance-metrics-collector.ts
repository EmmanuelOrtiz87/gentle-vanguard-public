#!/usr/bin/env tsx
/**
 * Performance Metrics Real-Time Dashboard
 *
 * Sistema de métricas en tiempo real para el dashboard de Gentle-Vanguard.
 * Expone métricas avanzadas de performance del stack.
 *
 * Usage:
 *   npx tsx src/monitor/performance-metrics-collector.ts --serve    # Iniciar servidor API
 *   npx tsx src/monitor/performance-metrics-collector.ts --collect  # Recolección única
 *   npx tsx src/monitor/performance-metrics-collector.ts --export    # Exportar métricas
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { join, resolve } from 'path';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { totalmem } from 'node:os';

const ROOT = resolve(process.cwd());
const METRICS_DIR = join(ROOT, '.runtime', 'performance-metrics');
const STATE_FILE = join(METRICS_DIR, 'metrics-state.json');
const HISTORY_FILE = join(METRICS_DIR, 'metrics-history.jsonl');

mkdirSync(METRICS_DIR, { recursive: true });

// ─── Configuration ─────────────────────────────────────────────────────────────
const CONFIG = {
  port: 9090,
  collectionInterval: 5000, // 5 segundos
  historyWindow: 3600, // 1 hora de historial

  metrics: {
    latency: { p50: true, p95: true, p99: true, p999: true },
    throughput: { requestsPerSecond: true, tokensPerSecond: true },
    errors: { rate: true, count: true, byCategory: true },
    resources: { cpu: true, memory: true, disk: true },
  },
};

// ─── Types ───────────────────────────────────────────────────────────────────────
interface LatencyMetrics {
  p50: number;
  p95: number;
  p99: number;
  p999: number;
  samples: number;
  source: 'trace-files' | 'unavailable';
}

interface ThroughputMetrics {
  requestsPerSecond: number;
  tokensPerSecond: number;
  operationsPerSecond: number;
  samples: number;
}

interface ErrorMetrics {
  rate: number;
  count: number;
  byCategory: Record<string, number>;
  samples: number;
}

interface ResourceMetrics {
  cpu: number | null;
  memory: number; // MB
  memoryPercent: number;
  disk: number | null; // GB free
}

interface TokenMetrics {
  total: number;
  input: number;
  output: number;
  cacheHitRate: number;
  efficiency: number; // output/total
  samples: number;
  source: 'nexus' | 'unavailable';
}

interface PerformanceMetrics {
  timestamp: number;
  sessionId: string;
  latency: LatencyMetrics;
  throughput: ThroughputMetrics;
  errors: ErrorMetrics;
  resources: ResourceMetrics;
  tokens: TokenMetrics;
  health: {
    score: number | null; // 0-100 when enough dimensions are observed
    components: Record<string, number>;
    status: 'measured' | 'insufficient';
  };
  dataQuality: {
    unavailable: string[];
  };
}

// ─── Logger ──────────────────────────────────────────────────────────────────────
function log(level: string, message: string, meta?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] ${message}`);
  if (meta) console.log('  ', JSON.stringify(meta, null, 2));
}

// ─── Metric Collection ──────────────────────────────────────────────────────────
async function collectLatencyMetrics(): Promise<LatencyMetrics> {
  // Calcular desde traces si existen
  const traces: number[] = [];

  // Leer archivos de trace recientes
  const traceDir = join(ROOT, '.telemetry', 'traces');
  try {
    const { readdirSync, readFileSync } = await import('fs');
    const files = readdirSync(traceDir).slice(-10); // Últimos 10 archivos

    for (const file of files) {
      const content = readFileSync(join(traceDir, file), 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      lines.forEach((line) => {
        try {
          const span = JSON.parse(line);
          if (span.duration_ms) traces.push(span.duration_ms);
        } catch {}
      });
    }
  } catch {
    // No trace files: report absence rather than estimated latency.
  }

  if (traces.length === 0) {
    return { p50: 0, p95: 0, p99: 0, p999: 0, samples: 0, source: 'unavailable' };
  }

  const sorted = traces.sort((a, b) => a - b);
  const percentile = (p: number) => {
    const index = Math.floor((p / 100) * sorted.length);
    return sorted[Math.min(index, sorted.length - 1)];
  };

  return {
    p50: percentile(50),
    p95: percentile(95),
    p99: percentile(99),
    p999: percentile(99.9),
    samples: traces.length,
    source: 'trace-files',
  };
}

async function collectThroughputMetrics(): Promise<ThroughputMetrics> {
  // Calcular desde Nexus DB
  try {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(join(ROOT, '.runtime', 'gentle-vanguard.db'), { readonly: true });

    // Obtener transacciones de los últimos 5 minutos
    const result = db
      .prepare(
        `
      SELECT COUNT(*) as count, 
             SUM(input_tokens + output_tokens + COALESCE(reasoning_tokens, 0)) as tokens
      FROM token_transactions
      WHERE tenant_id = 'gentle-vanguard' AND created_at > datetime('now', '-5 minutes')
    `,
      )
      .get() as { count?: number | null; tokens?: number | null };

    db.close();

    const requestsPerSecond = (result?.count || 0) / 300;
    const tokensPerSecond = (result?.tokens || 0) / 300;

    return {
      requestsPerSecond,
      tokensPerSecond,
      operationsPerSecond: requestsPerSecond,
      samples: result?.count || 0,
    };
  } catch {
    return { requestsPerSecond: 0, tokensPerSecond: 0, operationsPerSecond: 0, samples: 0 };
  }
}

async function collectResourceMetrics(): Promise<ResourceMetrics> {
  const memUsage = process.memoryUsage();
  const totalMem = totalmem();

  return {
    cpu: null,
    memory: Math.round(memUsage.heapUsed / 1024 / 1024),
    memoryPercent: Math.round((memUsage.heapUsed / totalMem) * 100),
    disk: null,
  };
}

async function collectTokenMetrics(): Promise<TokenMetrics> {
  let db: import('better-sqlite3').Database | null = null;
  try {
    const { default: Database } = await import('better-sqlite3');
    db = new Database(join(ROOT, '.runtime', 'gentle-vanguard.db'), { readonly: true });
    const row = db
      .prepare(
        `SELECT COUNT(*) samples, COALESCE(SUM(input_tokens), 0) input,
                COALESCE(SUM(output_tokens), 0) output,
                COALESCE(SUM(cache_read_tokens), 0) cache_read
         FROM token_transactions
         WHERE tenant_id = 'gentle-vanguard' AND created_at > datetime('now', '-5 minutes')`,
      )
      .get() as { samples: number; input: number; output: number; cache_read: number };
    const total = row.input + row.output;
    const cacheDenominator = total + row.cache_read;
    return {
      total,
      input: row.input,
      output: row.output,
      cacheHitRate: cacheDenominator > 0 ? (row.cache_read / cacheDenominator) * 100 : 0,
      efficiency: total > 0 ? row.output / total : 0,
      samples: row.samples,
      source: 'nexus',
    };
  } catch {
    return {
      total: 0,
      input: 0,
      output: 0,
      cacheHitRate: 0,
      efficiency: 0,
      samples: 0,
      source: 'unavailable',
    };
  } finally {
    db?.close();
  }
}

async function collectErrorMetrics(): Promise<ErrorMetrics> {
  let db: import('better-sqlite3').Database | null = null;
  try {
    const { default: Database } = await import('better-sqlite3');
    db = new Database(join(ROOT, '.runtime', 'gentle-vanguard.db'), { readonly: true });
    const cutoff = Date.now() - 5 * 60_000;
    const rows = db
      .prepare(
        `SELECT status, COUNT(*) count FROM traces
         WHERE tenant_id = 'gentle-vanguard' AND start_time >= ? GROUP BY status`,
      )
      .all(cutoff) as Array<{ status: string; count: number }>;
    const samples = rows.reduce((sum, row) => sum + row.count, 0);
    const byCategory = Object.fromEntries(rows.map((row) => [row.status || 'unknown', row.count]));
    const count = rows
      .filter((row) => !['completed', 'running'].includes(row.status))
      .reduce((sum, row) => sum + row.count, 0);
    return { rate: samples > 0 ? count / samples : 0, count, byCategory, samples };
  } catch {
    return { rate: 0, count: 0, byCategory: {}, samples: 0 };
  } finally {
    db?.close();
  }
}

async function calculateHealthScore(metrics: PerformanceMetrics): Promise<{
  score: number | null;
  components: Record<string, number>;
  status: 'measured' | 'insufficient';
}> {
  const components: Record<string, number> = {
    resources: Math.max(0, 100 - (metrics.resources.memory / 512) * 100),
  };
  if (metrics.latency.samples > 0)
    components.latency = Math.max(0, 100 - metrics.latency.p95 / 100);
  if (metrics.errors.samples > 0) components.errors = Math.max(0, 100 - metrics.errors.rate * 100);
  if (metrics.tokens.samples > 0) {
    const averageTokens = metrics.tokens.total / metrics.tokens.samples;
    components.tokens = Math.max(0, 100 - averageTokens / 1000);
  }

  if (Object.keys(components).length < 2) {
    return { score: null, components, status: 'insufficient' };
  }
  const score =
    Object.values(components).reduce((a, b) => a + b, 0) / Object.keys(components).length;

  return { score: Math.round(score), components, status: 'measured' };
}

// ─── Main Collection ─────────────────────────────────────────────────────────────
async function collectAllMetrics(): Promise<PerformanceMetrics> {
  const [latency, throughput, resources, tokens, errors] = await Promise.all([
    collectLatencyMetrics(),
    collectThroughputMetrics(),
    collectResourceMetrics(),
    collectTokenMetrics(),
    collectErrorMetrics(),
  ]);

  const metrics: PerformanceMetrics = {
    timestamp: Date.now(),
    sessionId: process.env.SESSION_ID || 'unknown',
    latency,
    throughput,
    errors,
    resources,
    tokens,
    health: { score: null, components: {}, status: 'insufficient' },
    dataQuality: {
      unavailable: [
        ...(latency.samples === 0 ? ['latency'] : []),
        ...(tokens.samples === 0 ? ['tokens'] : []),
        ...(errors.samples === 0 ? ['errors'] : []),
        'cpu',
        'disk',
      ],
    },
  };

  metrics.health = await calculateHealthScore(metrics);

  return metrics;
}

// ─── Storage ──────────────────────────────────────────────────────────────────────
function saveMetrics(metrics: PerformanceMetrics): void {
  // State actual
  writeFileSync(STATE_FILE, JSON.stringify(metrics, null, 2), 'utf-8');

  // Historial
  appendFileSync(HISTORY_FILE, JSON.stringify(metrics) + '\n', 'utf-8');
}

function loadCurrentMetrics(): PerformanceMetrics | null {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch {}
  return null;
}

function loadHistory(minutes: number = 60): PerformanceMetrics[] {
  try {
    const lines = readFileSync(HISTORY_FILE, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .slice(-minutes * 12); // ~5 segundos por métrica

    return lines.map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

// ─── HTTP API Server ─────────────────────────────────────────────────────────────
function startServer(): void {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    try {
      if (req.url === '/metrics/current') {
        const metrics = await collectAllMetrics();
        saveMetrics(metrics);
        res.end(JSON.stringify(metrics, null, 2));
      } else if (req.url === '/metrics/state') {
        const metrics = loadCurrentMetrics();
        res.end(JSON.stringify(metrics || { error: 'No metrics available' }, null, 2));
      } else if (req.url?.startsWith('/metrics/history')) {
        const params = new URLSearchParams(req.url.split('?')[1]);
        const minutes = parseInt(params.get('minutes') || '60');
        const history = loadHistory(minutes);
        res.end(JSON.stringify({ history, count: history.length }, null, 2));
      } else if (req.url === '/health') {
        const metrics = loadCurrentMetrics();
        res.end(
          JSON.stringify(
            {
              status: metrics?.health.status === 'measured' ? 'ok' : 'degraded',
              score: metrics?.health.score ?? null,
              timestamp: Date.now(),
            },
            null,
            2,
          ),
        );
      } else if (req.url === '/') {
        res.end(
          JSON.stringify(
            {
              service: 'Gentle-Vanguard Performance Metrics',
              version: '1.0.0',
              endpoints: [
                '/metrics/current - Current metrics',
                '/metrics/state - Last saved state',
                '/metrics/history?minutes=60 - Historical data',
                '/health - Health check',
              ],
            },
            null,
            2,
          ),
        );
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Not found' }, null, 2));
      }
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(err) }, null, 2));
    }
  });

  server.listen(CONFIG.port, () => {
    log('INFO', `Performance Metrics API listening on http://localhost:${CONFIG.port}`);
  });
}

// ─── Collection Loop ──────────────────────────────────────────────────────────────
async function runCollectionLoop(): Promise<void> {
  log('INFO', 'Starting metrics collection loop...');

  const collect = async () => {
    try {
      const metrics = await collectAllMetrics();
      saveMetrics(metrics);

      if (metrics.health.score !== null && metrics.health.score < 50) {
        log('WARN', `Health score low: ${metrics.health.score}`, metrics.health.components);
      }
    } catch (err) {
      log('ERROR', 'Collection error', { error: String(err) });
    }
  };

  await collect();
  setInterval(collect, CONFIG.collectionInterval);
}

// ─── CLI ──────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--serve')) {
    await runCollectionLoop();
    startServer();
  } else if (args.includes('--collect')) {
    const metrics = await collectAllMetrics();
    saveMetrics(metrics);
    console.log(JSON.stringify(metrics, null, 2));
  } else if (args.includes('--export')) {
    const history = loadHistory();
    const exportPath = join(METRICS_DIR, `export-${Date.now()}.json`);
    writeFileSync(exportPath, JSON.stringify(history, null, 2), 'utf-8');
    console.log(`Exported ${history.length} metrics to ${exportPath}`);
  } else {
    console.log('Performance Metrics Collector v1.0.0');
    console.log('');
    console.log('Usage:');
    console.log('  --serve    Start server with collection loop');
    console.log('  --collect  Collect metrics once');
    console.log('  --export   Export history to JSON');
    console.log('');
    console.log('API Endpoints:');
    console.log(`  http://localhost:${CONFIG.port}/metrics/current`);
    console.log(`  http://localhost:${CONFIG.port}/metrics/state`);
    console.log(`  http://localhost:${CONFIG.port}/metrics/history?minutes=60`);
    console.log(`  http://localhost:${CONFIG.port}/health`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    log('ERROR', 'Fatal error', { error: String(err) });
    process.exit(1);
  });
}

export { collectAllMetrics, loadCurrentMetrics, loadHistory };
