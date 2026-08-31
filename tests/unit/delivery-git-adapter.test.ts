import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { syncPathsFromSource } from '../../src/delivery/git-adapter.ts';

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.strictEqual(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

test('syncPathsFromSource materializes source changes without mutating source checkout', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'gv-delivery-git-'));
  const worktree = `${fixture}-target-worktree`;

  try {
    git(fixture, ['init', '-b', 'main']);
    git(fixture, ['config', 'user.name', 'Delivery Test']);
    git(fixture, ['config', 'user.email', 'delivery-test@example.invalid']);

    const file = join(fixture, 'tracked.txt');
    writeFileSync(file, 'target\n');
    git(fixture, ['add', '--', 'tracked.txt']);
    git(fixture, ['commit', '-m', 'target']);
    const targetSha = git(fixture, ['rev-parse', 'HEAD']);

    writeFileSync(file, 'source\n');
    git(fixture, ['add', '--', 'tracked.txt']);
    git(fixture, ['commit', '-m', 'source']);
    const sourceSha = git(fixture, ['rev-parse', 'HEAD']);
    const sourceHead = git(fixture, ['rev-parse', 'HEAD']);
    const sourceContent = readFileSync(file, 'utf8');

    git(fixture, ['worktree', 'add', '--detach', worktree, targetSha]);
    const sourceStatus = git(fixture, ['status', '--porcelain']);
    const result = syncPathsFromSource(sourceSha, targetSha, ['tracked.txt'], worktree, fixture);

    assert.equal(result.ok, true, result.stderr);
    assert.equal(
      readFileSync(join(worktree, 'tracked.txt'), 'utf8').replaceAll('\r\n', '\n'),
      'source\n',
    );
    assert.equal(git(worktree, ['diff', '--cached', '--name-only']), 'tracked.txt');
    assert.equal(git(fixture, ['rev-parse', 'HEAD']), sourceHead);
    assert.equal(git(fixture, ['status', '--porcelain']), sourceStatus);
    assert.equal(readFileSync(file, 'utf8'), sourceContent);
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', worktree], {
      cwd: fixture,
      windowsHide: true,
    });
    rmSync(fixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(worktree, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
