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
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditCapabilitySources, listContracts, describeContract } from '../../src/core/capabilities.ts';
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
    'gentle-vanguard.agent/v1',
    'gentle-vanguard.skill/v1',
    'gentle-vanguard.app-lifecycle/v1',
    'gentle-vanguard.external-capability/v1',
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

test('agent, skill, app, and external capability contracts expose operational verbs', () => {
  const expected = new Map([
    ['gentle-vanguard.agent/v1', ['discover', 'route', 'delegate', 'report']],
    ['gentle-vanguard.skill/v1', ['discover', 'match', 'load', 'verify']],
    ['gentle-vanguard.app-lifecycle/v1', ['register', 'start', 'stop', 'health']],
    ['gentle-vanguard.external-capability/v1', ['declare', 'authorize', 'invoke', 'audit']],
  ]);

  for (const [contract, requiredOps] of expected) {
    const answer = describeContract(contract);
    assert.ok(Array.isArray(answer), `${contract} must describe`);
    assert.equal(answer[0].status, 'stable');
    for (const op of requiredOps) {
      assert.ok(answer[0].operations.includes(op), `${contract} advertises ${op}`);
    }
  }
});

test('auditCapabilitySources validates live registries behind capability contracts', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-capabilities-'));
  mkdirSync(join(root, 'config'), { recursive: true });
  mkdirSync(join(root, 'docs'), { recursive: true });
  mkdirSync(join(root, 'skills'), { recursive: true });

  writeFileSync(
    join(root, 'config', 'agents.json'),
    JSON.stringify({
      agents: {
        tester: {
          name: 'tester',
          capability: 'verification',
          executionCommand: 'node --import tsx src/agents/tester.ts',
        },
      },
    }),
  );
  writeFileSync(
    join(root, 'config', 'mcp-registry.json'),
    JSON.stringify({
      servers: [
        { name: 'skill-server', enabled: true, transport: 'stdio', command: 'node' },
        { name: 'remote-docs', enabled: true, transport: 'remote', url: 'https://example.com/mcp' },
      ],
    }),
  );
  writeFileSync(
    join(root, 'skills', 'INDEX.md'),
    [
      '| Metric | Count |',
      '| ----- | ----- |',
      '| Active in `skills/` (canonical) | 1 |',
      '',
      '| Skill | Directory | Status | Origin | Description |',
      '| ----- | --------- | ------ | ------ | ----------- |',
      '| `test-skill` | `skills` | active | native | Test skill |',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'docs', 'APP-LIFECYCLE.md'),
    [
      '| App | Puerto(s) | start.sh | stop.sh | Alternativa npm | Pidfile(s) |',
      '| --- | --- | --- | --- | --- | --- |',
      '| demo-app | 1234 | `apps/demo/start.sh` | `apps/demo/stop.sh` | `npm run demo` | `demo.pid` |',
      '',
    ].join('\n'),
  );

  const results = auditCapabilitySources({ root });
  assert.deepEqual(
    results.map((result) => [result.id, result.status]),
    [
      ['contract-source:agents', 'pass'],
      ['contract-source:skills', 'pass'],
      ['contract-source:apps', 'pass'],
      ['contract-source:external-capabilities', 'pass'],
    ],
  );
});
