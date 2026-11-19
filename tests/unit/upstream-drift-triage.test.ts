/**
 * BL-2026-11-16 — decisión del reminder de triage de drifts upstream.
 * El gap: detección automática + absorción manual sin seguimiento.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideReminder } from '../../src/ops/upstream-drift-triage.js';

test('sin corrida del watcher: no recuerda', () => {
  assert.equal(decideReminder(null, null).remind, false);
  assert.equal(decideReminder({}, null).remind, false);
});

test('sin drifts: no recuerda', () => {
  assert.equal(decideReminder({ checkedAt: '2026-11-16T12:00:00Z', drifts: 0 }, null).remind, false);
});

test('drifts sin triage previo: recuerda con conteo y fecha', () => {
  const d = decideReminder({ checkedAt: '2026-11-16T12:00:00Z', drifts: 7 }, null);
  assert.equal(d.remind, true);
  assert.ok(d.reason.includes('7 drift(s)'));
});

test('triage posterior a la corrida: no recuerda de nuevo', () => {
  const d = decideReminder(
    { checkedAt: '2026-11-16T12:00:00Z', drifts: 7 },
    { processedThrough: '2026-11-16T12:00:00Z' },
  );
  assert.equal(d.remind, false);
});

test('triage anterior a la corrida: vuelve a recordar (nuevo drift)', () => {
  const d = decideReminder(
    { checkedAt: '2026-11-23T08:00:00Z', drifts: 2 },
    { processedThrough: '2026-11-16T12:00:00Z' },
  );
  assert.equal(d.remind, true);
});
