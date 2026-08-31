#!/usr/bin/env node
/**
 * Unit Tests: Anti-Loop Guard
 *
 * Verifies that repeated failed attempts at the same goal with the same strategy
 * are detected as a loop, forcing a strategy change or escalation, and that a
 * successful attempt resets the counter. Also verifies the delegateWithAntiLoop
 * integration blocks delegation when a task is already in a loop.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  registerAttempt,
  detectLoop,
  clearGoal,
  getLoopStatus,
  hashKey,
  DEFAULT_MAX_ATTEMPTS,
  ESCALATE_AFTER,
} from '../../src/resilience/anti-loop-guard.ts';

// Isolate state per test by pointing the guard at a temp dir via cwd.
// The guard uses process.cwd() for its state dir, so we run each test in a
// fresh temp working directory by chdir'ing. Async-aware so tests that await
// delegateWithAntiLoop keep the temp cwd until the promise settles.
async function withTempDir(fn: () => void | Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'gv-antiloop-'));
  const prev = process.cwd();
  process.chdir(dir);
  try {
    await fn();
  } finally {
    process.chdir(prev);
    rmSync(dir, { recursive: true, force: true });
  }
}

test('hashKey: produces a stable 16-char hex hash', () => {
  const a = hashKey('fix npm audit');
  const b = hashKey('fix npm audit');
  const c = hashKey('different goal');
  assert.strictEqual(a, b, 'same input → same hash');
  assert.notStrictEqual(a, c, 'different input → different hash');
  assert.match(a, /^[0-9a-f]{16}$/, '16-char hex');
});

test('registerAttempt: success resets the counter', async () => {
  await withTempDir(() => {
    registerAttempt('goal A', 'strategy 1', 'failed');
    registerAttempt('goal A', 'strategy 1', 'failed');
    const v = registerAttempt('goal A', 'strategy 1', 'success');
    assert.strictEqual(v.inLoop, false);
    assert.strictEqual(v.attempts, 0);
    assert.strictEqual(v.action, 'none');
  });
});

test('registerAttempt: same strategy failing N times flags a loop (change_strategy)', async () => {
  await withTempDir(() => {
    let v;
    for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) {
      v = registerAttempt('goal B', 'strategy X', 'failed');
    }
    assert.ok(v, 'verdict returned');
    assert.strictEqual(v!.inLoop, true, 'loop detected');
    assert.strictEqual(v!.action, 'change_strategy', 'forces strategy change');
    assert.strictEqual(v!.attempts, DEFAULT_MAX_ATTEMPTS);
  });
});

test('registerAttempt: escalating after ESCALATE_AFTER attempts', async () => {
  await withTempDir(() => {
    let v;
    for (let i = 0; i < ESCALATE_AFTER; i++) {
      v = registerAttempt('goal C', 'strategy Y', 'failed');
    }
    assert.strictEqual(v!.inLoop, true);
    assert.strictEqual(v!.action, 'escalate', 'escalates to user after repeated loop');
  });
});

test('registerAttempt: changing strategy resets the counter', async () => {
  await withTempDir(() => {
    registerAttempt('goal D', 'strategy P', 'failed');
    registerAttempt('goal D', 'strategy P', 'failed');
    // Switch strategy → fresh counter, not a loop yet.
    const v = registerAttempt('goal D', 'strategy Q', 'failed');
    assert.strictEqual(v.inLoop, false, 'new strategy not yet a loop');
    assert.strictEqual(v.attempts, 1, 'counter reset for new strategy');
  });
});

test('detectLoop: no attempts → not a loop', async () => {
  await withTempDir(() => {
    const v = detectLoop('never attempted');
    assert.strictEqual(v.inLoop, false);
    assert.strictEqual(v.action, 'none');
  });
});

test('detectLoop: reflects current loop state without registering', async () => {
  await withTempDir(() => {
    registerAttempt('goal E', 'strategy Z', 'failed');
    registerAttempt('goal E', 'strategy Z', 'failed');
    registerAttempt('goal E', 'strategy Z', 'failed');
    const v = detectLoop('goal E');
    assert.strictEqual(v.inLoop, true);
    assert.strictEqual(v.attempts, DEFAULT_MAX_ATTEMPTS);
  });
});

test('clearGoal: removes tracked state', async () => {
  await withTempDir(() => {
    registerAttempt('goal F', 'strategy W', 'failed');
    registerAttempt('goal F', 'strategy W', 'failed');
    registerAttempt('goal F', 'strategy W', 'failed');
    assert.strictEqual(getLoopStatus().activeLoops, 1);
    clearGoal('goal F');
    const status = getLoopStatus();
    assert.strictEqual(status.activeLoops, 0);
    assert.strictEqual(Object.keys(status.goals).length, 0);
  });
});

test('getLoopStatus: reports active loops', async () => {
  await withTempDir(() => {
    registerAttempt('goal G', 'strategy V', 'failed');
    registerAttempt('goal G', 'strategy V', 'failed');
    registerAttempt('goal G', 'strategy V', 'failed');
    const status = getLoopStatus();
    assert.strictEqual(status.activeLoops, 1);
    const key = hashKey('goal G');
    assert.strictEqual(status.goals[key].inLoop, true);
  });
});

test('delegateWithAntiLoop: blocks delegation when task is in a change_strategy loop', async () => {
  await withTempDir(async () => {
    // Simulate 3 failed attempts with the same strategy (same agent + task).
    const goal = 'implement feature X';
    const strategy = 'sdd-apply::implement feature X';
    for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) {
      registerAttempt(goal, strategy, 'failed');
    }
    // Now delegateWithAntiLoop should block BEFORE calling delegate().
    const { delegateWithAntiLoop } = await import('../../src/orchestration/agent-delegator.ts');
    const result = await delegateWithAntiLoop({ agent: 'sdd-apply', task: goal });
    assert.strictEqual(result.success, false);
    assert.match(result.error || '', /ANTI-LOOP.*Change strategy/i);
  });
});

test('delegateWithAntiLoop: escalates when task is in an escalate loop', async () => {
  await withTempDir(async () => {
    const goal = 'implement feature Y';
    const strategy = 'sdd-apply::implement feature Y';
    for (let i = 0; i < ESCALATE_AFTER; i++) {
      registerAttempt(goal, strategy, 'failed');
    }
    const { delegateWithAntiLoop } = await import('../../src/orchestration/agent-delegator.ts');
    const result = await delegateWithAntiLoop({ agent: 'sdd-apply', task: goal });
    assert.strictEqual(result.success, false);
    assert.match(result.error || '', /ANTI-LOOP.*Escalating/i);
  });
});
