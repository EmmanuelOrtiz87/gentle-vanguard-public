import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { syncPublicGitAttributes } from '../../src/infrastructure/sync-to-public.js';

const root = resolve(import.meta.dirname, '../..');

describe('public Git attributes', () => {
  it('keeps LF text and binary bytes in a Windows-style clone without LFS', () => {
    const temp = mkdtempSync(join(tmpdir(), 'gv-public-attributes-'));
    const source = join(temp, 'source');
    const clone = join(temp, 'clone');
    mkdirSync(source);
    const git = (cwd: string, ...args: string[]) => {
      const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout;
    };
    try {
      git(source, 'init', '-q');
      syncPublicGitAttributes(root, source);
      const attributes = readFileSync(join(source, '.gitattributes'), 'utf8');
      assert.doesNotMatch(attributes, /(?:filter|diff|merge)=lfs|\r/);
      const files = ['main.go', 'license.txt', 'shell.js', 'colors.csv', 'go.mod', 'module.psd1'];
      for (const file of files) writeFileSync(join(source, file), 'first\nsecond\n');
      const binary = Buffer.from([0, 13, 10, 255, 10]);
      for (const file of ['sample.pdf', 'sample.zip', 'sample.mp4']) {
        writeFileSync(join(source, file), binary);
        assert.match(git(source, 'check-attr', 'filter', '--', file), /filter: unspecified/);
        assert.match(git(source, 'check-attr', 'text', '--', file), /text: unset/);
      }
      git(source, 'add', '.');
      git(
        source,
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-qm',
        'fixture',
      );
      git(temp, '-c', 'core.autocrlf=true', 'clone', '-q', source, clone);
      for (const file of files) {
        assert.equal(readFileSync(join(clone, file), 'utf8'), 'first\nsecond\n', file);
      }
      for (const file of ['sample.pdf', 'sample.zip', 'sample.mp4']) {
        assert.deepEqual(readFileSync(join(clone, file)), binary, file);
      }
      syncPublicGitAttributes(root, clone);
      assert.equal(readFileSync(join(clone, '.gitattributes'), 'utf8'), attributes);
      assert.equal(git(clone, 'status', '--porcelain'), '');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it('preserves the target when canonical attributes cannot be read', () => {
    const temp = mkdtempSync(join(tmpdir(), 'gv-public-attributes-missing-'));
    try {
      writeFileSync(join(temp, '.gitattributes'), 'preserve\n');
      assert.throws(() => syncPublicGitAttributes(join(temp, 'missing'), temp), /ENOENT/);
      assert.equal(readFileSync(join(temp, '.gitattributes'), 'utf8'), 'preserve\n');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
