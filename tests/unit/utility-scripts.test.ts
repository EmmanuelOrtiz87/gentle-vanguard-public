import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('utility-scripts', () => {
  it('src/tools/validate-readme.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'tools', 'validate-readme.ts')));
  });

  it('src/review/validate-gitflow.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'review', 'validate-gitflow.ts')));
  });

  it('src/normative-audit-pipeline.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'infrastructure', 'normative-audit-pipeline.ts')));
  });
});
