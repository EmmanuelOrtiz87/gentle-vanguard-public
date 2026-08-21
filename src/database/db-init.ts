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

const ROOT = resolve(process.cwd());
const DB_PATH = join(ROOT, '.runtime', 'gentle-vanguard.db');

const args = process.argv.slice(2);
const quiet = args.includes('--quiet');
const checkOnly = args.includes('--check');

function log(msg: string): void {
  if (!quiet) console.log(`[db-init] ${msg}`);
}

// ─── Lazy import DatabaseManager ───────────────────────────────────────────
// The dashboard's DatabaseManager resolves root relative to its own path.
// When imported from here, it correctly finds ../../../../ = repo root.

async function main(): Promise<number> {
  if (checkOnly) {
    if (!existsSync(DB_PATH)) {
      log('DB not found at ' + DB_PATH);
      return 1;
    }
    const size = statSync(DB_PATH).size;
    const sizeMB = (size / 1024 / 1024).toFixed(2);
    log(`DB exists: ${DB_PATH} (${sizeMB} MB)`);
    return 0;
  }

  // Dynamic import to avoid better-sqlite3 loading if just checking
  const { DatabaseManager } = await import('../../apps/web-dashboard/server/database/manager');

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

  log(`${tables.length} tables, ${totalRows} rows, ${sizeMB} MB`);
  log(`${migrations.length} migrations applied:`);
  for (const m of migrations) {
    log(`  ${m.id} @ ${m.applied_at}`);
  }

  // Auto WAL checkpoint if WAL file exceeds 1MB
  const WAL_PATH = DB_PATH + '-wal';
  if (existsSync(WAL_PATH)) {
    const walSize = statSync(WAL_PATH).size;
    if (walSize > 1_000_000) {
      raw.prepare('PRAGMA wal_checkpoint(TRUNCATE)').run();
      log(`WAL checkpoint triggered: ${(walSize / 1024 / 1024).toFixed(1)}MB`);
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

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[db-init] FATAL:', err.message);
    process.exit(1);
  });
