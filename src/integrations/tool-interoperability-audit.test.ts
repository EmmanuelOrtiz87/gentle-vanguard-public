/**
 * tool-interoperability-audit.test.ts — Los perfiles declarados no son promesas mudas (F10).
 *
 * El audit 2026-11-17 encontro 4 perfiles (`claude-code`, `cline`, `cursor`, `windsurf`)
 * existentes y sin mencion: ni auditados ni declarados. La declaracion tiene que reflejar
 * presencia real, para que un perfil borrado no siga apareciendo como si existiera.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  REFERENCE_PROFILES,
  compareSkillTrees,
  referenceProfileReports,
} from './tool-interoperability-audit.js';

test('cada perfil de referencia declara la herramienta, el archivo y la razon', () => {
  assert.equal(REFERENCE_PROFILES.length, 4);
  assert.deepEqual(
    REFERENCE_PROFILES.map((profile) => profile.tool),
    ['Claude Code', 'Cline', 'Cursor', 'Windsurf'],
  );
  for (const profile of REFERENCE_PROFILES) {
    assert.ok(profile.reason.length > 20, `${profile.tool} sin razon accionable`);
    assert.ok(profile.surfacePaths.length > 0, `${profile.tool} sin superficie declarada`);
  }
});

test('el reporte marca presencia de perfil y superficie segun el filesystem', () => {
  const root = mkdtempSync(join(tmpdir(), 'tool-profiles-'));
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(join(root, 'config', 'tool-cline.json'), '{}');
  writeFileSync(join(root, '.clinerules'), 'reglas');

  const reports = referenceProfileReports(root);
  const cline = reports.find((report) => report.tool === 'Cline');
  assert.equal(cline?.profilePresent, true);
  assert.equal(cline?.surfacePresent, true);

  const windsurf = reports.find((report) => report.tool === 'Windsurf');
  assert.equal(windsurf?.profilePresent, false);
  assert.equal(windsurf?.surfacePresent, false);
});

test('compareSkillTrees degrada con gracia ante un archivo que desaparece (race con sync)', () => {
  const source = mkdtempSync(join(tmpdir(), 'skill-src-'));
  const target = mkdtempSync(join(tmpdir(), 'skill-tgt-'));
  mkdirSync(join(source, 'skills'), { recursive: true });
  mkdirSync(join(target, 'skills'), { recursive: true });
  writeFileSync(join(source, 'skills', 'a.md'), 'contenido');
  writeFileSync(join(target, 'skills', 'a.md'), 'contenido');
  assert.equal(compareSkillTrees(source, target).fresh, true);

  // El audit crasheaba con ENOENT cuando tool-interoperability-sync reescribía
  // un archivo en pleno hashing durante el autostart (observado 2026-11-18 23:02).
  // Hoy cualquier desalineación entre árboles se clasifica (missing/unexpected/
  // unreadable/changed), no tumba el step lazy.
  rmSync(join(source, 'skills', 'a.md'));
  const comparison = compareSkillTrees(source, target);
  assert.equal(comparison.fresh, false);
  assert.ok(
    comparison.differences.some((d) => d.startsWith('unexpected:')),
    'archivo solo en target → unexpected',
  );
  assert.ok(
    comparison.differences.every((d) => /^(missing|unexpected|unreadable|changed):/.test(d)),
    'sin crash, siempre clasificado',
  );
});
