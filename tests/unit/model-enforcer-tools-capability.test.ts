import assert from 'node:assert/strict';
import test from 'node:test';
import { declaresTools, resolveTargetModel } from '../../src/ml/model-enforcer.js';

interface RegistryLike {
  models: Record<string, { capabilities?: string[] }>;
  routingRules: { orchestrator: { primary: string }; subagents: { default: string } };
}

const registry: RegistryLike = {
  models: {
    'ollama/qwen2.5-coder:14b': { capabilities: ['code'] }, // sin tools: no sirve para la flota
    'ollama/qwen3-14b-32k': { capabilities: ['code', 'chat', 'reasoning', 'tools'] },
    'opencode-zen-C/big-pickle': { capabilities: ['code', 'chat', 'reasoning', 'tools'] },
  },
  routingRules: {
    orchestrator: { primary: 'ollama/qwen3-14b-32k' },
    subagents: { default: 'ollama/qwen3-14b-32k' },
  },
};

test('un modelo sin capability "tools" no puede ser impuesto a los agentes', () => {
  assert.equal(declaresTools(registry as never, 'ollama/qwen3-14b-32k'), true);
  assert.equal(declaresTools(registry as never, 'ollama/qwen2.5-coder:14b'), false);
});

test('el enforcer elige un modelo sano QUE declare tools', () => {
  const status = {
    healthy: ['ollama/qwen2.5-coder:14b', 'ollama/qwen3-14b-32k'],
    unhealthy: [],
    qualified: ['ollama/qwen2.5-coder:14b'],
  };
  const resolved = resolveTargetModel(
    status,
    { model: 'ollama/qwen2.5-coder:14b', provider: 'ollama' },
    registry as never,
  );
  assert.notEqual(resolved.target?.model, 'ollama/qwen2.5-coder:14b');
  assert.equal(resolved.target?.model, 'ollama/qwen3-14b-32k');
});

test('sin ningun modelo sano con tools no se modifica el routing', () => {
  const status = {
    healthy: ['ollama/qwen2.5-coder:14b'],
    unhealthy: [],
    qualified: [],
  };
  const resolved = resolveTargetModel(
    status,
    { model: 'ollama/qwen2.5-coder:14b', provider: 'ollama' },
    registry as never,
  );
  assert.equal(resolved.target, null);
});

test('con candidatos nube y local, el barrido automático elige la nube', () => {
  // Regresión 2026-11-26: el enforcer escribía Ollama como primario del
  // orquestador cuando era el primer modelo calificado por inferencia real.
  const status = {
    healthy: ['opencode-zen-C/big-pickle', 'ollama/qwen3-14b-32k'],
    unhealthy: [],
    qualified: ['ollama/qwen3-14b-32k', 'opencode-zen-C/big-pickle'],
  };
  const resolved = resolveTargetModel(
    status,
    { model: 'opencode-zen-C/big-pickle', provider: 'opencode-zen-C' },
    registry as never,
  );
  assert.equal(resolved.target?.model, 'opencode-zen-C/big-pickle');
});

test('el local solo se elige cuando no queda ningún candidato nube', () => {
  const status = {
    healthy: ['ollama/qwen3-14b-32k'],
    unhealthy: ['opencode-zen-C/big-pickle'],
    qualified: ['ollama/qwen3-14b-32k'],
    disqualified: ['opencode-zen-C/big-pickle'],
  };
  const resolved = resolveTargetModel(
    status,
    { model: 'opencode-zen-C/big-pickle', provider: 'opencode-zen-C' },
    registry as never,
  );
  assert.equal(resolved.target?.model, 'ollama/qwen3-14b-32k');
});

test('un preferido con proveedor medido inalcanzable se abandona aunque declare tools', () => {
  // Regresión review 4.7.1: el preferido se retenía por `healthy` estático en
  // `unknown`; una evidencia vigente de proveedor caído debe sacarlo, si no el
  // routing queda apuntando a un proveedor que no responde.
  const withPreferred = {
    models: {
      ...registry.models,
      'gpt-5.6-luna': { capabilities: ['code', 'chat', 'reasoning', 'tools'] },
    },
    routingRules: registry.routingRules,
  };
  const status = {
    healthy: ['opencode-zen-C/big-pickle'],
    unhealthy: ['gpt-5.6-luna'],
    qualified: ['opencode-zen-C/big-pickle'],
    disqualified: [],
    unreachable: ['gpt-5.6-luna'],
  };
  const resolved = resolveTargetModel(
    status,
    { model: 'gpt-5.6-luna', provider: 'codex' },
    withPreferred as never,
  );
  assert.equal(resolved.target?.model, 'opencode-zen-C/big-pickle');
});

test('sin modelos gratuitos, el substrate cloud de suscripción va antes que el local', () => {
  const withSubstrate = {
    models: {
      ...registry.models,
      'gpt-5.6-luna': {
        capabilities: ['code', 'chat', 'reasoning', 'tools'],
        tier: 'subscription',
        costPer1kTokens: { input: 0, output: 0 },
      },
    },
    routingRules: {
      orchestrator: { primary: 'opencode-zen-C/big-pickle' },
      subagents: { default: 'opencode-zen-C/big-pickle' },
    },
  };
  const status = {
    healthy: ['ollama/qwen3-14b-32k'],
    unhealthy: [],
    qualified: [],
    disqualified: ['opencode-zen-C/big-pickle', 'opencode-zen-C/mimo-v2.6-flash-free'],
  };
  const resolved = resolveTargetModel(
    status,
    { model: 'opencode-zen-C/big-pickle', provider: 'opencode-zen-C' },
    withSubstrate as never,
  );
  assert.equal(resolved.target?.model, 'gpt-5.6-luna');
});
