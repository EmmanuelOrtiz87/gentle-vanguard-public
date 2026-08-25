import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const STATE_FILE = join(ROOT, '.runtime', 'circuit-breaker-v2', 'state.json');
const namespace = `__test_v2_${Date.now()}_`;
const stateNames: string[] = [];

const modulePromise = import('../../src/circuit-breaker-v2.ts');

function writeCircuit(name: string, overrides: Record<string, unknown> = {}): void {
  const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {};
  state[name] = {
    name,
    state: 'CLOSED',
    config: {
      name,
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 50,
      resetTimeout: 0,
      halfOpenMaxCalls: 1,
    },
    metrics: {
      totalCalls: 0,
      successCount: 0,
      failureCount: 0,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      lastCallTime: 0,
      lastFailureTime: 0,
      lastSuccessTime: 0,
    },
    openedAt: null,
    halfOpenCalls: 0,
    lastStateChange: Date.now(),
    ...overrides,
  };
  writeFileSync(STATE_FILE, JSON.stringify(state), 'utf8');
  stateNames.push(name);
}

function readCircuit(name: string): Record<string, any> {
  return JSON.parse(readFileSync(STATE_FILE, 'utf8'))[name];
}

before(async () => {
  await modulePromise;
});

after(() => {
  if (!existsSync(STATE_FILE)) return;
  const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  for (const name of stateNames) delete state[name];
  writeFileSync(STATE_FILE, JSON.stringify(state), 'utf8');
  if (Object.keys(state).length === 0) unlinkSync(STATE_FILE);
});

describe('circuit-breaker-v2 reliability', () => {
  it('aborts without recording a circuit failure', async () => {
    const name = `${namespace}abort`;
    writeCircuit(name);
    const controller = new AbortController();
    const { executeWithCircuit } = await modulePromise;
    const pending = executeWithCircuit(
      name,
      (signal) =>
        new Promise((_, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
      undefined,
      { signal: controller.signal },
    );
    controller.abort(new Error('cancelled by test'));
    await assert.rejects(pending, /cancelled by test/);
    assert.equal(readCircuit(name).metrics.failureCount, 0);
  });

  it('reserves only one half-open execution slot', async () => {
    const name = `${namespace}half_open`;
    writeCircuit(name, {
      state: 'OPEN',
      openedAt: Date.now() - 100,
    });
    const { executeWithCircuit } = await modulePromise;
    let release!: () => void;
    const first = executeWithCircuit(
      name,
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve('first');
        }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    const second = executeWithCircuit(
      name,
      async () => 'second',
      () => 'fallback',
    );
    assert.equal(await second, 'fallback');
    release();
    assert.equal(await first, 'first');
  });

  it('health check resolves when a socket does not respond', async () => {
    const { checkServiceHealth } = await modulePromise;
    const result = await checkServiceHealth('dashboard_ws');
    assert.equal(typeof result.healthy, 'boolean');
    assert.ok(result.latency >= 0);
  });
});
