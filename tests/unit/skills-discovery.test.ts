import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('skills-discovery', () => {
  it('src/skill-recommender.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'skills', 'skill-recommender.ts')));
  });

  it('src/skill-embedder-incremental.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'skills', 'skill-embedder-incremental.ts')));
  });
});
