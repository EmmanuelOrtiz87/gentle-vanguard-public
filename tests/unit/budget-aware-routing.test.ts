#!/usr/bin/env node
/**
 * Unit Tests: budget-aware-routing
 *
 * Covers: usage below soft / above soft / above hard thresholds, disabled
 * config flag, env kill-switch (GV_BUDGET_ROUTING=0), applyTo path filtering,
 * interactive path never downgraded, and decision logging (JSONL).
 *
 * All cases run against an injected state — no Nexus dependency.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  getBudgetRoutingState,
  resolveBudgetAwareModel,
  type BudgetRoutingState,
} from '../../src/tokens/budget-aware-routing.ts';

const ROOT = process.cwd();
const DECISION_LOG = join(ROOT, '.runtime', 'budget-routing-decisions.jsonl');

const BASE_CONFIG = {
  enabled: true,
  softThresholdPct: 100,
  hardThresholdPct: 150,
  downgradeProfile: 'cheap',
  applyTo: ['subagent', 'delegation', 'research'],
};

function makeState(used: number, extra: Partial<BudgetRoutingState> = {}): BudgetRoutingState {
  const state = getBudgetRoutingState({
    usedTokensToday: used,
    configOverride: { ...BASE_CONFIG },
    dailyBudgetOverride: 5_000_000,
  });
  return Object.assign(state, { enabled: true, ...extra });
}

function readLastDecisions(n: number): Array<Record<string, unknown>> {
  if (!existsSync(DECISION_LOG)) return [];
  const lines = readFileSync(DECISION_LOG, 'utf-8')
    .split('\n')
    .filter((l) => l.trim());
  return lines.slice(-n).map((l) => JSON.parse(l));
}

const MODEL = 'opencode/big-pickle';
const CHEAP = 'opencode/mimo-v2.5-free';

test('usage below soft threshold -> tier ok, model unchanged', () => {
  const state = makeState(2_500_000); // 50% of 5M
  assert.equal(state.tier, 'ok');
  assert.equal(state.usagePct, 50);
  assert.equal(resolveBudgetAwareModel('subagent', MODEL, state), MODEL);
});

test('usage above soft threshold -> downgrade applied to subagent path', () => {
  const state = makeState(5_500_000); // 110% of 5M
  assert.equal(state.tier, 'soft');
  assert.equal(resolveBudgetAwareModel('subagent', MODEL, state), CHEAP);
});

test('usage above hard threshold -> downgrade + hard tier', () => {
  const state = makeState(7_500_000); // 150% of 5M
  assert.equal(state.tier, 'hard');
  assert.equal(resolveBudgetAwareModel('delegation', MODEL, state), CHEAP);
});

test('interactive path is NEVER downgraded', () => {
  const state = makeState(7_500_000); // hard tier
  assert.equal(resolveBudgetAwareModel('interactive', MODEL, state), MODEL);
});

test('path not in applyTo is not downgraded', () => {
  const state = makeState(7_500_000);
  assert.equal(resolveBudgetAwareModel('unknown-path', MODEL, state), MODEL);
});

test('disabled config flag -> no downgrade even above hard', () => {
  const state = makeState(7_500_000, { enabled: false });
  assert.equal(resolveBudgetAwareModel('subagent', MODEL, state), MODEL);
});

test('env GV_BUDGET_ROUTING=0 disables routing', () => {
  const prev = process.env.GV_BUDGET_ROUTING;
  process.env.GV_BUDGET_ROUTING = '0';
  try {
    const state = getBudgetRoutingState({
      usedTokensToday: 7_500_000,
      configOverride: { ...BASE_CONFIG },
      dailyBudgetOverride: 5_000_000,
    });
    assert.equal(state.enabled, false);
    assert.equal(state.disabledByEnv, true);
    assert.equal(resolveBudgetAwareModel('subagent', MODEL, state), MODEL);
  } finally {
    if (prev === undefined) delete process.env.GV_BUDGET_ROUTING;
    else process.env.GV_BUDGET_ROUTING = prev;
  }
});

test('downgrade decision is logged to the JSONL decision log', () => {
  const state = makeState(7_500_000);
  const resolved = resolveBudgetAwareModel('research', MODEL, state);
  assert.equal(resolved, CHEAP);
  const last = readLastDecisions(3);
  const row = last.find((r) => r.path === 'research' && r.from === MODEL && r.to === CHEAP);
  assert.ok(row, 'decision row found in budget-routing-decisions.jsonl');
  assert.ok(typeof row.ts === 'string' && row.ts);
  assert.ok(typeof row.usagePct === 'number' && (row.usagePct as number) >= 150);
  assert.ok(typeof row.reason === 'string' && (row.reason as string).includes('hard'));
});
