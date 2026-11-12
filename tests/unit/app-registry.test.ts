/**
 * app-registry.test.ts — el registro único de apps es de verdad la fuente de
 * verdad, y los dos centros de comando no se pisan.
 *
 * POR QUÉ EXISTE (2026-11-11)
 * -------------------------------------------------------------------------
 * Antes había cinco listas de apps copiadas a mano (Command Center, Sandbox,
 * watchtower, QA de diseño y validador de deploy) y las 6 apps de clientes
 * estaban en el Command Center Y en el Sandbox. Un registro único con `scope`
 * lo arregla, pero un registro que nadie verifica vuelve a ser una copia más:
 * estos tests son el contrato.
 *
 *   A1 · El registro real carga y valida sin errores (ids, puertos, carpetas,
 *        scripts).
 *   A2 · Cada app pertenece a UN centro: `native` ∩ `client` = ∅ y todos los
 *        ids están declarados.
 *   A3 · Las apps con `sandbox.config.*` en disco son exactamente las de
 *        scope `client` (el Sandbox no puede servir una app nativa, ni dejar
 *        fuera una de cliente).
 *   A4 · Las carpetas de las apps nativas existen y traen start/stop.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  clientApps,
  loadAppRegistry,
  nativeApps,
  validateAppRegistry,
} from '../../src/ops/app-registry.ts';

const ROOT = resolve(import.meta.dirname, '..', '..');

test('A1 · el registro real carga y valida sin errores', () => {
  const entries = loadAppRegistry();
  assert.ok(entries.length >= 20, `el registro tiene ${entries.length} apps`);
  assert.deepEqual(validateAppRegistry(entries), [], 'el registro del repo es consistente');
});

test('A2 · cada app pertenece a un centro y sólo a uno', () => {
  const native = nativeApps();
  const client = clientApps();
  const nativeIds = new Set(native.map((a) => a.id));
  const clientIds = new Set(client.map((a) => a.id));

  for (const id of clientIds) {
    assert.equal(nativeIds.has(id), false, `${id} no puede estar en los dos centros`);
  }
  assert.equal(native.length + client.length, loadAppRegistry().length, 'toda app tiene scope');
  assert.ok(native.length > 0 && client.length > 0, 'los dos centros tienen apps');
});

test('A3 · las apps con sandbox.config.* son exactamente las de scope client', () => {
  const appsDir = join(ROOT, 'apps');
  const withSandboxConfig = readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      const dir = join(appsDir, entry.name);
      return (
        existsSync(join(dir, 'sandbox.config.ts')) || existsSync(join(dir, 'sandbox.config.js'))
      );
    })
    .map((entry) => entry.name)
    .sort();

  const declaredClients = clientApps()
    .map((a) => a.id)
    .sort();
  assert.deepEqual(
    withSandboxConfig,
    declaredClients,
    'el Sandbox y el registro declaran el mismo conjunto de apps de cliente',
  );
});

test('A4 · las apps nativas existen en disco y traen start/stop', () => {
  for (const app of nativeApps()) {
    assert.ok(existsSync(join(ROOT, app.dir)), `${app.id}: existe ${app.dir}`);
    assert.ok(existsSync(join(ROOT, app.dir, app.start ?? './start.sh')), `${app.id}: tiene start`);
    assert.ok(existsSync(join(ROOT, app.dir, app.stop ?? './stop.sh')), `${app.id}: tiene stop`);
  }
});
