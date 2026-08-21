#!/usr/bin/env node
/**
 * Unit Tests: Skill Router
 * Tests TF-IDF semantic routing
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

describe('Skill Router', () => {
  const embeddingsFile = join(process.cwd(), '.atl', 'skill-embeddings.json');

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

      // Verify skills count
      assert.ok(
        embeddings.metadata.totalSkills >= 400,
        `Should have 400+ skills, found ${embeddings.metadata.totalSkills}`,
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
