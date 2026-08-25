import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

import { MigrationRunner } from '../../apps/web-dashboard/server/database/repositories/MigrationRunner';
import { HousekeepingRepo } from '../../apps/web-dashboard/server/database/repositories/HousekeepingRepo';

test('MigrationRunner applies migrations atomically', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE _migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE response_cache (key TEXT PRIMARY KEY, response TEXT NOT NULL);
    INSERT INTO _migrations (id) VALUES
      ('001_initial_schema'), ('002_stack_tables'), ('003_session_scoring'), ('004_error_memory');
    ALTER TABLE response_cache ADD COLUMN input_embedding TEXT DEFAULT '{}';
  `);

  assert.throws(() => new MigrationRunner(db).runMigrations());
  assert.equal(
    db.prepare("SELECT 1 FROM pragma_table_info('response_cache') WHERE name = 'input_text'").get(),
    undefined,
  );
  assert.equal(
    db.prepare("SELECT 1 FROM _migrations WHERE id = '005_semantic_cache'").get(),
    undefined,
  );
  db.close();
});

test('pruneAll vacuums after its transaction completes', () => {
  const db = new Database(':memory:');
  new MigrationRunner(db).runMigrations();
  db.prepare('INSERT INTO metric_snapshots (timestamp) VALUES (?)').run('2000-01-01');
  for (let index = 0; index < 499; index += 1) {
    db.prepare('INSERT INTO metric_snapshots (timestamp) VALUES (?)').run('2000-01-01');
  }

  const result = new HousekeepingRepo(db).pruneAll();

  assert.deepEqual(result, { events: 0, cache: 0, tokenUsage: 0, skillUsage: 0 });
  const row = db.prepare('SELECT COUNT(*) as count FROM metric_snapshots').get() as {
    count: number;
  };
  assert.equal(row.count, 500);
  db.close();
});

test('DatabaseManager applies the configured SQLite busy timeout', async () => {
  const dbDir = mkdtempSync(join(tmpdir(), 'gentle-vanguard-db-'));
  const previousDir = process.env.GENTLE_VANGUARD_DB_DIR;
  const previousFile = process.env.GENTLE_VANGUARD_DB_FILE;
  process.env.GENTLE_VANGUARD_DB_DIR = dbDir;
  process.env.GENTLE_VANGUARD_DB_FILE = 'reliability-test.db';

  try {
    const { DatabaseManager } = await import('../../apps/web-dashboard/server/database/manager');
    const manager = DatabaseManager.getInstance();
    assert.equal(manager.getDb().pragma('busy_timeout', { simple: true }), 5000);
    DatabaseManager.resetInstance();
  } finally {
    if (previousDir === undefined) delete process.env.GENTLE_VANGUARD_DB_DIR;
    else process.env.GENTLE_VANGUARD_DB_DIR = previousDir;
    if (previousFile === undefined) delete process.env.GENTLE_VANGUARD_DB_FILE;
    else process.env.GENTLE_VANGUARD_DB_FILE = previousFile;
    rmSync(dbDir, { recursive: true, force: true });
  }
});
