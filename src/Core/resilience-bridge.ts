#!/usr/bin/env node
/**
 * resilience-bridge.ts — Bridge between resilience-config.json and centralized timeout-config
 *
 * Unifies retry, circuit breaker, and user notification config from resilience-config.json
 * WITH the timeout values from the centralized timeout-config.json, making timeout-config
 * the single source of truth for all timeout values.
 *
 * Usage:
 *   import { getResilienceConfig, getOperationTimeout } from './core/resilience-bridge';
 *   const timeout = getOperationTimeout('engram_operation');
 *   const retry = getRetrySettings('git_operation');
 */

import * as fs from 'fs';
import * as path from 'path';
import { ROOT } from './repo-root';
import { getTimeout, getCircuitBreakerConfig, getRetryConfig } from './timeout-config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResilienceOperation {
  timeout_seconds: number;
  retry_attempts: number;
  retry_delay_ms: number;
  retry_backoff_factor?: number;
  fallback_action: string;
  description: string;
}

export interface CircuitBreakerEntry {
  failure_threshold: number;
  reset_seconds: number;
  half_open_max_requests: number;
}

export interface UserNotificationConfig {
  format: string;
  prefix: string;
  include_suggestions: boolean;
  suggestions: Record<string, string[]>;
}

export interface ResilienceConfig {
  version: string;
  description: string;
  global: {
    default_retry_attempts: number;
    default_retry_delay_ms: number;
    default_retry_backoff_factor: number;
    circuit_breaker_failure_threshold: number;
    circuit_breaker_reset_seconds: number;
    user_notification_enabled: boolean;
  };
  timeouts: Record<string, ResilienceOperation>;
  circuit_breakers: Record<string, CircuitBreakerEntry>;
  user_notifications: UserNotificationConfig;
}

// ---------------------------------------------------------------------------
// Config mapping: resilience operation → timeout-config key
// ---------------------------------------------------------------------------

const OPERATION_TIMEOUT_MAP: Record<string, string> = {
  agent_verify: 'process_execution.script_long_running_ms',
  psscriptanalyzer: 'process_execution.script_long_running_ms',
  normative_audit: 'process_execution.pipeline_step_ms',
  engram_operation: 'external_api.engram_operation_ms',
  git_operation: 'process_execution.git_operation_ms',
  pester_tests: 'process_execution.script_long_running_ms',
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _resilienceConfig: ResilienceConfig | null = null;
let _loaded = false;

function getResilienceFilePath(): string {
  return path.resolve(ROOT, 'config', 'resilience-config.json');
}

function loadResilienceFile(): ResilienceConfig | null {
  const filePath = getResilienceFilePath();
  if (!fs.existsSync(filePath)) {
    console.warn('[RESILIENCE-BRIDGE] resilience-config.json not found');
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as ResilienceConfig;
  } catch (err) {
    console.warn('[RESILIENCE-BRIDGE] Failed to parse:', (err as Error).message);
    return null;
  }
}

function ensureLoaded(): void {
  if (!_loaded) {
    _resilienceConfig = loadResilienceFile();
    _loaded = true;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the effective timeout for a resilience operation.
 * Uses centralized timeout-config as source of truth, falls back to resilience-config.json.
 */
export function getOperationTimeout(operationName: string): number {
  const configKey = OPERATION_TIMEOUT_MAP[operationName];
  if (configKey) {
    const centralized = getTimeout(configKey);
    if (centralized > 0) return centralized;
  }

  // Fallback: read from resilience-config.json
  ensureLoaded();
  const op = _resilienceConfig?.timeouts?.[operationName];
  if (op?.timeout_seconds) return op.timeout_seconds * 1000;

  return 30000; // Hard fallback
}

/**
 * Get retry settings for an operation.
 * Combines global retry config from timeout-config with per-operation overrides.
 */
export function getRetrySettings(operationName: string): {
  attempts: number;
  delayMs: number;
  backoffFactor: number;
} {
  const globalRetry = getRetryConfig();

  ensureLoaded();
  const op = _resilienceConfig?.timeouts?.[operationName];
  if (op) {
    return {
      attempts: op.retry_attempts ?? globalRetry.attempts,
      delayMs: op.retry_delay_ms ?? globalRetry.delayMs,
      backoffFactor: op.retry_backoff_factor ?? globalRetry.backoffFactor,
    };
  }

  return globalRetry;
}

/**
 * Get the fallback action for an operation when it times out.
 */
export function getFallbackAction(operationName: string): string {
  ensureLoaded();
  return _resilienceConfig?.timeouts?.[operationName]?.fallback_action ?? 'warn_continue';
}

/**
 * Get circuit breaker configuration for a named circuit.
 * Prefers timeout-config (centralized) over resilience-config.json.
 */
export function getCircuitBreakerSettings(breakerName: string): CircuitBreakerEntry | null {
  // First check centralized timeout-config
  const centralizedCB = getCircuitBreakerConfig();
  if (centralizedCB && (centralizedCB as any)[breakerName]) {
    const entry = (centralizedCB as any)[breakerName];
    return {
      failure_threshold: entry.failure_threshold ?? 5,
      reset_seconds: entry.reset_seconds ?? 60,
      half_open_max_requests: entry.half_open_max_requests ?? 1,
    };
  }

  // Fallback to resilience-config.json
  ensureLoaded();
  const cb = _resilienceConfig?.circuit_breakers?.[breakerName];
  if (cb) {
    return {
      failure_threshold: cb.failure_threshold,
      reset_seconds: cb.reset_seconds,
      half_open_max_requests: cb.half_open_max_requests,
    };
  }

  return null;
}

/**
 * Get user notification configuration.
 */
export function getUserNotificationConfig(): UserNotificationConfig | null {
  ensureLoaded();
  if (_resilienceConfig?.user_notifications) {
    return _resilienceConfig.user_notifications;
  }
  return null;
}

/**
 * Get the complete merged resilience configuration.
 */
export function getResilienceConfig(): {
  timeoutConfig: Record<string, number>;
  retryConfig: Record<string, { attempts: number; delayMs: number; backoffFactor: number }>;
  circuitBreakers: Record<string, CircuitBreakerEntry | null>;
} {
  ensureLoaded();
  const operations = _resilienceConfig?.timeouts ?? {};

  const timeoutConfig: Record<string, number> = {};
  const retryConfig: Record<string, { attempts: number; delayMs: number; backoffFactor: number }> =
    {};

  for (const opName of Object.keys(operations)) {
    timeoutConfig[opName] = getOperationTimeout(opName);
    retryConfig[opName] = getRetrySettings(opName);
  }

  const circuitBreakers: Record<string, CircuitBreakerEntry | null> = {};
  const cbNames = _resilienceConfig?.circuit_breakers
    ? Object.keys(_resilienceConfig.circuit_breakers)
    : ['engram', 'git_remote', 'external_api'];

  for (const name of cbNames) {
    circuitBreakers[name] = getCircuitBreakerSettings(name);
  }

  return { timeoutConfig, retryConfig, circuitBreakers };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printResilienceStatus(): void {
  const config = getResilienceConfig();
  console.log(`\n\x1b[36m═══════════════════════════════════════\x1b[0m`);
  console.log(`  \x1b[1mResilience Configuration Bridge\x1b[0m`);
  console.log(`\x1b[36m═══════════════════════════════════════\x1b[0m`);

  console.log(`\n  \x1b[1mOperation Timeouts (from timeout-config)\x1b[0m`);
  for (const [op, timeout] of Object.entries(config.timeoutConfig)) {
    console.log(`  \x1b[33m${op.padEnd(25)}\x1b[0m ${timeout}ms`);
  }

  console.log(`\n  \x1b[1mRetry Settings\x1b[0m`);
  for (const [op, retry] of Object.entries(config.retryConfig)) {
    console.log(
      `  \x1b[33m${op.padEnd(25)}\x1b[0m ${retry.attempts} attempts, ${retry.delayMs}ms delay, ${retry.backoffFactor}x backoff`,
    );
  }

  console.log(`\n  \x1b[1mCircuit Breakers\x1b[0m`);
  for (const [name, cb] of Object.entries(config.circuitBreakers)) {
    if (cb) {
      console.log(
        `  \x1b[33m${name.padEnd(25)}\x1b[0m ${cb.failure_threshold} failures, ${cb.reset_seconds}s reset, ${cb.half_open_max_requests} half-open`,
      );
    } else {
      console.log(`  \x1b[33m${name.padEnd(25)}\x1b[0m \x1b[90mnot configured\x1b[0m`);
    }
  }
  console.log();
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith('resilience-bridge.ts') ||
    process.argv[1].endsWith('resilience-bridge.js'))
) {
  printResilienceStatus();
}
