import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeSpace } from './analyze.js';

const NOW = Date.parse('2026-11-24T18:00:00Z');
const page = (lastModified: string | null) => ({ title: 'p', lastModified });

test('summarizeSpace separa actividad reciente, estancada y sin fecha', () => {
  const summary = summarizeSpace(
    [page('2026-11-20T00:00:00Z'), page('2026-09-01T00:00:00Z'), page(null), page('2023-01-01T00:00:00Z')],
    NOW,
  );
  assert.equal(summary.total, 4);
  assert.equal(summary.d30, 1);
  assert.equal(summary.staleOverYear, 2);
  assert.equal(summary.read, 'Activo');
});

test('summarizeSpace marca base envejecida cuando >60% supera el año', () => {
  const summary = summarizeSpace(
    [page('2026-11-20T00:00:00Z'), page('2023-01-01T00:00:00Z'), page('2023-06-01T00:00:00Z'), page(null)],
    NOW,
  );
  assert.equal(summary.staleOverYear, 3);
  assert.equal(summary.read, 'Activo sobre base envejecida');
});

test('summarizeSpace distingue espacio vacío y sin actividad reciente', () => {
  assert.equal(summarizeSpace([], NOW).read, 'Espacio vacío');
  assert.equal(summarizeSpace([page('2025-06-01T00:00:00Z')], NOW).read, 'Sin actividad reciente');
});
