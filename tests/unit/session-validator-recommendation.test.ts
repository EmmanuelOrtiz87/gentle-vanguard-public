#!/usr/bin/env node
/**
 * Unit Tests: session-validator decide por evidencia, no por ausencia de ella
 *
 * Contratest del defecto medido el 2026-11-14:
 *
 *   npm run session:validate
 *   { "hasActiveSession": true, "sessionAge": 0, "status": "active",
 *     "isSameAgent": false, "recommendation": "cleanup-first" }
 *
 * La sesion era la VIVA de ese mismo proceso. `isSameAgent` comparaba
 * `process.env.GENTLE_VANGUARD_SESSION_ID` contra el id del archivo, y esa env
 * var solo existe en el proceso que creo la sesion: en cualquier CLI aparte
 * (autostart detached, doctor, este test) esta siempre ausente. Resultado:
 * "propiedad desconocida" se colapsaba en "es otro agente" y el autostart
 * corria `removeStaleSessions` sobre la sesion activa.
 *
 * La regla que se fija aca: la ausencia de evidencia NO es evidencia de
 * conflicto. Borrar requiere prueba, no default.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { decideRecommendation } from '../../src/session/session-validator.ts';

const base = {
  hasActiveSession: true,
  ownership: 'unknown' as const,
  isNestedSession: false,
  sessionFileExists: true,
  status: 'active' as string | null,
};

test('sesion activa + propiedad desconocida => reuse (el bug: decia cleanup-first)', () => {
  assert.equal(decideRecommendation({ ...base, ownership: 'unknown' }), 'reuse');
});

test('sesion activa + propiedad probada de este proceso => reuse', () => {
  assert.equal(decideRecommendation({ ...base, ownership: 'proven-same' }), 'reuse');
});

test('sesion activa + propiedad probada de OTRO agente => cleanup-first', () => {
  assert.equal(decideRecommendation({ ...base, ownership: 'proven-different' }), 'cleanup-first');
});

test('archivo active fuera de la ventana (no activo) => cleanup-first', () => {
  assert.equal(
    decideRecommendation({ ...base, hasActiveSession: false, ownership: 'unknown' }),
    'cleanup-first',
  );
});

test('archivo ya cerrado => proceed, sin cleanup', () => {
  assert.equal(
    decideRecommendation({
      ...base,
      hasActiveSession: false,
      sessionFileExists: true,
      status: 'closed',
    }),
    'proceed',
  );
});

test('sesion anidada => reuse', () => {
  assert.equal(
    decideRecommendation({
      ...base,
      hasActiveSession: false,
      isNestedSession: true,
    }),
    'reuse',
  );
});

test('sin archivo de sesion => proceed', () => {
  assert.equal(
    decideRecommendation({
      ...base,
      hasActiveSession: false,
      sessionFileExists: false,
      status: null,
    }),
    'proceed',
  );
});
