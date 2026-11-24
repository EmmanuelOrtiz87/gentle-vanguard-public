#!/usr/bin/env node
/**
 * Regression: syncTriggers must recognise the `triggers:` block it writes.
 *
 * The writer emits a bare `triggers:` line, while the locator used to require a
 * trailing space. Adding a second lexicon entry therefore appended a duplicate
 * `triggers:` key and YAML rejected the whole frontmatter ("duplicated mapping
 * key"), silently losing name, description and triggers for that skill.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { syncTriggers } from '../../src/skills/skill-trigger-i18n.ts';

test('syncTriggers updates a bare triggers block without duplicating the key', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-trigger-'));
  try {
    const skillsDir = join(root, 'skills');
    mkdirSync(join(skillsDir, 'demo-skill'), { recursive: true });
    const skillPath = join(skillsDir, 'demo-skill', 'SKILL.md');
    writeFileSync(
      skillPath,
      '---\nname: demo-skill\ndescription: Demo skill for the trigger sync regression.\ntriggers:\n  - existing trigger\n---\n\n# Demo\n',
      'utf8',
    );
    const lexiconPath = join(root, 'lexicon.json');
    writeFileSync(
      lexiconPath,
      JSON.stringify({ version: '1.0.0', skills: { 'demo-skill': { es: ['nuevo disparador'] } } }),
      'utf8',
    );

    const first = syncTriggers(lexiconPath, skillsDir);
    assert.deepStrictEqual(first.updated, ['demo-skill']);

    const second = syncTriggers(lexiconPath, skillsDir);
    assert.deepStrictEqual(second.unchanged, ['demo-skill']);

    const content = readFileSync(skillPath, 'utf8');
    const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    assert.strictEqual((frontmatter.match(/^triggers:/gm) ?? []).length, 1);
    const parsed = load(frontmatter) as { triggers?: string[] };
    assert.deepStrictEqual(parsed.triggers, ['existing trigger', 'nuevo disparador']);
    assert.match(content, /# Demo/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
