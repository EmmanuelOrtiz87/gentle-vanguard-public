/**
 * Contratest del plan firmado del bootstrap (GB-2026-11-21 slice C, sub-item d
 * de BL-MW2P55O1): --dry-run serializa plan+hash, --accept-plan niega ejecutar
 * un plan que ya no describe la realidad.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, verifyPlan, sha256Of } from '../../src/infrastructure/installer-bootstrap.js';

test('buildPlan emite hash consistente con su propio cuerpo', () => {
  const plan = buildPlan('C:/tmp/fake-root', false);
  assert.equal(plan.id, 'bootstrap-plan-v1');
  assert.ok(plan.hash);
  const body = { ...plan, hash: undefined } as Omit<typeof plan, 'hash'>;
  assert.equal(sha256Of(body), plan.hash);
  // fases base sin --full
  assert.ok(plan.phases.some((p) => p.id === 'install-deps'));
  assert.ok(plan.phases.some((p) => p.id === 'doctor'));
  assert.ok(plan.phases.some((p) => p.id === 'nexus-init'));
  assert.ok(!plan.phases.some((p) => p.id === 'install-missing-prereqs'));
});

test('full mode incluye prereqs y health', () => {
  const plan = buildPlan('C:/tmp/fake-root', true);
  assert.ok(plan.phases.some((p) => p.id === 'install-missing-prereqs'));
  assert.ok(plan.phases.some((p) => p.id === 'health'));
});

test('verifyPlan acepta el plan exactamente como se emitió', () => {
  const plan = buildPlan('C:/tmp/fake-root', false);
  assert.equal(verifyPlan(plan, plan), null);
});

test('verifyPlan niega un plan alterado después de emitirse', () => {
  const plan = buildPlan('C:/tmp/fake-root', false);
  const tampered = { ...plan, phases: [{ id: 'evil', command: 'rm -rf /', label: 'x' }] };
  const refusal = verifyPlan(tampered, plan);
  assert.ok(refusal?.includes('alterado'));
});

test('verifyPlan niega cuando el repo ya no coincide con el plan revisado', () => {
  const reviewed = buildPlan('C:/tmp/fake-root', false); // plan revisado sin --full
  const current = buildPlan('C:/tmp/fake-root', true); // la realidad ahora es --full
  const refusal = verifyPlan(reviewed, current);
  assert.ok(refusal?.includes('cambió'));
});
