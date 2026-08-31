import { describe, expect, it, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { computeCost, makeCostReport } from '../server/cost-report';

const NOW = new Date('2026-08-31T12:00:00Z');

function setup() {
  const dir = join(tmpdir(), `gv-cost-report-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const pricingPath = join(dir, 'model-pricing.json');
  const budgetPath = join(dir, 'token-budget-guard.json');
  writeFileSync(
    pricingPath,
    JSON.stringify({
      currency: 'USD',
      models: {
        'kimi-2-5': { input: 0.6, output: 2.5 },
        'GLM-5.3': { input: 0.5, output: 2.0 },
        'deepseek-v4-flash-free': { input: 0, output: 0 },
      },
    }),
  );
  writeFileSync(
    budgetPath,
    JSON.stringify({
      tokenBudget: { limits: { daily: 5_000_000, perSession: 3_000_000, softThreshold: 70, hardThreshold: 90 } },
    }),
  );
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE token_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL,
    session_id TEXT,
    agent TEXT,
    model TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    reasoning_tokens INTEGER,
    cache_read_tokens INTEGER,
    cache_write_tokens INTEGER,
    cost REAL,
    created_at TEXT,
    tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard',
    UNIQUE(message_id, tenant_id)
  )`);
  const insert = db.prepare(
    `INSERT INTO token_transactions
     (message_id, session_id, agent, model, input_tokens, output_tokens, reasoning_tokens,
      cache_read_tokens, cache_write_tokens, cost, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?)`,
  );
  // 100M kimi input + 1M output = 60 + 2.5 = $62.50 across two days/sessions
  insert.run('m1', 'ses_a', 'orchestrator', 'kimi-2-5', 60_000_000, 1_000_000, '2026-08-30 10:00:00');
  insert.run('m2', 'ses_b', 'subagent', 'KIMI-2-5', 40_000_000, 0, '2026-08-31 09:00:00');
  // 2M glm input = $1.00
  insert.run('m3', 'ses_a', 'orchestrator', 'GLM-5.3', 2_000_000, 0, '2026-08-31 10:00:00');
  // free tier model: tokens but $0
  insert.run('m4', 'ses_c', 'subagent', 'deepseek-v4-flash-free', 1_000_000, 500_000, '2026-08-31 11:00:00');
  // unknown model: tokens but $0, must be flagged
  insert.run('m5', 'ses_c', 'subagent', 'big-pickle', 500_000, 100_000, '2026-08-31 11:30:00');
  // outside the 30d window: ignored
  insert.run('m6', 'ses_old', 'orchestrator', 'kimi-2-5', 100_000_000, 0, '2025-01-01 00:00:00');
  return { dir, db, pricingPath, budgetPath };
}

describe('computeCost', () => {
  const pricing = { 'kimi-2-5': { input: 0.6, output: 2.5 } };
  it('prices tokens per 1M with case-insensitive matching', () => {
    expect(computeCost('KIMI-2-5', 1_000_000, 1_000_000, pricing)).toBeCloseTo(3.1);
    expect(computeCost(null, 1_000_000, 1_000_000, pricing)).toBe(0);
  });
});

describe('makeCostReport', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('aggregates cost by day, agent, model and session', () => {
    const report = makeCostReport(ctx.db, {
      pricingPath: ctx.pricingPath,
      budgetPath: ctx.budgetPath,
      now: NOW,
    });

    // 60M*0.6 + 1M*2.5 + 40M*0.6 + 2M*0.5 = 36 + 2.5 + 24 + 1 = 63.50
    expect(report.totals.costUsd).toBeCloseTo(63.5);
    expect(report.totals.totalTokens).toBe(105_100_000);
    // Month of "now" (2026-08): everything except m6
    expect(report.totals.monthToDateCostUsd).toBeCloseTo(63.5);

    expect(report.perModel[0]).toMatchObject({ key: 'kimi-2-5' });
    expect(report.perModel[0].costUsd).toBeCloseTo(62.5);
    expect(report.perModel.find((m) => m.key === 'glm-5.3')?.costUsd).toBeCloseTo(1);

    expect(report.perAgent[0]).toMatchObject({ key: 'orchestrator' });
    expect(report.perAgent[0].costUsd).toBeCloseTo(39.5);

    expect(report.topSessions).toHaveLength(3);
    expect(report.topSessions[0]).toMatchObject({ sessionId: 'ses_a', costUsd: 39.5 });

    expect(report.perDay.map((d) => d.date)).toEqual(['2026-08-30', '2026-08-31']);
  });

  it('flags unknown models as unpriced and excludes out-of-window rows', () => {
    const report = makeCostReport(ctx.db, {
      pricingPath: ctx.pricingPath,
      budgetPath: ctx.budgetPath,
      now: NOW,
    });
    expect(report.unpricedModels).toEqual(['big-pickle']);
    expect(report.totals.totalTokens).toBeLessThan(204_600_000);
  });

  it('computes budget usage against the configured daily limit', () => {
    const report = makeCostReport(ctx.db, {
      pricingPath: ctx.pricingPath,
      budgetPath: ctx.budgetPath,
      now: NOW,
    });
    // Today (2026-08-31): 40M + 2M + 1.5M + 0.6M = 44.1M of 5M → hard breach
    expect(report.budget.usedTodayTokens).toBe(44_100_000);
    expect(report.budget.status).toBe('hard');
    expect(report.budget.usedTodayPct).toBeGreaterThan(100);
  });

  it('projects monthly run-rate from trailing windows', () => {
    const report = makeCostReport(ctx.db, {
      pricingPath: ctx.pricingPath,
      budgetPath: ctx.budgetPath,
      now: NOW,
    });
    expect(report.monthlyProjection.from30d).toBeGreaterThan(0);
    expect(report.monthlyProjection.from7d).toBeGreaterThan(0);
    expect(report.insight.length).toBeGreaterThan(0);
  });

  it('returns a free-tier insight when nothing is billable', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE token_transactions (id INTEGER PRIMARY KEY, message_id TEXT, session_id TEXT, agent TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, cost REAL, created_at TEXT, tenant_id TEXT)`);
    const report = makeCostReport(db, {
      pricingPath: ctx.pricingPath,
      budgetPath: ctx.budgetPath,
      now: NOW,
    });
    expect(report.totals.costUsd).toBe(0);
    expect(report.insight).toMatch(/free\/local/i);
  });

  it('falls back to default budget limits when the config is missing', () => {
    const report = makeCostReport(ctx.db, {
      pricingPath: ctx.pricingPath,
      budgetPath: join(ctx.dir, 'does-not-exist.json'),
      now: NOW,
    });
    expect(report.budget.dailyTokens).toBe(5_000_000);
    expect(report.budget.perSessionTokens).toBe(3_000_000);
    rmSync(ctx.dir, { recursive: true, force: true });
  });
});
