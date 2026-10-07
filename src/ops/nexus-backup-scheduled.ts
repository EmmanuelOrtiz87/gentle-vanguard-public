#!/usr/bin/env node
/**
 * nexus-backup-scheduled.ts — Wrapper silencioso para la tarea programada
 * diaria de Windows (Gentle-Vanguard-Nexus-Backup).
 *
 * Corre `db-backup.ts backup` (a .runtime/backups/) y poda a 14 copias con
 * `prune --keep 14`. Fail-safe total: cualquier error se registra y sale 0
 * — una tarea programada nunca debe ventanear errores ni dejar basura.
 *
 * Run (manual): npx tsx src/ops/nexus-backup-scheduled.ts
 * Run (tarea):  node.exe --import tsx src/ops/nexus-backup-scheduled.ts
 */

import { appendFileSync } from 'fs';
import { join, resolve } from 'path';
import { runSync } from '../core/run-command.js';

const ROOT = resolve(process.cwd());
const LOG = join(ROOT, '.runtime', 'nexus-backup-scheduled.log');

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    appendFileSync(LOG, line);
  } catch {
    /* best-effort */
  }
  console.log(msg);
}

function main(): void {
  const script = join(ROOT, 'scripts', 'database', 'db-backup.ts');
  const backup = runSync(process.execPath, ['--import', 'tsx', script, 'backup'], {
    cwd: ROOT,
  });
  if (backup.status === 0) {
    log('backup: OK');
  } else {
    log(`backup: FAIL (exit ${backup.status}) ${String(backup.stderr).slice(-300)}`);
  }

  const prune = runSync(process.execPath, ['--import', 'tsx', script, 'prune', '--keep', '14'], {
    cwd: ROOT,
  });
  if (prune.status === 0) {
    log('prune: OK (keep 14)');
  } else {
    log(`prune: FAIL (exit ${prune.status})`);
  }
}

try {
  main();
  process.exit(0);
} catch (err) {
  log(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(0); // fail-safe: la tarea programada no debe reportar error al scheduler
}
