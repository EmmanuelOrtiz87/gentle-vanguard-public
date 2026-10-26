import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runSync } from '../../../src/core/run-command.js';
import {
  captureCandidate,
  appendReceipt,
  receiptErrors,
  type BoundReceipt,
} from '../../../src/rdd/receipt-contract.js';
import { generateReleaseProvenance, type RDDWorkflow } from '../../../src/rdd/rdd-core.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'gv-rdd-binding-'));
  function git(...args: string[]) {
    const r = runSync('git', args, { cwd: root });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  }
  git('init', '-b', 'main');
  git('config', 'user.name', 'fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'core.hooksPath', join(root, '.no-hooks'));
  writeFileSync(join(root, 'example.txt'), 'one');
  git('add', '.');
  git('commit', '-m', 'test: candidate');
  return { root, git };
}
function receipt(root: string, scope: 'index' | 'commit' | 'worktree' = 'index'): BoundReceipt {
  const candidate = captureCandidate(root, scope);
  return {
    id: 'fixture',
    candidateHash: candidate.head,
    contentHash: candidate.digest,
    timestamp: new Date().toISOString(),
    approved: true,
    candidate,
    evidence: {
      candidateDigest: candidate.digest,
      reviewer: 'isolated-test-fixture',
      verdict: 'pass',
      checks: [{ command: 'fixture assertion', exitCode: 0 }],
    },
    findings: [],
  };
}

test('provenance consumes the canonical receipt and never reports failed subprocesses as success', () => {
  const f = fixture(); const reviewed = receipt(f.root, 'commit'); appendReceipt(f.root, reviewed);
  const workflow = { workflowId: 'fixture-workflow', receipt: { id: reviewed.id } } as RDDWorkflow;
  const calls: string[][] = [];
  const runner = (_script: string, args: string[]) => {
    calls.push(args);
    return { status: 0, stdout: '', stderr: '', error: null, signal: null };
  };
  assert.equal(generateReleaseProvenance(workflow, { root: f.root, runner }), true);
  const artifact = calls[0][calls[0].indexOf('-a') + 1];
  assert.deepEqual(JSON.parse(readFileSync(artifact, 'utf8')), reviewed);
  assert.equal(generateReleaseProvenance(workflow, { root: f.root, runner: () => ({ status: 1, stdout: '', stderr: 'failure', error: null, signal: null }) }), false);
});
test('review binding detects staged changes and untracked byte changes', () => {
  const f = fixture();
  const staged = receipt(f.root);
  assert.deepEqual(receiptErrors(f.root, staged, 'pre-commit'), []);
  writeFileSync(join(f.root, 'example.txt'), 'two');
  f.git('add', '.');
  assert.ok(receiptErrors(f.root, staged, 'pre-commit').some((e) => e.includes('drifted')));
  writeFileSync(join(f.root, 'new.txt'), 'first');
  const untracked = receipt(f.root, 'worktree');
  writeFileSync(join(f.root, 'new.txt'), 'second');
  assert.ok(receiptErrors(f.root, untracked, 'post-apply').some((e) => e.includes('drifted')));
});
test('delivery accepts exactly the reviewed index tree after commit', () => {
  const f = fixture();
  writeFileSync(join(f.root, 'example.txt'), 'two');
  f.git('add', '.');
  const approved = receipt(f.root);
  f.git('commit', '-m', 'test: reviewed tree');
  assert.deepEqual(receiptErrors(f.root, approved, 'pre-push'), []);
  writeFileSync(join(f.root, 'example.txt'), 'three');
  f.git('add', '.');
  f.git('commit', '-m', 'test: unreviewed tree');
  assert.ok(receiptErrors(f.root, approved, 'release').length);
});
test('tampered candidate metadata cannot reuse prior review evidence', () => {
  const f = fixture();
  const approved = receipt(f.root);
  approved.candidate.tree = 'f'.repeat(40);
  assert.ok(receiptErrors(f.root, approved, 'pre-commit').length);
  assert.ok(receiptErrors(f.root, approved, 'pre-push').length);
});
