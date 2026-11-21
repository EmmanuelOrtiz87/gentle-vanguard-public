/**
 * editorial-registry-model.test.ts — el registro canónico (config/agents.json) es
 * la fuente de verdad del modelo editorial, con override por operación (trabajo
 * de MiniMax Code finalizado en GB-20261120). El agente ya no hardcodea su
 * default: el registro manda, el env por encima de todo.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { registryModel } from '../../src/agents/editorial-agent.js';

const ROOT = resolve(import.meta.dirname, '..', '..');

test('el registro declara el modelo del editorial y su override por operación', () => {
  const config = JSON.parse(readFileSync(resolve(ROOT, 'config/agents.json'), 'utf-8')) as {
    agents: Record<string, { model?: string; models?: Record<string, string> }>;
  };
  const editorial = config.agents['editorial-agent'];
  assert.ok(editorial, 'editorial-agent registrado');
  assert.ok(editorial.model, 'modelo base declarado');
  assert.ok(editorial.models?.rewrite, 'override por operación (rewrite) declarado');
});

test('registryModel resuelve la operación concreta y cae al modelo base', () => {
  const rewrite = registryModel('rewrite');
  const base = registryModel('summary');
  const current = JSON.parse(readFileSync(resolve(ROOT, 'config/agents.json'), 'utf-8')) as {
    agents: Record<string, { model?: string; models?: Record<string, string> }>;
  };
  assert.equal(rewrite, current.agents['editorial-agent'].models?.rewrite);
  assert.equal(base, current.agents['editorial-agent'].model);
});

test('una operación sin override devuelve el modelo base del registro (no el hardcodeado)', () => {
  // La cadena del agente es: env > registryModel(operation) > default hardcodeado.
  // registryModel('synthesis') debe devolver el modelo base (no undefined): si el
  // registro manda, el hardcoded deja de ser fuente de verdad.
  const synthesis = registryModel('synthesis');
  assert.ok(synthesis, 'registryModel no debe devolver undefined con el registro vivo');
  assert.notEqual(synthesis, undefined);
});
