/**
 * docs-facts-drift-gate.test.ts — El gate de cifras de la documentacion tiene que morder.
 *
 * Un gate que nunca falla es peor que no tener gate: entrena al owner a ignorar
 * la salida (bitacora 2026-11-23). Por eso estos tests tienen una parte
 * positiva (la documentacion real esta al dia) y una parte negativa (un
 * README con un numero viejo produce un error), mas los casos que el gate
 * tiene que DEJAR pasar (historico, ambiguo, subconjunto, exento).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkDocsFacts,
  collectDocFiles,
  loadBaseline,
  measureDocsFacts,
  type DocsFacts,
} from './docs-facts-drift-gate.js';

const ROOT = process.cwd();

/** Hechos sinteticos: el test no depende del estado real del repo. */
const FACTS: DocsFacts = {
  version: '4.5.0',
  skills: { canonical: 263, indexed: 265, critical: 29 },
  agents: 22,
  checks: 38,
  ruleFiles: 76,
  npmScripts: 712,
  tsFiles: 909,
  testFiles: 371,
  nexus: { tables: 45, migrations: 24 },
  apps: { total: 27, native: 21, client: 6 },
  mcpServers: 17,
  watchtowerComponents: 36,
  academy: { courses: 30, ebooks: 33, toolkits: 26, products: 89 },
};

test('una cifra vieja de skills produce un error facts/drift', () => {
  const report = checkDocsFacts(
    [{ path: 'README.md', text: 'El stack ofrece 127 skills canónicas para el trabajo diario.' }],
    FACTS,
  );
  assert.equal(report.ok, false);
  assert.equal(report.errors, 1);
  assert.equal(report.findings[0]?.rule, 'facts/drift');
  assert.match(report.findings[0]?.message ?? '', /263/);
});

test('la cifra correcta no produce ningun error', () => {
  const report = checkDocsFacts(
    [{ path: 'README.md', text: 'El stack ofrece 263 skills canónicas para el trabajo diario.' }],
    FACTS,
  );
  assert.equal(report.ok, true);
  assert.equal(report.errors, 0);
});

test('un contexto historico no se corrige: es registro, no estado actual', () => {
  const report = checkDocsFacts(
    [
      {
        path: 'docs/stack-manual-full.md',
        text: 'En la release 4.0 el monitor tenia 154 checks en 29 componentes.',
      },
    ],
    FACTS,
  );
  assert.equal(report.ok, true, report.findings.map((f) => f.message).join(' | '));
  assert.ok(report.historical >= 1);
});

test('un documento point-in-time no se audita como estado actual', () => {
  const report = checkDocsFacts(
    [
      {
        path: 'docs/reference/BITACORA-FRICCION.md',
        text: 'El roster tenia 23 agentes en ese momento.',
      },
    ],
    FACTS,
  );
  assert.equal(report.ok, true, report.findings.map((f) => f.message).join(' | '));
  assert.equal(report.historicalFiles, 1);
});

test('una afirmacion ambigua (no es sobre el inventario) no se evalua', () => {
  const report = checkDocsFacts(
    [{ path: 'README.md', text: 'El pipeline usa 4 agentes en paralelo para revisar cambios.' }],
    FACTS,
  );
  assert.equal(report.ok, true, report.findings.map((f) => f.message).join(' | '));
  assert.ok(report.ambiguous >= 1);
});

test('una mencion de subconjunto no se confunde con el total', () => {
  const report = checkDocsFacts(
    [
      {
        path: 'docs/stack-manual-modules.md',
        text: '`indexed` (265, incluye 2 skills que solo existen en mirrors)',
      },
    ],
    FACTS,
  );
  assert.equal(report.ok, true, report.findings.map((f) => f.message).join(' | '));
});

test('las skills criticas se comparan contra el total de criticas, no contra el indice', () => {
  const report = checkDocsFacts(
    [{ path: 'README.md', text: 'Se propagan 29 skills criticas a cada superficie.' }],
    FACTS,
  );
  assert.equal(report.ok, true, report.findings.map((f) => f.message).join(' | '));
});

test('una cifra de checks vieja produce error', () => {
  const report = checkDocsFacts(
    [
      {
        path: 'GETTING-STARTED.md',
        text: 'npm run watchtower:health  # salud (154 checks / 29 componentes)',
      },
    ],
    FACTS,
  );
  assert.equal(report.ok, false);
  assert.equal(report.errors, 2);
});

test('el baseline exime una afirmacion legitima de subconjunto', () => {
  const report = checkDocsFacts(
    [{ path: 'packages/brand/README.md', text: 'assets de marca para las 13 apps registradas.' }],
    FACTS,
    {
      entries: [
        {
          file: 'packages/brand/README.md',
          claim: '13 apps',
          fact: 'apps',
          reason: 'subconjunto con assets de marca',
        },
      ],
    },
  );
  assert.equal(report.ok, true, report.findings.map((f) => f.message).join(' | '));
  assert.equal(report.baselined, 1);
});

test('una excepcion de baseline que ya no aplica se reporta (y hay que borrarla)', () => {
  const report = checkDocsFacts(
    [{ path: 'README.md', text: 'El stack ofrece 263 skills canónicas.' }],
    FACTS,
    {
      entries: [
        {
          file: 'README.md',
          claim: '13 apps',
          fact: 'apps',
          reason: 'la excepcion ya no aplica',
        },
      ],
    },
  );
  assert.equal(report.ok, true);
  assert.equal(report.warnings, 1);
  assert.equal(report.findings[0]?.rule, 'facts/stale-baseline');
});

test('un numero pegado a una palabra no es un conteo (C3 Agentes)', () => {
  const report = checkDocsFacts(
    [
      {
        path: 'docs/educacion/ia-engineering/RUTA-ARQUITECTO-IA.md',
        text: '| C3 Agentes con herramientas | 22 agentes OpenCode |',
      },
    ],
    FACTS,
  );
  assert.equal(report.ok, true, report.findings.map((f) => f.message).join(' | '));
});

test('la superficie escaneada incluye los README y la landing, no las auditorias', () => {
  const files = collectDocFiles(ROOT);
  const paths = new Set(files.map((file) => file.path));
  assert.ok(paths.has('README.md'));
  assert.ok(paths.has('README-PUBLIC.md'));
  assert.ok(paths.has('GETTING-STARTED.md'));
  assert.ok(paths.has('docs/stack-manual-full.md'));
  assert.ok(paths.has('docs/reference/GLOSSARY.md'));
  assert.ok(
    [...paths].some((p) => p.startsWith('apps/academy-landing/') && p.endsWith('.html')),
    'no se encontro HTML de la landing en la superficie',
  );
  assert.ok(
    ![...paths].some((p) => p.startsWith('docs/analysis/')),
    'las auditorias point-in-time no deben entrar en la superficie',
  );
  assert.ok(
    ![...paths].some((p) => p.startsWith('docs/generated/')),
    'la fuente de los hechos no puede auditarse a si misma',
  );
  // Un documento NUEVO (sin commitear) tiene que auditarse igual: si el gate
  // solo mirara `git ls-files`, un doc recien creado pasaria sin control
  // hasta el commit.
  assert.ok(
    paths.has('docs/reference/AI-ENGINEERING-CANON.md'),
    'el canon de ingenieria en IA debe entrar en la superficie',
  );
});

test('la documentacion real del repo esta al dia', () => {
  const facts = measureDocsFacts(ROOT);
  assert.ok(facts.skills.canonical > 0);
  assert.ok(facts.version !== '0.0.0');
  const files = collectDocFiles(ROOT);
  assert.ok(files.length > 50, `se esperaban mas de 50 documentos, hay ${files.length}`);
  const report = checkDocsFacts(files, facts, loadBaseline(ROOT));
  const detail = report.findings.map((f) => `${f.file}:${f.line}: ${f.message}`).join('\n');
  assert.equal(report.ok, true, `drift en las cifras de la documentacion:\n${detail}`);
  assert.ok(report.evaluated > 0, 'el gate deberia haber evaluado afirmaciones');
});
