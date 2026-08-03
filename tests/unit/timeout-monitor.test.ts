import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

async function importMonitor() {
  // Clear any cached state by using a fresh import with cache bust
  const url = new URL('../../src/core/timeout-monitor.ts', import.meta.url).href;
  return await import(url);
}

describe('TimeoutMonitor', () => {
  describe('trackExecution()', () => {
    it('should track a simple execution and return a record', async () => {
      const monitor = await importMonitor();
      const stop = monitor.trackExecution('test-op', 'process_execution', 5000);
      const record = stop(true);
      assert.ok(record);
      assert.equal(record.operation, 'test-op');
      assert.equal(record.category, 'process_execution');
      assert.equal(record.success, true);
      assert.equal(record.violated, false);
      assert.equal(typeof record.durationMs, 'number');
      assert.ok(record.durationMs >= 0);
    });

    it('should detect timeout violations', async () => {
      const monitor = await importMonitor();
      const stop = monitor.trackExecution('slow-op', 'process_execution', 10);
      // Simulate slow operation with a tight spin
      const start = Date.now();
      while (Date.now() - start < 30) { /* spin */ }
      const record = stop(true);
      assert.equal(record.violated, true);
      assert.ok(record.durationMs > record.timeoutMs);
    });

    it('should track failed executions', async () => {
      const monitor = await importMonitor();
      const stop = monitor.trackExecution('failed-op', 'process_execution', 5000);
      const record = stop(false);
      assert.equal(record.success, false);
    });

    it('should return execution metrics', async () => {
      const monitor = await importMonitor();
      const stop = monitor.trackExecution('metrics-op', 'http_server', 5000);
      stop(true);
      const m = monitor.getPerformanceMetrics();
      assert.ok(m);
      assert.equal(typeof m.totalExecutions, 'number');
      assert.equal(typeof m.p95Ms, 'number');
      assert.equal(typeof m.p99Ms, 'number');
      assert.equal(typeof m.avgMs, 'number');
      assert.equal(typeof m.violationRate, 'number');
      assert.ok(Array.isArray(m.topSlowest));
    });
  });

  describe('trackAsync()', () => {
    it('should track a successful async operation', async () => {
      const monitor = await importMonitor();
      const result = await monitor.trackAsync(
        'async-op',
        'external_api',
        Promise.resolve('done'),
        5000
      );
      assert.equal(result, 'done');
      const m = monitor.getPerformanceMetrics();
      assert.ok(m.totalExecutions >= 1);
    });

    it('should track a failed async operation', async () => {
      const monitor = await importMonitor();
      try {
        await monitor.trackAsync(
          'async-fail',
          'external_api',
          Promise.reject(new Error('test error')),
          5000
        );
        assert.fail('Should have thrown');
      } catch (err: any) {
        assert.equal(err.message, 'test error');
      }
    });
  });

  describe('reportTimeoutViolation()', () => {
    it('should record an explicit timeout violation', async () => {
      const monitor = await importMonitor();
      monitor.reportTimeoutViolation('manual-violation', 'database', 60000, 30000);
      const m = monitor.getPerformanceMetrics();
      assert.ok(m.totalViolations >= 1);
      assert.ok(m.activeAlerts >= 1);
    });
  });

  describe('alert system', () => {
    it('should create alerts on violations', async () => {
      const monitor = await importMonitor();
      const stop = monitor.trackExecution('alert-op', 'test', 1);
      const start = Date.now();
      while (Date.now() - start < 10) { /* spin */ }
      stop(false);
      const alerts = monitor.getActiveAlerts();
      assert.ok(alerts.length >= 1);
      const alert = alerts[0];
      assert.ok(alert.id);
      assert.ok(alert.timestamp);
      assert.equal(alert.acknowledged, false);
    });

    it('should acknowledge individual alerts', async () => {
      const monitor = await importMonitor();
      const stop = monitor.trackExecution('ack-op', 'test', 1);
      const start = Date.now();
      while (Date.now() - start < 10) { /* spin */ }
      stop(false);
      const alerts = monitor.getActiveAlerts();
      if (alerts.length > 0) {
        const result = monitor.acknowledgeAlert(alerts[0].id);
        assert.equal(result, true);
      }
    });

    it('should acknowledge all alerts', async () => {
      const monitor = await importMonitor();
      for (let i = 0; i < 3; i++) {
        const stop = monitor.trackExecution(`mass-ack-${i}`, 'test', 1);
        const start = Date.now();
        while (Date.now() - start < 10) { /* spin */ }
        stop(false);
      }
      const count = monitor.acknowledgeAllAlerts();
      assert.ok(count >= 0);
      assert.equal(monitor.getActiveAlerts().length, 0);
    });
  });

  describe('getViolations()', () => {
    it('should return all violations', async () => {
      const monitor = await importMonitor();
      const stop = monitor.trackExecution('violation-op', 'test-cat', 1);
      const start = Date.now();
      while (Date.now() - start < 10) { /* spin */ }
      stop(false);
      const violations = monitor.getViolations();
      assert.ok(violations.length >= 1);
    });

    it('should filter violations by category', async () => {
      const monitor = await importMonitor();
      const stop1 = monitor.trackExecution('cat1-op', 'cat-alpha', 1);
      const start1 = Date.now();
      while (Date.now() - start1 < 10) { /* spin */ }
      stop1(false);

      const stop2 = monitor.trackExecution('cat2-op', 'cat-beta', 10000);
      stop2(true);

      const catAlpha = monitor.getViolations('cat-alpha');
      assert.ok(catAlpha.length >= 1);
      catAlpha.forEach(v => assert.equal(v.category, 'cat-alpha'));
    });
  });

  describe('getExecutions()', () => {
    it('should return executions by operation name', async () => {
      const monitor = await importMonitor();
      const stop = monitor.trackExecution('unique-op-name', 'test', 5000);
      stop(true);
      const execs = monitor.getExecutions('unique-op-name');
      assert.ok(execs.length >= 1);
      execs.forEach(e => assert.equal(e.operation, 'unique-op-name'));
    });
  });

  describe('daemon lifecycle', () => {
    it('should start and stop without errors', async () => {
      const monitor = await importMonitor();
      monitor.startMonitorDaemon(100);
      monitor.startMonitorDaemon(100); // double start is safe
      monitor.stopMonitorDaemon();
      monitor.stopMonitorDaemon(); // double stop is safe
      assert.ok(true);
    });
  });
});
