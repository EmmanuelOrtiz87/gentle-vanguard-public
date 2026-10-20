#!/usr/bin/env node
/**
 * nexus-backup-scheduled.ts — Wrapper silencioso para la tarea programada
 * diaria de Windows (Gentle-Vanguard-Nexus-Backup).
 *
 * Corre `db-backup.ts backup` (a .runtime/backups/) y poda a 14 copias con
 * `prune --keep 14`. Errors are logged and returned as a non-zero exit code so
 * Task Scheduler can report failures without opening a console window.
 *
 * Run (manual): npx tsx src/ops/nexus-backup-scheduled.ts
 * Run (tarea):  node.exe --import tsx src/ops/nexus-backup-scheduled.ts
 */

import { appendFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
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

export function runScheduledBackup(
  root = ROOT,
  runner: typeof runSync = runSync,
  writeLog: (message: string) => void = log,
): number {
  const script = join(root, 'scripts', 'database', 'db-backup.ts');
  const runStep = (name: string, args: string[], successMessage: string): boolean => {
    try {
      const result = runner(process.execPath, args, { cwd: root });
      if (result.status === 0) {
        writeLog(successMessage);
        return true;
      }
      writeLog(
        `${name}: FAIL (exit ${result.status ?? 'unknown'}) ${String(result.stderr).slice(-300)}`,
      );
    } catch (error) {
      writeLog(`${name}: FAIL ${error instanceof Error ? error.message : String(error)}`);
    }
    return false;
  };

  const backupOk = runStep('backup', ['--import', 'tsx', script, 'backup'], 'backup: OK');
  const pruneOk = runStep(
    'prune',
    ['--import', 'tsx', script, 'prune', '--keep', '14'],
    'prune: OK (keep 14)',
  );
  return backupOk && pruneOk ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = runScheduledBackup();
}
