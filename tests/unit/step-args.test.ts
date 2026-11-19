/**
 * `parseStepArgs` alimenta `spawn` sin shell. El config pasa JSON inline con
 * comillas simples (`--json-string '{"test":"ok"}'`) y el tokenizer viejo no
 * reconocía single quotes: el validador recibía un JSON inválido y la
 * verificación "OK" era falsa.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStepArgs } from '../../src/core/step-args.js';

test('args vacíos o solo espacios → []', () => {
  assert.deepEqual(parseStepArgs(undefined), []);
  assert.deepEqual(parseStepArgs('   '), []);
});

test('tokens simples se separan por whitespace', () => {
  assert.deepEqual(parseStepArgs('--build --quiet'), ['--build', '--quiet']);
});

test('JSON inline con comillas simples llega intacto', () => {
  assert.deepEqual(parseStepArgs(`--json-string '{"test":"ok"}' --context startup-verify`), [
    '--json-string',
    '{"test":"ok"}',
    '--context',
    'startup-verify',
  ]);
});

test('JSON inline con comillas dobles llega intacto', () => {
  assert.deepEqual(parseStepArgs('--json-string "{\\"test\\":\\"ok\\"}"'), [
    '--json-string',
    '{"test":"ok"}',
  ]);
});

test('quotes vacíos producen token vacío (no se descarta la posición)', () => {
  assert.deepEqual(parseStepArgs(`a '' b`), ['a', '', 'b']);
});
