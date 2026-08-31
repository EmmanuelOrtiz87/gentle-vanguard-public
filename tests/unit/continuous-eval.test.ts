import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import {
  EVAL_RUNS_DDL,
  buildGoldenDataset,
  computeTrend,
  ensureEvalRunsTable,
  evaluateGate,
  getPreviousRun,
  percentile,
  persistRun,
  runContinuousEval,
  scoreDataset,
  type DatasetScores,
  type EvalRunRecord,
  type GoldenItem,
} from '../../src/eval/continuous-eval.js';

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
    CREATE TABLE feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT, trace_id TEXT, span_id TEXT,
      type TEXT, created_at TEXT, tenant_id TEXT
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

function insertSession(
  db: Database.Database,
  id: string,
  status: string,
  tokensUsed = 0,
  createdAt = '2026-08-01T10:00:00.000Z',
  updatedAt = '2026-08-01T10:05:00.000Z',
): void {
  db.prepare(
    `INSERT INTO sessions (id, status, tokens_used, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, status, tokensUsed, createdAt, updatedAt);
}

function insertTrace(
  db: Database.Database,
  sessionId: string,
  status: string,
  duration = 1000,
): void {
  db.prepare(
    `INSERT INTO traces (span_id, trace_id, duration, status, session_id) VALUES (?, ?, ?, ?, ?)`,
  ).run(`span-${Math.random().toString(36).slice(2)}`, `t-${sessionId}`, duration, status, sessionId);
}

function insertTokens(db: Database.Database, sessionId: string, inputT: number, outputT: number): void {
  db.prepare(
    `INSERT INTO token_transactions (session_id, input_tokens, output_tokens) VALUES (?, ?, ?)`,
  ).run(sessionId, inputT, outputT);
}

/* ── Dataset building ── */

test('buildGoldenDataset labels successes as positive and failures as negative', () => {
  const db = makeTestDb();
  insertSession(db, 's-ok', 'completed', 100);
  insertSession(db, 's-fail', 'error', 50);
  insertSession(db, 's-active', 'active'); // no signal -> skipped
  insertTrace(db, 's-ok', 'completed', 5000);
  insertTrace(db, 's-fail', 'error', 100);
  insertTokens(db, 's-ok', 300, 200);

  const ds = buildGoldenDataset(db);
  assert.equal(ds.items.length, 2);
  assert.equal(ds.positives, 1);
  assert.equal(ds.negatives, 1);

  const ok = ds.items.find((i) => i.id === 's-ok');
  assert.ok(ok);
  assert.equal(ok.label, 'positive');
  assert.equal(ok.tokens, 500); // from token_transactions (300+200)
  assert.equal(ok.durationMs, 5000); // from traces max duration

  const fail = ds.items.find((i) => i.id === 's-fail');
  assert.ok(fail);
  assert.equal(fail.label, 'negative');
  db.close();
});

test('buildGoldenDataset treats error traces and negative feedback as negative, falls back to session tokens and lifetime', () => {
  const db = makeTestDb();
  insertSession(db, 's-err-trace', 'completed', 42, '2026-08-01T10:00:00.000Z', '2026-08-01T10:10:00.000Z');
  insertTrace(db, 's-err-trace', 'error', 0); // error trace flips label; duration 0 -> lifetime fallback
  insertSession(db, 's-fb', 'active', 0);
  insertTrace(db, 's-fb', 'completed', 10);
  db.prepare(`INSERT INTO feedback (trace_id, type) VALUES ('t-s-fb', 'negative')`).run();

  const ds = buildGoldenDataset(db);
  assert.equal(ds.items.find((i) => i.id === 's-err-trace')?.label, 'negative');
  assert.equal(ds.items.find((i) => i.id === 's-err-trace')?.tokens, 42);
  // duration falls back to session lifetime: 10 min = 600000 ms (max trace dur is 10)
  assert.equal(ds.items.find((i) => i.id === 's-err-trace')?.durationMs, 600000);
  assert.equal(ds.items.find((i) => i.id === 's-fb')?.label, 'negative');
  db.close();
});

/* ── Scoring math ── */

test('scoreDataset computes deterministic aggregate from success/tokens/duration', () => {
  const items: GoldenItem[] = [
    { id: 'a', label: 'positive', tokens: 10_000, durationMs: 30_000 },
    { id: 'b', label: 'positive', tokens: 20_000, durationMs: 60_000 },
    { id: 'c', label: 'positive', tokens: 30_000, durationMs: 90_000 },
    { id: 'd', label: 'positive', tokens: 40_000, durationMs: 120_000 },
    { id: 'e', label: 'negative', tokens: 100_000, durationMs: 300_000 },
  ];
  const s = scoreDataset({ items, positives: 4, negatives: 1 });
  assert.equal(s.datasetSize, 5);
  assert.equal(s.successRate, 0.8);
  // avg tokens = 40000 -> efficiency = 50000/40000 capped at 1 => 1
  assert.equal(s.tokenEfficiency, 1);
  // p95 duration = 300000 (the negative outlier) -> 120000/300000 = 0.4
  assert.equal(s.durationEfficiency, 0.4);
  const expected = 0.8 * 0.5 + 1 * 0.3 + 0.4 * 0.2;
  assert.equal(s.aggregateScore, Number(expected.toFixed(4)));
  assert.equal(s.avgTokens, 40_000);
});

test('percentile handles empty arrays and boundary values', () => {
  assert.equal(percentile([], 50), 0);
  assert.equal(percentile([5], 50), 5);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
});

/* ── Trend + gate ── */

function fakePrev(score: number, id = 1): EvalRunRecord {
  return {
    id,
    created_at: '2026-08-01T00:00:00.000Z',
    dataset_size: 10,
    scores_json: JSON.stringify({ aggregateScore: score } satisfies Partial<DatasetScores>),
    trend_json: '{}',
  };
}

test('computeTrend reports first-run, improvement and regression with correct percents', () => {
  const first = computeTrend(0.9, null);
  assert.equal(first.direction, 'first-run');
  assert.equal(first.deltaPercent, null);

  const improved = computeTrend(0.99, fakePrev(0.9));
  assert.equal(improved.direction, 'improved');
  assert.equal(improved.deltaPercent, 10);

  const stable = computeTrend(0.9, fakePrev(0.9));
  assert.equal(stable.direction, 'stable');

  const regressed = computeTrend(0.81, fakePrev(0.9));
  assert.equal(regressed.direction, 'regressed');
  assert.equal(regressed.deltaPercent, -10);
});

test('evaluateGate passes first run and small regressions, fails beyond threshold', () => {
  assert.equal(evaluateGate(computeTrend(0.5, null), 5).passed, true);

  // -3% regression with 5% threshold -> pass
  const small = computeTrend(0.97, fakePrev(1.0));
  assert.equal(evaluateGate(small, 5).passed, true);

  // -8% regression with 5% threshold -> fail
  const big = computeTrend(0.92, fakePrev(1.0));
  const g = evaluateGate(big, 5);
  assert.equal(g.passed, false);
  assert.match(g.reason, /regressed -8%/);

  // -8% regression with 10% threshold -> pass
  assert.equal(evaluateGate(big, 10).passed, true);
});

test('evaluateGate tolerates unreadable previous scores', () => {
  const broken: EvalRunRecord = {
    id: 9,
    created_at: '2026-08-01T00:00:00.000Z',
    dataset_size: 1,
    scores_json: 'not-json',
    trend_json: '{}',
  };
  const t = computeTrend(0.5, broken);
  assert.equal(t.direction, 'first-run');
  assert.equal(evaluateGate(t, 5).passed, true);
});

/* ── Persistence + end-to-end orchestration ── */

test('ensureEvalRunsTable is idempotent and persistRun/getPreviousRun round-trip', () => {
  const db = new Database(':memory:');
  db.exec(EVAL_RUNS_DDL);
  ensureEvalRunsTable(db); // idempotent
  assert.equal(getPreviousRun(db), null);

  const id1 = persistRun(
    db,
    { datasetSize: 3, successRate: 1, tokenEfficiency: 1, durationEfficiency: 1, aggregateScore: 1, avgTokens: 100, medianTokens: 100, p95Tokens: 100, medianDurationMs: 1, p95DurationMs: 1 },
    computeTrend(1, null),
  );
  const id2 = persistRun(
    db,
    { datasetSize: 3, successRate: 0.5, tokenEfficiency: 1, durationEfficiency: 1, aggregateScore: 0.5, avgTokens: 100, medianTokens: 100, p95Tokens: 100, medianDurationMs: 1, p95DurationMs: 1 },
    computeTrend(0.5, getPreviousRun(db)),
  );
  assert.ok(id2 > id1);

  const prev = getPreviousRun(db);
  assert.ok(prev);
  assert.equal(prev.id, id2);
  assert.equal((JSON.parse(prev.scores_json) as DatasetScores).aggregateScore, 0.5);
  db.close();
});

test('runContinuousEval end-to-end: persists runs and gate trips on regression', () => {
  const db = makeTestDb();
  db.exec(EVAL_RUNS_DDL);

  // Run 1: healthy dataset (all positive, low tokens, short durations)
  insertSession(db, 'ok-1', 'completed');
  insertSession(db, 'ok-2', 'completed');
  insertTrace(db, 'ok-1', 'completed', 5_000);
  insertTrace(db, 'ok-2', 'completed', 5_000);
  insertTokens(db, 'ok-1', 100, 100);
  insertTokens(db, 'ok-2', 100, 100);

  const run1 = runContinuousEval(db, { gate: true });
  assert.ok(run1.runId && run1.runId > 0);
  assert.equal(run1.trend.direction, 'first-run');
  assert.equal(run1.gate.passed, true);
  assert.ok(run1.scores.aggregateScore > 0.99);

  // Run 2: same dataset -> stable, gate passes
  const run2 = runContinuousEval(db, { gate: true });
  assert.equal(run2.trend.direction, 'stable');
  assert.equal(run2.gate.passed, true);

  // Run 3: inject failures + token hogs to force a regression
  for (let i = 0; i < 10; i++) {
    const id = `fail-${i}`;
    insertSession(db, id, 'error');
    insertTrace(db, id, 'error', 300_000);
    insertTokens(db, id, 500_000, 500_000);
  }
  const run3 = runContinuousEval(db, { gate: true });
  assert.equal(run3.trend.direction, 'regressed');
  assert.equal(run3.gate.passed, false);
  assert.ok(run3.scores.successRate < run2.scores.successRate);
  db.close();
});
