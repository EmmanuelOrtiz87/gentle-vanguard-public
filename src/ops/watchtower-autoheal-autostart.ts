#!/usr/bin/env node
/**
 * Watchtower Auto-Heal step for scheduled maintenance (Fase 6 N4).
 *
 * Runs the maintenance watchtower in `autoheal -Quiet` mode so daemons
 * (dashboard-ws, codegraph, gv-analytics, watchdog) are revived between
 * sessions without manual intervention. Registered as a Windows scheduled
 * task (Gentle-Vanguard-Watchtower-AutoHeal) by src/infrastructure/bootstrap.ts.
 *
 * Exit codes:
 *   0 — autoheal completed (PASS or WARN; findings reaped)
 *   1 — autoheal failed (unexpected error)
 */

import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { runSync } from '../core/run-command.js';
import { getEffectiveProcessTimeout } from '../core/timeout-config';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const args = process.argv.slice(2);
const asJson = args.includes('--json') || args.includes('-AsJson');

function result(status: string, message: string, data: Record<string, unknown> = {}): void {
  const ts = new Date().toISOString().slice(0, 19);
  if (asJson) {
    console.log(JSON.stringify({ status, message, timestamp: ts, ...data }));
  } else {
    console.log(`[${status}] ${message}`);
  }
}

function findRepoRoot(dir: string): string {
  let current = resolve(dir);
  while (current) {
    if (existsSync(join(current, 'config', 'orchestrator.json'))) return current;
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return dir;
}

function main(): void {
  const repoRoot = process.env.GENTLE_VANGUARD_BASE_DIR || findRepoRoot(ROOT);
  const watchtowerScript = join(repoRoot, 'src', 'core', 'maintenance-watchtower.ts');

  if (!existsSync(watchtowerScript)) {
    result('WARN', `Watchtower script not found at ${watchtowerScript}`);
    process.exit(0);
  }

  try {
    const run = runSync(
      process.execPath,
      ['--import', 'tsx', watchtowerScript, '-Action', 'autoheal', '-Quiet'],
      {
        cwd: repoRoot,
        stdio: 'pipe',
        timeout: getEffectiveProcessTimeout('long_running'),
      },
    );
    if (run.error && run.status === null) throw run.error;
    const summary =
      (run.stdout || '')
        .split('\n')
        .filter((l) => l.includes('PASS:'))
        .pop() || '';
    result('OK', `Watchtower autoheal completed${summary ? ` — ${summary.trim()}` : ''}`, {
      exitCode: run.status ?? 0,
      action: 'autoheal',
    });
  } catch (e) {
    result('WARN', `Watchtower autoheal failed: ${e instanceof Error ? e.message : String(e)}`, {
      action: 'autoheal_error',
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
