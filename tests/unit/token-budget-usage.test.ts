import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  calibrate,
  hasRecentNexusData,
  percentile,
  readDailyUsage,
  readUsedTokensToday,
  summarizeUsage,
} from '../../src/tokens/token-budget-usage.js';

function tempNexus(): { dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'gv-token-usage-'));
  const dbPath = join(dir, 'nexus.db');
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE token_transactions (
    session_id TEXT, input_tokens INTEGER, output_tokens INTEGER, created_at TEXT
  )`);
  db.close();
  return { dir, dbPath };
}

function insert(dbPath: string, rows: Array<[string, string, number, number]>): void {
  const db = new Database(dbPath);
  const stmt = db.prepare(
    `INSERT INTO token_transactions (session_id, created_at, input_tokens, output_tokens) VALUES (?,?,?,?)`,
  );
  for (const [session, day, input, output] of rows)
    stmt.run(session, `${day} 12:00:00`, input, output);
  db.close();
}

test('percentile and summary use measured values instead of estimates', () => {
  assert.equal(percentile([], 0.9), 0);
  assert.equal(percentile([10, 20, 30, 40], 0.5), 20);
  assert.equal(percentile([10, 20, 30, 40], 0.99), 40);
  const s = summarizeUsage([
    { day: '2026-11-01', tokens: 100, transactions: 1 },
    { day: '2026-11-02', tokens: 300, transactions: 1 },
    { day: '2026-11-03', tokens: 200, transactions: 1 },
  ]);
  assert.equal(s.days, 3);
  assert.equal(s.totalTokens, 600);
  assert.equal(s.median, 200);
  assert.equal(s.max, 300);
  assert.equal(s.latestDay, '2026-11-03');
});

test('readDailyUsage groups Nexus transactions by day and filters the window', () => {
  const { dir, dbPath } = tempNexus();
  try {
    const today = new Date().toISOString().slice(0, 10);
    insert(dbPath, [
      ['s1', today, 100, 50],
      ['s1', today, 25, 25],
      ['s2', '2020-01-01', 999, 999],
    ]);
    const rows = readDailyUsage(14, dbPath);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].day, today);
    assert.equal(rows[0].tokens, 200);
    assert.equal(rows[0].transactions, 2);
    assert.equal(readUsedTokensToday(dbPath, today), 200);
    assert.equal(hasRecentNexusData(14, dbPath), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('calibrate recommends observed peak + 10% rounded to 10M', () => {
  const { dir, dbPath } = tempNexus();
  try {
    const day = (offset: number): string => {
      const d = new Date();
      d.setDate(d.getDate() - offset);
      return d.toISOString().slice(0, 10);
    };
    insert(dbPath, [
      ['s1', day(2), 140_000_000, 0],
      ['s2', day(1), 200_000_000, 0],
      ['s3', day(0), 50_000_000, 0],
    ]);
    const result = calibrate(14, dbPath);
    assert.equal(result.daily.max, 200_000_000);
    assert.equal(result.recommendedDaily, 220_000_000);
    assert.equal(result.recommendedPerSession, 220_000_000);
    assert.equal(result.daily.days, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
