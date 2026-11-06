import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyOpenAlerts,
  type BaselineConfig,
  type DependabotAlert,
} from './dependabot-alerts-gate.ts';

function alert(
  number: number,
  overrides: Partial<DependabotAlert> = {},
): DependabotAlert {
  return {
    number,
    state: 'open',
    dependency: {
      manifest_path: 'package-lock.json',
      package: { name: 'minimatch', ecosystem: 'npm' },
    },
    security_advisory: {
      ghsa_id: 'GHSA-test',
      cve_id: 'CVE-test',
      severity: 'medium',
      summary: 'test',
    },
    ...overrides,
  };
}

const BASELINE: BaselineConfig = {
  entries: [
    {
      manifest: 'apps/pinned/locked',
      reason: 'lock pinned por diseno',
      source: 'politica',
    },
    {
      manifest: 'apps/research',
      pkg: 'minimatch',
      reason: 'snapshot de auditoria',
      source: 'politica',
    },
  ],
};

describe('dependabot-alerts-gate: classifyOpenAlerts', () => {
  it('clasifica 0 alertas abiertas como pass limpio', () => {
    const { tolerated, violations } = classifyOpenAlerts([], BASELINE);
    assert.equal(tolerated.length, 0);
    assert.equal(violations.length, 0);
  });

  it('una alerta fuera del baseline es una violation (el gate FALLA)', () => {
    const { violations } = classifyOpenAlerts([alert(1)], BASELINE);
    assert.equal(violations.length, 1);
    assert.deepEqual(violations[0], {
      number: 1,
      pkg: 'minimatch',
      manifest: 'package-lock.json',
      severity: 'medium',
      advisory: 'GHSA-test',
    });
  });

  it('un manifest cubierto por el baseline es tolerated', () => {
    const { tolerated, violations } = classifyOpenAlerts(
      [alert(2, { dependency: { manifest_path: 'apps/pinned/locked/pnpm-lock.yaml' } })],
      BASELINE,
    );
    assert.equal(violations.length, 0);
    assert.equal(tolerated.length, 1);
    assert.equal(tolerated[0].number, 2);
  });

  it('el pkg del baseline acota: otro paquete en la misma superficie es violation', () => {
    const { violations, tolerated } = classifyOpenAlerts(
      [
        alert(3, {
          dependency: {
            manifest_path: 'apps/research/security/frontend-lock/pnpm-lock.yaml',
            package: { name: 'glob', ecosystem: 'npm' },
          },
        }),
      ],
      BASELINE,
    );
    // La entrada de research exige pkg minimatch: glob NO esta cubierto.
    assert.equal(tolerated.length, 0);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].pkg, 'glob');
  });

  it('mezcla tolerated y violations sin cruzar listas', () => {
    const { tolerated, violations } = classifyOpenAlerts(
      [
        alert(10),
        alert(11, { dependency: { manifest_path: 'apps/pinned/locked/a/pnpm-lock.yaml' } }),
        alert(12, {
          dependency: {
            manifest_path: 'apps/research/x/pnpm-lock.yaml',
            package: { name: 'minimatch', ecosystem: 'npm' },
          },
        }),
      ],
      BASELINE,
    );
    assert.deepEqual(violations.map((v) => v.number), [10]);
    assert.deepEqual(tolerated.map((t) => t.number).sort(), [11, 12]);
  });

  it('sin baseline cualquier alerta es violation (default defensivo)', () => {
    const { violations } = classifyOpenAlerts([alert(99)], { entries: [] });
    assert.equal(violations.length, 1);
  });

  it('manifiestos incompletos no explotan (campos ausentes = desconocidos)', () => {
    const { violations } = classifyOpenAlerts(
      [{ number: 200, state: 'open' } as DependabotAlert],
      BASELINE,
    );
    assert.equal(violations.length, 1);
    assert.equal(violations[0].pkg, '(desconocido)');
  });
});
