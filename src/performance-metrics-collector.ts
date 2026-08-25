#!/usr/bin/env tsx
/**
 * Performance Metrics Real-Time Dashboard
 *
 * Sistema de métricas en tiempo real para el dashboard de Gentle-Vanguard.
 * Expone métricas avanzadas de performance del stack.
 *
 * Usage:
 *   npx tsx src/performance-metrics-collector.ts --serve    # Iniciar servidor API
 *   npx tsx src/performance-metrics-collector.ts --collect  # Recolección única
 *   npx tsx src/performance-metrics-collector.ts --export    # Exportar métricas
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { join, resolve } from 'path';
import { createServer, IncomingMessage, ServerResponse } from 'http';

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
}

interface ThroughputMetrics {
  requestsPerSecond: number;
  tokensPerSecond: number;
  operationsPerSecond: number;
}

interface ErrorMetrics {
  rate: number;
  count: number;
  byCategory: Record<string, number>;
}

interface ResourceMetrics {
  cpu: number;
  memory: number; // MB
  memoryPercent: number;
  disk: number; // GB free
}

interface TokenMetrics {
  total: number;
  input: number;
  output: number;
  cacheHitRate: number;
  efficiency: number; // output/total
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
    score: number; // 0-100
    components: Record<string, number>;
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
    // Fallback: usar valores estimados
    return { p50: 100, p95: 500, p99: 2000, p999: 5000 };
  }

  if (traces.length === 0) {
    return { p50: 100, p95: 500, p99: 2000, p999: 5000 };
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
      WHERE timestamp > datetime('now', '-5 minutes')
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
    };
  } catch {
    return { requestsPerSecond: 0, tokensPerSecond: 0, operationsPerSecond: 0 };
  }
}

async function collectResourceMetrics(): Promise<ResourceMetrics> {
  const memUsage = process.memoryUsage();
  const totalMem = require('os').totalmem();

  return {
    cpu: 0, // Requiere sampling
    memory: Math.round(memUsage.heapUsed / 1024 / 1024),
    memoryPercent: Math.round((memUsage.heapUsed / totalMem) * 100),
    disk: 0, // Requiere llamada al sistema
  };
}

async function collectTokenMetrics(): Promise<TokenMetrics> {
  try {
    // Intentar obtener de fuentes disponibles
    const sources = [
      join(ROOT, 'reports', 'stack-live-observability-latest.json'),
      join(ROOT, '.session', 'token-usage.json'),
    ];

    for (const source of sources) {
      if (existsSync(source)) {
        const data = JSON.parse(readFileSync(source, 'utf-8'));
        const tokens = data.tokenMetrics || data.tokens || data;
        const total = (tokens.input || 0) + (tokens.output || 0);

        return {
          total,
          input: tokens.input || 0,
          output: tokens.output || 0,
          cacheHitRate: tokens.cacheHitRate || 0,
          efficiency: total > 0 ? (tokens.output || 0) / total : 0,
        };
      }
    }
  } catch {}

  return { total: 0, input: 0, output: 0, cacheHitRate: 0, efficiency: 0 };
}

async function calculateHealthScore(
  metrics: PerformanceMetrics,
): Promise<{ score: number; components: Record<string, number> }> {
  const components: Record<string, number> = {
    latency: Math.max(0, 100 - metrics.latency.p95 / 100),
    throughput: Math.min(100, metrics.throughput.requestsPerSecond * 10),
    errors: Math.max(0, 100 - metrics.errors.rate * 100),
    resources: Math.max(0, 100 - metrics.resources.memoryPercent),
    tokens: Math.max(0, 100 - metrics.tokens.total / 100000),
  };

  const score =
    Object.values(components).reduce((a, b) => a + b, 0) / Object.keys(components).length;

  return { score: Math.round(score), components };
}

// ─── Main Collection ─────────────────────────────────────────────────────────────
async function collectAllMetrics(): Promise<PerformanceMetrics> {
  const [latency, throughput, resources, tokens] = await Promise.all([
    collectLatencyMetrics(),
    collectThroughputMetrics(),
    collectResourceMetrics(),
    collectTokenMetrics(),
  ]);

  const metrics: PerformanceMetrics = {
    timestamp: Date.now(),
    sessionId: process.env.SESSION_ID || 'unknown',
    latency,
    throughput,
    errors: { rate: 0, count: 0, byCategory: {} },
    resources,
    tokens,
    health: { score: 0, components: {} },
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
              status: metrics ? 'ok' : 'degraded',
              score: metrics?.health.score || 0,
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

      if (metrics.health.score < 50) {
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
