/**
 * script-policy-gate.test.ts — El inventario declarado tiene que morder.
 *
 * F14: un .ps1 nuevo fuera de la superficie sancionada no puede pasar en silencio.
 * F15: si el guardrail de destruccion pierde su script, step, destino o referencia
 * normativa, el gate lo reporta.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkDestructionGuardWiring,
  checkPs1Inventory,
  PS1_EXCEPTIONS,
  type DestructionGuardInput,
} from './script-policy-gate.js';

const WIRED: DestructionGuardInput = {
  packageScripts: { 'guard:snapshot': 'node --import tsx src/ops/untracked-snapshot.ts' },
  autostartSteps: [
    { id: 'untracked-snapshot', script: 'src/ops/untracked-snapshot.ts', enabled: true },
  ],
  snapshotSource: 'escribe a .session/snapshots/untracked/ con patch por archivo',
  normText: 'prohibido autonomo: siempre EXPLAIN-required + guard:snapshot',
};

test('un .ps1 bajo una excepcion declarada no es violacion', () => {
  const report = checkPs1Inventory(['apps/wpp-bot/scripts/install.ps1'], PS1_EXCEPTIONS);
  assert.equal(report.tracked, 1);
  assert.deepEqual(report.violations, []);
  assert.equal(report.exceptions[0]?.prefix, 'apps/wpp-bot/scripts/');
});

test('un .ps1 nuevo fuera de la lista falla y no se pierde por separadores Windows', () => {
  const report = checkPs1Inventory(['scripts\\nuevo.ps1', '.archive\\old.ps1'], PS1_EXCEPTIONS);
  assert.deepEqual(report.violations, ['scripts/nuevo.ps1']);
  assert.equal(report.exceptions.length, 1);
});

test('el inventario vacio es valido (nada que declarar)', () => {
  const report = checkPs1Inventory([], PS1_EXCEPTIONS);
  assert.equal(report.tracked, 0);
  assert.deepEqual(report.violations, []);
  assert.deepEqual(report.exceptions, []);
});

test('el guardrail conectado no reporta problemas', () => {
  assert.deepEqual(checkDestructionGuardWiring(WIRED), []);
});

test('sin step de autostart o deshabilitado, el guardrail falla', () => {
  const missing = checkDestructionGuardWiring({ ...WIRED, autostartSteps: [] });
  assert.equal(missing.length, 1);
  assert.match(missing[0] ?? '', /no hay step/);

  const disabled = checkDestructionGuardWiring({
    ...WIRED,
    autostartSteps: [
      { id: 'untracked-snapshot', script: 'src/ops/untracked-snapshot.ts', enabled: false },
    ],
  });
  assert.equal(disabled.length, 1);
  assert.match(disabled[0] ?? '', /deshabilitado/);
});

test('script npm, destino y normativa tambien se verifican', () => {
  const broken = checkDestructionGuardWiring({
    ...WIRED,
    packageScripts: {},
    snapshotSource: 'escribe a otro lado',
    normText: 'sin referencia',
  });
  assert.equal(broken.length, 3);
  assert.ok(broken.some((problem) => problem.includes('guard:snapshot')));
  assert.ok(broken.some((problem) => problem.includes('.session/snapshots/untracked')));
  assert.ok(broken.some((problem) => problem.includes('NORMATIVAS-AUTONOMOUS-EVOLUTION')));
});
