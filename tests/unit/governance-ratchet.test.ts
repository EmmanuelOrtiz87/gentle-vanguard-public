/**
 * Ratchet de gobernanza de skills: la deuda heredada (colisiones de triggers,
 * skills sin triggers, refs rotas, nombres duplicados) no crece. Editar 52
 * triggers en 254 skills es trabajo de contenido del owner; el stack puede
 * garantizar que no empeore.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareGovernance, type GovernanceBaseline } from '../../src/skills/governance-ratchet.js';

const base: GovernanceBaseline = {
  capturedAt: '2026-11-18T00:00:00.000Z',
  skills: 254,
  duplicateNames: 0,
  actionableTriggerCollisions: 52,
  brokenReferences: 0,
  skillsWithoutTriggers: 130,
};

test('sin baseline no hay veredicto (ni regresión ni mejora)', () => {
  assert.deepEqual(compareGovernance(base, null), { regressions: [], improvements: [] });
});

test('deuda igual al baseline pasa', () => {
  const r = compareGovernance({ ...base }, base);
  assert.deepEqual(r.regressions, []);
  assert.deepEqual(r.improvements, []);
});

test('deuda mayor es regresión nombrada por métrica', () => {
  const r = compareGovernance({ ...base, actionableTriggerCollisions: 53 }, base);
  assert.deepEqual(r.regressions, ['actionableTriggerCollisions: 52 -> 53']);
});

test('deuda menor se reporta como mejora, no como falla', () => {
  const r = compareGovernance({ ...base, skillsWithoutTriggers: 129 }, base);
  assert.deepEqual(r.regressions, []);
  assert.deepEqual(r.improvements, ['skillsWithoutTriggers: 130 -> 129']);
});

test('métricas ausentes en el baseline viejo se ignoran', () => {
  const old = { capturedAt: 'x', skills: 1 } as unknown as GovernanceBaseline;
  const r = compareGovernance(base, old);
  assert.deepEqual(r.regressions, []);
});
