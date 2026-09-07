import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  deriveOutcomeFeedback,
  captureOutcomeFeedback,
  readPerSessionTokenBudget,
  AUTO_OUTCOME_SPAN_SUFFIX,
} from '../../src/session/outcome-feedback.js';

/* Real Nexus shape (feedback.type CHECK up/down, UNIQUE(span_id, tenant_id)). */
function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, agent TEXT, status TEXT,
      created_at TEXT, updated_at TEXT, tokens_used INTEGER,
      cost REAL, message_count INTEGER, metadata TEXT,
      tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard'
    );
    CREATE TABLE traces (
      span_id TEXT, trace_id TEXT, parent_span_id TEXT, name TEXT,
      start_time INTEGER, end_time INTEGER, duration INTEGER, status TEXT,
      model TEXT, input_tokens INTEGER, output_tokens INTEGER, cost REAL,
      session_id TEXT, attributes TEXT,
      tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard'
    );
    CREATE TABLE feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trace_id TEXT NOT NULL,
      span_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('up', 'down')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard',
      UNIQUE(span_id, tenant_id)
    );
    CREATE TABLE token_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT, session_id TEXT,
      agent TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER,
      reasoning_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER,
      cost REAL, created_at TEXT,
      tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard'
    );
  `);
  return db;
}

/* ── deriveOutcomeFeedback (pure rules) ── */

test('derive: success status + no errors + under budget → up', () => {
  assert.equal(
    deriveOutcomeFeedback({
      sessionStatus: 'completed',
      errorTraceCount: 0,
      tokensUsed: 100,
      tokenBudget: 3_000_000,
      failedPhaseCount: 0,
    }),
    'up',
  );
});

test('derive: error traces → down even with success status', () => {
  assert.equal(
    deriveOutcomeFeedback({
      sessionStatus: 'completed',
      errorTraceCount: 2,
      tokensUsed: 10,
      tokenBudget: 3_000_000,
      failedPhaseCount: 0,
    }),
    'down',
  );
});

test('derive: failed close phases → down', () => {
  assert.equal(
    deriveOutcomeFeedback({
      sessionStatus: 'completed',
      errorTraceCount: 0,
      tokensUsed: 10,
      tokenBudget: 3_000_000,
      failedPhaseCount: 1,
    }),
    'down',
  );
});

test('derive: negative terminal status → down', () => {
  for (const status of ['failed', 'error', 'aborted']) {
    assert.equal(
      deriveOutcomeFeedback({
        sessionStatus: status,
        errorTraceCount: 0,
        tokensUsed: 0,
        tokenBudget: 3_000_000,
        failedPhaseCount: 0,
      }),
      'down',
    );
  }
});

test('derive: success but over budget → null (inconclusive, no row)', () => {
  assert.equal(
    deriveOutcomeFeedback({
      sessionStatus: 'completed',
      errorTraceCount: 0,
      tokensUsed: 4_000_000,
      tokenBudget: 3_000_000,
      failedPhaseCount: 0,
    }),
    null,
  );
});

test('derive: active/abandoned/unknown status → null', () => {
  for (const status of ['active', 'abandoned', null, undefined, 'weird']) {
    assert.equal(
      deriveOutcomeFeedback({
        sessionStatus: status,
        errorTraceCount: 0,
        tokensUsed: 0,
        tokenBudget: 3_000_000,
        failedPhaseCount: 0,
      }),
      null,
    );
  }
});

/* ── readPerSessionTokenBudget ── */

test('budget: reads tokenBudget.limits.perSession from config', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gv-budget-'));
  try {
    writeFileSync(
      join(dir, 'token-budget-guard.json'),
      JSON.stringify({ tokenBudget: { limits: { perSession: 2500000 } } }),
    );
    assert.equal(readPerSessionTokenBudget(join(dir, 'token-budget-guard.json')), 2500000);
    assert.equal(readPerSessionTokenBudget(join(dir, 'missing.json')), 3_000_000);
    writeFileSync(join(dir, 'token-budget-guard.json'), '{not json');
    assert.equal(readPerSessionTokenBudget(join(dir, 'token-budget-guard.json')), 3_000_000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ── captureOutcomeFeedback (integration against real schema) ── */

function seedSession(db: Database.Database, id: string, status: string): void {
  db.prepare(
    `INSERT INTO sessions (id, status, tokens_used, created_at, updated_at)
     VALUES (?, ?, 0, datetime('now'), datetime('now'))`,
  ).run(id, status);
  db.prepare(
    `INSERT INTO traces (span_id, trace_id, name, status, session_id, start_time)
     VALUES (?, ?, 'session-start', 'ok', ?, 1)`,
  ).run(`${id}-span`, `${id}-trace`, id);
}

test('capture: positive session writes up row linked via trace_id', () => {
  const db = makeDb();
  seedSession(db, 's-pos', 'completed');
  const r = captureOutcomeFeedback(db, 's-pos');
  assert.equal(r.written, true);
  assert.equal(r.type, 'up');
  const rows = db.prepare(`SELECT trace_id, span_id, type FROM feedback`).all() as Array<{
    trace_id: string;
    span_id: string;
    type: string;
  }>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].trace_id, 's-pos-trace'); // the linkage the eval reader joins on
  assert.equal(rows[0].span_id, `s-pos-span${AUTO_OUTCOME_SPAN_SUFFIX}`);
  assert.equal(rows[0].type, 'up');
});

test('capture: error traces write down row', () => {
  const db = makeDb();
  seedSession(db, 's-neg', 'completed');
  db.prepare(
    `INSERT INTO traces (span_id, trace_id, name, status, session_id, start_time)
     VALUES ('err-span', 's-neg-trace', 'op', 'error', 's-neg', 2)`,
  ).run();
  const r = captureOutcomeFeedback(db, 's-neg');
  assert.equal(r.type, 'down');
  const row = db.prepare(`SELECT type FROM feedback`).get() as { type: string };
  assert.equal(row.type, 'down');
});

test('capture: active session writes nothing', () => {
  const db = makeDb();
  seedSession(db, 's-active', 'active');
  const r = captureOutcomeFeedback(db, 's-active');
  assert.equal(r.written, false);
  assert.equal((db.prepare(`SELECT COUNT(*) c FROM feedback`).get() as { c: number }).c, 0);
});

test('capture: missing session or missing trace writes nothing', () => {
  const db = makeDb();
  assert.equal(captureOutcomeFeedback(db, 'ghost', {}).written, false);
  db.prepare(`INSERT INTO sessions (id, status) VALUES ('s-notrace', 'completed')`).run();
  assert.equal(captureOutcomeFeedback(db, 's-notrace', {}).written, false);
});

test('capture: idempotent — re-running close does not duplicate rows', () => {
  const db = makeDb();
  seedSession(db, 's-idem', 'completed');
  captureOutcomeFeedback(db, 's-idem');
  captureOutcomeFeedback(db, 's-idem');
  const c = (db.prepare(`SELECT COUNT(*) c FROM feedback`).get() as { c: number }).c;
  assert.equal(c, 1);
});

test('capture: token_transactions sum is used as token signal', () => {
  const db = makeDb();
  seedSession(db, 's-tx', 'completed');
  db.prepare(
    `INSERT INTO token_transactions (message_id, session_id, input_tokens, output_tokens)
     VALUES ('m1', 's-tx', 3_000_001, 0)`,
  ).run();
  const r = captureOutcomeFeedback(db, 's-tx'); // over 3M default budget → inconclusive
  assert.equal(r.written, false);
});
