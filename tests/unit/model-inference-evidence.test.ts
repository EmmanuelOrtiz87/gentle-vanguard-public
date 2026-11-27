import assert from 'node:assert/strict';
import test from 'node:test';
import { inferenceVerdictFor } from '../../src/ml/model-inference-evidence.js';

const now = Date.now();
const at = new Date(now - 60_000).toISOString();

const file = {
  version: 1,
  generatedAt: at,
  ttlSeconds: 900,
  targets: [],
  results: {
    'opencode-go-A/gpt-5.6-luna': {
      status: 'SUBSCRIPTION_REQUIRED' as const,
      responded: true,
      quota: true,
      checkedAt: at,
    },
    'opencode-zen-C/big-pickle': {
      status: 'USAGE_LIMIT' as const,
      responded: true,
      quota: true,
      checkedAt: at,
    },
  },
};

test('la evidencia de un provider no descalifica un modelo homónimo de otro provider', () => {
  // Regresión 2026-11-26: el substrate Codex (`gpt-5.6-luna` por suscripción
  // CLI) quedaba descalificado por la evidencia HTTP de opencode-go, que exige
  // suscripción Go — un provider distinto con el mismo ultimo segmento.
  assert.equal(inferenceVerdictFor(file, 'gpt-5.6-luna', now), 'UNKNOWN');
  assert.equal(inferenceVerdictFor(file, 'opencode-go/gpt-5.6-luna', now), 'FAIL');
  assert.equal(inferenceVerdictFor(file, 'opencode-zen-C/big-pickle', now), 'FAIL');
});
