import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getConfiguredAgentModelIds, getDefaultModelIds } from '../../src/orchestration/intelligent-delegator.js';

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
    assert.ok(actual.includes(model), `agent preference ${model} must be in the canonical fallback chain`);
  }
});
