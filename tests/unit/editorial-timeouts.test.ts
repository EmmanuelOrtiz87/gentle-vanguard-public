/**
 * editorial-timeouts.test.ts — política de timeouts por operación × modelo
 * (GB-20261120 S3). El cap fijo de 90 s explicaba la mayor parte del fallo
 * registrado de la ruta editorial (síntesis y revisión encadenadas).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { editorialTimeoutMs } from '../../src/agents/editorial-provider.js';
import { editorialDelegationTimeoutSeconds } from '../../src/orchestration/route-and-delegate.js';

test('síntesis recibe el presupuesto más generoso, nube y local', () => {
  assert.equal(editorialTimeoutMs('synthesis', 'gpt-5.6-sol'), 240_000);
  assert.equal(editorialTimeoutMs('synthesis', 'ollama/qwen3-14b-32k'), 300_000);
});

test('draft/rewrite/summary reciben presupuesto medio; lo menor queda en 90s', () => {
  assert.equal(editorialTimeoutMs('draft', 'gpt-5.6-sol'), 150_000);
  assert.equal(editorialTimeoutMs('rewrite', 'ollama/qwen3-14b-32k'), 180_000);
  assert.equal(editorialTimeoutMs('summary', 'gpt-5.6-sol'), 150_000);
  assert.equal(editorialTimeoutMs('translation', 'gpt-5.6-sol'), 90_000);
});

test('EDITORIAL_TIMEOUT_MS sobreescritura break-glass', () => {
  process.env.EDITORIAL_TIMEOUT_MS = '5000';
  try {
    assert.equal(editorialTimeoutMs('synthesis', 'gpt-5.6-sol'), 5000);
  } finally {
    delete process.env.EDITORIAL_TIMEOUT_MS;
  }
});

test('el timeout de delegación editorial cubre generación + revisión + margen', () => {
  // síntesis local: 2 × 300s + 30s de margen
  assert.equal(editorialDelegationTimeoutSeconds('synthesis'), 630);
  // operaciones medias: 2 × 180s + 30s
  assert.equal(editorialDelegationTimeoutSeconds('rewrite'), 390);
  // menores: 2 × 90s + 30s
  assert.equal(editorialDelegationTimeoutSeconds('transcription'), 210);
});
