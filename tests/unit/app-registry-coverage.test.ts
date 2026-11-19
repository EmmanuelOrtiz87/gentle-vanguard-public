/**
 * app-registry-coverage.test.ts — el registro único es completo, no solo válido.
 *
 * POR QUÉ EXISTE (2026-11-18)
 * -------------------------------------------------------------------------
 * `validateAppRegistry` certifica que lo DECLARADO es consistente, pero no
 * ve lo que NO está declarado: `apps/` tenía 31 directorios y el registro 28.
 * Una app nueva entraba al repo y quedaba invisible para el CC, el Sandbox,
 * el health y los pidfiles. Este test es el contrato de la cobertura y de las
 * exclusiones con motivo.
 *
 *   C1 · El repo real tiene cobertura completa (ni dirs sin clasificar ni
 *        declarados inexistentes).
 *   C2 · Un dir sin registrar ni excluir se reporta como uncovered.
 *   C3 · Un dir registrado Y excluido se reporta como overlap.
 *   C4 · Una exclusión de un dir registrado se reporta como stale.
 *   C5 · Un dir declarado que no existe se reporta como missing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { checkCoverage } from '../../src/ops/app-registry-coverage.ts';

const ROOT = resolve(import.meta.dirname, '..', '..');

function fixture(appDirs: string[], registered: string[], excluded: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'apps-coverage-'));
  mkdirSync(join(root, 'config'), { recursive: true });
  for (const dir of appDirs) mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(
    join(root, 'config', 'apps.registry.json'),
    JSON.stringify({ version: 1, apps: registered.map((dir) => ({ id: dir, dir })) }),
  );
  writeFileSync(
    join(root, 'config', 'apps.registry-exclusions.json'),
    JSON.stringify({
      version: 1,
      excluded: excluded.map((dir) => ({ dir, kind: 'test', reason: 'fixture' })),
    }),
  );
  return root;
}

test('C1 · el repo real tiene cobertura completa del registro de apps', () => {
  const report = checkCoverage(ROOT);
  assert.deepEqual(report.uncovered, [], 'ningún dir de apps/ queda sin clasificar');
  assert.deepEqual(report.missingDirs, [], 'toda app declarada existe');
  assert.deepEqual(report.overlaps, [], 'ningún dir está registrado y excluido a la vez');
  assert.ok(report.registered >= 20, `${report.registered} apps registradas`);
});

test('C2 · dir sin registrar ni excluir se reporta como uncovered', () => {
  const root = fixture(['apps/a', 'apps/nueva'], ['apps/a'], []);
  try {
    const report = checkCoverage(root);
    assert.deepEqual(report.uncovered, ['apps/nueva']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('C3 · dir registrado y excluido a la vez se reporta como overlap', () => {
  const root = fixture(['apps/a'], ['apps/a'], ['apps/a']);
  try {
    const report = checkCoverage(root);
    assert.deepEqual(report.overlaps, ['apps/a']);
    assert.deepEqual(report.uncovered, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('C4 · exclusión de un dir ya registrado se reporta como stale', () => {
  const root = fixture(['apps/a'], ['apps/a'], ['apps/a']);
  try {
    assert.deepEqual(checkCoverage(root).staleExclusions, ['apps/a']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('C5 · dir declarado que no existe se reporta como missing', () => {
  const root = fixture(['apps/a'], ['apps/borrada'], []);
  try {
    const report = checkCoverage(root);
    assert.deepEqual(report.missingDirs, ['apps/borrada']);
    assert.deepEqual(report.uncovered, ['apps/a']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
