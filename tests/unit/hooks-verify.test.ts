/**
 * hooks-verify.test.ts — una declaracion mandatory sin ejecutor es FAIL.
 *
 * H1 · mandatory:true sin runner falla (la promesa falsa que motivo el check).
 * H2 · status advisory/inert/superseded es OK aunque no haya runner.
 * H3 · hook activo sin runner ni status es WARN (drift silencioso).
 * H4 · hook habilitado cuyo script no existe es FAIL.
 * H5 · el repo real no tiene FAIL ni WARN (las declaraciones son honestas).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import { evaluateHook, evaluateHooks, scriptPathOf } from '../../src/tools/hooks-verify.ts';

const ROOT = resolve(import.meta.dirname, '..', '..');
const exists = () => true;

test('H1 · mandatory:true sin runner es FAIL', () => {
  const f = evaluateHook('cfg', 'pre_process', { enabled: true, mandatory: true }, exists);
  assert.equal(f.verdict, 'FAIL');
});

test('H2 · status advisory/inert/superseded es OK sin runner', () => {
  for (const status of ['advisory', 'inert', 'superseded']) {
    const f = evaluateHook('cfg', 'h', { mandatory: false, status, runner: null }, exists);
    assert.equal(f.verdict, 'OK', status);
  }
});

test('H3 · hook activo sin runner ni status es WARN', () => {
  const f = evaluateHook('cfg', 'h', { enabled: true }, exists);
  assert.equal(f.verdict, 'WARN');
});

test('H4 · script declarado que no existe es FAIL', () => {
  const f = evaluateHook(
    'cfg',
    'h',
    { enabled: true, runner: 'lefthook', script: 'node --import tsx src/no-existe.ts' },
    (path) => path !== 'src/no-existe.ts',
  );
  assert.equal(f.verdict, 'FAIL');
});

test('scriptPathOf extrae el path del comando', () => {
  assert.equal(
    scriptPathOf('node --import tsx src/tools/pre-process-input.ts --input x'),
    'src/tools/pre-process-input.ts',
  );
  assert.equal(scriptPathOf(undefined), null);
});

test('H5 · el repo real declara hooks de forma honesta', () => {
  const findings = evaluateHooks(ROOT);
  assert.ok(findings.length >= 5, `${findings.length} declaraciones revisadas`);
  assert.deepEqual(
    findings.filter((f) => f.verdict !== 'OK'),
    [],
    'sin FAIL ni WARN en las declaraciones del repo',
  );
});
