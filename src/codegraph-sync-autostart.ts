#!/usr/bin/env node
/**
 * CodeGraph sync step for session-autostart pipeline.
 * Verifies index freshness and syncs if stale.
 * TS migration of scripts/utilities/codegraph/codegraph-sync-autostart.ps1
 */

import { existsSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { runSync } from './core/run-command.js';
import { getEffectiveProcessTimeout } from './core/timeout-config';
import { pathToFileURL } from 'url';

const ROOT = resolve(process.cwd());
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
  const codegraphDir = join(repoRoot, '.codegraph');
  const dbPath = join(codegraphDir, 'codegraph.db');

  if (!existsSync(codegraphDir)) {
    result('WARN', "CodeGraph directory not found. Run 'codegraph init -i' first.");
    process.exit(0);
  }

  if (!existsSync(dbPath)) {
    result('WARN', "CodeGraph database not found. Run 'codegraph init -i' first.");
    process.exit(0);
  }

  const dbStat = statSync(dbPath);
  let dbLastWrite = dbStat.mtimeMs;

  // Check WAL and SHM files (SQLite WAL mode)
  for (const ext of ['.db-wal', '.db-shm']) {
    const p = join(codegraphDir, `codegraph${ext}`);
    if (existsSync(p)) {
      const mtime = statSync(p).mtimeMs;
      if (mtime > dbLastWrite) dbLastWrite = mtime;
    }
  }

  const dbAgeMinutes = Math.round(((Date.now() - dbLastWrite) / 60000) * 10) / 10;
  const dbSizeMB = Math.round((dbStat.size / (1024 * 1024)) * 100) / 100;
  const stalenessThresholdMinutes = 30;
  const needsSync = dbAgeMinutes > stalenessThresholdMinutes;

  if (needsSync) {
    console.log(
      `[INFO] CodeGraph index is ${dbAgeMinutes}min old (threshold: ${stalenessThresholdMinutes}min). Syncing...`,
    );
    try {
      const sync = runSync('codegraph', ['sync'], {
        cwd: repoRoot,
        stdio: 'pipe',
        timeout: getEffectiveProcessTimeout('long_running'),
      });
      if (sync.error && sync.status === null) throw sync.error;
      result('OK', `CodeGraph index synced successfully (was ${dbAgeMinutes}min old)`, {
        dbSizeMB,
        ageMinutes: dbAgeMinutes,
        action: 'synced',
      });
    } catch (e) {
      result('WARN', `CodeGraph sync failed: ${e instanceof Error ? e.message : String(e)}`, {
        dbSizeMB,
        ageMinutes: dbAgeMinutes,
        action: 'sync_error',
      });
    }
  } else {
    result('OK', `CodeGraph index is fresh (${dbAgeMinutes}min old, ${dbSizeMB}MB)`, {
      dbSizeMB,
      ageMinutes: dbAgeMinutes,
      action: 'fresh',
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
