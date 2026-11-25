/**
 * Cache de la sonda editorial: el reporte dentro de la ventana de 24 h no debe
 * pisar el veredicto guardado. Bug 2026-11-24: cada run guardaba `state: 'recent'`
 * y el original se perdia, asi que el step fallaba en cada arranque.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cachedVerdict, PROBE_MAX_AGE_MS } from '../../src/agents/editorial-probe-cache.js';

const NOW = Date.parse('2026-11-24T12:00:00.000Z');

test('veredicto fresh operable/broken se reutiliza con su antiguedad', () => {
  assert.deepEqual(cachedVerdict({ at: '2026-11-24T06:00:00.000Z', state: 'operable' }, NOW), {
    state: 'operable',
    hoursAgo: 6,
  });
  assert.deepEqual(cachedVerdict({ at: '2026-11-24T11:45:00.000Z', state: 'broken' }, NOW), {
    state: 'broken',
    hoursAgo: 0.3,
  });
});

test('un registro auto-pisado (state recent) obliga a re-probar: se auto-cura', () => {
  assert.equal(cachedVerdict({ at: '2026-11-24T11:00:00.000Z', state: 'recent' }, NOW), null);
});

test('registro vencido (>24 h) obliga a re-probar', () => {
  const old = new Date(NOW - PROBE_MAX_AGE_MS - 1).toISOString();
  assert.equal(cachedVerdict({ at: old, state: 'operable' }, NOW), null);
  const edge = new Date(NOW - PROBE_MAX_AGE_MS + 60_000).toISOString();
  assert.equal(cachedVerdict({ at: edge, state: 'operable' }, NOW)?.state, 'operable');
});

test('registro ilegible o sin shape no rompe: se re-prueba', () => {
  assert.equal(cachedVerdict(null, NOW), null);
  assert.equal(cachedVerdict('garbage', NOW), null);
  assert.equal(cachedVerdict({ state: 'operable' }, NOW), null);
  assert.equal(cachedVerdict({ at: 'not-a-date', state: 'operable' }, NOW), null);
});
