/**
 * Unit tests for backfillTraces (src/session/session-id-bridge.ts) — temporal
 * window matching over an in-memory sqlite with the Nexus shapes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { backfillTraces } from '../../src/session/session-id-bridge.js';

function makeTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, agent TEXT, status TEXT,
      created_at TEXT, updated_at TEXT, tokens_used INTEGER,
      cost REAL, message_count INTEGER, metadata TEXT, tenant_id TEXT
    );
    CREATE TABLE traces (
      span_id TEXT PRIMARY KEY, trace_id TEXT NOT NULL, parent_span_id TEXT,
      name TEXT NOT NULL, start_time INTEGER NOT NULL, end_time INTEGER,
      duration INTEGER, status TEXT DEFAULT 'running', model TEXT,
      input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
      cost REAL DEFAULT 0, session_id TEXT, attributes TEXT,
      tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard'
    );
  `);
  return db;
}

const HOUR = 3_600_000;

function addSession(db: Database.Database, id: string, iso: string): void {
  db.prepare(
    `INSERT INTO sessions (id, agent, status, created_at, updated_at) VALUES (?, 'test', 'active', ?, ?)`,
  ).run(id, iso, iso);
}

function addTrace(
  db: Database.Database,
  span: string,
  tsMs: number,
  sessionId: string | null,
): void {
  db.prepare(
    `INSERT INTO traces (span_id, trace_id, name, start_time, session_id) VALUES (?, 't', 'op', ?, ?)`,
  ).run(span, tsMs, sessionId);
}

test('backfillTraces: unique window match assigns session id', () => {
  const db = makeTestDb();
  const t0 = Date.parse('2026-08-30T10:00:00Z');
  addSession(db, 'session-A', new Date(t0).toISOString());
  addSession(db, 'session-B', new Date(t0 + 4 * HOUR).toISOString());
  addTrace(db, 'span-1', t0 + HOUR, null); // inside session-A window
  addTrace(db, 'span-2', t0 + 5 * HOUR, null); // inside session-B window

  const dry = backfillTraces(db, {});
  assert.equal(dry.matched.length, 2);
  assert.equal(dry.applied, 0); // dry-run does not write

  const applied = backfillTraces(db, { apply: true });
  assert.equal(applied.applied, 2);
  const rows = db
    .prepare(`SELECT span_id, session_id FROM traces ORDER BY span_id`)
    .all() as Array<{ span_id: string; session_id: string | null }>;
  assert.equal(rows[0].session_id, 'session-A');
  assert.equal(rows[1].session_id, 'session-B');
});

test('backfillTraces: ambiguous short window → never guesses', () => {
  const db = makeTestDb();
  const t0 = Date.parse('2026-08-30T10:00:00Z');
  addSession(db, 'session-A', new Date(t0).toISOString());
  // next session created 30s later; trace falls between the two creations
  // (within tolerance of B but before it) → cannot distinguish → ambiguous
  addSession(db, 'session-B', new Date(t0 + 30_000).toISOString());
  addTrace(db, 'span-1', t0 + 15_000, null);

  const res = backfillTraces(db, { apply: true });
  assert.equal(res.matched.length, 0);
  assert.equal(res.skippedAmbiguous, 1);
  assert.equal(res.applied, 0);
});

test('backfillTraces: trace before first session → skippedNoWindow', () => {
  const db = makeTestDb();
  const t0 = Date.parse('2026-08-30T10:00:00Z');
  addSession(db, 'session-A', new Date(t0).toISOString());
  addTrace(db, 'span-early', t0 - HOUR, null); // way before any session

  const res = backfillTraces(db, { apply: true });
  assert.equal(res.matched.length, 0);
  assert.equal(res.skippedNoWindow, 1);
});

test('backfillTraces: tolerance lets a trace just before creation match', () => {
  const db = makeTestDb();
  const t0 = Date.parse('2026-08-30T10:00:00Z');
  addSession(db, 'session-A', new Date(t0).toISOString());
  addSession(db, 'session-B', new Date(t0 + 4 * HOUR).toISOString());
  // 60s before session-A creation → within default 2min tolerance
  addTrace(db, 'span-tol', t0 - 60_000, null);

  const res = backfillTraces(db, { apply: true });
  assert.equal(res.matched.length, 1);
  assert.equal(res.matched[0].sessionId, 'session-A');
});

test('backfillTraces: only NULL/empty session rows are touched', () => {
  const db = makeTestDb();
  const t0 = Date.parse('2026-08-30T10:00:00Z');
  addSession(db, 'session-A', new Date(t0).toISOString());
  addTrace(db, 'span-set', t0 + HOUR, 'already-set');
  addTrace(db, 'span-empty', t0 + HOUR, '');

  const res = backfillTraces(db, { apply: true });
  assert.equal(res.totalNullTraces, 1); // only span-empty
  const row = db.prepare(`SELECT session_id FROM traces WHERE span_id = 'span-set'`).get() as {
    session_id: string;
  };
  assert.equal(row.session_id, 'already-set');
});
