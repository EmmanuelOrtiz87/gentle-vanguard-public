import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, isStatsStale } from './quality-gates-stats.js';

const gates = [
  { id: 'a', stage: 'pre-commit', enforced: true },
  { id: 'b', stage: 'ci', enforced: true },
  { id: 'c', stage: 'manual', enforced: false },
];

test('lastVerified no marca el bloque como stale al cambiar el dia', () => {
  const yesterday = computeStats(gates, '2.1.6', '2026-11-17');
  const today = computeStats(gates, '2.1.6', '2026-11-18');
  assert.equal(isStatsStale(yesterday, today), false);
});

test('un cambio real en los gates si marca stale', () => {
  const before = computeStats(gates, '2.1.6', '2026-11-18');
  const after = computeStats(
    [...gates, { id: 'd', stage: 'ci', enforced: true }],
    '2.1.6',
    '2026-11-18',
  );
  assert.equal(isStatsStale(before, after), true);
});
