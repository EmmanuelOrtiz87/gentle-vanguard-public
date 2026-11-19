import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  getConfiguredAgentModelIds,
  getDefaultModelIds,
  parseDelegationResult,
} from '../../src/orchestration/intelligent-delegator.js';

test('delegator fallback chain is unique and derived from the canonical model registry', () => {
  const registry = JSON.parse(readFileSync('config/model-health-registry.json', 'utf8'));
  const primary = registry.routingRules.orchestrator.primary as string;
  const fallback = registry.models[primary].fallbackChain as string[];
  const expected = [...new Set([primary, ...fallback])];
  const actual = getDefaultModelIds();

  assert.deepEqual(actual, expected);
  assert.equal(new Set(actual).size, actual.length);
  for (const model of actual) assert.ok(registry.models[model], `${model} must exist in registry`);
  for (const model of getConfiguredAgentModelIds()) {
    assert.ok(
      actual.includes(model),
      `agent preference ${model} must be in the canonical fallback chain`,
    );
  }
});

test('a declared helper failure is not trusted as success from exit code 0', () => {
  const stdout = [
    'banner',
    '=== Delegation Result ===',
    JSON.stringify({
      success: false,
      error:
        'Native helper prepared a template/plan; phase execution requires the active host agent',
      executionKind: 'deterministic-domain-analysis',
      llmCalled: false,
    }),
    '',
  ].join('\n');
  const parsed = parseDelegationResult(stdout);
  assert.equal(parsed?.success, false);
  assert.equal(parsed?.llmCalled, false);
  assert.match(parsed?.error ?? '', /host agent/);
  assert.equal(parseDelegationResult('no structured result'), null);
});
