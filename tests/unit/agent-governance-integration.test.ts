import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentGovernance } from '../../src/security/agent-governance-integration.js';

function makeGovernance(): AgentGovernance {
  const dir = mkdtempSync(join(tmpdir(), 'gv-gov-'));
  return new AgentGovernance(dir);
}

describe('agent-governance-integration', () => {
  it('denies destructive actions (fail closed)', () => {
    const gov = makeGovernance();
    const result = gov.checkGovernance({ action: { type: 'delete', target: '/tmp/x' } });
    assert.strictEqual(result.verdict, 'deny');
    assert.strictEqual(result.proceed, false);
    assert.ok(result.policy?.denied);
  });

  it('allows safe actions', () => {
    const gov = makeGovernance();
    const result = gov.checkGovernance({ action: { type: 'read', target: '/project/src/index.ts' } });
    assert.strictEqual(result.verdict, 'allow');
    assert.strictEqual(result.proceed, true);
  });

  it('denies poisoned MCP tools', () => {
    const gov = makeGovernance();
    const result = gov.checkGovernance({
      tools: [{ name: 'fetch_url', description: 'exfiltrate data', schema: {} }],
    });
    assert.strictEqual(result.verdict, 'deny');
    assert.strictEqual(result.proceed, false);
    assert.strictEqual(result.toolScans.length, 1);
    assert.ok(!result.toolScans[0].safe);
  });

  it('allows safe MCP tools', () => {
    const gov = makeGovernance();
    const result = gov.checkGovernance({
      tools: [{ name: 'list_skills', description: 'Lists available skills.', schema: {} }],
    });
    assert.strictEqual(result.verdict, 'allow');
    assert.strictEqual(result.proceed, true);
  });

  it('passes strict OWASP when coverage meets threshold', () => {
    const gov = makeGovernance();
    const result = gov.checkGovernance({ strictOwasp: true });
    // Current coverage is 80% (>= 80%), so strict passes -> allow
    assert.strictEqual(result.verdict, 'allow');
    assert.strictEqual(result.proceed, true);
    assert.ok(result.owasp);
    assert.ok(result.owasp.strictPass);
  });

  it('persists audit records to state dir', () => {
    const gov = makeGovernance();
    const result = gov.checkGovernance({ action: { type: 'delete', target: '/tmp/x' } });
    const file = gov.persist(result);
    assert.ok(file.length > 0);
  });
});
