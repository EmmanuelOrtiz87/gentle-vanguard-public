/**
 * TEST NEGATIVO de la decisión de liveness del dashboard.
 *
 * El incidente (2026-11-02): el dashboard WS llevaba días con el puerto 8080
 * abierto y la API HTTP muerta, y NADIE lo reiniciaba porque las tres capas
 * de supervision confundian "puerto abierto" con "servicio sirviendo".
 *
 * Este test no verifica que el codigo corra: verifica que la decisión sea la
 * correcta en los cuatro casos, incluido el que antes fallaba (wedged).
 *
 * Corre con:  node --import tsx --test src/core/watchtower/dashboard-liveness.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  classifyLiveness,
  decideRecovery,
  DEFAULT_FAILURE_THRESHOLD,
} from './dashboard-liveness.js';

describe('dashboard-liveness', () => {
  it('sano cuando la API responde', () => {
    assert.equal(classifyLiveness({ httpOk: true, portOpen: true }), 'healthy');
    assert.equal(classifyLiveness({ httpOk: true, portOpen: false }), 'healthy');
    const decision = decideRecovery({ httpOk: true, portOpen: true, consecutiveFailures: 0 });
    assert.equal(decision.action, 'none');
  });

  it('DETECTA el daemon wedged: puerto abierto + API muerta', () => {
    assert.equal(classifyLiveness({ httpOk: false, portOpen: true }), 'wedged');
  });

  it('DETECTA el daemon caido: puerto cerrado + API muerta', () => {
    assert.equal(classifyLiveness({ httpOk: false, portOpen: false }), 'down');
  });

  it('un fallo aislado NO reinicia (antiflap)', () => {
    const decision = decideRecovery({
      httpOk: false,
      portOpen: true,
      consecutiveFailures: 1,
      threshold: DEFAULT_FAILURE_THRESHOLD,
    });
    assert.equal(decision.action, 'none');
    assert.match(decision.reason, /se espera antes de actuar/);
  });

  it('el daemon wedged con fallos consecutivos SE reinicia matando al dueno del puerto', () => {
    const decision = decideRecovery({
      httpOk: false,
      portOpen: true,
      consecutiveFailures: 2,
      threshold: DEFAULT_FAILURE_THRESHOLD,
    });
    assert.equal(decision.action, 'restart');
    assert.equal(decision.liveness, 'wedged');
    assert.equal(decision.killPortOwner, true, 'sin matar al wedged el puerto queda ocupado');
  });

  it('el daemon caido se reinicia sin matar a nadie', () => {
    const decision = decideRecovery({
      httpOk: false,
      portOpen: false,
      consecutiveFailures: 2,
      threshold: DEFAULT_FAILURE_THRESHOLD,
    });
    assert.equal(decision.action, 'restart');
    assert.equal(decision.killPortOwner, false);
  });
});
