/**
 * CONTRATO del probe de capacidad local (BL-MVJKNHPA-WT62).
 *
 * La distincion que protege: "el endpoint contesta" NO es "el modelo trabaja".
 * Y ademas: un modelo con una debilidad conocida (2/3) es operable, no roto —
 * declararlo FAIL convertiria el gate en ruido.
 *
 * Ejecutar: node --import tsx --test src/tools/local-capability-probe.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonObject, validateAnswer } from './local-capability-probe.js';

describe('extractJsonObject', () => {
  it('lee JSON puro', () => {
    assert.deepEqual(extractJsonObject('{"sum":42}'), { sum: 42 });
  });

  it('lee JSON dentro de un bloque markdown', () => {
    const text = 'Claro:\n```json\n{"sum":42,"count":8}\n```\nListo.';
    assert.deepEqual(extractJsonObject(text), { sum: 42, count: 8 });
  });

  it('tolera prosa alrededor del objeto', () => {
    assert.deepEqual(extractJsonObject('La respuesta es {"sum":42} espero que sirva'), {
      sum: 42,
    });
  });

  it('devuelve null si no hay objeto parseable', () => {
    assert.equal(extractJsonObject('sin json aca'), null);
    assert.equal(extractJsonObject('{roto'), null);
    assert.equal(extractJsonObject('[1,2,3]'), null, 'un array no es el objeto pedido');
  });
});

describe('validateAnswer', () => {
  it('acepta la respuesta correcta completa', () => {
    const checks = validateAnswer({ sum: 42, reversed: 'draugnav', count: 8 });
    assert.equal(
      checks.every((c) => c.ok),
      true,
    );
  });

  it('acepta el veredicto 2/3 cuando la debilidad es la inversion exacta', () => {
    // Caso REAL medido con qwen2.5-coder:14b: acierta aritmetica y conteo,
    // falla la inversion de caracteres (tokenizacion).
    const checks = validateAnswer({ sum: 42, reversed: 'dragnuav', count: 8 });
    const passed = checks.filter((c) => c.ok).length;
    assert.equal(passed, 2);
    assert.equal(checks.find((c) => !c.ok)?.name, 'texto invertido');
  });

  it('marca como fallo los tipos equivocados', () => {
    const checks = validateAnswer({ sum: '42', reversed: 123, count: 'ocho' });
    assert.equal(
      checks.every((c) => !c.ok),
      true,
      '"42" texto no es el numero 42',
    );
  });

  it('una respuesta vacia no aprueba nada', () => {
    const checks = validateAnswer(null);
    assert.equal(
      checks.every((c) => !c.ok),
      true,
    );
  });
});
