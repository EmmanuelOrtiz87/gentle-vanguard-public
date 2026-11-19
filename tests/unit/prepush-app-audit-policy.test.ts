import { describe, it } from 'node:test';
import assert from 'node:assert';
import { evaluateGate, isAppAuditBlocking, shouldRunAppAudit } from '../../src/git/prepush-gate.ts';
import { summarize } from '../../src/ops/stack-apps-audit-scheduled.ts';

describe('politica de stack-audit-apps', () => {
  it('diff acotado a apps: corre y BLOQUEA', () => {
    const scope = { mode: 'apps' as const };
    assert.equal(shouldRunAppAudit(scope, { auditApps: false }), true);
    assert.equal(isAppAuditBlocking(scope, { auditApps: false }), true);
  });

  it('diff en superficie compartida: NO se barre el catalogo en el push', () => {
    const scope = { mode: 'full' as const };
    assert.equal(shouldRunAppAudit(scope, { auditApps: false }), false);
    assert.equal(isAppAuditBlocking(scope, { auditApps: false }), false);
  });

  it('sin impacto en apps: nada que auditar', () => {
    const scope = { mode: 'none' as const };
    assert.equal(shouldRunAppAudit(scope, { auditApps: false }), true);
    assert.equal(isAppAuditBlocking(scope, { auditApps: false }), false);
  });

  it('--audit-apps: a demanda, el barrido completo corre y bloquea', () => {
    for (const mode of ['apps', 'full', 'none'] as const) {
      const scope = { mode };
      assert.equal(shouldRunAppAudit(scope, { auditApps: true }), true);
      assert.equal(isAppAuditBlocking(scope, { auditApps: true }), true);
    }
  });

  it('un FAIL bloqueante sigue bloqueando', () => {
    const results = [
      { name: 'typecheck', status: 'pass' as const, durationMs: 1, tail: '' },
      { name: 'stack-audit-apps', status: 'fail' as const, durationMs: 1, tail: 'x' },
    ];
    const blocked = evaluateGate(results, new Set());
    assert.equal(blocked.allPass, false);
    assert.equal(blocked.blockingFailures.length, 1);
  });

  it('un FAIL advisory informa pero no bloquea', () => {
    const results = [
      { name: 'typecheck', status: 'pass' as const, durationMs: 1, tail: '' },
      { name: 'stack-audit-apps', status: 'fail' as const, durationMs: 1, tail: 'x' },
    ];
    const advisory = evaluateGate(results, new Set(['stack-audit-apps']));
    assert.equal(advisory.allPass, true);
    assert.equal(advisory.blockingFailures.length, 0);
    assert.equal(advisory.allGreen, false);
  });
});

describe('wrapper de cadencia', () => {
  it('resume el reporte JSON del barrido', () => {
    const stdout = JSON.stringify({
      passed: 2,
      warned: 1,
      failed: 1,
      audits: [
        { app: 'a', status: 'PASS' },
        { app: 'b', status: 'PASS' },
        { app: 'c', status: 'WARN' },
        { app: 'd', status: 'FAIL' },
      ],
    });
    const summary = summarize(stdout);
    assert.match(summary ?? '', /4 apps/);
    assert.match(summary ?? '', /2 PASS \/ 1 WARN \/ 1 FAIL/);
    assert.match(summary ?? '', /fallan: d/);
  });

  it('no inventa resumen si el stdout no es JSON', () => {
    assert.equal(summarize('no soy json'), null);
  });
});
