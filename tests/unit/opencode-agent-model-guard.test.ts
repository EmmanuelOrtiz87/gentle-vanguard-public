#!/usr/bin/env node
/**
 * Unit Tests: guard anti-drift de modelos de agentes (opencode.json)
 *
 * Contratest del defecto GB-2026-11-14 §2.5, ocurrido 2 veces: opencode.json
 * reescrito al cerrar OpenCode con los 22 agentes en ollama/qwen2.5-coder:14b
 * (modelo SIN tool calling por /v1 — la flota queda sin herramientas sin un
 * solo error). El guard clasifica cada agente contra el registry; estos tests
 * fallan si la clasificación deja pasar (a) modelos sin registrar o (b)
 * modelos sin capability "tools".
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  classifyAgentModels,
  validateFallbackChains,
  validateInheritanceTargets,
  type Registry,
} from '../../src/tools/opencode-agent-model-guard.ts';

const registry: Registry = {
  'opencode-zen-C/big-pickle': { capabilities: ['code', 'chat', 'reasoning', 'tools'] },
  'ollama/qwen3-14b-32k': { capabilities: ['code', 'chat', 'reasoning', 'tools'] },
  'ollama/qwen2.5-coder:14b': { capabilities: ['code'] },
};

test('fleet healthy: todos los agentes sobre modelos con tools', () => {
  const r = classifyAgentModels(
    {
      orchestrator: { model: 'opencode-zen-C/big-pickle' },
      'local-code': { model: 'ollama/qwen3-14b-32k' },
    },
    registry,
  );
  assert.equal(r.ok, true);
  assert.equal(r.checked, 2);
  assert.deepEqual(r.problems, []);
});

test('el defecto real: swap silencioso a qwen2.5-coder (sin tools) es FAIL', () => {
  const r = classifyAgentModels({ orchestrator: { model: 'ollama/qwen2.5-coder:14b' } }, registry);
  assert.equal(r.ok, false);
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0].reason, /sin "tools"/);
});

test('modelo no registrado es FAIL (la verdad vive en el registry)', () => {
  const r = classifyAgentModels({ docAgent: { model: 'nuevo-modelo-nunca-visto' } }, registry);
  assert.equal(r.ok, false);
  assert.match(r.problems[0].reason, /no registrado/);
});

test('agente sin modelo declarado HEREDA el modelo de la sesión y pasa (canon 2026-11-21)', () => {
  const r = classifyAgentModels({ ghost: {} }, registry);
  assert.equal(r.ok, true);
  assert.equal(r.inherited, 1);
  assert.equal(r.checked, 0);
  assert.deepEqual(r.problems, []);
});

test('flota mixta: heredados + pinneado con tools pasa y cuenta cada uno', () => {
  const r = classifyAgentModels(
    {
      orchestrator: {},
      'sdd-explore': {},
      'local-code': { model: 'ollama/qwen3-14b-32k' },
    },
    registry,
  );
  assert.equal(r.ok, true);
  assert.equal(r.inherited, 2);
  assert.equal(r.checked, 1);
});

test('target de herencia sin tools es FAIL: toda la flota hereda un modelo sin tool calling', () => {
  const r = validateInheritanceTargets(['ollama/qwen2.5-coder:14b'], registry);
  assert.equal(r.ok, false);
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0].reason, /heredan pierden tool calling/);
});

test('target de herencia no registrado es FAIL', () => {
  const r = validateInheritanceTargets(['modelo-fantasma'], registry);
  assert.equal(r.ok, false);
  assert.match(r.problems[0].reason, /no registrado/);
});

test('targets de herencia registrados con tools pasan', () => {
  const r = validateInheritanceTargets(
    ['ollama/qwen3-14b-32k', 'opencode-zen-C/big-pickle'],
    registry,
  );
  assert.equal(r.ok, true);
  assert.equal(r.checked, 2);
});

test('fallback sin tools es FAIL: el agente perderia tool calling al caer', () => {
  const r = validateFallbackChains({
    ...registry,
    'opencode-zen-C/big-pickle': {
      capabilities: ['code', 'tools'],
      fallbackChain: ['ollama/qwen2.5-coder:14b'],
    },
  });
  assert.equal(r.ok, false);
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0].reason, /pierde tool calling/);
});

test('fallback registrado con tools pasa', () => {
  const r = validateFallbackChains({
    ...registry,
    'opencode-zen-C/big-pickle': {
      capabilities: ['code', 'tools'],
      fallbackChain: ['ollama/qwen3-14b-32k'],
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.checked, 1);
});
