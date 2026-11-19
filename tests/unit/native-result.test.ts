import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeResultFailure, parseNativeResult } from '../../src/orchestration/native-result.js';

const envelope = (result: unknown) =>
  `diagnostic log\n=== JSON OUTPUT ===\n${JSON.stringify(result)}`;
test('exit-zero templates and unsuccessful structured results do not qualify as completed work', () => {
  assert.match(
    nativeResultFailure(envelope({ success: true, phaseComplete: false }))!,
    /template\/plan/,
  );
  assert.match(
    nativeResultFailure(envelope({ success: false, implementationPerformed: false }))!,
    /host agent/,
  );
  assert.match(nativeResultFailure(envelope({ success: false }))!, /unsuccessful/);
});
test('malformed envelopes fail while real success and legacy output remain compatible', () => {
  assert.match(nativeResultFailure('log\n=== JSON OUTPUT ===\ninvalid')!, /malformed/);
  assert.match(nativeResultFailure(envelope(null))!, /invalid/);
  assert.equal(nativeResultFailure(envelope({ success: true })), undefined);
  assert.equal(nativeResultFailure('legacy helper output'), undefined);
});
test('parseNativeResult exposes executionKind/llmCalled so metrics do not call helpers LLM work', () => {
  const parsed = parseNativeResult(
    envelope({
      success: true,
      executionKind: 'deterministic-domain-analysis',
      llmCalled: false,
    }),
  );
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.envelope?.executionKind, 'deterministic-domain-analysis');
  assert.equal(parsed.envelope?.llmCalled, false);
  assert.deepEqual(parseNativeResult('legacy helper output'), {});
});
