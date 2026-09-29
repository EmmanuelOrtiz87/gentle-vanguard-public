import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadKeepalivePolicy,
  selectAppsToStart,
  type KeepalivePolicy,
} from '../../src/ops/apps-keepalive.js';

const POLICY: KeepalivePolicy = {
  default: 'on-demand',
  apps: {
    analytics: 'always',
    cms: 'always',
    dashboard: 'on-demand',
    'gv-music': 'on-demand',
  },
};

test('selectAppsToStart solo arranca apps always caídas', () => {
  const apps = [
    { id: 'analytics', status: 'running' },
    { id: 'cms', status: 'stopped' },
    { id: 'dashboard', status: 'stopped' },
    { id: 'gv-music', status: 'stopped' },
  ];
  const { toStart, skippedOnDemand } = selectAppsToStart(apps, POLICY);
  assert.deepEqual(
    toStart.map((a) => a.id),
    ['cms'],
  );
  assert.deepEqual(skippedOnDemand.sort(), ['dashboard', 'gv-music']);
});

test('selectAppsToStart respeta partial: lo repara si es always', () => {
  const { toStart, skippedOnDemand } = selectAppsToStart(
    [
      { id: 'analytics', status: 'partial' },
      { id: 'gv-music', status: 'partial' },
    ],
    POLICY,
  );
  assert.deepEqual(
    toStart.map((a) => a.id),
    ['analytics'],
  );
  assert.deepEqual(skippedOnDemand, ['gv-music']);
});

test('selectAppsToStart: app desconocida cae en el default', () => {
  const { toStart, skippedOnDemand } = selectAppsToStart(
    [
      { id: 'nueva-app', status: 'stopped' },
      { id: 'otra-nueva', status: 'stopped' },
    ],
    { default: 'always', apps: { 'otra-nueva': 'on-demand' } },
  );
  assert.deepEqual(
    toStart.map((a) => a.id),
    ['nueva-app'],
  );
  assert.deepEqual(skippedOnDemand, ['otra-nueva']);
});

test('loadKeepalivePolicy: archivo válido se parsea con valores saneados', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ka-policy-'));
  const file = join(dir, 'policy.json');
  writeFileSync(
    file,
    JSON.stringify({
      default: 'always',
      apps: { cms: 'always', 'gv-music': 'on-demand', corrupta: 'a veces' },
    }),
    'utf-8',
  );
  const result = loadKeepalivePolicy(file);
  rmSync(dir, { recursive: true, force: true });
  assert.ok(result.ok, 'política válida carga');
  if (!result.ok) return;
  assert.equal(result.policy.default, 'always');
  assert.equal(result.policy.apps.cms, 'always');
  assert.equal(result.policy.apps['gv-music'], 'on-demand');
  assert.equal(result.policy.apps.corrupta, undefined, 'valor fuera de dominio se descarta');
});

test('loadKeepalivePolicy: falta de archivo → ok:false (fail-safe, no arranca nada)', () => {
  const result = loadKeepalivePolicy(join(tmpdir(), 'no-existe', 'policy.json'));
  assert.ok(!result.ok);
});

test('loadKeepalivePolicy: JSON inválido → ok:false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ka-policy-'));
  const file = join(dir, 'policy.json');
  writeFileSync(file, '{ no es json', 'utf-8');
  const result = loadKeepalivePolicy(file);
  rmSync(dir, { recursive: true, force: true });
  assert.ok(!result.ok);
});
