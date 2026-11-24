/**
 * Contrato de la señal honesta del gate de calidad universal
 * (meta-auditoría 2026-11-20, backlog #6 — "presencia ≠ operación").
 *
 * Un check que sólo puede afirmar que un archivo EXISTE no es un PASS: no hay
 * evidencia de que la cosa funcione. Estos tests muerden: si vuelve a
 * certificar presencia como salud, fallan.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { unverifiedDeclaration } from './universal-quality-gate.js';
import { unverifiedNoticeFromReport } from '../git/prepush-gate.js';

test('un check verificado solo por presencia NO se cuenta como pass', () => {
  const report = {
    summary: { total: 3, passed: 1, warned: 0, failed: 0, unverified: 2 },
    results: [
      { id: 'a', status: 'pass' as const, detail: 'verificado' },
      { id: 'b', status: 'unverified' as const, detail: 'presencia' },
      { id: 'c', status: 'unverified' as const, detail: 'presencia' },
    ],
  };
  const passed = report.results.filter((r) => r.status === 'pass').length;
  assert.equal(passed, 1, 'los unverified no son pass');
  assert.equal(report.summary.unverified, 2);
});

test('la declaración nombra cuántos checks son solo-presencia', () => {
  const line = unverifiedDeclaration(2);
  assert.match(line, /2 check\(s\)/);
  assert.match(line, /PRESENCIA/);
  assert.match(line, /no es un "todo verificado"/);
});

test('sin checks sin verificar no hay aviso (no se inventa ruido)', () => {
  assert.equal(unverifiedDeclaration(0), 'todos los checks con evidencia de operación');
  assert.equal(unverifiedNoticeFromReport({ summary: { unverified: 0 } }), null);
  assert.equal(unverifiedNoticeFromReport(null), null);
});

test('el aviso del push declara los checks verificados solo por presencia', () => {
  const notice = unverifiedNoticeFromReport({ summary: { unverified: 3 } });
  assert.ok(notice, 'debe haber aviso');
  assert.match(notice, /3 check\(s\)/);
  assert.match(notice, /PRESENCIA/);
});
