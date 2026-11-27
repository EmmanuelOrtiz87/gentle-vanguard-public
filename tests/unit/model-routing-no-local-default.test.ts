/**
 * model-routing-no-local-default.test.ts — regresión 2026-11-26.
 *
 * El owner midió la ruta editorial yendo a `ollama/qwen3-14b-32k`, un local que
 * no está siempre activo: cada delegación dependía de levantar Ollama. La causa
 * no era un fallback legítimo sino un DEFAULT: el base del editorial estaba
 * pinneado a local y `routingRules` del health registry declaraba Ollama como
 * primario del orquestador.
 *
 * Invariante: ningún default de ruta es local. El local solo puede aparecer
 * como último recurso explícito de una cadena de fallback.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import {
  buildEditorialModelChain,
  registryFallbacks,
  registryModel,
} from '../../src/agents/editorial-agent.js';

const ROOT = resolve(import.meta.dirname, '..', '..');
const readJson = (path: string) => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'));

type HealthRegistry = {
  models: Record<string, { tier?: string; requiresLocal?: boolean }>;
  routingRules?: {
    orchestrator?: { primary?: string };
    subagents?: { default?: string };
  };
};

function isLocal(registry: HealthRegistry, model: string): boolean {
  const entry = registry.models[model];
  return entry?.tier === 'local' || entry?.requiresLocal === true || model.startsWith('ollama/');
}

test('el primario del orquestador y el default de subagentes no son locales', () => {
  const registry = readJson('config/model-health-registry.json') as HealthRegistry;
  const primary = registry.routingRules?.orchestrator?.primary;
  const subagentDefault = registry.routingRules?.subagents?.default;
  for (const model of [primary, subagentDefault]) {
    assert.ok(model, 'target de herencia declarado');
    assert.ok(registry.models[model], `${model} registrado en el health registry`);
    assert.equal(isLocal(registry, model), false, `${model} no puede ser el default de ruta`);
  }
});

test('ningún agente de agents.json pinea un modelo local como base', () => {
  const registry = readJson('config/model-health-registry.json') as HealthRegistry;
  const config = readJson('config/agents.json') as {
    agents: Record<string, { model?: string; fallbackModels?: string[] }>;
  };
  for (const [name, agent] of Object.entries(config.agents)) {
    assert.ok(agent.model, `${name} declara modelo base`);
    assert.equal(
      isLocal(registry, agent.model!),
      false,
      `${name} pinea un modelo local (${agent.model})`,
    );
  }
});

test('el editorial usa el canon cloud y deja el local solo como último recurso', () => {
  const config = readJson('config/agents.json') as {
    agents: Record<string, { model?: string; fallbackModels?: string[] }>;
  };
  const fallbacks = registryFallbacks();
  assert.deepEqual(fallbacks, config.agents['editorial-agent'].fallbackModels);
  assert.ok(fallbacks.length > 0, 'el editorial declara fallbacks explícitos');
  // Un local puede aparecer ÚNICAMENTE como último recurso de la cadena.
  fallbacks.forEach((model, index) => {
    if (model.startsWith('ollama/')) {
      assert.equal(index, fallbacks.length - 1, `local ${model} solo puede ser el último fallback`);
    }
  });
  const base = registryModel('summary');
  assert.ok(base && !base.startsWith('ollama/'), 'el base del editorial ya no es local');
});

test('la cadena del editorial deduplica y respeta el orden preferido → base → fallbacks', () => {
  assert.deepEqual(buildEditorialModelChain('a', ['b', 'c']), ['a', 'b', 'c']);
  assert.deepEqual(buildEditorialModelChain('b', ['a', 'b']), ['b', 'a']);
  assert.deepEqual(buildEditorialModelChain('a', ['a']), ['a']);
  assert.deepEqual(buildEditorialModelChain('a', []), ['a']);
});
