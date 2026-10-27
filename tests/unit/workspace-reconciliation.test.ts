import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSync } from '../../src/core/run-command.js';

test('reconciles real tracked and untracked bytes without changing the workspace', async () => {
  const { reconcileWorkspace } = await import('../../src/git/workspace-reconciliation.js');
  const root = mkdtempSync(join(tmpdir(), 'gv-reconcile-'));
  const git = (...args: string[]) => {
    const result = runSync('git', args, { cwd: root });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  try {
    git('init'); git('config', 'user.name', 'Test fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'core.autocrlf', 'false');
    for (const name of ['already.txt', 'texto español.txt', 'changed.txt', 'missing.txt'])
      writeFileSync(join(root, name), 'baseline\n');
    writeFileSync(join(root, 'binary.dat'), Buffer.from([0, 1, 2]));
    git('add', '.'); git('commit', '-m', 'fixture');
    // A baseline file can be untracked locally on an older/different branch.
    git('rm', '--cached', 'already.txt');
    writeFileSync(join(root, 'texto español.txt'), 'baseline\r\n');
    writeFileSync(join(root, 'changed.txt'), 'local work\n');
    writeFileSync(join(root, 'new.txt'), 'new work\n');
    writeFileSync(join(root, 'binary.dat'), Buffer.from([0, 1, 3]));
    rmSync(join(root, 'missing.txt'));
    const before = git('status', '--porcelain=v1', '-z', '--untracked-files=all');
    const result = reconcileWorkspace(root, 'HEAD');
    const states = Object.fromEntries(result.files.map((file) => [file.path, file.state]));
    assert.equal(states['already.txt'], 'matches-baseline');
    assert.equal(states['texto español.txt'], 'matches-after-eol-normalization');
    assert.equal(states['changed.txt'], 'different');
    assert.equal(states['binary.dat'], 'different');
    assert.equal(states['new.txt'], 'local-only');
    assert.equal(states['missing.txt'], 'missing-locally');
    assert.equal(git('status', '--porcelain=v1', '-z', '--untracked-files=all'), before);
    assert.equal(readFileSync(join(root, 'changed.txt'), 'utf8'), 'local work\n');
    assert.throws(() => reconcileWorkspace(root, 'nonexistent-ref'), /Git/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
