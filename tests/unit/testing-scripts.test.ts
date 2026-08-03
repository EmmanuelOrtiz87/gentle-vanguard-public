import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('testing-scripts', () => {
  it('src/test-runner.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'test-runner.ts')));
  });

  it('tests/config directory exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'tests', 'config')));
  });
});
