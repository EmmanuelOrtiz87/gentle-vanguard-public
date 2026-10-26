import test from 'node:test';
import assert from 'node:assert/strict';
import { assessBinding, assessModelProbe, surfaceQualification } from '../../src/integrations/client-qualification.js';

test('installation PASS does not certify runtime task execution', () => {
  assert.equal(surfaceQualification('PASS').level, 'declared');
  assert.equal(surfaceQualification('PASS').qualified, false);
});
test('binding requires successful resolver with a nonempty host-returned identity', () => {
  assert.equal(assessBinding(0, '{}'), false);
  assert.equal(assessBinding(1, '{"session_id":"host-returned"}'), false);
  assert.equal(assessBinding(0, '{"session_id":"host-returned"}'), true);
});
test('model error, fallback, or a marker without accepted output never qualifies SDD', () => {
  const answer = 'GV_SDD_PROBE {"requirements":["3 failed PINs"],"acceptance":["third failure locks","60 second boundary unlocks"],"unresolvedQuestions":["retry window?"]}';
  const stdout = [
    { type: 'tool_use', part: { tool: 'task', state: { status: 'completed', input: { subagent_type: 'sdd-explore' }, output: `<task_result>${answer}</task_result>` } } },
    { type: 'step_finish', part: { reason: 'stop' } },
  ].map(event => JSON.stringify(event)).join('\n');
  assert.equal(assessModelProbe(0, stdout, '').qualified, true);
  assert.equal(assessModelProbe(0, stdout, 'Falling back to default agent').qualified, false);
  assert.equal(assessModelProbe(1, '403 FreeTierError', '').qualified, false);
  assert.equal(assessModelProbe(0, 'GV_SDD_PROBE', '').qualified, false);
  assert.equal(assessModelProbe(0, JSON.stringify({ type: 'text', part: { text: answer } }), '').qualified, false);
  assert.equal(assessModelProbe(0, stdout.replace('sdd-explore', 'other-agent'), '').qualified, false);
  assert.equal(assessModelProbe(0, stdout.replace('completed', 'error'), '').qualified, false);
  assert.equal(assessModelProbe(0, stdout.split('\n')[0], '').qualified, false);
});
