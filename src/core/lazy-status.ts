#!/usr/bin/env node
/**
 * Lazy step status — reads the per-step outcomes written by lazy-step-runner.
 * A running record whose wrapper PID is gone is reported as stale (crashed),
 * not silently counted as running.
 */

import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface LazyStepResult {
  id: string;
  /** `daemon` = el watcher quedo vivo (o otra instancia es dueña por dedupe). */
  status: 'running' | 'ok' | 'daemon' | 'failed' | 'timeout' | 'stale';
  pid?: number;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  timeoutMs?: number;
  exitCode?: number | null;
  timedOut?: boolean;
  script?: string;
  error?: string;
  note?: string;
}

export interface LazyStatus {
  total: number;
  ok: number;
  failed: number;
  timeout: number;
  running: number;
  stale: number;
  results: LazyStepResult[];
}

function isAlive(pid: number | undefined): boolean {
  if (!pid || !Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function collectLazyStatus(
  root = process.cwd(),
  opts: { prune?: boolean; maxAgeDays?: number } = {},
): LazyStatus {
  const dir = join(resolve(root), '.runtime', 'autostart-lazy-results');
  const results: LazyStepResult[] = [];
  if (!existsSync(dir)) {
    return { total: 0, ok: 0, failed: 0, timeout: 0, running: 0, stale: 0, results };
  }
  const maxAgeMs = (opts.maxAgeDays ?? 7) * 24 * 60 * 60_000;
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
    const path = join(dir, file);
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8')) as LazyStepResult;
      let status = raw.status;
      if (status === 'running' && !isAlive(raw.pid)) status = 'stale';
      const finishedMs = Date.parse(raw.finishedAt ?? '') || 0;
      if (opts.prune && finishedMs > 0 && Date.now() - finishedMs > maxAgeMs) {
        unlinkSync(path);
        continue;
      }
      results.push({ ...raw, status });
    } catch {
      results.push({
        id: file.replace(/\.json$/, ''),
        status: 'failed',
        error: 'unreadable result',
      });
    }
  }
  results.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
  return {
    total: results.length,
    // Un daemon vivo cuenta como ok: el objetivo del step (que el watcher
    // quede corriendo) se cumple. Antes no estaba en la cuenta y el resumen
    // reportaba menos steps ok que los reales.
    ok: results.filter((r) => r.status === 'ok' || r.status === 'daemon').length,
    failed: results.filter((r) => r.status === 'failed').length,
    timeout: results.filter((r) => r.status === 'timeout').length,
    running: results.filter((r) => r.status === 'running').length,
    stale: results.filter((r) => r.status === 'stale').length,
    results,
  };
}

export function writeLazyStatus(root = process.cwd()): LazyStatus {
  const status = collectLazyStatus(root, { prune: true });
  try {
    writeFileSync(
      join(resolve(root), '.runtime', 'autostart-lazy-status.json'),
      `${JSON.stringify({ ...status, generatedAt: new Date().toISOString() }, null, 2)}\n`,
    );
  } catch {
    /* best effort */
  }
  return status;
}

function main(): void {
  const asJson = process.argv.includes('--json');
  const status = writeLazyStatus();
  if (asJson) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    console.log(
      `[lazy-status] ${status.total} steps: ${status.ok} ok, ${status.running} running, ` +
        `${status.failed} failed, ${status.timeout} timeout, ${status.stale} stale`,
    );
    for (const result of status.results.filter(
      (r) => r.status !== 'ok' && r.status !== 'running' && r.status !== 'daemon',
    )) {
      console.log(
        `  [${result.status.toUpperCase()}] ${result.id}${result.exitCode !== null && result.exitCode !== undefined ? ` (exit ${result.exitCode})` : ''}${result.error ? `: ${result.error}` : ''}`,
      );
    }
  }
  process.exit(status.failed + status.timeout + status.stale > 0 ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
