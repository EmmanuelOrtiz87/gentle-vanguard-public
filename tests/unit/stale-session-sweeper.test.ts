import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

import {
  sweepStaleSessions,
  syncContextLogStatus,
  parseSweepArgs,
  type SweepOptions,
} from '../../src/session/stale-session-sweeper.js';

/* ── Fixtures ── */

function makeTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, agent TEXT, status TEXT,
      created_at TEXT, updated_at TEXT, tokens_used INTEGER,
      cost REAL, message_count INTEGER, metadata TEXT, tenant_id TEXT
    );
    CREATE TABLE traces (
      span_id TEXT, trace_id TEXT, parent_span_id TEXT, name TEXT,
      start_time INTEGER, end_time INTEGER, duration INTEGER, status TEXT,
      model TEXT, input_tokens INTEGER, output_tokens INTEGER, cost REAL,
      session_id TEXT, attributes TEXT, tenant_id TEXT
    );
    CREATE TABLE token_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT, session_id TEXT,
      agent TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER,
      reasoning_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER,
      cost REAL, created_at TEXT, tenant_id TEXT
    );
  `);
  return db;
}

const NOW = Date.parse('2026-08-31T12:00:00.000Z');
const H = 3_600_000;
const D = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

function baseOpts(db: Database.Database, repoRoot: string, apply = false): SweepOptions {
  return {
    staleHours: 24,
    protectHours: 2,
    idleWindowDays: 7,
    apply,
    dbPath: ':memory:',
    syncContextLog: true,
    repoRoot,
  };
}

function insertSession(
  db: Database.Database,
  id: string,
  updatedAtMs: number,
  extra: { status?: string; tokens?: number; messages?: number } = {},
): void {
  db.prepare(
    `INSERT INTO sessions (id, agent, status, created_at, updated_at, tokens_used, cost, message_count, metadata, tenant_id)
     VALUES (?, 'test', ?, ?, ?, ?, 0, ?, NULL, 't')`,
  ).run(
    id,
    extra.status ?? 'active',
    iso(updatedAtMs - D),
    iso(updatedAtMs),
    extra.tokens ?? 0,
    extra.messages ?? 0,
  );
}

/* ── Tests ── */

test('classifies stale sessions: idle (recent traces), completed (lifetime activity), abandoned (empty)', () => {
  const db = makeTestDb();
  // updated 3 days ago -> candidate
  const t3d = NOW - 3 * D;

  insertSession(db, 'recent-trace', t3d); // trace within 7d -> idle
  db.prepare(
    `INSERT INTO traces (session_id, start_time, duration, status) VALUES (?, ?, 5, 'completed')`,
  ).run('recent-trace', NOW - 2 * D);

  // updated 10 days ago (beyond the 7d idle window), tokens > 0 -> completed
  insertSession(db, 'old-but-real', NOW - 10 * D, { tokens: 500 });
  db.prepare(
    `INSERT INTO traces (session_id, start_time, duration, status) VALUES (?, ?, 5, 'completed')`,
  ).run('old-but-real', NOW - 20 * D);

  insertSession(db, 'empty-ghost', NOW - 10 * D); // nothing anywhere, beyond idle window -> abandoned

  insertSession(db, 'live-session', NOW - 30 * 60 * 1000); // 30min ago -> protected

  const summary = sweepStaleSessions(db, baseOpts(db, '.'), NOW);

  assert.equal(summary.applied, false);
  assert.equal(summary.wouldSweep.length, 3);
  const byId = new Map(summary.wouldSweep.map((d) => [d.id, d.newStatus]));
  assert.equal(byId.get('recent-trace'), 'idle');
  assert.equal(byId.get('old-but-real'), 'completed');
  assert.equal(byId.get('empty-ghost'), 'abandoned');
  assert.equal(summary.skippedProtected, 1);
  // dry-run must not write
  const statuses = db.prepare(`SELECT id, status FROM sessions`).all() as Array<{
    id: string;
    status: string;
  }>;
  assert.ok(statuses.every((s) => s.status === 'active'));
});

test('apply writes statuses, is idempotent, and stamps metadata', () => {
  const db = makeTestDb();
  insertSession(db, 'ghost', NOW - 10 * D);

  const s1 = sweepStaleSessions(db, baseOpts(db, '.', true), NOW);
  assert.equal(s1.counts.abandoned, 1);
  assert.equal(
    (db.prepare(`SELECT status FROM sessions WHERE id='ghost'`).get() as { status: string }).status,
    'abandoned',
  );
  const meta = JSON.parse(
    (db.prepare(`SELECT metadata FROM sessions WHERE id='ghost'`).get() as { metadata: string })
      .metadata,
  ) as { swept: { to: string } };
  assert.equal(meta.swept.to, 'abandoned');
  // updated_at preserved
  const row = db.prepare(`SELECT updated_at FROM sessions WHERE id='ghost'`).get() as {
    updated_at: string;
  };
  assert.equal(row.updated_at, iso(NOW - 10 * D));

  // second run: no active candidates -> no-op (idempotent)
  const s2 = sweepStaleSessions(db, baseOpts(db, '.', true), NOW);
  assert.equal(s2.wouldSweep.length, 0);
  assert.equal(s2.remainingActive, 0);
});

test('hard floor: sessions updated within 2h are never touched even with tiny --stale-hours', () => {
  const db = makeTestDb();
  insertSession(db, 'just-now', NOW - 30 * 60 * 1000); // 30 min ago
  insertSession(db, '90min', NOW - 90 * 60 * 1000); // 1.5h ago

  const summary = sweepStaleSessions(db, { ...baseOpts(db, '.'), staleHours: 0.5 }, NOW);
  assert.equal(summary.wouldSweep.length, 0);
  assert.equal(summary.scannedActive, 2);
  assert.equal(summary.skippedProtected, 2);
});

test('token_transactions activity counts: recent tx -> idle, old tx -> completed', () => {
  const db = makeTestDb();
  const t3d = NOW - 3 * D;
  insertSession(db, 'tx-recent', t3d);
  db.prepare(`INSERT INTO token_transactions (session_id, created_at) VALUES (?, ?)`).run(
    'tx-recent',
    iso(NOW - 2 * D),
  );
  insertSession(db, 'tx-old', NOW - 10 * D);
  db.prepare(`INSERT INTO token_transactions (session_id, created_at) VALUES (?, ?)`).run(
    'tx-old',
    iso(NOW - 30 * D),
  );

  const summary = sweepStaleSessions(db, baseOpts(db, '.'), NOW);
  const byId = new Map(summary.wouldSweep.map((d) => [d.id, d.newStatus]));
  assert.equal(byId.get('tx-recent'), 'idle');
  assert.equal(byId.get('tx-old'), 'completed');
});

test('handles SQLite datetime() format and skips unparseable timestamps', () => {
  const db = makeTestDb();
  // SQL format ("YYYY-MM-DD HH:MM:SS"), 3 days old
  db.prepare(
    `INSERT INTO sessions (id, status, created_at, updated_at, tokens_used, message_count) VALUES ('sql-fmt', 'active', ?, ?, 0, 0)`,
  ).run(
    new Date(NOW - 3 * D).toISOString().slice(0, 19).replace('T', ' '),
    new Date(NOW - 3 * D).toISOString().slice(0, 19).replace('T', ' '),
  );
  // unparseable -> excluded (fail-safe)
  db.prepare(
    `INSERT INTO sessions (id, status, created_at, updated_at) VALUES ('garbage', 'active', 'nope', 'nope')`,
  ).run();

  const summary = sweepStaleSessions(db, baseOpts(db, '.'), NOW);
  assert.equal(summary.wouldSweep.length, 1);
  assert.equal(summary.wouldSweep[0].id, 'sql-fmt');
});

test('syncContextLogStatus rewrites .state.json and is best-effort on missing files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gv-sweep-'));
  try {
    const statePath = join(dir, '.session', 'context-log', 'sess-a', '.state.json');
    mkdirSync(join(dir, '.session', 'context-log', 'sess-a'), { recursive: true });
    writeFileSync(statePath, JSON.stringify({ sessionId: 'sess-a', status: 'active' }));

    const changed = syncContextLogStatus(dir, 'sess-a', 'abandoned', '2026-08-31T12:00:00Z');
    assert.equal(changed, true);
    const state = JSON.parse(readFileSync(statePath, 'utf-8')) as { status: string };
    assert.equal(state.status, 'abandoned');

    // already terminal -> no rewrite
    assert.equal(syncContextLogStatus(dir, 'sess-a', 'abandoned', '2026-08-31T12:00:00Z'), false);
    // missing file -> false, no throw
    assert.equal(syncContextLogStatus(dir, 'no-such-session', 'idle', 'x'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseSweepArgs parses flags and values', () => {
  const parsed = parseSweepArgs([
    'node',
    'script.ts',
    '--apply',
    '--stale-hours',
    '48',
    '--db',
    'x.db',
  ]);
  assert.equal(parsed.apply, true);
  assert.equal(parsed.staleHours, 48);
  assert.equal(parsed.dbPath, 'x.db');
});
