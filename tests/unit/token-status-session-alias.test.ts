import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readSessionTokenTotals } from '../../src/tokens/token-status.js';
import { getLocalDayKey, readDailyTokenTotal } from '../../src/tokens/local-day.js';

function makeDb(withAliases = true): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE token_usage (
      session_id TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0
    );
  `);
  if (withAliases) {
    db.exec(`CREATE TABLE session_id_aliases (session_id TEXT NOT NULL, alias_id TEXT NOT NULL);`);
  }
  return db;
}

describe('token status session aliases', () => {
  it('aggregates token usage from the local session and its tool aliases', () => {
    const db = makeDb();
    db.prepare('INSERT INTO token_usage VALUES (?, ?, ?)').run('workspace-session', 10, 2);
    db.prepare('INSERT INTO token_usage VALUES (?, ?, ?)').run('codex-runtime-id', 100, 5);
    db.prepare('INSERT INTO token_usage VALUES (?, ?, ?)').run('minimax-runtime-id', 20, 3);
    db.prepare('INSERT INTO token_usage VALUES (?, ?, ?)').run('unrelated-session', 999, 999);
    db.prepare('INSERT INTO session_id_aliases VALUES (?, ?)').run('workspace-session', 'codex-runtime-id');
    db.prepare('INSERT INTO session_id_aliases VALUES (?, ?)').run('workspace-session', 'minimax-runtime-id');
    try {
      assert.deepEqual(readSessionTokenTotals(db, 'workspace-session'), { input: 130, output: 10 });
    } finally {
      db.close();
    }
  });

  it('falls back to the direct session row when the alias table is absent', () => {
    const db = makeDb(false);
    db.prepare('INSERT INTO token_usage VALUES (?, ?, ?)').run('workspace-session', 10, 2);
    try {
      assert.deepEqual(readSessionTokenTotals(db, 'workspace-session'), { input: 10, output: 2 });
    } finally {
      db.close();
    }
  });
});

describe('local-day token accounting', () => {
  it('uses the machine local calendar day, not SQLite UTC date', () => {
    const date = new Date('2026-10-25T00:07:00Z');
    const expected = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    assert.equal(getLocalDayKey(date), expected);
  });

  it('sums only rows for the requested local date', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE token_usage (timestamp TEXT, prompt_tokens INTEGER, completion_tokens INTEGER);`);
    db.prepare('INSERT INTO token_usage VALUES (?, ?, ?)').run('2026-10-24 21:06:54', 25_397, 3);
    db.prepare('INSERT INTO token_usage VALUES (?, ?, ?)').run('2026-10-23 23:59:59', 100, 20);
    try {
      assert.equal(readDailyTokenTotal(db, '2026-10-24'), 25_400);
    } finally {
      db.close();
    }
  });
});
