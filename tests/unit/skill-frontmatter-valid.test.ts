#!/usr/bin/env node
/**
 * Invariante de autoría: todo `skills/<dir>/SKILL.md` debe tener frontmatter YAML
 * válido con `name` y `description`. Los lectores canónicos (registry, embedder,
 * governance audit) usan js-yaml: un bloque inválido degrada la skill a invisible
 * sin ningún error visible (medido 2026-11-25: 21 skills con metadata duplicada o
 * `description` multilínea sin plegar quedaban sin triggers ni descripción).
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { load } from 'js-yaml';

const skillsRoot = resolve(process.cwd(), 'skills');

function frontmatterBlocks(): Array<{ dir: string; block: string | null }> {
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const file = join(skillsRoot, e.name, 'SKILL.md');
      if (!existsSync(file)) return { dir: e.name, block: null };
      const text = readFileSync(file, 'utf8');
      return { dir: e.name, block: text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? null };
    })
    .filter((s) => s.block !== null);
}

test('todos los SKILL.md tienen frontmatter YAML válido con name y description', () => {
  const blocks = frontmatterBlocks();
  assert.ok(blocks.length > 200, `se esperaban >200 skills, encontradas ${blocks.length}`);
  const failures: string[] = [];
  for (const { dir, block } of blocks) {
    let meta: Record<string, unknown> | null = null;
    try {
      meta = (load(block!) as Record<string, unknown> | null) ?? null;
    } catch (e) {
      failures.push(`${dir}: YAML inválido (${(e as Error).message.split('\n')[0]})`);
      continue;
    }
    if (typeof meta?.name !== 'string' || !String(meta.name).trim())
      failures.push(`${dir}: sin name`);
    if (typeof meta?.description !== 'string' || !String(meta.description).trim())
      failures.push(`${dir}: sin description legible`);
  }
  assert.deepStrictEqual(failures, [], `frontmatter inválidos:\n${failures.join('\n')}`);
});
