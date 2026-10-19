import assert from 'node:assert/strict';
import test from 'node:test';

import { saveSessionState } from '../../src/core/session-context-log';
import { ResponseCache } from '../../src/resilience/response-cache';
import { runPipeline } from '../../src/tokens/token-optimization-orchestrator';

test('ResponseCache completes a miss, store, hit cycle with the same key', () => {
  const cache = new ResponseCache({ useSqlite: true });
  const prompt = `cache-cycle-${Date.now()}-${'repeatable prompt '.repeat(30)}`;
  const context = 'cache-cycle-test';
  cache.clear();

  assert.equal(cache.get(prompt, context), null);
  cache.set(prompt, 'stored response', 12, context);

  assert.deepEqual(cache.get(prompt, context), {
    response: 'stored response',
    tokensSaved: 12,
  });
  cache.clear();
});

test('runPipeline stores the original prompt key before compression', async () => {
  const prompt = `pipeline-cycle-${Date.now()}-${'original prompt '.repeat(40)}`;
  const first = await runPipeline(
    { prompt, context: 'pipeline-cycle-test', cacheEnabled: true },
    { skipPreProcess: false, skipPostProcess: true },
  );
  const second = await runPipeline(
    { prompt, context: 'pipeline-cycle-test', cacheEnabled: true },
    { skipPreProcess: false, skipPostProcess: true },
  );

  assert.equal(first.output.fromCache, false);
  assert.equal(second.output.fromCache, true);
  assert.equal(second.output.cacheKey, first.output.cacheKey);
});

test('runPipeline can load session history into pre-process stage', async () => {
  const sessionId = `pipeline-history-${Date.now()}`;
  saveSessionState({
    sessionId,
    agent: 'test',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    totalTokens: 0,
    totalCost: 0,
    messageCount: 28,
    turns: Array.from({ length: 28 }, (_, index) => ({
      message: `turn-${index}`,
      inputSummary: 'prior input summary with repeated operational details '.repeat(20),
      outputSummary: 'prior output summary with confirmed decisions '.repeat(20),
    })),
  });

  const result = await runPipeline(
    {
      prompt: 'Continue with the optimization work.',
      context: `pipeline-history-${Date.now()}`,
      cacheEnabled: false,
      useSessionHistory: true,
      sessionId,
      historyTurns: 28,
    },
    { skipPreProcess: false, skipPostProcess: true },
  );

  const preProcess = result.stages.find((stage) => stage.stage === 'pre-process');
  assert.ok(preProcess);
  assert.ok(preProcess.savings > 0);
  assert.match(String(preProcess.output), /\[Previous context\]/);
});
