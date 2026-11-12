/**
 * app-registry-consumers.test.ts — los consumidores del registro UNICO de apps
 * respetan el scope.
 *
 * POR QUÉ EXISTE (2026-11-11)
 * -------------------------------------------------------------------------
 * El registro (`config/apps.registry.json`) declara quién manda sobre cada app:
 * el Command Center (scope `native`) o el Sandbox (scope `client`). Si los
 * consumidores vuelven a copiar la lista a mano, el registro vuelve a ser una
 * fuente de verdad más y los dos centros se pisan otra vez.
 *
 * Estos tests son el contrato de los CONSUMIDORES:
 *
 *   C1 · El Sandbox sirve EXACTAMENTE las apps de scope `client`.
 *   C2 · Una app NATIVA con sandbox.config se ignora, con motivo explícito.
 *   C3 · Sin registro, el Sandbox no rompe: sigue con lo que descubre + aviso.
 *   C4 · Una app cliente sin adaptador de acciones queda VISIBLE (no fatal).
 *   C5 · El watchtower espera las apps NATIVAS del registro (no una copia) y
 *        el dashboard conserva su puerto de UI (el websocket es dinámico).
 *   C6 · validate-stack usa el registro y ya no parsea el server.ts del CC.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { clientApps, nativeApps } from '../../src/ops/app-registry.ts';
import { discoverApps, discoverAppsWithReport } from '../../apps/sandbox-gv/src/registry.ts';
import { deriveExpectedApps } from '../../src/core/watchtower/checks-apps.ts';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..', '..');

// ---------------------------------------------------------------------------
// Fixtures: un root de stack mínimo en disco temporal
// ---------------------------------------------------------------------------

interface FixtureApp {
  id: string;
  scope: 'native' | 'client';
  dir: string;
  withAdapter: boolean;
}

/** Crea un root de stack mínimo: `apps/<id>` + `config/apps.registry.json`. */
function makeRoot(apps: FixtureApp[], withRegistry = true): string {
  const root = mkdtempSync(join(tmpdir(), 'gv-app-scope-'));
  for (const app of apps) {
    const appDir = join(root, app.dir);
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: app.id }), 'utf8');
    if (app.withAdapter) {
      writeFileSync(
        join(appDir, 'sandbox.config.ts'),
        [
          `export const sandbox = {`,
          `  name: ${JSON.stringify(app.id)},`,
          `  displayName: ${JSON.stringify(app.id)},`,
          `  description: "fixture",`,
          `  category: "other",`,
          `  version: "1.0.0",`,
          `  actions: ["reset"],`,
          `};`,
          '',
        ].join('\n'),
        'utf8',
      );
    }
  }
  if (withRegistry) {
    mkdirSync(join(root, 'config'), { recursive: true });
    writeFileSync(
      join(root, 'config', 'apps.registry.json'),
      JSON.stringify({
        version: 1,
        apps: apps.map((app) => ({
          id: app.id,
          name: app.id,
          description: 'fixture',
          scope: app.scope,
          dir: app.dir,
          ports: [9000 + app.id.length],
        })),
      }),
      'utf8',
    );
  }
  return root;
}

// ---------------------------------------------------------------------------
// C1 · El Sandbox sirve SOLO apps de cliente
// ---------------------------------------------------------------------------

test('C1 · el Sandbox sirve exactamente las apps de scope client', async () => {
  const discovered = await discoverApps(ROOT);
  const names = discovered.map((app) => app.name).sort();
  const expected = clientApps()
    .map((app) => app.id)
    .sort();
  assert.deepEqual(names, expected, 'el Sandbox sirve el mismo conjunto que scope=client');
  assert.ok(names.length > 0, 'hay apps de cliente que servir');

  const nativeIds = new Set(nativeApps().map((app) => app.id));
  for (const name of names) {
    assert.equal(nativeIds.has(name), false, `${name} es nativa: no la sirve el Sandbox`);
  }
});

// ---------------------------------------------------------------------------
// C2 · Una app NATIVA se ignora con motivo explícito
// ---------------------------------------------------------------------------

test('C2 · una app nativa con sandbox.config se ignora por scope', async () => {
  const root = makeRoot([
    { id: 'native-app', scope: 'native', dir: 'apps/native-app', withAdapter: true },
    { id: 'client-app', scope: 'client', dir: 'apps/client-app', withAdapter: true },
  ]);

  const report = await discoverAppsWithReport(root);
  assert.deepEqual(
    report.apps.map((app) => app.name),
    ['client-app'],
    'sólo la app de cliente se sirve',
  );
  const skippedNative = report.skipped.find((s) => s.name === 'native-app');
  assert.ok(skippedNative, 'la app nativa queda reportada como ignorada');
  assert.match(skippedNative.reason, /native/, 'el motivo dice el scope');
  assert.match(skippedNative.reason, /Command Center/, 'el motivo dice quién la gestiona');
});

// ---------------------------------------------------------------------------
// C3 · Sin registro el Sandbox no rompe
// ---------------------------------------------------------------------------

test('C3 · sin registro el Sandbox sigue funcionando y deja un aviso', async () => {
  const root = makeRoot(
    [{ id: 'client-app', scope: 'client', dir: 'apps/client-app', withAdapter: true }],
    false,
  );

  const report = await discoverAppsWithReport(root);
  assert.deepEqual(
    report.apps.map((app) => app.name),
    ['client-app'],
    'sigue sirviendo lo que descubre',
  );
  assert.ok(
    report.warnings.some((w) => /registro|registry/i.test(`${w.name} ${w.reason}`)),
    'deja un aviso de que no hay registro',
  );
});

// ---------------------------------------------------------------------------
// C4 · Una app cliente sin adaptador queda visible (no fatal)
// ---------------------------------------------------------------------------

test('C4 · una app cliente sin sandbox.config se reporta pero no rompe', async () => {
  const root = makeRoot([
    { id: 'client-app', scope: 'client', dir: 'apps/client-app', withAdapter: true },
    { id: 'client-sin-adaptador', scope: 'client', dir: 'apps/other-app', withAdapter: false },
  ]);

  const report = await discoverAppsWithReport(root);
  assert.deepEqual(
    report.apps.map((app) => app.name),
    ['client-app'],
    'la app sin adaptador no se sirve',
  );
  const warning = report.warnings.find((w) => w.name === 'client-sin-adaptador');
  assert.ok(warning, 'queda visible como aviso');
  assert.match(warning.reason, /adaptador/i, 'el aviso explica que falta el adaptador');
});

// ---------------------------------------------------------------------------
// C5 · El watchtower deriva la lista del registro
// ---------------------------------------------------------------------------

test('C5 · el watchtower espera las apps nativas del registro, no una copia', () => {
  const expected = deriveExpectedApps(ROOT);
  const ids = expected.map((app) => app.id).sort();
  const nativeIds = nativeApps()
    .map((app) => app.id)
    .sort();
  assert.deepEqual(ids, nativeIds, 'la lista deriva del registro (scope native)');

  const clientIds = new Set(clientApps().map((app) => app.id));
  for (const id of ids) {
    assert.equal(clientIds.has(id), false, `${id} es de cliente: no la vigila el Command Center`);
  }

  for (const app of expected) {
    assert.ok(app.dir, `${app.id}: el registro declara su carpeta`);
  }

  // El dashboard conserva su puerto de UI (5173): su websocket es dinámico
  // (8080 por defecto) y no debe quedar fijo en el check.
  const dashboard = expected.find((app) => app.id === 'dashboard');
  assert.ok(dashboard, 'dashboard está en la lista');
  assert.equal(dashboard.uiPort, 5173, 'el dashboard mantiene su puerto de UI');
});

// ---------------------------------------------------------------------------
// C6 · validate-stack usa el registro
// ---------------------------------------------------------------------------

test('C6 · validate-stack usa el registro y no parsea el server.ts del CC', async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['--import', 'tsx', 'deploy/cloud/scripts/validate-stack.ts'],
    { cwd: ROOT, timeout: 120_000 },
  );
  assert.match(stdout, /apps\.registry\.json\[/, 'el puerto sale del registro');
  assert.doesNotMatch(
    stdout,
    /command-center\/server\.ts:APPS_REGISTRY/,
    'el parseo viejo del server.ts desapareció',
  );
  assert.match(
    stdout,
    /OK: \d+ app\(s\) validadas contra el repo, 0 errores/,
    'el validador sigue verde',
  );
});
