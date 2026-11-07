/**
 * Test del reintento ante fallo ambiental del gate de apps.
 *
 * Contexto (2026-11-02): el worker de vitest de `apps/prompt-studio` murio
 * durante el `stack-audit-apps` del prepush ("Worker exited unexpectedly") y
 * bloqueo un push de documentacion. El archivo de test PASABA si se corria
 * solo: era el pool, no el codigo.
 *
 * La regla que este test fija:
 *   - un fallo con firma ambiental se reintenta UNA vez;
 *   - un fallo de asercion NO se reintenta (el fallo es real);
 *   - si el reintento tambien falla, el fallo es real.
 *
 * Corre con:  node --import tsx --test src/ops/stack-audit-apps.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runAppCheck } from './stack-audit-apps.js';

describe('stack-audit-apps: reintento ante fallo ambiental', () => {
  it('reintenta cuando la salida muestra la firma de worker muerto y el reintento pasa', () => {
    let calls = 0;
    const result = runAppCheck('prompt-studio', 'test', 'test', () => {
      calls += 1;
      if (calls === 1) {
        return {
          status: 1,
          output: '[vitest-pool]: Worker forks emitted error. Error: Worker exited unexpectedly',
        };
      }
      return { status: 0, output: 'Test Files 2 passed' };
    });

    assert.equal(result.status, 'PASS');
    assert.equal(calls, 2, 'deberia haber reintentado una vez');
    assert.match(result.message, /reintento/);
  });

  it('NO reintenta un fallo de asercion (el fallo es real)', () => {
    let calls = 0;
    const result = runAppCheck('prompt-studio', 'test', 'test', () => {
      calls += 1;
      return { status: 1, output: 'FAIL src/x.test.ts > deberia funcionar' };
    });

    assert.equal(result.status, 'FAIL');
    assert.equal(calls, 1, 'un fallo de asercion no se reintenta');
  });

  it('mantiene el FAIL cuando el reintento tambien falla', () => {
    let calls = 0;
    const result = runAppCheck('prompt-studio', 'test', 'test', () => {
      calls += 1;
      return { status: 1, output: 'ENOMEM: JavaScript heap out of memory' };
    });

    assert.equal(result.status, 'FAIL');
    assert.equal(calls, 2, 'un solo reintento, no un bucle');
  });
});

describe('stack-audit-apps: firmas ambientales de la noche 2026-11-07', () => {
  const casos: Array<[string, string]> = [
    ['server de test sin health bajo carga', 'Error: el server no quedó sano en 20000ms'],
    ['Playwright pisado por recarga del SW', 'Execution context was destroyed'],
    ['red del browser', 'net::ERR_CONNECTION_REFUSED'],
    ['timeout de node:test', 'test timed out after 30000ms'],
    ['timeout de vitest', 'Test timed out in 5000ms'],
  ];

  for (const [nombre, salida] of casos) {
    it(`reintenta y pasa: ${nombre}`, () => {
      let calls = 0;
      const result = runAppCheck('prompt-studio', 'test', 'test', () => {
        calls += 1;
        if (calls === 1) return { status: 1, output: salida };
        return { status: 0, output: 'ok' };
      });
      assert.equal(result.status, 'PASS');
      assert.equal(calls, 2, 'un solo reintento (contrato existente)');
    });
  }

  it('NEGATIVO: MODULE_NOT_FOUND NO es flake — rotura real de paquete debe gritar', () => {
    let calls = 0;
    const result = runAppCheck('prompt-studio', 'test', 'test', () => {
      calls += 1;
      return { status: 1, output: "Cannot find package 'better-sqlite3'" };
    });
    assert.equal(result.status, 'FAIL');
    assert.equal(calls, 1, 'no se reintenta: es rotura real');
  });
});
