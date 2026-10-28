#!/usr/bin/env node
/**
 * Unit Tests: Skill Router
 * Tests TF-IDF semantic routing
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { buildSkillCatalog } from '../../src/skills/skill-embedder.ts';

const ROOT = process.cwd();

describe('Skill Router', () => {
  const embeddingsFile = join(ROOT, '.atl', 'skill-embeddings.json');

  it('should have skill embeddings file', () => {
    assert.ok(existsSync(embeddingsFile), 'Skill embeddings should exist');
  });

  it('should have valid embeddings structure', () => {
    if (existsSync(embeddingsFile)) {
      const embeddings = JSON.parse(readFileSync(embeddingsFile, 'utf-8'));

      assert.ok(embeddings.version, 'Should have version');
      assert.ok(embeddings.metadata, 'Should have metadata');
      assert.ok(embeddings.vocabulary, 'Should have vocabulary');
      assert.ok(embeddings.idf, 'Should have IDF scores');
      assert.ok(Array.isArray(embeddings.skills), 'Skills should be an array');
      assert.strictEqual(
        embeddings.metadata.totalSkills,
        embeddings.skills.length,
        'metadata.totalSkills must match the indexed skill array',
      );

      // The index must mirror the catalog of skills that can actually be loaded.
      // Until 2026-10-02 the artifact also indexed registry/config names with no
      // SKILL.md on disk (276 of 512 entries were phantoms, see
      // buildSkillCatalog in src/skills/skill-embedder.ts); dropping them left
      // ~246 real skills, so the old "400+ skills" threshold measured a catalog
      // that no longer exists. Assert parity against the native oracle instead:
      // a stale artifact (skills changed without reindexing) still fails.
      const expectedSkills = Object.keys(
        buildSkillCatalog(
          join(ROOT, '.atl', 'skill-registry.md'),
          join(ROOT, 'config', 'auto-delegation.json'),
          ROOT,
        ),
      ).sort();
      const indexedSkills = embeddings.skills
        .map((skill: { name: string }) => skill.name)
        .sort();
      assert.deepStrictEqual(
        indexedSkills,
        expectedSkills,
        'skill-embeddings.json must index exactly the loadable skill catalog; regenerate with `npx tsx src/skills/skill-embedder.ts` when skills change',
      );
    }
  });

  it('should have valid skill entries', () => {
    if (existsSync(embeddingsFile)) {
      const embeddings = JSON.parse(readFileSync(embeddingsFile, 'utf-8'));
      const skill = embeddings.skills[0];

      assert.ok(skill.name, 'Skill should have name');
      assert.ok(skill.agent, 'Skill should have agent');
      assert.ok(Array.isArray(skill.triggers), 'Skill should have triggers array');
      assert.ok(skill.vector, 'Skill should have vector');
      assert.ok(Array.isArray(skill.charNgrams), 'Skill should have charNgrams');
    }
  });

  it('should have vocabulary', () => {
    if (existsSync(embeddingsFile)) {
      const embeddings = JSON.parse(readFileSync(embeddingsFile, 'utf-8'));
      assert.ok(
        embeddings.metadata.vocabularySize > 1000,
        `Should have 1000+ vocabulary terms, found ${embeddings.metadata.vocabularySize}`,
      );
    }
  });
});
