import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('utility-scripts', () => {
  it('src/validate-readme.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'validate-readme.ts')));
  });

  it('src/validate-gitflow.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'validate-gitflow.ts')));
  });

  it('src/normative-audit-pipeline.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'infrastructure', 'normative-audit-pipeline.ts')));
  });
});
