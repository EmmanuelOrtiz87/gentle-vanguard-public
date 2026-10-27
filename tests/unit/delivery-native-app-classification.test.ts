import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { classifyPath, classifyDiff } from '../../src/delivery/diff-classifier.js';
import { gitStatus } from '../../src/delivery/git-adapter.js';

test('native app source, dependencies and sensitive overlays receive software review lanes', () => {
  assert.equal(classifyPath('apps/connect/app/services/inbox.rb'), 'code');
  assert.equal(classifyPath('apps/connect/public/gv/theme.css'), 'code');
  assert.equal(classifyPath('apps/connect/Dockerfile'), 'dependency');
  assert.equal(classifyPath('apps/connect/deploy/locked/Gemfile.lock'), 'dependency');
  assert.equal(classifyPath('apps/connect/package.json'), 'release');
  assert.equal(classifyPath('apps/connect/overlay/gv_strict_encryption.rb'), 'security');
  assert.equal(classifyPath('apps/connect/app/controllers/auth/sessions.rb'), 'security');
  assert.equal(classifyPath('apps/connect/db/migrate/20260101_change.rb'), 'schema');
  assert.equal(classifyPath('apps/connect/docs/installation.md'), 'docs');
  assert.equal(classifyDiff(['apps/connect/overlay/gv_strict_encryption.rb']).requiresHumanApproval, true);
});

test('working tree risk sees actual untracked files and preserves modified/renamed Unicode paths', () => {
  const directory = mkdtempSync(join(tmpdir(), 'gv-native-risk-'));
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: directory, windowsHide: true, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'QA fixture');
    git('config', 'user.email', 'qa@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    writeFileSync(join(directory, 'tracked.txt'), 'baseline');
    writeFileSync(join(directory, 'old.txt'), 'rename');
    git('add', '--', 'tracked.txt', 'old.txt');
    git('commit', '-m', 'synthetic baseline');
    writeFileSync(join(directory, 'tracked.txt'), 'changed');
    git('mv', '--', 'old.txt', 'nuevo ñ espacio.txt');
    mkdirSync(join(directory, 'apps/connect'), { recursive: true });
    writeFileSync(join(directory, 'apps/connect/package.json'), '{}');
    const status = gitStatus(directory);
    assert.equal(status.clean, false);
    assert.ok(status.dirty.includes('tracked.txt'));
    assert.ok(status.dirty.includes('nuevo ñ espacio.txt'));
    assert.ok(status.dirty.includes('old.txt'));
    assert.deepEqual(status.untracked, ['apps/connect/package.json']);
    assert.equal(classifyDiff([...status.dirty, ...status.untracked]).requiresHumanApproval, true);
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + '\\') || resolve(directory).startsWith(resolve(tmpdir()) + '/'));
    rmSync(directory, { recursive: true, force: true });
  }
});
