#!/usr/bin/env node
/**
 * Unit Tests: Guardrail Orchestrator
 *
 * Verifies that failures are classified into the correct category, that the
 * decision engine maps each category to the correct action, and that the
 * learning loop (incident log + resolution) works end-to-end.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyFailure,
  decideAction,
  evaluateFailure,
  resolveIncident,
  getCategoryStats,
} from '../../src/guardrail-orchestrator.ts';

// Isolate state per test by pointing the orchestrator at a temp dir via cwd.
async function withTempDir(fn: () => void | Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'gv-guardrail-'));
  const prev = process.cwd();
  process.chdir(dir);
  try {
    await fn();
  } finally {
    process.chdir(prev);
    rmSync(dir, { recursive: true, force: true });
  }
}

test('classifyFailure: config errors', () => {
  assert.strictEqual(classifyFailure({ error: 'config file not found: foo.json' }), 'config');
  assert.strictEqual(classifyFailure({ error: 'invalid JSON in config' }), 'config');
  assert.strictEqual(classifyFailure({ error: 'field "agent" is missing' }), 'config');
});

test('classifyFailure: network errors', () => {
  assert.strictEqual(classifyFailure({ error: 'ECONNREFUSED' }), 'network');
  assert.strictEqual(classifyFailure({ error: 'fetch failed' }), 'network');
  assert.strictEqual(classifyFailure({ error: 'socket hang up' }), 'network');
  assert.strictEqual(classifyFailure({ error: 'connect ETIMEDOUT' }), 'network');
});

test('classifyFailure: model errors', () => {
  assert.strictEqual(classifyFailure({ error: 'model not found: opencode/foo' }), 'model');
  assert.strictEqual(classifyFailure({ error: 'rate limit exceeded (429)' }), 'model');
  assert.strictEqual(classifyFailure({ error: 'provider error' }), 'model');
});

test('classifyFailure: db errors', () => {
  assert.strictEqual(classifyFailure({ error: 'SQLITE_BUSY: database is locked' }), 'db');
  assert.strictEqual(classifyFailure({ error: 'no such table: sessions' }), 'db');
  assert.strictEqual(classifyFailure({ error: 'database corrupt' }), 'db');
});

test('classifyFailure: git errors', () => {
  assert.strictEqual(classifyFailure({ error: 'merge conflict in src/foo.ts' }), 'git');
  assert.strictEqual(classifyFailure({ error: 'push rejected: non-fast-forward' }), 'git');
  assert.strictEqual(classifyFailure({ error: 'not a git repository' }), 'git');
});

test('classifyFailure: security errors', () => {
  assert.strictEqual(classifyFailure({ error: 'prompt injection detected' }), 'security');
  assert.strictEqual(classifyFailure({ error: 'blocked pattern: rm -rf' }), 'security');
  assert.strictEqual(classifyFailure({ error: 'secret found in file' }), 'security');
});

test('classifyFailure: resource errors', () => {
  assert.strictEqual(classifyFailure({ error: 'token budget exceeded' }), 'resource');
  assert.strictEqual(classifyFailure({ error: 'out of memory' }), 'resource');
  assert.strictEqual(classifyFailure({ error: 'workload limit exceeded' }), 'resource');
});

test('classifyFailure: reasoning errors', () => {
  assert.strictEqual(classifyFailure({ error: '[ANTI-LOOP] Escalating' }), 'reasoning');
  assert.strictEqual(classifyFailure({ error: 'maximum steps reached' }), 'reasoning');
});

test('classifyFailure: quality errors', () => {
  assert.strictEqual(classifyFailure({ error: 'quality score degraded' }), 'quality');
  assert.strictEqual(classifyFailure({ error: 'lint error: unused var' }), 'quality');
  assert.strictEqual(classifyFailure({ error: 'typecheck failed' }), 'quality');
});

test('classifyFailure: unknown falls back', () => {
  assert.strictEqual(classifyFailure({ error: 'some random thing happened' }), 'unknown');
});

test('classifyFailure: accepts Error objects', () => {
  assert.strictEqual(classifyFailure({ error: new Error('ECONNREFUSED') }), 'network');
});

test('decideAction: maps each category to the correct action', () => {
  assert.strictEqual(decideAction('config').action, 'correct');
  assert.strictEqual(decideAction('network').action, 'retry');
  assert.strictEqual(decideAction('model').action, 'retry');
  assert.strictEqual(decideAction('db').action, 'correct');
  assert.strictEqual(decideAction('git').action, 'retry');
  assert.strictEqual(decideAction('security').action, 'block');
  assert.strictEqual(decideAction('resource').action, 'isolate');
  assert.strictEqual(decideAction('reasoning').action, 'escalate');
  assert.strictEqual(decideAction('quality').action, 'correct');
  assert.strictEqual(decideAction('unknown').action, 'continue');
});

test('decideAction: security and reasoning surface to user', () => {
  assert.strictEqual(decideAction('security').surfaceToUser, true);
  assert.strictEqual(decideAction('reasoning').surfaceToUser, true);
  assert.strictEqual(decideAction('network').surfaceToUser, false);
});

test('evaluateFailure: records incident and returns proceed flag', async () => {
  await withTempDir(async () => {
    // Blocking failure -> should NOT proceed
    const block = evaluateFailure({ error: 'prompt injection detected', source: 'test' });
    assert.strictEqual(block.category, 'security');
    assert.strictEqual(block.decision.action, 'block');
    assert.strictEqual(block.proceed, false);
    assert.ok(block.incident.id);

    // Retryable failure -> should proceed
    const retry = evaluateFailure({ error: 'ECONNREFUSED', source: 'test' });
    assert.strictEqual(retry.category, 'network');
    assert.strictEqual(retry.decision.action, 'retry');
    assert.strictEqual(retry.proceed, true);

    // Stats should reflect both incidents
    const stats = getCategoryStats();
    const security = stats.find((s) => s.category === 'security');
    const network = stats.find((s) => s.category === 'network');
    assert.ok(security);
    assert.ok(network);
    assert.strictEqual(security!.total, 1);
    assert.strictEqual(network!.total, 1);

    // Resolve the network incident -> learning loop
    const resolved = resolveIncident(retry.incident.id, 'retried successfully');
    assert.strictEqual(resolved, true);
    const statsAfter = getCategoryStats();
    const networkAfter = statsAfter.find((s) => s.category === 'network');
    assert.strictEqual(networkAfter!.resolved, 1);
    assert.strictEqual(networkAfter!.resolveRate, 100);
  });
});

test('resolveIncident: unknown id returns false', async () => {
  await withTempDir(async () => {
    assert.strictEqual(resolveIncident('nonexistent', 'x'), false);
  });
});

// ---------------------------------------------------------------------------
// Integration: delegateWithGuardrail
// ---------------------------------------------------------------------------

test('delegateWithGuardrail: unknown agent failure is classified and proceeds', async () => {
  await withTempDir(async () => {
    const { delegateWithGuardrail } = await import('../../src/agent-delegator.ts');
    // Unknown agent -> delegate() fails with "Unknown agent" -> classified as
    // 'unknown' -> action 'continue' -> proceed: true -> incident id attached.
    const result = await delegateWithGuardrail({ agent: 'nonexistent-agent', task: 'x' });
    assert.strictEqual(result.success, false);
    assert.match(result.error || '', /GUARDRAIL:unknown/);
    assert.match(result.error || '', /incident=/);
  });
});

test('delegateWithGuardrail: reasoning loop escalates and blocks retry', async () => {
  await withTempDir(async () => {
    const { registerAttempt, ESCALATE_AFTER } = await import('../../src/anti-loop-guard.ts');
    const { delegateWithGuardrail } = await import('../../src/agent-delegator.ts');
    const goal = 'implement feature Z';
    const strategy = 'sdd-apply::implement feature Z';
    // Simulate enough failures to trigger escalation (5+).
    for (let i = 0; i < ESCALATE_AFTER; i++) {
      registerAttempt(goal, strategy, 'failed');
    }
    // delegateWithAntiLoop blocks BEFORE delegating with [ANTI-LOOP] Escalating,
    // which the guardrail classifies as 'reasoning' -> escalate -> proceed: false.
    const result = await delegateWithGuardrail({ agent: 'sdd-apply', task: goal });
    assert.strictEqual(result.success, false);
    assert.match(result.error || '', /GUARDRAIL:reasoning/);
    assert.match(result.error || '', /STOP retrying|escalat/i);
  });
});
