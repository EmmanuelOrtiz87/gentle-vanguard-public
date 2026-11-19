/**
 * BL-2026-11-18 — el juez semantico local de Engram.
 *
 * Casos que fijan:
 *   1. Un veredicto invalido NO cierra la relacion: el par sigue pending.
 *      (Un cierre inventado es peor que una deuda declarada.)
 *   2. La confianza se acota a [0,1] y el motivo se recorta.
 *   3. El prompt del juez lleva las DOS observaciones con su tipo y su titulo.
 *   4. El recorte de contenido no pierde el tamaño real (para que el juez y el
 *      recibo sepan que hubo truncamiento).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildPrompt, parseVerdict, trimContent } from '../../src/ops/engram-judge-semantic.ts';

describe('juez semantico de Engram', () => {
  it('parsea un veredicto valido', () => {
    const verdict = parseVerdict('{"relation":"related","confidence":0.8,"reason":"mismo tema"}');
    assert.ok(verdict);
    assert.equal(verdict?.relation, 'related');
    assert.equal(verdict?.confidence, 0.8);
    assert.equal(verdict?.reason, 'mismo tema');
  });

  it('acepta JSON envuelto en un bloque de codigo', () => {
    const verdict = parseVerdict(
      '```json\n{"relation":"compatible","confidence":0.9,"reason":"r"}\n```',
    );
    assert.equal(verdict?.relation, 'compatible');
  });

  it('rechaza una relacion fuera del catálogo', () => {
    assert.equal(parseVerdict('{"relation":"inventada","confidence":0.9,"reason":"r"}'), null);
  });

  it('rechaza una salida sin relacion, sin confianza o sin motivo', () => {
    assert.equal(parseVerdict('{"confidence":0.9,"reason":"r"}'), null);
    assert.equal(parseVerdict('{"relation":"related","reason":"r"}'), null);
    assert.equal(parseVerdict('{"relation":"related","confidence":0.9}'), null);
    assert.equal(parseVerdict('no soy json'), null);
    assert.equal(parseVerdict(''), null);
  });

  it('acota la confianza a [0,1]', () => {
    assert.equal(parseVerdict('{"relation":"related","confidence":5,"reason":"r"}')?.confidence, 1);
    assert.equal(
      parseVerdict('{"relation":"related","confidence":-2,"reason":"r"}')?.confidence,
      0,
    );
  });

  it('recorta el motivo a 200 caracteres', () => {
    const long = 'x'.repeat(400);
    const verdict = parseVerdict(`{"relation":"related","confidence":0.9,"reason":"${long}"}`);
    assert.equal(verdict?.reason.length, 200);
  });

  it('el recorte de contenido declara cuanto se perdio', () => {
    const text = 'a'.repeat(1200);
    const trimmed = trimContent(text, 900);
    assert.ok(trimmed.length < 1200);
    assert.match(trimmed, /truncado: 300 caracteres/);
  });

  it('el prompt lleva las dos observaciones con tipo y titulo', () => {
    const prompt = buildPrompt({
      source_id: 'obs-a',
      target_id: 'obs-b',
      title_a: 'Titulo A',
      title_b: 'Titulo B',
      content_a: 'contenido A',
      content_b: 'contenido B',
      type_a: 'decision',
      type_b: 'bugfix',
    });
    assert.match(prompt, /\[decision\] Titulo A/);
    assert.match(prompt, /\[bugfix\] Titulo B/);
    assert.match(prompt, /contenido A/);
    assert.match(prompt, /contenido B/);
    assert.match(prompt, /not_conflict/);
    assert.match(prompt, /conflicts_with/);
  });
});
