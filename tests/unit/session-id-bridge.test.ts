/**
 * Unit tests for src/session/session-id-bridge.ts — alias matching over an
 * in-memory sqlite with the same shapes as Nexus (sessions + token_transactions).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import {
  ALIAS_DDL,
  aliasStats,
  aliasTableExists,
  backfillAliases,
  ensureAliasTable,
  recordForwardAliases,
  sessionPlusAliasIds,
} from '../../src/session/session-id-bridge.js';

/* ── Fixtures ── */

function makeTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, agent TEXT, status TEXT,
      created_at TEXT, updated_at TEXT, tokens_used INTEGER,
      cost REAL, message_count INTEGER, metadata TEXT, tenant_id TEXT
    );
    CREATE TABLE token_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT, session_id TEXT,
      agent TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER,
      reasoning_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER,
      cost REAL, created_at TEXT, tenant_id TEXT
    );
    CREATE TABLE traces (
      span_id TEXT, trace_id TEXT, parent_span_id TEXT, name TEXT,
      start_time TEXT, end_time TEXT, duration INTEGER, status TEXT, model TEXT,
      input_tokens INTEGER, output_tokens INTEGER, cost REAL, session_id TEXT,
      attributes TEXT, tenant_id TEXT
    );
  `);
  return db;
}

/** Inserta sesión repo (ISO UTC created_at) y tx de herramienta (datetime local). */
function addSession(db: Database.Database, id: string, createdIso: string): void {
  db.prepare(
    `INSERT INTO sessions (id, agent, status, created_at, updated_at, tokens_used, tenant_id)
     VALUES (?, 'orchestrator', 'completed', ?, ?, 0, 't')`,
  ).run(id, createdIso, createdIso);
}

function addTx(db: Database.Database, aliasId: string, at: Date, tokens = 100): void {
  const local = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(
    at.getDate(),
  ).padStart(2, '0')} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(
    2,
    '0',
  )}:${String(at.getSeconds()).padStart(2, '0')}`;
  db.prepare(
    `INSERT INTO token_transactions (message_id, session_id, agent, model, input_tokens, output_tokens, cost, created_at, tenant_id)
     VALUES (?, ?, 'orchestrator', 'm', ?, 0, 0, ?, 't')`,
  ).run(`msg-${aliasId}-${at.getTime()}`, aliasId, tokens, local);
}

/* ── Table bootstrap ── */

test('ensureAliasTable creates idempotently', () => {
  const db = makeTestDb();
  assert.equal(aliasTableExists(db), false);
  ensureAliasTable(db);
  assert.equal(aliasTableExists(db), true);
  ensureAliasTable(db); // idempotent
  assert.equal(aliasTableExists(db), true);
  assert.ok(ALIAS_DDL.includes('session_id_aliases'));
  db.close();
});

/* ── Temporal-window matching ── */

test('backfill: unique window match creates alias', () => {
  const db = makeTestDb();
  // Dos sesiones repo separadas por 1h. El alias cae dentro de la ventana 1.
  const t0 = new Date('2026-08-31T10:00:00Z');
  const t1 = new Date('2026-08-31T11:00:00Z');
  addSession(db, 'session-A', t0.toISOString());
  addSession(db, 'session-B', t1.toISOString());
  // tx local time = same instant (test runs in local tz; Date ctor normalizes)
  addTx(db, 'ses_alpha', t0, 500); // 10:00 dentro de [10:00-tol, 11:00-tol)

  const res = backfillAliases(db, { apply: true });
  assert.equal(res.candidates.length, 1);
  assert.equal(res.candidates[0].aliasId, 'ses_alpha');
  assert.equal(res.candidates[0].sessionId, 'session-A');
  assert.equal(res.applied, 1);

  const rows = db.prepare(`SELECT * FROM session_id_aliases`).all() as Array<{
    session_id: string;
    alias_id: string;
    source: string;
  }>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].session_id, 'session-A');
  assert.equal(rows[0].alias_id, 'ses_alpha');
  assert.equal(rows[0].source, 'temporal-window');
  db.close();
});

test('backfill: ambiguous (zero-width window) never guesses', () => {
  const db = makeTestDb();
  const t0 = new Date('2026-08-31T10:00:00Z');
  const t1 = new Date('2026-08-31T10:00:30Z'); // gap 30s < minWindow → ambiguo
  addSession(db, 'session-A', t0.toISOString());
  addSession(db, 'session-B', t1.toISOString());
  addTx(db, 'ses_beta', new Date('2026-08-31T10:00:15Z'), 500);

  const res = backfillAliases(db, { apply: true });
  assert.equal(res.candidates.length, 0);
  assert.equal(res.applied, 0);
  assert.ok(res.skippedAmbiguous >= 1);
  const n = (db.prepare(`SELECT COUNT(*) c FROM session_id_aliases`).get() as { c: number }).c;
  assert.equal(n, 0);
  db.close();
});

test('backfill: tx before all sessions → no window, no alias', () => {
  const db = makeTestDb();
  addSession(db, 'session-A', new Date('2026-08-31T10:00:00Z').toISOString());
  addTx(db, 'ses_gamma', new Date('2026-08-30T10:00:00Z'), 500); // ayer
  const res = backfillAliases(db, { apply: true });
  assert.equal(res.candidates.length, 0);
  assert.ok(res.skippedNoWindow >= 1);
  db.close();
});

test('backfill: dry-run default does not write', () => {
  const db = makeTestDb();
  const t0 = new Date('2026-08-31T10:00:00Z');
  addSession(db, 'session-A', t0.toISOString());
  addTx(db, 'ses_delta', t0, 500);
  const res = backfillAliases(db); // sin apply
  assert.equal(res.candidates.length, 1);
  assert.equal(res.applied, 0);
  db.close();
});

test('backfill: idempotent — second pass skips already-aliased', () => {
  const db = makeTestDb();
  const t0 = new Date('2026-08-31T10:00:00Z');
  addSession(db, 'session-A', t0.toISOString());
  addTx(db, 'ses_eps', t0, 500);
  const r1 = backfillAliases(db, { apply: true });
  assert.equal(r1.applied, 1);
  const r2 = backfillAliases(db, { apply: true });
  assert.equal(r2.applied, 0);
  assert.ok(r2.alreadyAliased >= 1);
  db.close();
});

/* ── Forward-write path ── */

test('recordForwardAliases: aliases recent activity to explicit repo session', () => {
  const db = makeTestDb();
  ensureAliasTable(db);
  const now = Date.now();
  const inserted = recordForwardAliases(
    db,
    [
      { aliasId: 'sess_forward1', lastActivityMs: now - 60_000, source: 'zcode' },
      { aliasId: 'sess_subagent_agent_x', lastActivityMs: now - 60_000, source: 'zcode' },
      { aliasId: 'sess_stale', lastActivityMs: now - 60 * 60_000, source: 'zcode' }, // > recency
    ],
    { repoSessionId: 'session-CURRENT', recencyMs: 15 * 60_000 },
  );
  assert.equal(inserted, 2);
  const ids = sessionPlusAliasIds(db, 'session-CURRENT');
  assert.ok(ids.includes('session-CURRENT'));
  assert.ok(ids.includes('sess_forward1'));
  assert.ok(ids.includes('sess_subagent_agent_x'));
  assert.ok(!ids.includes('sess_stale'));
  // confianza: subagente menor que orquestador
  const rows = db.prepare(`SELECT alias_id, confidence FROM session_id_aliases`).all() as Array<{
    alias_id: string;
    confidence: number;
  }>;
  const sub = rows.find((r) => r.alias_id.startsWith('sess_subagent'));
  const main = rows.find((r) => r.alias_id === 'sess_forward1');
  assert.ok(sub && main && sub.confidence < main.confidence);
  db.close();
});

test('recordForwardAliases: no repo session → no-op', () => {
  const db = makeTestDb();
  ensureAliasTable(db);
  const n = recordForwardAliases(
    db,
    [{ aliasId: 'x', lastActivityMs: Date.now(), source: 'zcode' }],
    { repoSessionId: null },
  );
  assert.equal(n, 0);
  db.close();
});

/* ── Stats + eval-facing helper ── */

test('aliasStats attributes tokens through the bridge', () => {
  const db = makeTestDb();
  ensureAliasTable(db);
  const t0 = new Date('2026-08-31T10:00:00Z');
  addSession(db, 'session-A', t0.toISOString());
  addTx(db, 'ses_attr', t0, 700); // in+out = 700
  addTx(db, 'ses_orphan', new Date('2026-08-29T10:00:00Z'), 300); // sin ventana
  const res = backfillAliases(db, { apply: true });
  assert.equal(res.applied, 1);
  const stats = aliasStats(db);
  assert.ok(stats);
  assert.equal(stats.totalAliases, 1);
  assert.equal(stats.attributedTokens, 700);
  assert.equal(stats.totalTxnTokens, 1000);
  db.close();
});

test('sessionPlusAliasIds falls back to plain id when table missing', () => {
  const db = makeTestDb();
  assert.deepEqual(sessionPlusAliasIds(db, 'session-X'), ['session-X']);
  db.close();
});
