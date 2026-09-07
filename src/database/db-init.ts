#!/usr/bin/env node

/**
 * db-init.ts — Standalone DB initializer for Gentle-Vanguard
 *
 * Called as a pipeline step in session-autostart.config.json to ensure
 * gentile-vanguard.db is created and all migrations are applied.
 * Idempotent — safe to run multiple times.
 *
 * Usage:
 *   npx tsx src/database/db-init.ts            # Initialize DB, print summary
 *   npx tsx src/database/db-init.ts --quiet    # Silent mode (for pipeline)
 *   npx tsx src/database/db-init.ts --check    # Check only, don't init
 */

import { existsSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

const ROOT = resolve(process.cwd());
const DB_PATH = join(ROOT, '.runtime', 'gentle-vanguard.db');

export interface DbInitOptions {
  quiet?: boolean;
  checkOnly?: boolean;
}

export interface DbInitResult {
  status: 'ok' | 'missing';
  path: string;
  sizeBytes: number;
  tables?: number;
  rows?: number;
  migrations?: number;
}

function log(quiet: boolean, msg: string): void {
  if (!quiet) console.log(`[db-init] ${msg}`);
}

// ─── Lazy import DatabaseManager ───────────────────────────────────────────
// The dashboard's DatabaseManager resolves root relative to its own path.
// When imported from here, it correctly finds ../../../../ = repo root.

/** Library entry: init (or check) the DB without process-level side effects. */
export async function initDb(options: DbInitOptions = {}): Promise<DbInitResult> {
  const quiet = options.quiet ?? false;
  const checkOnly = options.checkOnly ?? false;

  if (checkOnly) {
    if (!existsSync(DB_PATH)) {
      log(quiet, 'DB not found at ' + DB_PATH);
      return { status: 'missing', path: DB_PATH, sizeBytes: 0 };
    }
    const size = statSync(DB_PATH).size;
    log(quiet, `DB exists: ${DB_PATH} (${(size / 1024 / 1024).toFixed(2)} MB)`);
    return { status: 'ok', path: DB_PATH, sizeBytes: size };
  }

  // Dynamic import to avoid better-sqlite3 loading if just checking
  const { DatabaseManager } = await import('./nexus/manager.js');

  const db = DatabaseManager.getInstance();

  // Collect table stats
  const raw = db.getDb();
  const tables = raw
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_%' ORDER BY name`,
    )
    .all() as { name: string }[];

  const totalRows = tables.reduce((sum, t) => {
    const row = raw.prepare(`SELECT COUNT(*) as cnt FROM [${t.name}]`).get() as { cnt: number };
    return sum + row.cnt;
  }, 0);

  const size = existsSync(DB_PATH) ? statSync(DB_PATH).size : 0;
  const sizeMB = (size / 1024 / 1024).toFixed(2);
  const migrations = raw
    .prepare('SELECT id, applied_at FROM _migrations ORDER BY applied_at')
    .all() as { id: string; applied_at: string }[];

  log(quiet, `${tables.length} tables, ${totalRows} rows, ${sizeMB} MB`);
  log(quiet, `${migrations.length} migrations applied:`);
  for (const m of migrations) {
    log(quiet, `  ${m.id} @ ${m.applied_at}`);
  }

  // Auto WAL checkpoint if WAL file exceeds 1MB
  const WAL_PATH = DB_PATH + '-wal';
  if (existsSync(WAL_PATH)) {
    const walSize = statSync(WAL_PATH).size;
    if (walSize > 1_000_000) {
      raw.prepare('PRAGMA wal_checkpoint(TRUNCATE)').run();
      log(quiet, `WAL checkpoint triggered: ${(walSize / 1024 / 1024).toFixed(1)}MB`);
    }
  }

  // Output JSON for pipeline consumption
  if (!quiet) {
    console.log(
      JSON.stringify(
        {
          status: 'ok',
          path: DB_PATH,
          sizeBytes: size,
          tables: tables.length,
          rows: totalRows,
          migrations: migrations.length,
        },
        null,
        2,
      ),
    );
  }

  return {
    status: 'ok',
    path: DB_PATH,
    sizeBytes: size,
    tables: tables.length,
    rows: totalRows,
    migrations: migrations.length,
  };
}

// CLI entry — guard keeps imports side-effect free when loaded as a library.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const quiet = args.includes('--quiet');
  const checkOnly = args.includes('--check');
  initDb({ quiet, checkOnly })
    .then((result) => process.exit(result.status === 'ok' ? 0 : 1))
    .catch((err) => {
      console.error('[db-init] FATAL:', err.message);
      process.exit(1);
    });
}
