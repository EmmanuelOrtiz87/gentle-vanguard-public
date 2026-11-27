/**
 * editorial-registry-model.test.ts — el registro canónico (config/agents.json) es
 * la fuente de verdad del modelo editorial.
 *
 * Canon 2026-11-26: la ruta usa los mismos modelos cloud que el orquestador. El
 * pin a `gpt-5.6-luna` por operación (rewrite) se retiró junto con el pin local:
 * el CLI de Codex colgaba y la ruta quedaba dependiendo de un proveedor externo
 * que no es el del orquestador. El env sigue por encima de todo.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { registryFallbacks, registryModel } from '../../src/agents/editorial-agent.js';

const ROOT = resolve(import.meta.dirname, '..', '..');

type EditorialConfig = {
  model?: string;
  models?: Record<string, string>;
  fallbackModels?: string[];
};

function editorial(): EditorialConfig {
  const config = JSON.parse(readFileSync(resolve(ROOT, 'config/agents.json'), 'utf-8')) as {
    agents: Record<string, EditorialConfig>;
  };
  return config.agents['editorial-agent'];
}

test('el registro declara el modelo base del editorial y sus fallbacks cloud', () => {
  const entry = editorial();
  assert.ok(entry, 'editorial-agent registrado');
  assert.ok(entry.model, 'modelo base declarado');
  assert.ok(!entry.model.startsWith('ollama/'), 'el base no es un modelo local');
  const fallbacks = registryFallbacks();
  assert.deepEqual(fallbacks, entry.fallbackModels);
  assert.ok(fallbacks.length > 0, 'fallbacks declarados en el registro');
});

test('registryModel resuelve la operación con el modelo base del registro', () => {
  const entry = editorial();
  for (const operation of ['rewrite', 'summary', 'synthesis']) {
    assert.equal(
      registryModel(operation),
      entry.models?.[operation] ?? entry.model,
      `registryModel(${operation}) debe salir del registro`,
    );
  }
});

test('una operación sin override devuelve el modelo base del registro (no el hardcodeado)', () => {
  const synthesis = registryModel('synthesis');
  assert.ok(synthesis, 'registryModel no debe devolver undefined con el registro vivo');
});
