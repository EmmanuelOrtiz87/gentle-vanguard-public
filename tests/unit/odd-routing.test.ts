import assert from 'node:assert/strict';
import test from 'node:test';
import { SmallestRouteRouter } from '../../src/orchestration/smallest-route-router.js';

const router = new SmallestRouteRouter();
test('ODD keeps multi-file and research work inline without a delegation reason', () => {
  for (const estimatedFiles of [1, 4, 30]) {
    const result = router.analyze({
      description: 'Understand and implement a feature',
      estimatedFiles,
      requiresResearch: true,
      complexity: 'substantial',
      confidence: 0.9,
    });
    assert.equal(result.route, 'direct');
    assert.equal(result.requiresConfirmation, false);
  }
});
test('SDD remains available by explicit request', () => {
  assert.equal(router.analyze({ description: 'spec', explicitSDD: true }).route, 'sdd');
});
test('a named ODD reason allows deliberate delegation', () => {
  assert.equal(
    router.analyze({ description: 'independent review', delegationReason: 'verifier' }).route,
    'delegated',
  );
});
test('zero confidence is preserved and uncertainty can require clarification inline', () => {
  const result = router.analyze({ description: 'unclear', confidence: 0 });
  assert.equal(result.route, 'direct');
  assert.equal(result.confidence, 0);
  assert.equal(result.requiresConfirmation, true);
});
