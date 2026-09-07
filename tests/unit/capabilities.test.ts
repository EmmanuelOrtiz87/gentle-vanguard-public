#!/usr/bin/env node
/**
 * Unit Tests: capabilities registry + CLI surfaces
 *
 * Absorbed from gentle-ai v2.5.0-rc.3 ("Capabilities v2.3"): a caller asks
 * what the stack advertises and gets an honest, versioned answer. Unknown
 * contracts refuse typed with the registered list as remediation.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { listContracts, describeContract } from '../../src/core/capabilities.ts';
import { isTypedRefusal } from '../../src/core/typed-refusal.ts';

test('every native contract is registered with protocol and operations', () => {
  const contracts = listContracts();
  const names = contracts.map((c) => c.contract);
  for (const expected of [
    'gentle-vanguard.capabilities/v1',
    'gentle-vanguard.continuation/v1',
    'gentle-vanguard.ack/v1',
    'gentle-vanguard.typed-refusal/v1',
    'gentle-vanguard.rdd-workflow/v1',
    'gentle-vanguard.sdd-pipeline/v1',
    'gentle-vanguard.sdd-research/v1',
  ]) {
    assert.ok(names.includes(expected), `${expected} must be registered`);
  }
  for (const c of contracts) {
    assert.match(c.protocol, /^\d+\.\d+$/, `${c.contract} has a major.minor protocol`);
    assert.ok(c.operations.length > 0, `${c.contract} advertises operations`);
    assert.ok(['stable', 'experimental', 'retired'].includes(c.status));
  }
});

test('describeContract returns the descriptor for an exact contract string', () => {
  const answer = describeContract('gentle-vanguard.continuation/v1');
  assert.ok(Array.isArray(answer));
  assert.equal(answer[0].operations.includes('next-transition'), true);
});

test('describeContract refuses unknown contracts typed, naming the registry', () => {
  const answer = describeContract('gentle-vanguard.does-not-exist/v9');
  assert.ok(!Array.isArray(answer));
  assert.ok(isTypedRefusal(answer));
  const r = answer as { code: string; remediation?: { description: string } };
  assert.equal(r.code, 'capabilities.unknown-contract');
  assert.match(r.remediation?.description ?? '', /gentle-vanguard\.continuation\/v1/);
});
