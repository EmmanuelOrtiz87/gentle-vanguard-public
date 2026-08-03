import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Dynamic import to allow module reload with different env
async function importConfig(env?: string) {
  if (env) process.env.NODE_ENV = env;
  else delete process.env.NODE_ENV;
  return await import('../../src/core/timeout-config');
}

describe('TimeoutConfig', () => {
  describe('loadTimeoutConfig()', () => {
    it('should load config without errors', async () => {
      const config = await importConfig();
      assert.ok(config.getTimeoutConfig);
      const cfg = config.getTimeoutConfig();
      assert.ok(cfg.version);
      assert.equal(typeof cfg.version, 'string');
    });

    it('should have process_execution defaults', async () => {
      const config = await importConfig();
      const pe = config.getProcessExecutionTimeouts();
      assert.ok(pe);
      assert.equal(typeof pe.script_default_ms, 'number');
      assert.equal(typeof pe.script_long_running_ms, 'number');
      assert.ok(pe.script_default_ms > 0);
    });

    it('should have http_server defaults', async () => {
      const config = await importConfig();
      const hs = config.getHttpServerTimeouts();
      assert.ok(hs);
      assert.equal(typeof hs.socket_timeout_ms, 'number');
      assert.equal(typeof hs.request_timeout_ms, 'number');
    });
  });

  describe('getTimeout()', () => {
    it('should return specific timeout by dot path', async () => {
      const config = await importConfig();
      const t = config.getTimeout('http_server.socket_timeout_ms');
      assert.equal(typeof t, 'number');
      assert.ok(t > 0);
    });

    it('should return fallback for unknown path', async () => {
      const config = await importConfig();
      const t = config.getTimeout('nonexistent.path', 42000);
      assert.equal(t, 42000);
    });

    it('should use default fallback when none provided', async () => {
      const config = await importConfig();
      const t = config.getTimeout('nonexistent.path');
      assert.equal(typeof t, 'number');
      assert.equal(t, 30000); // global.default_timeout_ms
    });
  });

  describe('getEffectiveProcessTimeout()', () => {
    it('should return timeout for each type', async () => {
      const config = await importConfig();
      const types = ['default', 'long_running', 'git', 'npm', 'pnpm', 'tsc', 'pipeline_step', 'health_check'] as const;
      for (const type of types) {
        const t = config.getEffectiveProcessTimeout(type);
        assert.equal(typeof t, 'number', `Type ${type} should return a number`);
        assert.ok(t > 0, `Type ${type} should return > 0, got ${t}`);
      }
    });
  });

  describe('getRetryConfig()', () => {
    it('should return retry config with all fields', async () => {
      const config = await importConfig();
      const r = config.getRetryConfig();
      assert.ok(r);
      assert.equal(typeof r.attempts, 'number');
      assert.equal(typeof r.delayMs, 'number');
      assert.equal(typeof r.backoffFactor, 'number');
      assert.ok(r.attempts > 0);
      assert.ok(r.delayMs > 0);
      assert.ok(r.backoffFactor > 0);
    });
  });

  describe('environment detection', () => {
    it('should respect setEnvironment()', async () => {
      const config = await importConfig();
      config.setEnvironment('production');
      assert.equal(config.getActiveEnvironment(), 'production');
      config.setEnvironment('development');
      assert.equal(config.getActiveEnvironment(), 'development');
    });
  });

  describe('category getters', () => {
    it('should return all required category configs', async () => {
      const config = await importConfig();
      assert.ok(config.getHttpServerTimeouts());
      assert.ok(config.getProcessExecutionTimeouts());
      assert.ok(config.getPipelineTimeouts());
      assert.ok(config.getSessionTimeouts());
      assert.ok(config.getHookTimeouts());
      assert.ok(config.getMonitoringTimeouts());
    });

    it('should handle optional categories', async () => {
      const config = await importConfig();
      const ws = config.getWebSocketTimeouts();
      const ext = config.getExternalApiTimeouts();
      const dash = config.getDashboardTimeouts();
      const db = config.getDatabaseTimeouts();
      const cache = config.getCacheTimeouts();
      const cb = config.getCircuitBreakerConfig();
      for (const val of [ws, ext, dash, db, cache, cb]) {
        if (val !== undefined) {
          assert.equal(typeof val, 'object');
          assert.ok(val !== null);
        }
      }
    });
  });
});
