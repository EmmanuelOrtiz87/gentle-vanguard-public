#!/usr/bin/env node
/**
 * Unit Tests: appFixCommand — el hint apunta al check que fallo
 *
 * Defecto medido el 2026-11-14 en `stack:verify`:
 *
 *   ✘ app:command-center: test:native: Failed Tests 1 ...
 *      → cd apps/command-center && npm run typecheck
 *
 * Dos mentiras en una linea: (1) el fallo era un TEST y el hint mandaba al
 * typecheck; (2) `command-center` no tiene `package.json`, asi que ese comando
 * ni existe (ENOENT). Un hint que no reproduce el fallo manda a mirar el lugar
 * equivocado y quema el turno.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { appFixCommand } from '../../src/ops/stack-verify.ts';

test('fallo de test => sugiere el test, no el typecheck', () => {
  const cmd = appFixCommand('some-app', ['test'], true);
  assert.equal(cmd, 'cd apps/some-app && npm test');
});

test('varios checks rojos => reproduce todos, sin repetir', () => {
  const cmd = appFixCommand('some-app', ['test', 'typecheck', 'test'], true);
  assert.equal(cmd, 'cd apps/some-app && npm test && npm run typecheck');
});

test('sin package.json => apunta al contrato, no a un script inexistente', () => {
  const cmd = appFixCommand('command-center', ['test'], false);
  assert.ok(cmd?.includes('app-validation-contracts.json'), `hint sin contrato: ${cmd}`);
  assert.ok(cmd?.includes('nativeTestSuites'), `hint sin la seccion del contrato: ${cmd}`);
  assert.ok(!cmd?.includes('npm run typecheck'), `hint con un script que no existe: ${cmd}`);
});

test('sin checks fallidos => sin hint', () => {
  assert.equal(appFixCommand('some-app', [], true), undefined);
});

test('kind desconocido => no inventa un comando', () => {
  assert.equal(appFixCommand('some-app', ['e2e'], true), undefined);
});
