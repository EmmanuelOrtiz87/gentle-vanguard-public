import test from 'node:test';
import assert from 'node:assert/strict';
import { freshProbe, inventoryCoverage, qualificationExit, bindingObservation, memoryTransportObservation } from '../../src/integrations/client-runtime-evidence.js';

const now = Date.parse('2026-10-22T15:00:00Z');
const evidence = { recordedAt: new Date(now - 1000).toISOString(), fingerprint: 'current', result: { qualified: false, reason: 'HTTP 403' } };
test('cached probe cannot outlive its configuration/version or freshness window', () => {
  assert.equal(freshProbe(evidence, 'current', now)?.result.qualified, false);
  assert.equal(freshProbe(evidence, 'changed', now), null);
  assert.equal(freshProbe({ ...evidence, recordedAt: new Date(now - 86400001).toISOString() }, 'current', now), null);
  assert.equal(freshProbe({ ...evidence, recordedAt: new Date(now + 60000).toISOString() }, 'current', now), null);
  assert.equal(freshProbe({ fingerprint: 'current' }, 'current', now), null);
});
test('MCP evidence keeps connected, failed and OAuth-deferred scopes distinct', () => {
  const inventory = { capturedAt: new Date(now - 1000).toISOString(), servers: [
    { name: 'engram', tools: ['mem_search'] },
    { name: 'remote', tools: [], error: 'remote-oauth (no inventoria automático)' },
    { name: 'broken', tools: [], error: 'connection closed' },
  ] };
  assert.deepEqual(inventoryCoverage(inventory, now), { fresh: true, connected: 1, failed: 1, deferred: 1 });
  assert.equal(inventoryCoverage({ ...inventory, capturedAt: 'invalid' }, now).fresh, false);
  assert.deepEqual(inventoryCoverage({ capturedAt: inventory.capturedAt, servers: [null, { tools: 'fake' }] }, now), { fresh: false, connected: 0, failed: 2, deferred: 0 });
});
test('observation collector may succeed while a qualification gate still refuses', () => {
  assert.equal(qualificationExit({ complete: false, observe: true, collected: true }), 0);
  assert.equal(qualificationExit({ complete: false, observe: false, collected: true }), 2);
  assert.equal(qualificationExit({ complete: false, observe: true, collected: false }), 1);
});

test('missing host identity is unobserved, not proof that a registered host needs registration', () => {
  assert.equal(bindingObservation(null).status, 'host-identity-unavailable');
  assert.equal(bindingObservation(null).identityConfirmed, null);
  assert.equal(bindingObservation(false).status, 'host-event-required');
  assert.equal(bindingObservation(true).status, 'binding-confirmed');
});

test('a timed-out memory probe is inconclusive even when partial output claims PASS', () => {
  const output = JSON.stringify({ status: 'PASS', listProjectsOk: true, toolCount: 23 });
  const result = memoryTransportObservation(null, output, 'ETIMEDOUT');
  assert.equal(result.status, 'INCONCLUSIVE');
  assert.equal(result.reason, 'Memory probe timed out');
  assert.equal(memoryTransportObservation(1, output).status, 'FAIL');
});

test('memory transport requires a completed process and an accepted read-only response', () => {
  assert.equal(memoryTransportObservation(0, 'not JSON').status, 'FAIL');
  assert.equal(memoryTransportObservation(0, '{"status":"PASS"}').status, 'FAIL');
  assert.equal(memoryTransportObservation(null, '', 'ENOENT').reason, 'Memory probe could not start (ENOENT)');
  assert.deepEqual(memoryTransportObservation(0, '{"status":"PASS","listProjectsOk":true,"toolCount":23}'), {
    status: 'PASS', toolCount: 23, listProjectsOk: true,
  });
});
