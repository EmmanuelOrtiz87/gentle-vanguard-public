/**
 * TEST NEGATIVO del gate de accesibilidad de skills.
 *
 * Un gate que nunca falla no vale nada: "PASS" en el repo real solo demuestra
 * que el gate corrio, no que muerda. Este test INyecta cada tipo de skill
 * inaccesible y exige que el gate lo detects.
 *
 * Corre con:  node --import tsx --test src/tools/skills-accessibility-gate.test.ts
 */

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { checkSkillAccessibility, defaultRoot } from './skills-accessibility-gate.js';

const temps: string[] = [];

after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** Repo minimo con una raiz de skills y un indice semantico. */
function makeRepo(skills: Array<{ name: string; body: string }>, indexed: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'skills-access-'));
  temps.push(root);
  mkdirSync(join(root, 'skills'), { recursive: true });
  mkdirSync(join(root, '.atl'), { recursive: true });
  for (const skill of skills) {
    const dir = join(root, 'skills', skill.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), skill.body, 'utf8');
  }
  writeFileSync(
    join(root, '.atl', 'skill-embeddings.json'),
    JSON.stringify({ version: '1.0', skills: indexed.map((name) => ({ name })) }),
    'utf8',
  );
  return root;
}

const GOOD = `---
name: alpha
description: Skill de prueba con descripcion real.
---

Cuerpo.
`;

describe('skills-accessibility-gate', () => {
  it('acepta un repo donde toda skill es alcanzable', () => {
    const root = makeRepo([{ name: 'alpha', body: GOOD }], ['alpha']);
    const report = checkSkillAccessibility(root);
    assert.equal(report.errors, 0, JSON.stringify(report.findings, null, 2));
    assert.equal(report.ok, true);
  });

  it('DETECTA la skill sin description (el loader la descarta en silencio)', () => {
    const root = makeRepo(
      [{ name: 'alpha', body: '---\nname: alpha\n---\n\nCuerpo.\n' }],
      ['alpha'],
    );
    const report = checkSkillAccessibility(root);
    assert.equal(report.ok, false);
    assert.ok(
      report.findings.some((f) => f.rule === 'skill/no-description'),
      'esperaba skill/no-description',
    );
  });

  it('DETECTA la skill sin frontmatter', () => {
    const root = makeRepo([{ name: 'alpha', body: '# Sin frontmatter\n' }], ['alpha']);
    const report = checkSkillAccessibility(root);
    assert.equal(report.ok, false);
    assert.ok(
      report.findings.some((f) => f.rule === 'skill/no-frontmatter'),
      'esperaba skill/no-frontmatter',
    );
  });

  it('DETECTA la skill ausente del indice semantico (peso muerto)', () => {
    const root = makeRepo([{ name: 'alpha', body: GOOD }], []);
    const report = checkSkillAccessibility(root);
    assert.equal(report.ok, false);
    assert.ok(
      report.findings.some((f) => f.rule === 'skill/unindexed'),
      'esperaba skill/unindexed',
    );
  });

  it('DETECTA la entrada del indice que apunta a una skill inexistente', () => {
    const root = makeRepo([{ name: 'alpha', body: GOOD }], ['alpha', 'fantasma']);
    const report = checkSkillAccessibility(root);
    assert.equal(report.ok, false);
    assert.ok(
      report.findings.some((f) => f.rule === 'skill/dead-index-entry'),
      'esperaba skill/dead-index-entry',
    );
  });

  it('degrada con AVISO (no error) cuando el indice semantico no existe', () => {
    // El indice vive en .atl/, que esta en el .gitignore: en un clon limpio
    // no existe. Afirmar "282 skills inaccesibles" ahi seria un falso positivo.
    const root = makeRepo([{ name: 'alpha', body: GOOD }], ['alpha']);
    rmSync(join(root, '.atl', 'skill-embeddings.json'), { force: true });
    const report = checkSkillAccessibility(root);
    assert.equal(report.errors, 0, JSON.stringify(report.findings, null, 2));
    assert.ok(
      report.findings.some((f) => f.rule === 'skill/index-missing'),
      'esperaba skill/index-missing',
    );
  });

  it('el repo real esta accesible (si esto falla, regenerar el indice)', () => {
    const report = checkSkillAccessibility(defaultRoot());
    assert.equal(
      report.errors,
      0,
      `el repo real tiene skills inaccesibles:\n${JSON.stringify(report.findings, null, 2)}`,
    );
  });
});
