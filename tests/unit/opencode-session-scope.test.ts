#!/usr/bin/env node
/**
 * Unit Tests: NORM-OPENCODE-001 — OpenCode opera en scope de sesión.
 *
 * Contratest del defecto GB-2026-11-14 §2.5 (tres ocurrencias): OpenCode
 * persiste su selección de modelo al cerrar y deja la flota entera sobre un
 * modelo sin capability "tools" — silenciosamente roto para todo el stack.
 * Estos tests fijan el invariante: la flota se clasifica contra el registry,
 * la copia de sesión se regenera del canon, y el heal restaura desde HEAD
 * solo cuando la flota está rota (el drift legítimo del owner se preserva).
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyFleetStatus,
  writeSessionConfig,
  sessionConfigPath,
  healOpencodeDrift,
} from '../../src/tools/opencode-session-scope.ts';
import type { Registry } from '../../src/tools/opencode-agent-model-guard.ts';

const registry: Registry = {
  'opencode-zen-C/big-pickle': { capabilities: ['code', 'chat', 'tools'] },
  'ollama/qwen3-14b-32k': { capabilities: ['code', 'chat', 'tools'] },
  'ollama/qwen2.5-coder:14b': { capabilities: ['code'] }, // SIN tools — el modelo del defecto
};

const canonical = JSON.stringify({
  agent: {
    orchestrator: { model: 'opencode-zen-C/big-pickle' },
    'local-code': { model: 'ollama/qwen3-14b-32k' },
  },
});

/** Fixture: raíz temporal con opencode.json + registry (sin git). */
function fixture(opencodeJson: string): string {
  const root = mkdtempSync(join(tmpdir(), 'gv-ocscope-'));
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(join(root, 'opencode.json'), opencodeJson);
  writeFileSync(join(root, 'config', 'model-health-registry.json'), JSON.stringify(registry));
  return root;
}

test('flota sana se clasifica clean', () => {
  const status = classifyFleetStatus(canonical, registry);
  assert.equal(status.kind, 'clean');
  assert.equal(status.kind === 'clean' ? status.checked : 0, 2);
});

test('flota sobre modelo SIN tools se clasifica drift (el defecto real)', () => {
  const drifted = JSON.stringify({
    agent: { orchestrator: { model: 'ollama/qwen2.5-coder:14b' } },
  });
  const status = classifyFleetStatus(drifted, registry);
  assert.equal(status.kind, 'drift');
  if (status.kind === 'drift') {
    assert.equal(status.problems.length, 1);
    assert.match(status.problems[0].reason, /tools/);
  }
});

test('config ilegible y ausente se clasifican illegible', () => {
  assert.equal(classifyFleetStatus('{broken', registry).kind, 'illegible');
  assert.equal(classifyFleetStatus(null, registry).kind, 'illegible');
});

test('writeSessionConfig crea copia idéntica al canon en .runtime/opencode/', () => {
  const root = fixture(canonical);
  const target = writeSessionConfig(root);
  assert.equal(target, sessionConfigPath(root));
  assert.equal(readFileSync(target, 'utf8'), canonical);
});

test('heal NO toca drift legítimo (modelos registrados con tools)', () => {
  const legit = JSON.stringify({
    agent: { orchestrator: { model: 'ollama/qwen3-14b-32k' } },
  });
  const root = fixture(legit);
  const report = healOpencodeDrift(root);
  assert.equal(report.healed, false);
  assert.equal(report.status.kind, 'clean');
  assert.match(report.detail, /nada que restaurar/);
  // el archivo quedó intacto
  assert.equal(readFileSync(join(root, 'opencode.json'), 'utf8'), legit);
});

test('heal de flota rota en raíz sin git reporta fallo honesto (no destruye)', () => {
  const drifted = JSON.stringify({
    agent: { orchestrator: { model: 'ollama/qwen2.5-coder:14b' } },
  });
  const root = fixture(drifted);
  const report = healOpencodeDrift(root);
  assert.equal(report.healed, false);
  assert.equal(report.status.kind, 'drift');
  // snapshot forense creado ANTES de intentar restaurar
  assert.ok(report.snapshotPath);
  assert.ok(readFileSync(report.snapshotPath!, 'utf8').includes('qwen2.5-coder:14b'));
  // el archivo drifted sigue en disco (no se pierde evidencia)
  assert.ok(readFileSync(join(root, 'opencode.json'), 'utf8').includes('qwen2.5-coder:14b'));
});

test('heal de canon ilegible guarda snapshot forense y reporta', () => {
  const root = fixture('{broken json');
  const report = healOpencodeDrift(root);
  assert.equal(report.healed, false);
  assert.equal(report.status.kind, 'illegible');
  assert.ok(report.snapshotPath);
});
