#!/usr/bin/env node
/**
 * Unit Tests: compareCatalog — "stale" solo con evidencia
 *
 * Contratest del defecto medido el 2026-11-14:
 *
 *   $ npm run models:check
 *   stale config: 1 model(s) in your config do NOT exist upstream:
 *     ✗ qwen3-14b-32k
 *   $ ollama list
 *   qwen3-14b-32k:latest   6f45a8bcdebd   9.3 GB
 *
 * El modelo estaba instalado. Ollama publica `name:latest` para modelos sin tag
 * y la config los nombra sin tag, asi que la comparacion exacta de ids
 * inventaba deriva — y el doctor invita a un cleanup que borraria una config
 * que funciona. Dos reglas fijadas aca:
 *
 *   1. `:latest` se normaliza para comparar (se reporta el id configurado).
 *   2. Catalogo inaccesible (401/403/timeout) NO es evidencia de que falte un
 *      modelo: devuelve vacio, nunca "stale".
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  canProbeInference,
  compareCatalog,
  normalizeModelId,
} from '../../src/tools/opencode-model-doctor.ts';
import { syncProviderModels } from '../../src/tools/model-catalog-sync.ts';

test('normaliza `:latest` (el caso real qwen3-14b-32k)', () => {
  assert.equal(normalizeModelId('qwen3-14b-32k:latest'), 'qwen3-14b-32k');
  assert.equal(normalizeModelId('qwen3-14b-32k'), 'qwen3-14b-32k');
  // No toca ids que no son ollama ni sufijos que no son :latest
  assert.equal(normalizeModelId('big-pickle'), 'big-pickle');
  assert.equal(normalizeModelId('llama3:8b'), 'llama3:8b');
});

test('modelo instalado con :latest NO se reporta stale', () => {
  const { missingInUpstream } = compareCatalog(
    ['qwen3-14b-32k'],
    ['qwen3-14b-32k:latest', 'qwen3-14b-16k:latest'],
    true,
  );
  assert.deepEqual(missingInUpstream, []);
});

test('modelo configurado con :latest tampoco es extra upstream', () => {
  const { extrasInUpstream } = compareCatalog(['qwen3-14b-32k:latest'], ['qwen3-14b-32k'], true);
  assert.deepEqual(extrasInUpstream, []);
});

test('un id realmente inexistente SI se reporta, tal como se escribe', () => {
  const { missingInUpstream } = compareCatalog(['modelo-fantasma:latest'], ['otro:latest'], true);
  assert.deepEqual(missingInUpstream, ['modelo-fantasma:latest']);
});

test('catalogo inaccesible => cero stale (unverified != stale)', () => {
  const { missingInUpstream, extrasInUpstream } = compareCatalog(['a'], ['b'], false);
  assert.deepEqual(missingInUpstream, []);
  assert.deepEqual(extrasInUpstream, []);
});

test('catalogo vacio pero accesible => todo lo configurado es stale', () => {
  const { missingInUpstream } = compareCatalog(['a', 'b'], [], true);
  assert.deepEqual(missingInUpstream, ['a', 'b']);
});

test('inference probe permits local unauthenticated servers and requires remote credentials', () => {
  assert.equal(canProbeInference('http://127.0.0.1:11434/v1', false), true);
  assert.equal(canProbeInference('http://localhost:1234/v1', false), true);
  assert.equal(canProbeInference('http://[::1]:11434/v1', false), true);
  assert.equal(canProbeInference('https://localhost.example.test/v1', false), false);
  assert.equal(canProbeInference('https://provider.example.test/v1', true), true);
});

test('el sync NO poda un modelo local INSTALADO (misma regla que el doctor)', () => {
  // El doctor ya normaliza `:latest`; el sync comparaba a pelo y por eso
  // `models:sync --dry` proponia borrar `qwen3-14b-32k` (instalado, con
  // `tools`, medido con tool-calling). El que ESCRIBE tiene la misma regla.
  const provider = { models: { 'qwen3-14b-32k': { name: 'qwen3-14b-32k' } } };
  const result = syncProviderModels(
    provider,
    { catalogOK: true, upstreamCatalog: ['qwen3-14b-32k:latest', 'qwen3-14b-16k:latest'] },
    false,
  );
  assert.equal(result.removed, 0);
  assert.deepEqual(Object.keys(provider.models), ['qwen3-14b-32k']);
});

test('el sync SI poda un id que no existe upstream', () => {
  const provider = {
    models: { 'modelo-fantasma': { name: 'modelo-fantasma' }, ok: { name: 'ok' } },
  };
  const result = syncProviderModels(provider, { catalogOK: true, upstreamCatalog: ['ok'] }, false);
  assert.equal(result.removed, 1);
  assert.deepEqual(Object.keys(provider.models), ['ok']);
});

test('el sync con catalogo inaccesible no toca nada (unverified != stale)', () => {
  const provider = { models: { 'qwen3-14b-32k': { name: 'qwen3-14b-32k' } } };
  const result = syncProviderModels(provider, { catalogOK: false, upstreamCatalog: [] }, false);
  assert.equal(result.removed, 0);
  assert.deepEqual(Object.keys(provider.models), ['qwen3-14b-32k']);
});
