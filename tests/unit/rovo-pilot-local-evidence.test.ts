/**
 * rovo-pilot-local-evidence.test.ts — el acta del piloto no puede afirmar lo
 * que no se midió.
 *
 * POR QUÉ EXISTE (2026-11-11)
 * -------------------------------------------------------------------------
 * El owner no tiene permisos de admin de la plataforma Atlassian: no puede
 * exportar el transcript, los créditos Rovo ni la latencia del agente. La
 * decisión fue NO dejar que eso bloquee el cierre del hito, pero tampoco dejar
 * que el acta afirme números que nadie midió.
 *
 * Estos tests son el contrato de honestidad documental:
 *
 *   P1 · Los golden cases del contrato pasan (7/7): la calidad local medida.
 *   P2 · La dependencia externa (transcript/créditos/latencia de la plataforma)
 *        está DECLARADA en el acta, con el motivo.
 *   P3 · El acta NO afirma veredictos "PASA" en las cinco consultas de
 *        aceptación: no hay transcript archivado que los sostenga.
 *   P4 · El consumo por participante no trae cifras inventadas.
 *
 * Control declarado en `config/declarations.json`: rovo:pilot-local-evidence
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { evaluateGoldenCases } from '../../apps/alexandria/server/evaluation.ts';

const ROOT = resolve(import.meta.dirname, '..', '..');
const ACTA = join(ROOT, 'docs', 'atlassian', 'rovo-alexandria', '11-piloto-2026-11-10.md');

function acta(): string {
  return readFileSync(ACTA, 'utf8');
}

test('P1 · los golden cases del contrato pasan (calidad local medida)', () => {
  const cases = evaluateGoldenCases();
  const passed = cases.filter((c) => c.passed).length;
  assert.equal(cases.length, 7, 'el corpus tiene 7 casos');
  assert.equal(passed, 7, `pasan ${passed} de ${cases.length}`);
});

test('P2 · la dependencia externa de la plataforma está declarada', () => {
  const text = acta();
  assert.match(text, /Dependencia externa declarada/, 'la sección de dependencia existe');
  assert.match(text, /admin/i, 'el motivo (permisos de admin) está escrito');
  assert.match(text, /Transcript del piloto Rovo/, 'el transcript queda nombrado');
  assert.match(text, /Créditos Rovo/, 'los créditos quedan nombrados');
  assert.match(text, /Latencia de invocación/, 'la latencia queda nombrada');
});

test('P3 · el acta no afirma veredictos que no se midieron', () => {
  const text = acta();
  // La celda del numero puede venir con padding de tabla markdown (prettier
  // alinea las columnas): "| 1 |" o "| 1   |". La regex exige solo el NUMERO
  // de la primera celda, no el ancho de la columna.
  const acceptanceRows = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\|\s*[1-5]\s*\|/.test(line));
  assert.equal(acceptanceRows.length, 5, 'las cinco consultas están listadas');
  for (const row of acceptanceRows) {
    assert.ok(!/PASA/.test(row), `la fila no puede afirmar PASA: ${row}`);
    assert.match(row, /sin transcript|_pendiente_/, `la fila declara por qué está vacía: ${row}`);
  }
});

test('P4 · el consumo por participante no trae cifras inventadas', () => {
  const text = acta();
  const consumption = text.split('## 4. Consumo por participante')[1]?.split('## 5.')[0] ?? '';
  assert.ok(consumption.length > 0, 'la sección existe');
  assert.match(consumption, /no medido \(admin\)/, 'los tres datos no medidos están marcados');
  assert.match(consumption, /25 consultas/, 'lo único contado es lo que el owner confirmó');
});
