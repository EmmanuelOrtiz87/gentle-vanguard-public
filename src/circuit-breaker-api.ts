#!/usr/bin/env node
/**
 * circuit-breaker-api.ts — API para estados de circuit breaker
 *
 * Permite a cualquier componente consultar el estado de salud del sistema
 * antes de intentar operaciones, previniendo fallos en cascada.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(process.cwd());
const CIRCUITS_FILE = join(ROOT, '.runtime', 'circuit-breakers.json');

export interface CircuitBreakerState {
  component: string;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failureCount: number;
  lastFailure: string | null;
  lastSuccess: string | null;
  threshold: number;
  timeoutMs: number;
  lastStateChange: string;
}

interface CircuitConfig {
  name: string;
  threshold?: number;
  timeoutMs?: number;
}

// ─── Store ────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLD = 5;
const DEFAULT_TIMEOUT = 30000;

function ensureFile(): void {
  const dir = join(ROOT, '.runtime');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(CIRCUITS_FILE)) writeFileSync(CIRCUITS_FILE, '{}', 'utf-8');
}

function loadCircuits(): Record<string, CircuitBreakerState> {
  ensureFile();
  return JSON.parse(readFileSync(CIRCUITS_FILE, 'utf-8'));
}

function saveCircuits(circuits: Record<string, CircuitBreakerState>): void {
  ensureFile();
  writeFileSync(CIRCUITS_FILE, JSON.stringify(circuits, null, 2), 'utf-8');
}

// ─── API ──────────────────────────────────────────────────────────────

export function registerComponent(config: CircuitConfig): void {
  const circuits = loadCircuits();
  if (!circuits[config.name]) {
    circuits[config.name] = {
      component: config.name,
      state: 'CLOSED',
      failureCount: 0,
      lastFailure: null,
      lastSuccess: null,
      threshold: config.threshold || DEFAULT_THRESHOLD,
      timeoutMs: config.timeoutMs || DEFAULT_TIMEOUT,
      lastStateChange: new Date().toISOString(),
    };
    saveCircuits(circuits);
  }
}

export function getCircuitState(component: string): CircuitBreakerState | null {
  const circuits = loadCircuits();
  return circuits[component] || null;
}

export function getAllCircuitStates(): CircuitBreakerState[] {
  return Object.values(loadCircuits());
}

export function isComponentHealthy(component: string): boolean {
  const state = getCircuitState(component);
  if (!state) return true; // Unknown = healthy
  if (state.state === 'OPEN') return false;
  if (state.state === 'HALF_OPEN') return true; // Allow trial
  return true;
}

export function recordSuccess(component: string): void {
  const circuits = loadCircuits();
  const state = circuits[component];
  if (!state) {
    registerComponent({ name: component });
    return recordSuccess(component);
  }

  state.failureCount = 0;
  state.lastSuccess = new Date().toISOString();
  if (state.state !== 'CLOSED') {
    state.state = 'CLOSED';
    state.lastStateChange = new Date().toISOString();
  }
  saveCircuits(circuits);
}

export function recordFailure(component: string): void {
  let circuits = loadCircuits();
  let state = circuits[component];
  if (!state) {
    registerComponent({ name: component });
    circuits = loadCircuits(); // Reload after registerComponent writes to disk
    state = circuits[component];
  }

  state.failureCount++;
  state.lastFailure = new Date().toISOString();

  if (state.failureCount >= state.threshold && state.state === 'CLOSED') {
    state.state = 'OPEN';
    state.lastStateChange = new Date().toISOString();
  } else if (state.state === 'HALF_OPEN') {
    state.state = 'OPEN';
    state.lastStateChange = new Date().toISOString();
  }

  saveCircuits(circuits);
}

export function resetCircuit(component: string): void {
  const circuits = loadCircuits();
  if (circuits[component]) {
    circuits[component] = {
      ...circuits[component],
      state: 'CLOSED',
      failureCount: 0,
      lastFailure: null,
      lastStateChange: new Date().toISOString(),
    };
    saveCircuits(circuits);
  }
}

export function checkAndResetStaleCircuits(): number {
  const circuits = loadCircuits();
  let reset = 0;

  for (const [name, state] of Object.entries(circuits)) {
    if (state.state === 'OPEN' && state.lastFailure) {
      const elapsed = Date.now() - new Date(state.lastFailure).getTime();
      if (elapsed > state.timeoutMs) {
        circuits[name].state = 'HALF_OPEN';
        circuits[name].lastStateChange = new Date().toISOString();
        reset++;
      }
    }
  }

  if (reset > 0) saveCircuits(circuits);
  return reset;
}

// ─── CLI ──────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const action = args[0];

  if (action === 'status') {
    const circuits = getAllCircuitStates();
    const openCount = circuits.filter((c) => c.state === 'OPEN').length;
    const healthyCount = circuits.filter((c) => c.state === 'CLOSED').length;

    console.log(
      JSON.stringify({
        total: circuits.length,
        healthy: healthyCount,
        open: openCount,
        halfOpen: circuits.length - healthyCount - openCount,
        circuits,
      }),
    );
  } else if (action === 'reset-stale') {
    const reset = checkAndResetStaleCircuits();
    console.log(JSON.stringify({ resetStale: reset }));
  } else if (action === 'register' && args[1]) {
    registerComponent({ name: args[1], threshold: parseInt(args[2]) || 5 });
    console.log(JSON.stringify({ registered: args[1] }));
  } else {
    console.log('Circuit Breaker API');
    console.log('  Commands: status, reset-stale, register <name> [threshold]');
  }
}

if (process.argv[1]?.includes('circuit-breaker-api')) main();
