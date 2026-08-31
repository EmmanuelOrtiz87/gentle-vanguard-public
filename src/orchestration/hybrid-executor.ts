#!/usr/bin/env node
/**
 * Hybrid Executor — Cloud connector routing by cost/latency/load with circuit breaker.
 *
 * Migrated from: scripts/utilities/ops/CLOUD-CONNECTORS/hybrid-executor.ps1
 *
 * Supports automatic fallback between providers based on metrics.
 */

// ─── Types ─────────────────────────────────────────────────────────────

export interface ProviderInfo {
  provider: string;
  cost: number;
  latency: number;
  load: number;
  capacity: number;
  reliability: number;
}

export interface ProviderConfig {
  AWS_ESTIMATED_COST?: string;
  AZURE_ESTIMATED_COST?: string;
  AWS_ESTIMATED_LATENCY_MS?: string;
  AZURE_ESTIMATED_LATENCY_MS?: string;
  [key: string]: string | undefined;
}

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Get provider catalog from environment configuration.
 */
export function getProviderCatalog(env: ProviderConfig): ProviderInfo[] {
  const providers: ProviderInfo[] = [];

  // AWS
  if (env.AWS_ESTIMATED_COST || env.AWS_ESTIMATED_LATENCY_MS) {
    providers.push({
      provider: 'AWS',
      cost: parseFloat(env.AWS_ESTIMATED_COST || '0.00002'),
      latency: parseFloat(env.AWS_ESTIMATED_LATENCY_MS || '30'),
      load: 0.3,
      capacity: 1000,
      reliability: 0.999,
    });
  }

  // Azure
  if (env.AZURE_ESTIMATED_COST || env.AZURE_ESTIMATED_LATENCY_MS) {
    providers.push({
      provider: 'Azure',
      cost: parseFloat(env.AZURE_ESTIMATED_COST || '0.000025'),
      latency: parseFloat(env.AZURE_ESTIMATED_LATENCY_MS || '50'),
      load: 0.5,
      capacity: 800,
      reliability: 0.995,
    });
  }

  return providers;
}

/**
 * Select the best provider based on mode and strategy.
 */
export function selectProvider(
  providers: ProviderInfo[],
  _mode: string,
  strategy: 'cost' | 'latency' | 'load' | 'reliability' = 'cost',
): ProviderInfo {
  if (providers.length === 0) {
    throw new Error('No providers available');
  }

  // Sort by the chosen strategy and return the best one
  const sorted = [...providers].sort((a, b) => {
    switch (strategy) {
      case 'cost':
        return a.cost - b.cost;
      case 'latency':
        return a.latency - b.latency;
      case 'load':
        return a.load - b.load;
      case 'reliability':
        return b.reliability - a.reliability;
      default:
        return a.cost - b.cost;
    }
  });

  return sorted[0];
}

/**
 * Get provider fallback order anchored on the preferred provider.
 * @param selected - The selected/provider to anchor on
 * @param allProviders - Optional list of all available providers (defaults to ['AWS', 'Azure'])
 */
export function getProviderOrder(
  selected: ProviderInfo,
  allProviders: string[] = ['AWS', 'Azure'],
): string[] {
  const order: string[] = [selected.provider];

  for (const p of allProviders) {
    if (p !== selected.provider) {
      order.push(p);
    }
  }

  return order;
}

// ─── Circuit Breaker ───────────────────────────────────────────────────

interface CircuitState {
  failures: number;
  lastFailure: number | null;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
}

const circuits = new Map<string, CircuitState>();

const THRESHOLD = 5;
const TIMEOUT_MS = 30000;

export function isCircuitOpen(provider: string): boolean {
  const state = circuits.get(provider);
  if (!state || state.state === 'CLOSED') return false;
  if (state.state === 'OPEN') {
    if (state.lastFailure && Date.now() - state.lastFailure > TIMEOUT_MS) {
      circuits.set(provider, { ...state, state: 'HALF_OPEN' });
      return false;
    }
    return true;
  }
  // HALF_OPEN — allow one request
  circuits.set(provider, { ...state, state: 'OPEN' });
  return false;
}

export function recordFailure(provider: string): void {
  const state = circuits.get(provider) || { failures: 0, lastFailure: null, state: 'CLOSED' };
  state.failures++;
  state.lastFailure = Date.now();
  if (state.failures >= THRESHOLD) {
    state.state = 'OPEN';
  }
  circuits.set(provider, state);
}

export function recordSuccess(provider: string): void {
  circuits.set(provider, { failures: 0, lastFailure: null, state: 'CLOSED' });
}

// ─── CLI ───────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const action = args[0] || 'status';

  if (action === 'status') {
    console.log('Hybrid Executor — Available Providers: AWS, Azure, GCP');
    console.log('Mode: local-only');
    console.log('Circuit breaker: active');
    console.log('Routing: cost-priority');
    return;
  }

  console.log(`Unknown action: ${action}`);
  process.exit(1);
}

if (
  process.argv[1]?.endsWith('hybrid-executor.ts') ||
  process.argv[1]?.endsWith('hybrid-executor.js')
) {
  main();
}
