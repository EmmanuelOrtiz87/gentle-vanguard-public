import test from 'node:test';
import assert from 'node:assert/strict';
import { mirrorPayload, verifyMirror, traceErrors } from '../../src/ops/feature-trace.js';

const doc = '# Feature\n## Specs\nS1 — owner verbatim\n## Tasks\n- T1 [S1] inline: implement\n## Evidence\n- T1 | tests/proof.test.ts | abcdef1\n## Log\nL1 — evidence\n';
test('full mirror is recoverable, with content and locator checked on read-back', () => {
  const payload = mirrorPayload('docs/features/feature.md', doc);
  assert.equal(verifyMirror(`Memory header\n${payload}\nMetadata`, 'docs/features/feature.md', doc), doc);
  assert.throws(() => verifyMirror(payload, 'other.md', doc));
  assert.throws(() => verifyMirror(payload, 'docs/features/feature.md', doc + 'edit'));
  assert.throws(() => verifyMirror(payload.replace('owner verbatim', 'truncated'), 'docs/features/feature.md', doc));
});
test('trace refuses orphan spec refs, tasks without proofs, and nonexistent commits', () => {
  const exists = (path: string, commit: string) => path === 'tests/proof.test.ts' && commit === 'abcdef1';
  assert.deepEqual(traceErrors(doc, exists), []);
  assert.deepEqual(traceErrors(doc.replace(/\n/g, '\r\n'), exists), []);
  assert.match(traceErrors(doc.replace('[S1]', '[S9]'), exists).join(), /S9/);
  assert.match(traceErrors(doc.replace('- T1 | tests/proof.test.ts | abcdef1', ''), exists).join(), /T1/);
  assert.match(traceErrors(doc, () => false).join(), /proof|commit/);
});
