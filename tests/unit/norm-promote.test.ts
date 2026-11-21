#!/usr/bin/env node
/**
 * Unit Tests: norm-promote — promoción clase-B con evidencia obligatoria.
 *
 * Contratest del veredicto del benchmark honesto (2026-11-20): "la promoción
 * clase-B está descrita pero no codificada". Invariantes fijados:
 *   - sin artefacto EXISTENTE no hay promoción (el gate anti-papel);
 *   - promover es idempotente;
 *   - el historial registra el aterrizaje (landedAs/landedAt/occ/conf);
 *   - el registro real del repo no drift-ea: cada landedAs apunta a un
 *     archivo que sigue existiendo.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promoteNorm } from '../../src/tools/norm-promote.ts';
import type { PromotedDoc } from '../../src/tools/norm-promote.ts';

const ROOT = resolve(import.meta.dirname, '..', '..');

const norms = [
  { id: 'inbox:patron recurrente', status: 'proposed', occurrences: 3, confidence: 62 },
  { id: 'inbox:ya activa', status: 'active', occurrences: 9, confidence: 85 },
];
const emptyDoc: PromotedDoc = { promoted: [] };

test('promoción con artefacto existente registra id + historial', () => {
  const doc: PromotedDoc = { promoted: [] };
  const { verdict, promoted } = promoteNorm(
    norms,
    doc,
    'inbox:patron recurrente',
    'rules/adaptive/ENGINEERING-NORMS.md#ENG-017',
    existsSync,
    '2026-11-21',
  );
  assert.equal(verdict.ok, true);
  assert.equal(verdict.outcome, 'promoted');
  assert.deepEqual(promoted.promoted, ['inbox:patron recurrente']);
  assert.equal(promoted.history?.length, 1);
  const h = promoted.history![0];
  assert.equal(h.landedAs, 'rules/adaptive/ENGINEERING-NORMS.md#ENG-017');
  assert.equal(h.landedAt, '2026-11-21');
  assert.equal(h.occurrencesAtPromotion, 3);
  assert.equal(h.confidenceAtPromotion, 62);
});

test('SIN artefacto (o artefacto inexistente) la promoción se NIEGA — el gate anti-papel', () => {
  for (const artifact of ['', 'skills/no-existe/SKILL.md']) {
    const doc: PromotedDoc = { promoted: [] };
    const { verdict, promoted } = promoteNorm(
      norms,
      doc,
      'inbox:patron recurrente',
      artifact,
      existsSync,
    );
    assert.equal(verdict.ok, false);
    assert.equal(verdict.outcome, 'refused');
    assert.match(verdict.reason, /existe|aterriza/i);
    assert.deepEqual(promoted.promoted, [], 'el registro no debe mutarse al negar');
  }
});

test('idempotente: ya promovida o ya active → ok sin duplicar', () => {
  const doc: PromotedDoc = { promoted: ['inbox:patron recurrente'] };
  const r1 = promoteNorm(
    norms,
    doc,
    'inbox:patron recurrente',
    'rules/adaptive/ENGINEERING-NORMS.md',
    existsSync,
  );
  assert.equal(r1.verdict.outcome, 'already');
  assert.deepEqual(r1.promoted.promoted, ['inbox:patron recurrente']);

  const r2 = promoteNorm(
    norms,
    { promoted: [] },
    'inbox:ya activa',
    'rules/adaptive/ENGINEERING-NORMS.md',
    existsSync,
  );
  assert.equal(r2.verdict.outcome, 'already');
});

test('norma desconocida se niega con nombre explícito', () => {
  const { verdict } = promoteNorm(
    norms,
    { promoted: [] },
    'inbox:fantasma',
    'README.md',
    existsSync,
  );
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /no existe/);
});

test('CONTRATO repo: cada landedAs del registro real apunta a un archivo vivo', () => {
  const doc = JSON.parse(
    readFileSync(resolve(ROOT, 'rules', 'adaptive', 'PROMOTED-NORMS.json'), 'utf-8'),
  ) as PromotedDoc;
  const muertos = (doc.history ?? [])
    .map((h) => ({ id: h.id, path: (h.landedAs ?? '').split('#')[0] ?? '' }))
    .filter((e) => e.path && !existsSync(resolve(ROOT, e.path)));
  assert.deepEqual(
    muertos,
    [],
    `normas promovidas cuyo artefacto desapareció (drift del registro): ${muertos.map((m) => `${m.id} → ${m.path}`).join(', ')}`,
  );
});
