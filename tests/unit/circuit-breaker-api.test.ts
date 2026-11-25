import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SRC = (name: string) => pathToFileURL(resolve(ROOT, 'src', name)).href;

// Unique test namespace to avoid cross-test contamination
const NS = `__test_${Date.now()}__`;

describe('circuit-breaker-api', () => {
  // The module derives its state file from process.cwd() at import time, so the
  // suite runs in a temp dir: the 672 `__test_*` keys left in the production
  // .runtime/circuit-breakers.json came from this test writing to the real file
  // and its cleanup using `require` inside ESM (always threw, silently caught).
  let tempDir: string;
  let previousCwd: string;
  before(() => {
    tempDir = mkdtempSync(resolve(tmpdir(), 'gv-circuit-api-'));
    previousCwd = process.cwd();
    process.chdir(tempDir);
  });

  after(() => {
    process.chdir(previousCwd);
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('source file exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src/resilience/circuit-breaker-api.ts')));
  });

  it('imports without error', async () => {
    const mod = await import(SRC('resilience/circuit-breaker-api.ts'));
    assert.ok(mod);
  });

  it('exports registerComponent', async () => {
    const mod = await import(SRC('resilience/circuit-breaker-api.ts'));
    assert.strictEqual(typeof mod.registerComponent, 'function');
  });

  it('isComponentHealthy returns true for unknown component (safe default)', async () => {
    const mod = await import(SRC('resilience/circuit-breaker-api.ts'));
    const result = mod.isComponentHealthy(`${NS}_unknown`);
    assert.strictEqual(result, true);
  });

  it('recordFailure+recordSuccess cycle works', async () => {
    const mod = await import(SRC('resilience/circuit-breaker-api.ts'));
    const comp = `${NS}_cycle`;
    mod.recordFailure(comp);
    mod.recordSuccess(comp);
    const state = mod.getCircuitState(comp);
    assert.ok(state);
    assert.strictEqual(state.failureCount, 0);
    assert.strictEqual(state.state, 'CLOSED');
  });

  it('state is confined to the temp dir, never .runtime of the repo', () => {
    assert.ok(existsSync(resolve(tempDir, '.runtime', 'circuit-breakers.json')));
  });
});
