#!/usr/bin/env node
/**
 * CodeGraph sync step for session-autostart pipeline.
 * Verifies index freshness and syncs if stale.
 * TS migration of scripts/utilities/codegraph/codegraph-sync-autostart.ps1
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { runSync } from '../core/run-command.js';
import { getEffectiveProcessTimeout } from '../core/timeout-config.js';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';
import type Database from 'better-sqlite3';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const args = process.argv.slice(2);
const asJson = args.includes('--json') || args.includes('-AsJson');

/**
 * El WAL de CodeGraph creció a 579 MB sin checkpoint (2026-11-18): cada sync
 * agrega paginas al WAL y nadie las consolida. Umbral alto a proposito: un
 * checkpoint barato cada sesion no aporta, y TRUNCATE con lectores activos
 * devuelve `busy` (se informa tal cual, no se fuerza).
 */
const WAL_CHECKPOINT_THRESHOLD_BYTES = 100 * 1024 * 1024;

const _require = createRequire(import.meta.url);

function mb(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

interface CheckpointResult {
  action: 'skipped' | 'truncated' | 'busy' | 'error';
  walMbBefore: number;
  walMbAfter: number;
  detail?: string;
}

function checkpointWal(codegraphDir: string): CheckpointResult {
  const walPath = join(codegraphDir, 'codegraph.db-wal');
  const before = existsSync(walPath) ? statSync(walPath).size : 0;
  if (before < WAL_CHECKPOINT_THRESHOLD_BYTES) {
    return { action: 'skipped', walMbBefore: mb(before), walMbAfter: mb(before) };
  }
  let db: Database.Database | undefined;
  try {
    const DatabaseCtor = _require('better-sqlite3') as typeof Database;
    db = new DatabaseCtor(join(codegraphDir, 'codegraph.db'));
    const row = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as
      { busy?: number; checkpointed?: number } | undefined;
    const after = existsSync(walPath) ? statSync(walPath).size : 0;
    if (row?.busy) {
      return {
        action: 'busy',
        walMbBefore: mb(before),
        walMbAfter: mb(after),
        detail: 'lectores activos: se reintenta en la proxima sesion',
      };
    }
    return { action: 'truncated', walMbBefore: mb(before), walMbAfter: mb(after) };
  } catch (e) {
    return {
      action: 'error',
      walMbBefore: mb(before),
      walMbAfter: mb(before),
      detail: e instanceof Error ? e.message : String(e),
    };
  } finally {
    db?.close();
  }
}

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

/** Estado declarado del codegraph (`config/codegraph.config.json`). */
function readCodegraphState(repoRoot: string): { enabled: boolean; reason?: string } {
  const path = join(repoRoot, 'config', 'codegraph.config.json');
  if (!existsSync(path)) return { enabled: true };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as {
      enabled?: boolean;
      reason?: string;
    };
    return { enabled: parsed.enabled !== false, reason: parsed.reason };
  } catch {
    return { enabled: true };
  }
}

function main(): void {
  const repoRoot = process.env.GENTLE_VANGUARD_BASE_DIR || findRepoRoot(ROOT);
  const codegraphDir = join(repoRoot, '.codegraph');
  const dbPath = join(codegraphDir, 'codegraph.db');

  // Decision DECLARADA (2026-11-18): con codegraph desactivado, este paso NO
  // reconstruye el indice. Sin este chequeo, el autostart reindexaba 956 MB
  // en cada sesion y desmentia la decision tomada.
  const state = readCodegraphState(repoRoot);
  if (!state.enabled) {
    result(
      'SKIP',
      `CodeGraph desactivado por config: no se reindexa. ${state.reason ?? ''}`.trim(),
      {
        action: 'disabled',
      },
    );
    process.exit(0);
  }

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

  const checkpoint = checkpointWal(codegraphDir);
  if (checkpoint.action !== 'skipped') {
    const summary = `WAL ${checkpoint.walMbBefore}MB -> ${checkpoint.walMbAfter}MB`;
    const line =
      checkpoint.action === 'truncated'
        ? `WAL checkpoint TRUNCATE: ${summary}`
        : `WAL checkpoint ${checkpoint.action}: ${summary}${checkpoint.detail ? ` (${checkpoint.detail})` : ''}`;
    result(checkpoint.action === 'truncated' ? 'OK' : 'WARN', line, { wal: checkpoint });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
