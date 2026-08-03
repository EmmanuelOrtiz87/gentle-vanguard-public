import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SRC = (name: string) => pathToFileURL(resolve(ROOT, 'src', name)).href;
const CIRCUITS_FILE = resolve(ROOT, '.runtime', 'circuit-breakers.json');

// Unique test namespace to avoid cross-test contamination
const NS = `__test_${Date.now()}__`;

describe('circuit-breaker-api', () => {
  // Cleanup after all tests
  after(() => {
    try {
      if (existsSync(CIRCUITS_FILE)) {
        const data = JSON.parse(require('fs').readFileSync(CIRCUITS_FILE, 'utf-8'));
        // Remove test entries
        for (const key of Object.keys(data)) {
          if (key.startsWith('__test_')) delete data[key];
        }
        require('fs').writeFileSync(CIRCUITS_FILE, JSON.stringify(data, null, 2), 'utf-8');
      }
    } catch { /* non-fatal */ }
  });

  it('source file exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src/circuit-breaker-api.ts')));
  });

  it('imports without error', async () => {
    const mod = await import(SRC('circuit-breaker-api.ts'));
    assert.ok(mod);
  });

  it('exports registerComponent', async () => {
    const mod = await import(SRC('circuit-breaker-api.ts'));
    assert.strictEqual(typeof mod.registerComponent, 'function');
  });

  it('isComponentHealthy returns true for unknown component (safe default)', async () => {
    const mod = await import(SRC('circuit-breaker-api.ts'));
    const result = mod.isComponentHealthy(`${NS}_unknown`);
    assert.strictEqual(result, true);
  });

  it('recordFailure+recordSuccess cycle works', async () => {
    const mod = await import(SRC('circuit-breaker-api.ts'));
    const comp = `${NS}_cycle`;
    mod.recordFailure(comp);
    mod.recordSuccess(comp);
    const state = mod.getCircuitState(comp);
    assert.ok(state);
    assert.strictEqual(state.failureCount, 0);
    assert.strictEqual(state.state, 'CLOSED');
  });
});
