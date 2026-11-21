import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isSimulatedRun,
  recomputeStats,
  redactRecord,
} from '../../src/tokens/token-optimization-orchestrator';

const legacyRow = {
  input: { prompt: 'secret prompt text', context: 'pipeline-cycle-test', cacheEnabled: true },
  output: {
    response: '[Simulated response for: secret prompt text]',
    fromCache: true,
    cacheKey: 'abc',
  },
  stages: [
    {
      stage: 'cache-check',
      durationMs: 1,
      tokensIn: 100,
      tokensOut: 10,
      savings: 90,
      success: true,
    },
  ],
  metrics: {
    cacheHit: true,
    cacheTokensSaved: 90,
    totalTokensIn: 100,
    totalTokensOut: 10,
    totalSavings: 90,
    totalReduction: 90,
    estimatedCostSaved: 0.09,
  },
  durationMs: 2,
};

test('redactRecord keeps sizes and hashes, never prompt or response text', () => {
  const record = redactRecord(legacyRow);
  const serialized = JSON.stringify(record);
  assert.ok(!serialized.includes('secret prompt text'), 'raw prompt leaked into stored record');
  assert.equal(record.input.promptChars, 'secret prompt text'.length);
  assert.ok(record.input.promptHash);
  assert.ok(record.output.responseHash);
  assert.equal(record.output.fromCache, true);
  assert.equal(record.metrics.totalSavings, 90);
});

test('rows without an explicit flag are treated as simulated (no real LLM path)', () => {
  assert.equal(isSimulatedRun(legacyRow), true);
  assert.equal(
    isSimulatedRun({
      input: { context: 'anything' },
      output: { response: 'looks like a real answer' },
    }),
    true,
  );
  assert.equal(isSimulatedRun({ simulated: false, input: {}, output: {} }), false);
});

test('recomputeStats never reports simulated savings as real savings', () => {
  const simulated = redactRecord(legacyRow);
  const real = redactRecord({
    ...legacyRow,
    simulated: false,
    input: { ...legacyRow.input, context: 'production' },
    output: { ...legacyRow.output, response: 'a real answer' },
    metrics: { ...legacyRow.metrics, totalSavings: 40 },
  });

  const stats = recomputeStats([simulated, real]);
  assert.equal(stats.totalRuns, 2);
  assert.equal(stats.simulatedRuns, 1);
  assert.equal(stats.realRuns, 1);
  assert.equal(stats.simulatedTokenSavings, 90);
  assert.equal(stats.realTokenSavings, 40);
  assert.equal(stats.totalTokenSavings, 40);
  assert.equal(stats.avgSavingsPct, 40);
  assert.equal(stats.byStage['cache-check'].runs, 2);
});

test('recomputeStats with only simulated runs reports zero real savings', () => {
  const stats = recomputeStats([redactRecord(legacyRow), redactRecord(legacyRow)]);
  assert.equal(stats.simulatedRuns, 2);
  assert.equal(stats.realRuns, 0);
  assert.equal(stats.totalTokenSavings, 0);
  assert.equal(stats.avgSavingsPct, 0);
});
