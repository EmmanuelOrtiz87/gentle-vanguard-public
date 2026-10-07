import test from 'node:test';
import assert from 'node:assert/strict';
import { readProcessMetrics, readProcessMetricsHistory } from '../src/process-metrics.js';

test('returns an explicit unavailable state for invalid pids', () => {
  const metrics = readProcessMetrics(0);
  assert.equal(metrics.status, 'unavailable');
  assert.equal(metrics.memoryMb, null);
  assert.equal(metrics.cpuPercent, null);
});

test('reads real memory metrics for the current process', () => {
  const metrics = readProcessMetrics(process.pid);
  assert.equal(metrics.status, 'available');
  assert.ok((metrics.memoryMb ?? 0) > 0);
  assert.match(metrics.sampledAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(metrics.history.length >= 1);
  assert.equal(readProcessMetricsHistory(process.pid, 1).length, 1);
});
