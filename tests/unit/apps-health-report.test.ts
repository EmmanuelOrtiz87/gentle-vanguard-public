import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyApp, isPidAlive } from '../../src/ops/apps-health-report.js';

describe('apps-health-report', () => {
  it('classifyApp: ok cuando algún puerto responde', () => {
    assert.equal(
      classifyApp({ portsUp: true, hasPidfile: false, pidAlive: false, hasPorts: true }),
      'ok',
    );
  });

  it('classifyApp: down cuando sin puertos ni pidfile vivo', () => {
    assert.equal(
      classifyApp({ portsUp: false, hasPidfile: false, pidAlive: false, hasPorts: true }),
      'down',
    );
    assert.equal(
      classifyApp({ portsUp: false, hasPidfile: true, pidAlive: false, hasPorts: true }),
      'down',
    );
  });

  it('classifyApp: zombie = PID vivo pero puerto muerto (caso censor BL-2026-11-16)', () => {
    assert.equal(
      classifyApp({ portsUp: false, hasPidfile: true, pidAlive: true, hasPorts: true }),
      'zombie',
    );
  });

  it('classifyApp: no-ports omite apps sin puertos declarados', () => {
    assert.equal(
      classifyApp({ portsUp: false, hasPidfile: false, pidAlive: false, hasPorts: false }),
      'no-ports',
    );
  });

  it('isPidAlive: null/negativos/no-finito → false sin lanzar', () => {
    assert.equal(isPidAlive(null), false);
    assert.equal(isPidAlive(0), false);
    assert.equal(isPidAlive(-5), false);
    assert.equal(isPidAlive(Number.NaN), false);
  });

  it('isPidAlive: PID 1 existe en sistemas unix-like y en Windows falla EPERM/ESRCH sin crash', () => {
    // La garantía clave: nunca lanza; siempre booleano.
    const result = isPidAlive(1);
    assert.equal(typeof result, 'boolean');
  });
});
