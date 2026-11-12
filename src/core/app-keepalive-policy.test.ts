/**
 * CONTRATO de la política de auto-arranque (decisión owner 2026-10-21).
 *
 * Lo que este test protege: un chequeo de salud nunca puede tratar como fallo
 * un servicio `on-demand` legítimamente detenido, y un error de lectura de la
 * config NUNCA puede habilitar auto-arranque.
 *
 * Ejecutar: node --import tsx --test src/core/app-keepalive-policy.test.ts
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readAppKeepalivePolicy, isOnDemand } from './app-keepalive-policy.js';

describe('readAppKeepalivePolicy', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gv-keepalive-policy-'));
    mkdirSync(join(root, 'config'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const writeConfig = (body: string) =>
    writeFileSync(join(root, 'config', 'apps-keepalive.json'), body, 'utf-8');

  it('lee la clave explicita de la app', () => {
    writeConfig(JSON.stringify({ default: 'on-demand', apps: { dashboard: 'always' } }));
    assert.equal(readAppKeepalivePolicy('dashboard', root), 'always');
    assert.equal(isOnDemand('dashboard', root), false);
  });

  it('cae al default cuando la app no esta listada', () => {
    writeConfig(JSON.stringify({ default: 'on-demand', apps: {} }));
    assert.equal(readAppKeepalivePolicy('otra-app', root), 'on-demand');
  });

  it('un default always solo aplica a apps sin clave propia', () => {
    writeConfig(JSON.stringify({ default: 'always', apps: { dashboard: 'on-demand' } }));
    assert.equal(readAppKeepalivePolicy('dashboard', root), 'on-demand');
    assert.equal(readAppKeepalivePolicy('sin-clave', root), 'always');
  });

  it('config ausente degrada a on-demand (fail-safe: nada se auto-arranca)', () => {
    assert.equal(readAppKeepalivePolicy('dashboard', root), 'on-demand');
  });

  it('JSON invalido degrada a on-demand', () => {
    writeConfig('{ esto no es json');
    assert.equal(readAppKeepalivePolicy('dashboard', root), 'on-demand');
  });

  it('un valor desconocido no habilita auto-arranque', () => {
    writeConfig(JSON.stringify({ default: 'yes-please', apps: { dashboard: 'true' } }));
    assert.equal(readAppKeepalivePolicy('dashboard', root), 'on-demand');
  });
});

describe('politica vigente del stack real', () => {
  it('el dashboard esta en on-demand', () => {
    // Si esto falla, alguien cambio la decision del owner sin darse cuenta.
    assert.equal(readAppKeepalivePolicy('dashboard'), 'on-demand');
  });
});
