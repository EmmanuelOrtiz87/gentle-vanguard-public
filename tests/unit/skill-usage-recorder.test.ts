import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  writeSkillUsageRow,
  recordSkillUsage,
  setDbProviderForTests,
  backfillSkillUsageFromStats,
} from '../../src/knowledge/skill-usage-recorder.js';

/* Real Nexus skill_usage shape (UNIQUE(skill_id, session_id, tenant_id)). */
function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE skill_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_id TEXT NOT NULL,
      session_id TEXT,
      count INTEGER DEFAULT 1,
      tokens_used INTEGER DEFAULT 0,
      cost REAL DEFAULT 0,
      last_used TEXT NOT NULL DEFAULT (datetime('now')),
      tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard',
      UNIQUE(skill_id, session_id, tenant_id)
    );
  `);
  return db;
}

/* ── Core writer ── */

test('writer: inserts a first-use row with defaults', () => {
  const db = makeDb();
  writeSkillUsageRow(db, { skillId: 'code-review', sessionId: 'sess-1' });
  const row = db.prepare(`SELECT * FROM skill_usage`).get() as Record<string, unknown>;
  assert.equal(row.skill_id, 'code-review');
  assert.equal(row.session_id, 'sess-1');
  assert.equal(row.count, 1);
  assert.equal(row.tenant_id, 'gentle-vanguard');
});

test('writer: repeated use upserts — count++, tokens/cost accumulate, last_used refreshed', () => {
  const db = makeDb();
  writeSkillUsageRow(db, { skillId: 'sk', sessionId: 's', tokensUsed: 100, cost: 0.5 });
  writeSkillUsageRow(db, { skillId: 'sk', sessionId: 's', tokensUsed: 50, cost: 0.25 });
  const rows = db.prepare(`SELECT * FROM skill_usage`).all() as Array<Record<string, unknown>>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 2);
  assert.equal(rows[0].tokens_used, 150);
  assert.equal(rows[0].cost, 0.75);
});

test('writer: different sessions or tenants are separate rows', () => {
  const db = makeDb();
  writeSkillUsageRow(db, { skillId: 'sk', sessionId: 'a' });
  writeSkillUsageRow(db, { skillId: 'sk', sessionId: 'b' });
  writeSkillUsageRow(db, { skillId: 'sk', tenantId: 'other' });
  assert.equal((db.prepare(`SELECT COUNT(*) c FROM skill_usage`).get() as { c: number }).c, 3);
});

/* ── recordSkillUsage via provider (failure tolerance) ── */

test('recordSkillUsage: writes through the provider and never throws', () => {
  const db = makeDb();
  setDbProviderForTests({ getDb: () => db });
  try {
    assert.equal(recordSkillUsage({ skillId: 'via-provider', sessionId: 'sess-9' }), true);
    assert.equal((db.prepare(`SELECT COUNT(*) c FROM skill_usage`).get() as { c: number }).c, 1);
  } finally {
    setDbProviderForTests(null);
  }
  // No DB available → graceful false, no throw.
  assert.equal(recordSkillUsage({ skillId: 'x' }), false);
});

test('recordSkillUsage: a throwing DB never propagates', () => {
  setDbProviderForTests({
    getDb: () => {
      throw new Error('db locked');
    },
  });
  try {
    assert.equal(recordSkillUsage({ skillId: 'boom' }), false);
  } finally {
    setDbProviderForTests(null);
  }
});

/* ── Backfill from real evidence ── */

test('backfill: derives rows from real stats counters, session NULL', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gv-stats-'));
  try {
    const statsPath = join(dir, 'skill-stats.json');
    writeFileSync(
      statsPath,
      JSON.stringify({
        totalCalls: 5,
        callsBySkill: { 'skill-a': 3.0, 'skill-b': 2.0, 'skill-zero': 0 },
        lastCall: '2026-07-24T00:10:33.786Z',
      }),
    );
    const db = makeDb();
    const r = backfillSkillUsageFromStats(db, statsPath);
    assert.deepEqual(r, { skills: 2, skipped: false });
    const rows = db
      .prepare(`SELECT skill_id, session_id, count, last_used FROM skill_usage ORDER BY skill_id`)
      .all() as Array<Record<string, unknown>>;
    assert.equal(rows.length, 2); // zero-count skill not fabricated
    assert.equal(rows[0].skill_id, 'skill-a');
    assert.equal(rows[0].count, 3);
    assert.equal(rows[0].session_id, null);
    assert.equal(rows[0].last_used, '2026-07-24 00:10:33');
    // Dry run writes nothing.
    assert.deepEqual(backfillSkillUsageFromStats(db, statsPath, { dryRun: true }), {
      skills: 2,
      skipped: false,
    });
    assert.equal((db.prepare(`SELECT COUNT(*) c FROM skill_usage`).get() as { c: number }).c, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('backfill: no evidence → skipped, nothing fabricated', () => {
  const db = makeDb();
  const dir = mkdtempSync(join(tmpdir(), 'gv-stats-empty-'));
  try {
    assert.deepEqual(backfillSkillUsageFromStats(db, join(dir, 'nope.json')), {
      skills: 0,
      skipped: true,
    });
    const p = join(dir, 'skill-stats.json');
    writeFileSync(p, JSON.stringify({ callsBySkill: {} }));
    assert.deepEqual(backfillSkillUsageFromStats(db, p), { skills: 0, skipped: true });
    writeFileSync(p, '{broken');
    assert.deepEqual(backfillSkillUsageFromStats(db, p), { skills: 0, skipped: true });
    assert.equal((db.prepare(`SELECT COUNT(*) c FROM skill_usage`).get() as { c: number }).c, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
