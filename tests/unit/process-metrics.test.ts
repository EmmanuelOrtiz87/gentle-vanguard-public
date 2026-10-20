import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readProcessMetrics,
  readProcessMetricsHistory,
} from '../../packages/shared/src/process-metrics.ts';

test('rechaza PID inválido sin consultar procesos', async () => {
  for (const pid of [0, -1, 1.5, Number.NaN]) {
    const metrics = await readProcessMetrics(pid);
    assert.equal(metrics.status, 'unavailable');
    assert.equal(metrics.memoryMb, null);
    assert.equal(metrics.cpuPercent, null);
    assert.deepEqual(metrics.history, []);
    assert.deepEqual(readProcessMetricsHistory(pid), []);
  }
});

test('mantiene el event loop receptivo mientras consulta métricas del proceso', async () => {
  const startedAt = performance.now();
  const timer = new Promise<void>((resolve) => setTimeout(resolve, 25));
  const metrics = readProcessMetrics(process.pid);

  await timer;
  assert.ok(performance.now() - startedAt < 500, 'process sampling blocked the event loop');
  assert.equal((await metrics).status, 'available');
});

test('lee métricas de un proceso disponible y marca uno inexistente', async () => {
  assert.equal((await readProcessMetrics(process.pid)).status, 'available');
  assert.equal((await readProcessMetrics(2_147_483_647)).status, 'unavailable');
});
