/**
 * skill-registry-sync.test.ts — el registro de skills se actualiza SOLO cuando
 * el canon cambia, y se detecta aunque el registro exista.
 *
 * POR QUÉ EXISTE (2026-11-25)
 * -------------------------------------------------------------------------
 * `.atl/skill-registry.md` lo leen ~12 módulos del stack. `ensureSkillRegistry`
 * sólo reparaba la AUSENCIA: una skill agregada, un trigger cambiado o un
 * mapeo skill→agente distinto dejaban el registro viejo en silencio (el
 * defecto que el owner pidió cerrar: "registrá todas las skills según
 * corresponda, automáticamente cuando se agregan o se cambian"). El contrato
 * de este test fija:
 *
 *   S1 · Registro ausente → se crea (reason `missing`).
 *   S2 · Sin cambios → `up-to-date`, no reescribe.
 *   S3 · Skill nueva → `stale`, aparece en `added` y en el registro.
 *   S4 · Trigger cambiado → `stale` (mismo conjunto de nombres, distinto canon).
 *   S5 · Mapeo skill→agente cambiado en auto-delegation.json → `stale`.
 *   S6 · Skill retirada del disco → `stale` y aparece en `removed`.
 *   S7 · `write: false` (modo gate) detecta sin tocar el archivo.
 *   S8 · Registro heredado sin fingerprint → una vez `stale`, luego estable.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { registryFingerprint, syncSkillRegistry } from '../../src/skills/skill-registry-builder.ts';

const roots: string[] = [];

function makeRoot(): { root: string; delegation: string; registry: string } {
  const root = mkdtempSync(join(tmpdir(), 'gv-registry-sync-'));
  roots.push(root);
  mkdirSync(join(root, 'config'), { recursive: true });
  const delegation = join(root, 'config', 'auto-delegation.json');
  writeFileSync(delegation, JSON.stringify({ skillToAgentProfile: {} }), 'utf8');
  return { root, delegation, registry: join(root, '.atl', 'skill-registry.md') };
}

function makeSkill(root: string, dir: string, frontmatter: string): void {
  const skillDir = join(root, 'skills', dir);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), `---\n${frontmatter}\n---\n\n# ${dir}\n`, 'utf8');
}

function seedAlphaBeta(root: string): void {
  makeSkill(
    root,
    'alpha-skill',
    'name: alpha-skill\ndescription: Alpha\ntriggers: "generar informe"',
  );
  makeSkill(root, 'beta-skill', 'name: beta-skill\ndescription: Beta\ntriggers: "revisar codigo"');
}

function sync(root: string, delegation: string, registry: string, write = true) {
  return syncSkillRegistry({
    projectRoot: root,
    delegationConfigPath: delegation,
    registryPath: registry,
    write,
  });
}

describe('skill-registry-sync', () => {
  it('S1 · registro ausente → se crea con todas las skills del disco', () => {
    const { root, delegation, registry } = makeRoot();
    seedAlphaBeta(root);
    const result = sync(root, delegation, registry);
    assert.equal(result.changed, true);
    assert.equal(result.reason, 'missing');
    assert.equal(result.skills, 2);
    assert.deepEqual(result.added.sort(), ['alpha-skill', 'beta-skill']);
    assert.ok(existsSync(registry));
    const content = readFileSync(registry, 'utf8');
    assert.match(content, /alpha-skill/);
    assert.match(content, /skills-fingerprint:/);
  });

  it('S2 · sin cambios → up-to-date y no reescribe', () => {
    const { root, delegation, registry } = makeRoot();
    seedAlphaBeta(root);
    sync(root, delegation, registry);
    const before = readFileSync(registry, 'utf8');
    const second = sync(root, delegation, registry);
    assert.equal(second.changed, false);
    assert.equal(second.reason, 'up-to-date');
    assert.equal(readFileSync(registry, 'utf8'), before);
  });

  it('S3 · skill nueva → stale, added y registrada', () => {
    const { root, delegation, registry } = makeRoot();
    seedAlphaBeta(root);
    sync(root, delegation, registry);
    makeSkill(root, 'gamma-skill', 'name: gamma-skill\ndescription: Gamma\ntriggers: "g"');
    const result = sync(root, delegation, registry);
    assert.equal(result.changed, true);
    assert.equal(result.reason, 'stale');
    assert.deepEqual(result.added, ['gamma-skill']);
    assert.match(readFileSync(registry, 'utf8'), /gamma-skill/);
  });

  it('S4 · trigger cambiado → stale aunque los nombres sean los mismos', () => {
    const { root, delegation, registry } = makeRoot();
    seedAlphaBeta(root);
    sync(root, delegation, registry);
    makeSkill(
      root,
      'alpha-skill',
      'name: alpha-skill\ndescription: Alpha\ntriggers: "informe semanal"',
    );
    const result = sync(root, delegation, registry);
    assert.equal(result.changed, true);
    assert.equal(result.reason, 'stale');
    assert.deepEqual(result.added, []);
    assert.deepEqual(result.removed, []);
  });

  it('S5 · cambiar el mapeo skill→agente en auto-delegation.json → stale', () => {
    const { root, delegation, registry } = makeRoot();
    seedAlphaBeta(root);
    sync(root, delegation, registry);
    writeFileSync(
      delegation,
      JSON.stringify({ skillToAgentProfile: { 'alpha-skill': 'BACKEND' } }),
      'utf8',
    );
    const result = sync(root, delegation, registry);
    assert.equal(result.reason, 'stale');
    assert.match(readFileSync(registry, 'utf8'), /\| BACKEND \| alpha-skill \|/);
  });

  it('S6 · skill retirada del disco → stale y removed', () => {
    const { root, delegation, registry } = makeRoot();
    seedAlphaBeta(root);
    sync(root, delegation, registry);
    rmSync(join(root, 'skills', 'beta-skill'), { recursive: true, force: true });
    const result = sync(root, delegation, registry);
    assert.equal(result.reason, 'stale');
    assert.deepEqual(result.removed, ['beta-skill']);
    assert.doesNotMatch(readFileSync(registry, 'utf8'), /beta-skill/);
  });

  it('S7 · write:false detecta sin tocar el archivo (modo gate)', () => {
    const { root, delegation, registry } = makeRoot();
    seedAlphaBeta(root);
    sync(root, delegation, registry);
    const before = readFileSync(registry, 'utf8');
    makeSkill(root, 'gamma-skill', 'name: gamma-skill\ndescription: Gamma\ntriggers: "g"');
    const check = sync(root, delegation, registry, false);
    assert.equal(check.changed, true);
    assert.deepEqual(check.added, ['gamma-skill']);
    assert.equal(readFileSync(registry, 'utf8'), before, 'el gate no reescribe');
  });

  it('S8 · registro heredado sin fingerprint → stale una vez, después estable', () => {
    const { root, delegation, registry } = makeRoot();
    seedAlphaBeta(root);
    mkdirSync(join(root, '.atl'), { recursive: true });
    writeFileSync(
      registry,
      '# Registro viejo\n\n| Agent | Skill | Triggers |\n|---|---|---|\n| X | alpha-skill | a |\n',
      'utf8',
    );
    const legacy = sync(root, delegation, registry, false);
    assert.equal(legacy.changed, true);
    assert.equal(legacy.reason, 'stale');
    sync(root, delegation, registry);
    assert.equal(sync(root, delegation, registry).reason, 'up-to-date');
  });

  it('S9 · fingerprint es estable ante el orden de los triggers', () => {
    const a = registryFingerprint([{ skill: 's', agent: 'A', triggers: ['b', 'a'] }]);
    const b = registryFingerprint([{ skill: 's', agent: 'A', triggers: ['a', 'b'] }]);
    assert.equal(a, b);
    const c = registryFingerprint([{ skill: 's', agent: 'B', triggers: ['a', 'b'] }]);
    assert.notEqual(a, c);
  });
});

process.on('exit', () => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});
