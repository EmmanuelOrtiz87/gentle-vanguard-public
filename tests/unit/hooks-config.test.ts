import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('hooks-config', () => {
  it('.lefthook.yml exists', () => {
    assert.ok(existsSync(resolve(ROOT, '.lefthook.yml')));
  });

  it('lefthook.yml contains pre-commit', () => {
    const content = readFileSync(resolve(ROOT, '.lefthook.yml'), 'utf-8');
    assert.ok(content.includes('pre-commit'));
  });
});
