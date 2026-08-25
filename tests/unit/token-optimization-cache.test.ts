import assert from 'node:assert/strict';
import test from 'node:test';

import { ResponseCache } from '../../src/response-cache';
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
