/**
 * TEST NEGATIVO de la politica del watchdog del dashboard WS.
 *
 * Reproduce los dos fallos reales (2026-11-03):
 *
 *   1) El watchdog se SUICIDABA al agotar su presupuesto de reinicios
 *      (`return` = el proceso salia) y el dashboard quedaba sin supervisor
 *      para siempre: el autoheal del watchtower lanza el SERVER, no el
 *      watchdog, asi que nadie lo relanzaba. Un dashboard que fallaba 10
 *      veces quedaba muerto de forma permanente y silenciosa.
 *
 *   2) El launcher (la via canonica del autoheal) no arrancaba ningun
 *      watchdog: un dashboard lanzado por el autoheal quedaba sin nadie que
 *      lo reiniciara cuando se colgara.
 *
 * Corre con:  node --import tsx --test src/ops/dashboard-watchdog-policy.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decideBudget, decidePortAction, watchdogIsAlive } from './dashboard-watchdog-policy.js';

const MAX = 10;

describe('dashboard-watchdog-policy', () => {
  it('reinicia mientras haya presupuesto', () => {
    const d = decideBudget({ restarts: 0, degraded: false }, MAX);
    assert.equal(d.action, 'restart');
    assert.equal(d.restarts, 1);
    assert.equal(d.degraded, false);
  });

  it('consume el presupuesto de a uno', () => {
    let state = { restarts: 0, degraded: false };
    for (let i = 1; i <= MAX; i++) {
      const d = decideBudget(state, MAX);
      assert.equal(d.action, 'restart', `reinicio ${i} deberia reiniciar`);
      assert.equal(d.restarts, i);
      state = { restarts: d.restarts, degraded: d.degraded };
    }
  });

  it('NUNCA se suicida al agotar el presupuesto: entra en modo degradado', () => {
    // El fallo original: el watchdog hacia `return` y el proceso salia.
    const d = decideBudget({ restarts: MAX, degraded: false }, MAX);
    assert.equal(d.action, 'degrade', 'el watchdog debe seguir vivo, no morir');
    assert.equal(d.degraded, true);
    assert.equal(d.enteredDegraded, true);
    assert.equal(d.restarts, 0, 'el presupuesto se reactiva cuando el server se recupera');
  });

  it('el modo degradado no se re-anuncia cada ciclo', () => {
    const d = decideBudget({ restarts: MAX, degraded: true }, MAX);
    assert.equal(d.action, 'degrade');
    assert.equal(d.enteredDegraded, false, 'la transicion ya se anuncio');
    assert.equal(d.degraded, true);
  });

  it('un watchdog vivo se detecta y NO se relanza', () => {
    const alive = watchdogIsAlive(
      '/tmp/does-not-matter.pid',
      (pid) => pid === 4242,
      () => '4242',
    );
    assert.equal(alive, true);
  });

  it('un watchdog MUERTO se detecta: hay que relanzarlo', () => {
    const alive = watchdogIsAlive(
      '/tmp/does-not-matter.pid',
      (pid) => pid === 4242,
      () => '9999', // PID registrado que ya no existe
    );
    assert.equal(alive, false, 'un PID muerto NO es un watchdog vivo');
  });

  it('sin PID file hay que arrancar el watchdog', () => {
    const alive = watchdogIsAlive(
      '/tmp/does-not-matter.pid',
      () => true,
      () => null,
    );
    assert.equal(alive, false);
  });

  it('un PID file corrupto no cuenta como watchdog vivo', () => {
    for (const raw of ['', '   ', 'abc', '0', '-1']) {
      const alive = watchdogIsAlive(
        '/tmp/does-not-matter.pid',
        () => true,
        () => raw,
      );
      assert.equal(alive, false, `PID file con "${raw}" no debe contar como vivo`);
    }
  });

  it('una excepcion al comprobar el proceso cuenta como watchdog muerto', () => {
    const alive = watchdogIsAlive(
      '/tmp/does-not-matter.pid',
      () => {
        throw new Error('EPERM');
      },
      () => '4242',
    );
    assert.equal(alive, false);
  });
});

describe('dashboard-watchdog-policy — decision de puerto', () => {
  it('puerto libre: se arranca ahi', () => {
    assert.equal(decidePortAction({ busy: false, healthy: false, killed: false }), 'reuse');
  });

  it('puerto ocupado pero API Sana: se adopta el server', () => {
    assert.equal(decidePortAction({ busy: true, healthy: true, killed: false }), 'adopt');
  });

  it('puerto ocupado + API muerta + daemon registrado muerto: REUSA el puerto', () => {
    // El bug original: se mudaba al siguiente puerto y dejaba al daemon
    // wedged ocupando el puerto CANONICO (8080 -> 8081).
    assert.equal(decidePortAction({ busy: true, healthy: false, killed: true }), 'reuse');
  });

  it('puerto ocupado + API muerta + proceso NO registrado: busca otro puerto', () => {
    // Un proceso ajeno no se toca: se busca otro puerto.
    assert.equal(decidePortAction({ busy: true, healthy: false, killed: false }), 'find-free');
  });
});
