#!/usr/bin/env node
/** Generate real cache and latency evidence through the production response-cache path. */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseManager } from '../database/nexus/manager.js';
import { ResponseCache } from '../resilience/response-cache/cache.js';
import { generateCacheKey } from '../resilience/response-cache/sqlite.js';
import { recordCacheTelemetry } from '../resilience/response-cache/telemetry.js';

interface ExerciseReport {
  generatedAt: string;
  runId: string;
  operations: number;
  hits: number;
  misses: number;
  hitRate: number;
  telemetryBucketsWritten: number;
  latency: { minMs: number; avgMs: number; maxMs: number };
  cleanupChanges: number;
  status: 'PASS' | 'FAIL';
}

export function summarizeDurations(values: number[]): ExerciseReport['latency'] {
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    minMs: Number(Math.min(...values).toFixed(3)),
    avgMs: Number((total / values.length).toFixed(3)),
    maxMs: Number(Math.max(...values).toFixed(3)),
  };
}

export function runPerformanceExercise(root = process.cwd()): ExerciseReport {
  const runId = randomUUID();
  const cache = new ResponseCache({ useSqlite: true, enabled: true });
  const manager = DatabaseManager.getInstance();
  const hitInput = `gv-performance-exercise-hit-${runId}`;
  cache.set(hitInput, 'verified-cache-response', 32, 'maintenance', 10);

  const durations: number[] = [];
  let hits = 0;
  let misses = 0;
  const operations: Array<{ input: string; context: string }> = [];
  for (let i = 0; i < 20; i++) operations.push({ input: hitInput, context: 'maintenance' });
  for (let i = 0; i < 5; i++) {
    operations.push({ input: `gv-cache-miss-${runId}-${i}-${randomUUID()}`, context: 'isolated' });
  }

  for (const operation of operations) {
    const startedAt = Date.now();
    const started = performance.now();
    const result = cache.get(operation.input, operation.context);
    const measured = Math.max(0.001, performance.now() - started);
    durations.push(measured);
    if (result) hits++;
    else misses++;
    const spanId = randomUUID();
    manager.insertTrace({
      span_id: spanId,
      trace_id: `performance-exercise-${runId}`,
      name: result ? 'response-cache.hit' : 'response-cache.miss',
      start_time: startedAt,
      end_time: startedAt + measured,
      duration: measured,
      status: 'completed',
      attributes: JSON.stringify({ source: 'maintenance-performance-exercise', runId }),
    });
  }

  const telemetryBucketsWritten = recordCacheTelemetry();
  const hitKey = generateCacheKey(hitInput, 'maintenance');
  const cleanupChanges = manager
    .getDb()
    .prepare('DELETE FROM response_cache WHERE tenant_id = ? AND key = ?')
    .run('gentle-vanguard', hitKey).changes;
  const hitRate = Number(((hits / operations.length) * 100).toFixed(2));
  const report: ExerciseReport = {
    generatedAt: new Date().toISOString(),
    runId,
    operations: operations.length,
    hits,
    misses,
    hitRate,
    telemetryBucketsWritten,
    latency: summarizeDurations(durations),
    cleanupChanges,
    status: hits === 20 && misses === 5 && telemetryBucketsWritten === 1 ? 'PASS' : 'FAIL',
  };
  const reportDir = resolve(root, 'reports', 'audits');
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(
    resolve(reportDir, 'performance-exercise-latest.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  DatabaseManager.resetInstance();
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = runPerformanceExercise();
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'PASS') process.exitCode = 1;
}
