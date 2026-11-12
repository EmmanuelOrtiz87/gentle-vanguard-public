#!/usr/bin/env node
/**
 * Unit Tests: Skill Registry Builder
 *
 * POR QUÉ UN TEST
 * ---------------
 * `.atl/skill-registry.md` es un artefacto DERIVADO y gitignored que el
 * embedder lee. Cuando se pierde, el stack entero pierde el índice semántico
 * en silencio (el paso del autostart es lazy) y los gates que lo leen fallan
 * con ENOENT mucho después, sin causa visible.
 *
 * Este test fija DOS cosas:
 *  1. El builder genera un registro desde el catálogo real (no desde un
 *     archivo que alguien editó a mano).
 *  2. ROUND-TRIP: el registro generado lo puede leer `parseSkillRegistry`
 *     (el parser real del embedder). Si el formato deriva, el round-trip
 *     falla acá y no semanas después en un gate.
 *
 * CONTRATO DECLARADO: control `skill-registry:rebuild`
 * (config/declarations.json → controls[].contractTest). El ledger de
 * declaraciones exige que este archivo mencione ese id: un control sin test
 * enlazado es un control que nadie verifica.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  buildSkillRegistry,
  collectRegistryRows,
  ensureSkillRegistry,
} from '../../src/skills/skill-registry-builder.ts';
import { parseSkillRegistry } from '../../src/skills/skill-embedder.ts';

function makeSkill(root: string, dir: string, frontmatter: string): void {
  const skillDir = join(root, 'skills', dir);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), `---\n${frontmatter}\n---\n\n# ${dir}\n`, 'utf8');
}

function makeFixture(): { root: string; delegation: string; registry: string } {
  const root = mkdtempSync(join(tmpdir(), 'gv-registry-'));
  makeSkill(
    root,
    'alpha-skill',
    'name: alpha-skill\ndescription: Skill de prueba\ntriggers:\n  - "generar informe"\n  - "informe semanal"',
  );
  makeSkill(
    root,
    'beta-skill',
    'name: beta-skill\ndescription: Otra skill\ntriggers: "revisar codigo"',
  );
  // Directorio interno: NO es una skill (copia deprecated).
  const internal = join(root, 'skills', '_deprecated-copia');
  mkdirSync(internal, { recursive: true });
  writeFileSync(join(internal, 'SKILL.md'), '---\nname: deprecated\n---\n', 'utf8');

  const delegation = join(root, 'config', 'auto-delegation.json');
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(
    delegation,
    JSON.stringify({ skillToAgentProfile: { 'alpha-skill': 'BA', 'beta-skill': 'OPS' } }),
    'utf8',
  );
  return { root, delegation, registry: join(root, '.atl', 'skill-registry.md') };
}

describe('Skill Registry Builder', () => {
  it('construye el registro desde el catalogo real en disco', () => {
    const { root, delegation, registry } = makeFixture();
    const result = buildSkillRegistry({
      projectRoot: root,
      delegationConfigPath: delegation,
      registryPath: registry,
      write: true,
    });

    assert.ok(existsSync(registry), 'el registro debe escribirse');
    assert.strictEqual(
      result.skills,
      2,
      'sólo las skills con SKILL.md (sin los directorios _internos)',
    );

    const content = readFileSync(registry, 'utf8');
    assert.match(content, /^## Skill-Agent Mapping$/m, 'debe tener la seccion que lee el parser');
    assert.match(content, /\| BA \| alpha-skill \| /, 'el agente sale de auto-delegation.json');
    assert.match(content, /\| OPS \| beta-skill \| /);
    assert.ok(!content.includes('deprecated'), 'no debe indexar copias internas');
  });

  it('ROUND-TRIP: el parser real del embedder relee lo que genera el builder', () => {
    const { root, delegation, registry } = makeFixture();
    buildSkillRegistry({
      projectRoot: root,
      delegationConfigPath: delegation,
      registryPath: registry,
      write: true,
    });

    const parsed = parseSkillRegistry(registry);
    assert.ok(parsed['alpha-skill'], 'alpha-skill debe parsearse');
    assert.strictEqual(parsed['alpha-skill'].agent, 'BA');
    assert.deepStrictEqual(
      parsed['alpha-skill'].triggers.sort(),
      ['generar informe', 'informe semanal'],
      'los triggers del frontmatter deben llegar al parser',
    );
    assert.strictEqual(parsed['beta-skill'].agent, 'OPS');
    assert.deepStrictEqual(parsed['beta-skill'].triggers, ['revisar codigo']);
  });

  it('una skill sin mapeo explicito queda con el agente KNOWLEDGE', () => {
    const { root, delegation, registry } = makeFixture();
    makeSkill(root, 'gamma-skill', 'name: gamma-skill\ndescription: Sin agente');
    const rows = collectRegistryRows({ projectRoot: root, delegationConfigPath: delegation });
    const gamma = rows.find((row) => row.skill === 'gamma-skill');
    assert.ok(gamma, 'gamma-skill debe estar en el catalogo');
    assert.strictEqual(gamma.agent, 'KNOWLEDGE');
  });

  it('ensureSkillRegistry repara un registro ausente y respeta uno existente', () => {
    const { root, delegation, registry } = makeFixture();
    const repaired = ensureSkillRegistry({
      projectRoot: root,
      delegationConfigPath: delegation,
      registryPath: registry,
      write: true,
    });
    assert.strictEqual(repaired.wrote, true, 'debe reconstruir el registro ausente');
    assert.ok(repaired.skills >= 2);

    // Segunda llamada: el registro ya existe, no se toca.
    const again = ensureSkillRegistry({
      projectRoot: root,
      delegationConfigPath: delegation,
      registryPath: registry,
      write: true,
    });
    assert.strictEqual(again.wrote, false, 'no debe reescribir un registro existente');
  });

  it('el registro real del repo se puede regenerar sin perder skills', () => {
    const root = process.cwd();
    const rows = collectRegistryRows({
      projectRoot: root,
      delegationConfigPath: join(root, 'config', 'auto-delegation.json'),
    });
    assert.ok(rows.length > 100, `el catálogo real debe tener skills (obtenidas: ${rows.length})`);
    const conAgente = rows.filter((row) => row.agent !== 'KNOWLEDGE');
    assert.ok(
      conAgente.length > rows.length / 2,
      'la mayoría de las skills debe tener agente mapeado en auto-delegation.json',
    );
  });
});
