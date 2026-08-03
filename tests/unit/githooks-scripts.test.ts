import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('githooks-scripts', () => {
  it('src/hooks/pre-commit.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'hooks', 'pre-commit.ts')));
  });

  it('src/hooks/commitlint.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'hooks', 'commitlint.ts')));
  });

  it('src/hooks/commit-msg-session-track-hook.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'hooks', 'commit-msg-session-track-hook.ts')));
  });
});
