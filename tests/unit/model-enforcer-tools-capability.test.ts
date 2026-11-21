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
