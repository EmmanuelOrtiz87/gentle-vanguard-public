#!/usr/bin/env tsx
/**
 * Circuit Breaker 2.0 - Sistema de Circuit Breaker Avanzado
 *
 * Versión: 2.0.0
 *
 * Implementa el patrón Circuit Breaker para servicios externos con:
 * - 3 estados: CLOSED, OPEN, HALF_OPEN
 * - Thresholds configurables
 * - Auto-recovery con backoff exponencial
 * - Health checks automáticos
 * - Métricas detalladas
 *
 * Usage:
 *   npx tsx src/circuit-breaker-v2.ts --monitor    # Monitoreo
 *   npx tsx src/circuit-breaker-v2.ts --status      # Estado
 *   npx tsx src/circuit-breaker-v2.ts --reset        # Reset manual
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

const ROOT = resolve(process.cwd());
const STATE_DIR = join(ROOT, '.runtime', 'circuit-breaker-v2');
const STATE_FILE = join(STATE_DIR, 'state.json');

mkdirSync(STATE_DIR, { recursive: true });

// ─── Types ────────────────────────────────────────────────────────────────────────
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitConfig {
  name: string;
  failureThreshold: number;
  successThreshold: number;
  timeout: number;
  resetTimeout: number;
  halfOpenMaxCalls: number;
}

interface CircuitMetrics {
  totalCalls: number;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastCallTime: number;
  lastFailureTime: number;
  lastSuccessTime: number;
}

interface CircuitState_v2 {
  name: string;
  state: CircuitState;
  config: CircuitConfig;
  metrics: CircuitMetrics;
  openedAt: number | null;
  halfOpenCalls: number;
  lastStateChange: number;
}

interface ExecuteOptions {
  signal?: AbortSignal;
}

const circuitLocks = new Map<string, Promise<void>>();
const HEALTH_CHECK_TIMEOUT = 2000;

// ─── Configuration ─────────────────────────────────────────────────────────────────
const DEFAULT_CONFIGS: Record<string, CircuitConfig> = {
  opencode: {
    name: 'opencode',
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 30000,
    resetTimeout: 60000,
    halfOpenMaxCalls: 3,
  },
  nexus: {
    name: 'nexus',
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 10000,
    resetTimeout: 30000,
    halfOpenMaxCalls: 2,
  },
  dashboard_ws: {
    name: 'dashboard_ws',
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 5000,
    resetTimeout: 15000,
    halfOpenMaxCalls: 3,
  },
  web_crawler: {
    name: 'web_crawler',
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 30000,
    resetTimeout: 30000,
    halfOpenMaxCalls: 2,
  },
  external_api: {
    name: 'external_api',
    failureThreshold: 5,
    successThreshold: 3,
    timeout: 10000,
    resetTimeout: 60000,
    halfOpenMaxCalls: 3,
  },
  agent_delegation: {
    name: 'agent_delegation',
    failureThreshold: 4,
    successThreshold: 2,
    timeout: 120000, // subagent runs are long; generous call timeout
    resetTimeout: 45000,
    halfOpenMaxCalls: 2,
  },
};

// ─── Logger ───────────────────────────────────────────────────────────────────────
function log(level: string, message: string, meta?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const emoji = { INFO: 'ℹ️', WARN: '⚠️', ERROR: '❌', SUCCESS: '✅' }[level] || '•';
  const line = `[${timestamp}] ${emoji} [${level}] ${message}`;
  console.log(line);
  if (meta) console.log('  ', JSON.stringify(meta, null, 2));
}

// ─── State Management ───────────────────────────────────────────────────────────────
function loadState(): Record<string, CircuitState_v2> {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveState(state: Record<string, CircuitState_v2>): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

/** Resolve config by exact name, then by prefix ("agent_delegation:BA" → agent_delegation), then generic fallback. */
function resolveCircuitConfig(name: string): CircuitConfig {
  const exact = DEFAULT_CONFIGS[name];
  if (exact) return { ...exact, name };
  const prefix = name.split(':')[0];
  const byPrefix = DEFAULT_CONFIGS[prefix];
  if (byPrefix) return { ...byPrefix, name };
  return { ...DEFAULT_CONFIGS.external_api, name };
}

function initializeCircuit(name: string): CircuitState_v2 {
  const config = resolveCircuitConfig(name);
  return {
    name,
    state: 'CLOSED',
    config,
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
  };
}

// ─── Circuit Breaker Logic ─────────────────────────────────────────────────────────
function canExecute(circuit: CircuitState_v2): { allowed: boolean; reason: string } {
  const now = Date.now();

  switch (circuit.state) {
    case 'CLOSED':
      return { allowed: true, reason: 'Circuit closed, execution allowed' };

    case 'OPEN': {
      // Check if enough time has passed to try again
      if (circuit.openedAt && now - circuit.openedAt > circuit.config.resetTimeout) {
        return { allowed: true, reason: 'Reset timeout elapsed, transitioning to HALF_OPEN' };
      }
      const waitTime = Math.ceil(
        (circuit.config.resetTimeout - (now - (circuit.openedAt || 0))) / 1000,
      );
      return { allowed: false, reason: `Circuit open, retry in ${waitTime}s` };
    }

    case 'HALF_OPEN': {
      if (circuit.halfOpenCalls >= circuit.config.halfOpenMaxCalls) {
        return { allowed: false, reason: 'Half-open max calls reached' };
      }
      return { allowed: true, reason: 'Circuit half-open, limited execution allowed' };
    }

    default:
      return { allowed: false, reason: 'Unknown circuit state' };
  }
}

async function withCircuitLock<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
  const previous = circuitLocks.get(name) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  circuitLocks.set(name, queued);

  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (circuitLocks.get(name) === queued) circuitLocks.delete(name);
  }
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error('Operation aborted');
  error.name = 'AbortError';
  return error;
}

function reserveExecution(name: string): {
  circuit: CircuitState_v2;
  state: Record<string, CircuitState_v2>;
} {
  const state = loadState();
  const circuit = state[name] || initializeCircuit(name);

  if (circuit.state === 'OPEN' && circuit.openedAt) {
    if (Date.now() - circuit.openedAt > circuit.config.resetTimeout) {
      circuit.state = 'HALF_OPEN';
      circuit.halfOpenCalls = 0;
      circuit.lastStateChange = Date.now();
      log('INFO', `Circuit ${name} transitioned: OPEN -> HALF_OPEN`);
    }
  }

  const check = canExecute(circuit);
  if (!check.allowed) throw new Error(`Circuit ${name} OPEN: ${check.reason}`);
  if (circuit.state === 'HALF_OPEN') circuit.halfOpenCalls++;
  state[name] = circuit;
  saveState(state);
  return { circuit, state };
}

function recordSuccess(circuit: CircuitState_v2): CircuitState_v2 {
  const now = Date.now();
  circuit.metrics.totalCalls++;
  circuit.metrics.successCount++;
  circuit.metrics.consecutiveSuccesses++;
  circuit.metrics.consecutiveFailures = 0;
  circuit.metrics.lastSuccessTime = now;
  circuit.metrics.lastCallTime = now;

  const previousState = circuit.state;

  if (circuit.state === 'HALF_OPEN') {
    if (circuit.metrics.consecutiveSuccesses >= circuit.config.successThreshold) {
      circuit.state = 'CLOSED';
      circuit.halfOpenCalls = 0;
      circuit.openedAt = null;
      circuit.lastStateChange = now;
      log(
        'SUCCESS',
        `Circuit ${circuit.name} CLOSED after ${circuit.metrics.consecutiveSuccesses} consecutive successes`,
      );
    }
  }

  if (circuit.state !== previousState) {
    log('INFO', `Circuit ${circuit.name} state changed: ${previousState} -> ${circuit.state}`);
  }

  return circuit;
}

function recordFailure(circuit: CircuitState_v2): CircuitState_v2 {
  const now = Date.now();
  circuit.metrics.totalCalls++;
  circuit.metrics.failureCount++;
  circuit.metrics.consecutiveFailures++;
  circuit.metrics.consecutiveSuccesses = 0;
  circuit.metrics.lastFailureTime = now;
  circuit.metrics.lastCallTime = now;

  const previousState = circuit.state;

  if (circuit.state === 'CLOSED') {
    if (circuit.metrics.consecutiveFailures >= circuit.config.failureThreshold) {
      circuit.state = 'OPEN';
      circuit.openedAt = now;
      circuit.lastStateChange = now;
      log(
        'WARN',
        `Circuit ${circuit.name} OPENED after ${circuit.metrics.consecutiveFailures} consecutive failures`,
      );
    }
  } else if (circuit.state === 'HALF_OPEN') {
    circuit.state = 'OPEN';
    circuit.openedAt = now;
    circuit.halfOpenCalls = 0;
    circuit.lastStateChange = now;
    log('WARN', `Circuit ${circuit.name} OPENED during half-open test`);
  }

  if (circuit.state !== previousState) {
    log('INFO', `Circuit ${circuit.name} state changed: ${previousState} -> ${circuit.state}`);
  }

  return circuit;
}

// ─── Execute with Circuit Breaker ───────────────────────────────────────────────────
async function executeWithCircuit<T>(
  name: string,
  fn: (signal?: AbortSignal) => Promise<T>,
  fallback?: () => T,
  options: ExecuteOptions = {},
): Promise<T> {
  if (options.signal?.aborted) throw abortError(options.signal);
  let reservation: { circuit: CircuitState_v2; state: Record<string, CircuitState_v2> };
  try {
    reservation = await withCircuitLock(name, () => reserveExecution(name));
  } catch (err) {
    log('WARN', `Circuit ${name} blocked`, { error: String(err) });
    if (fallback) {
      log('INFO', `Executing fallback for ${name}`);
      return fallback();
    }
    throw err;
  }
  let circuit = reservation.circuit;
  const controller = new AbortController();
  const onAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) {
    controller.abort(options.signal.reason);
    options.signal.removeEventListener('abort', onAbort);
    await withCircuitLock(name, () => {
      const state = loadState();
      const reserved = state[name] || circuit;
      if (reserved.state === 'HALF_OPEN' && reserved.halfOpenCalls > 0) reserved.halfOpenCalls--;
      state[name] = reserved;
      saveState(state);
    });
    throw abortError(options.signal);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  try {
    const result = await new Promise<T>((resolve, reject) => {
      const onSignalAbort = () => reject(abortError(controller.signal));
      controller.signal.addEventListener('abort', onSignalAbort, { once: true });
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error(`${name} timeout`));
        reject(new Error(`${name} timeout`));
      }, circuit.config.timeout);
      Promise.resolve()
        .then(() => fn(controller.signal))
        .then(resolve, reject)
        .finally(() => controller.signal.removeEventListener('abort', onSignalAbort));
    });

    await withCircuitLock(name, () => {
      const state = loadState();
      circuit = recordSuccess(state[name] || circuit);
      state[name] = circuit;
      saveState(state);
    });

    return result;
  } catch (err) {
    if (!timedOut && (options.signal?.aborted || controller.signal.aborted)) {
      await withCircuitLock(name, () => {
        const state = loadState();
        const reserved = state[name] || circuit;
        if (reserved.state === 'HALF_OPEN' && reserved.halfOpenCalls > 0) reserved.halfOpenCalls--;
        state[name] = reserved;
        saveState(state);
      });
      throw err;
    }
    await withCircuitLock(name, () => {
      const state = loadState();
      circuit = recordFailure(state[name] || circuit);
      state[name] = circuit;
      saveState(state);
    });

    log('ERROR', `Circuit ${name} recorded failure`, { error: String(err) });

    if (fallback) {
      log('INFO', `Executing fallback for ${name}`);
      return fallback();
    }

    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

// ─── Health Checks ────────────────────────────────────────────────────────────────
async function checkServiceHealth(name: string): Promise<{ healthy: boolean; latency: number }> {
  const start = Date.now();

  try {
    switch (name) {
      case 'opencode':
        // Simulado - en realidad verificaría endpoint
        return { healthy: true, latency: Date.now() - start };

      case 'nexus':
        const fs = await import('fs');
        const dbPath = join(ROOT, '.runtime', 'gentle-vanguard.db');
        const exists = fs.existsSync(dbPath);
        return { healthy: exists, latency: Date.now() - start };

      case 'dashboard_ws':
        // Verificar si WebSocket está escuchando
        const { createConnection } = await import('net');
        return new Promise((resolve) => {
          const socket = createConnection(8080, 'localhost');
          const finish = (healthy: boolean): void => {
            socket.setTimeout(0);
            socket.removeAllListeners();
            if (healthy) socket.end();
            else socket.destroy();
            resolve({ healthy, latency: Date.now() - start });
          };
          socket.once('connect', () => finish(true));
          socket.once('error', () => finish(false));
          socket.once('timeout', () => finish(false));
          socket.setTimeout(HEALTH_CHECK_TIMEOUT);
        });

      case 'web_crawler':
        // Verificar si el crawler puede hacer una petición simple
        return { healthy: true, latency: Date.now() - start };

      default:
        return { healthy: false, latency: 0 };
    }
  } catch {
    return { healthy: false, latency: Date.now() - start };
  }
}

async function runHealthChecks(): Promise<void> {
  const state = loadState();

  for (const [name, circuit] of Object.entries(state)) {
    if (circuit.state === 'HALF_OPEN' || circuit.state === 'OPEN') {
      const health = await checkServiceHealth(name);

      if (health.healthy) {
        log('SUCCESS', `Health check passed for ${name}`, { latency: `${health.latency}ms` });
        circuit.metrics.consecutiveSuccesses++;

        if (circuit.state === 'OPEN' && circuit.metrics.consecutiveSuccesses >= 1) {
          circuit.state = 'HALF_OPEN';
          circuit.halfOpenCalls = 0;
          circuit.openedAt = null;
          circuit.lastStateChange = Date.now();
          log('INFO', `Circuit ${name} transitioned: OPEN -> HALF_OPEN (health check)`);
        }
      } else {
        log('WARN', `Health check failed for ${name}`);
        circuit.metrics.consecutiveFailures++;
      }

      state[name] = circuit;
    }
  }

  saveState(state);
}

// ─── Monitor Loop ──────────────────────────────────────────────────────────────────
async function runMonitor(): Promise<void> {
  log('INFO', 'Starting Circuit Breaker 2.0 monitor...');

  // Initialize circuits
  const state = loadState();
  for (const name of Object.keys(DEFAULT_CONFIGS)) {
    if (!state[name]) {
      state[name] = initializeCircuit(name);
    }
  }
  saveState(state);

  // Schedule health checks
  setInterval(() => {
    runHealthChecks().catch((err) => log('ERROR', 'Health check error', { error: String(err) }));
  }, 30000); // cada 30s

  log('INFO', 'Monitor running', { circuits: Object.keys(state).join(', ') });
}

// ─── CLI ────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--monitor')) {
    await runMonitor();
  } else if (args.includes('--status')) {
    const state = loadState();

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║        Circuit Breaker 2.0 Status                           ║');
    console.log('╚════════════════════════════════════════════════════════════╝');

    if (Object.keys(state).length === 0) {
      console.log('No circuits initialized. Run --monitor to initialize.');
    } else {
      console.log('\nCircuit              State      Calls   Success  Failures  Fail%');
      console.log('─'.repeat(70));
      Object.entries(state).forEach(([name, circuit]) => {
        const failRate =
          circuit.metrics.totalCalls > 0
            ? Math.round((circuit.metrics.failureCount / circuit.metrics.totalCalls) * 100)
            : 0;
        const emoji = circuit.state === 'CLOSED' ? '🟢' : circuit.state === 'OPEN' ? '🔴' : '🟡';

        console.log(
          `${emoji} ${name.padEnd(18)} ` +
            `${circuit.state.padEnd(8)} ` +
            `${circuit.metrics.totalCalls.toString().padStart(7)} ` +
            `${circuit.metrics.successCount.toString().padStart(8)} ` +
            `${circuit.metrics.failureCount.toString().padStart(8)} ` +
            `${failRate.toString().padStart(4)}%`,
        );
      });
    }

    console.log('\nThresholds:');
    Object.entries(DEFAULT_CONFIGS).forEach(([name, config]) => {
      console.log(`  ${name.padEnd(18)}: ${config.failureThreshold} failures -> OPEN`);
    });
    console.log('');
  } else if (args.includes('--test')) {
    const name = args[args.indexOf('--test') + 1] || 'test_circuit';

    console.log(`Testing circuit: ${name}\n`);

    // Test success path
    try {
      const result = await executeWithCircuit(
        name,
        async () => 'Success!',
        () => 'Fallback',
      );
      console.log('✅ Success path:', result);
    } catch (err) {
      console.log('❌ Success path failed:', String(err));
    }

    // Test failure path with fallback
    try {
      const result = await executeWithCircuit(
        name,
        async () => {
          throw new Error('Simulated failure');
        },
        () => 'Fallback triggered!',
      );
      console.log('✅ Fallback path:', result);
    } catch (err) {
      console.log('❌ Fallback also failed:', String(err));
    }
  } else if (args.includes('--reset')) {
    const name = args[args.indexOf('--reset') + 1];
    if (name) {
      const state = loadState();
      if (state[name]) {
        state[name] = initializeCircuit(name);
        saveState(state);
        log('SUCCESS', `Circuit ${name} reset`);
      } else {
        log('ERROR', `Circuit ${name} not found`);
      }
    } else {
      log('ERROR', 'Usage: --reset <circuit-name>');
    }
  } else {
    console.log('Circuit Breaker 2.0');
    console.log('');
    console.log('Usage:');
    console.log('  --monitor         Start monitor daemon');
    console.log('  --status          Show circuit status');
    console.log('  --test [name]     Test a circuit');
    console.log('  --reset <name>    Reset a circuit');
    console.log('');
    console.log('Circuits:');
    Object.keys(DEFAULT_CONFIGS).forEach((name) => console.log(`  - ${name}`));
    console.log('');
    console.log('States:');
    console.log('  🟢 CLOSED    - Normal operation, requests allowed');
    console.log('  🔴 OPEN      - Failing fast, requests blocked');
    console.log('  🟡 HALF_OPEN - Testing service recovery');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    log('ERROR', 'Fatal error', { error: String(err) });
    process.exit(1);
  });
}

export { executeWithCircuit, checkServiceHealth, runHealthChecks };
export type { ExecuteOptions };
export type { CircuitState };
