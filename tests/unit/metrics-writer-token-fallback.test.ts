import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { getRecentTokenTotals } from '../../src/database/nexus//metrics-writer.ts';

test('metrics writer reads recent Nexus tokens and cost with SQLite datetime cutoff', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE token_usage (
      tenant_id TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL,
      completion_tokens INTEGER NOT NULL,
      cost REAL NOT NULL,
      timestamp TEXT NOT NULL
    )
  `);
  const insert = db.prepare('INSERT INTO token_usage VALUES (?, ?, ?, ?, ?)');
  insert.run('gentle-vanguard', 100, 25, 0.5, '2026-08-29 12:00:00');
  insert.run('gentle-vanguard', 50, 10, 0.2, '2026-08-28 11:59:59');
  insert.run('other-tenant', 900, 100, 9, '2026-08-29 12:00:00');

  assert.deepEqual(
    getRecentTokenTotals(db, 'gentle-vanguard', new Date('2026-08-29T12:00:00.000Z')),
    { tokens: 125, cost: 0.5 },
  );
  db.close();
});
