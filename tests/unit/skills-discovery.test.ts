import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildContentHashes,
  FULL_REBUILD_SCRIPT,
} from '../../src/skills/skill-embedder-incremental.js';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('skills-discovery', () => {
  it('src/skill-recommender.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'skills', 'skill-recommender.ts')));
  });

  it('src/skill-embedder-incremental.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'skills', 'skill-embedder-incremental.ts')));
  });

  it('uses the native local embedder for full rebuilds', () => {
    assert.equal(FULL_REBUILD_SCRIPT, 'src/skills/skill-embedder.ts');
  });

  it('builds deterministic content hashes without semantic embedding fallback', () => {
    const skills = { 'skill-a': 'agent-a', 'skill-b': 'agent-b' };
    assert.deepEqual(buildContentHashes(skills), buildContentHashes(skills));
    assert.equal(Object.keys(buildContentHashes(skills)).length, 2);
    assert.notEqual(
      buildContentHashes(skills)['skill-a'],
      buildContentHashes({ 'skill-a': 'agent-b' })['skill-a'],
    );
  });
});
