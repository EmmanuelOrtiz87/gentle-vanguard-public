/**
 * delegation-policy.test.ts — ADR-0027 + HUMAN-IN-THE-LOOP cableados a la ruta
 * real de delegación (GB-20261120): toda delegación pasa por el motor de
 * política fail-closed ANTES de ejecutarse. deny bloquea; require_approval
 * bloquea con aprobadores (HITL); error del motor → deny (fail-closed).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  evaluateDelegationPolicy,
  setDelegationPolicyEngine,
} from '../../src/orchestration/agent-delegator.js';
import { PolicyEngine } from '../../src/security/policy-engine/policy-engine.js';

function tempPolicy(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'gv-policy-'));
  const path = join(dir, 'test-policy.yaml');
  writeFileSync(path, yaml);
  return path;
}

const POLICY_YAML = (rules: string) => `apiVersion: v1
name: gv-test-policy
defaultAction: deny
rules:
${rules}
`;

test('delegación estándar está permitida por la política del repo (allow-agent-delegation)', () => {
  // Motor default del repo: config/policies/gv-core-tool-safety.yaml
  const result = evaluateDelegationPolicy({ agent: 'editorial-agent', task: 'resume este texto' });
  assert.equal(result, null, `la delegación estándar debe fluir, bloqueó con: ${result}`);
});

test('una regla deny sobre el agente bloquea la delegación con mensaje honesto', () => {
  const path = tempPolicy(
    POLICY_YAML(
      `  - name: deny-maintenance\n` +
        `    condition: action.tool == 'maintenance-agent'\n` +
        `    action: deny\n` +
        `    priority: 100\n` +
        `    description: "Maintenance delegado denegado en este entorno."\n`,
    ),
  );
  setDelegationPolicyEngine(new PolicyEngine([path]));
  try {
    const result = evaluateDelegationPolicy({ agent: 'maintenance-agent', task: 'limpiar' });
    assert.ok(result?.startsWith('[POLICY:deny]'), `debe bloquear con deny: ${result}`);
  } finally {
    setDelegationPolicyEngine(undefined);
  }
});

test('require_approval bloquea con HITL y aprobadores (owner)', () => {
  const path = tempPolicy(
    POLICY_YAML(
      `  - name: hitl-finance\n` +
        `    condition: action.tool == 'finance-agent'\n` +
        `    action: require_approval\n` +
        `    priority: 100\n` +
        `    approvers: ["owner"]\n` +
        `    description: "Operaciones financieras requieren aprobación del owner."\n`,
    ),
  );
  setDelegationPolicyEngine(new PolicyEngine([path]));
  try {
    const result = evaluateDelegationPolicy({ agent: 'finance-agent', task: 'forecast Q1' });
    assert.ok(result?.includes('[POLICY:require_approval]'), `debe pedir aprobación: ${result}`);
    assert.ok(result?.includes('owner'), `debe nombrar a los aprobadores: ${result}`);
  } finally {
    setDelegationPolicyEngine(undefined);
  }
});

test('error del motor → fail-closed (deny), nunca abierto en silencio', () => {
  const broken = {
    evaluate: () => {
      throw new Error('config corrupta');
    },
  } as unknown as PolicyEngine;
  setDelegationPolicyEngine(broken);
  try {
    const result = evaluateDelegationPolicy({ agent: 'ops-agent', task: 'x' });
    assert.ok(
      result?.includes('[POLICY:deny]') && result?.includes('Fail-closed'),
      `debe fail-closed: ${result}`,
    );
  } finally {
    setDelegationPolicyEngine(undefined);
  }
});
