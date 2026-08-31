#!/usr/bin/env node
/**
 * timeout-config.ts — Centralized Timeout Configuration Loader
 *
 * Loads, validates, and provides typed access to the centralized timeout
 * configuration at config/timeout-config.json with environment-aware overrides.
 *
 * Usage:
 *   import { getTimeout, getHttpServerTimeouts } from './core/timeout-config';
 *   const timeout = getTimeout('http_server.socket_timeout_ms', 120000);
 *
 * CLI:
 *   npx tsx src/core/timeout-config.ts              # Print all values
 *   npx tsx src/core/timeout-config.ts --env=ci      # Print CI overrides
 */

import * as fs from 'fs';
import * as path from 'path';
import { ROOT } from './repo-root';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GlobalConfig {
  default_timeout_ms: number;
  default_retry_attempts: number;
  default_retry_delay_ms: number;
  default_retry_backoff_factor: number;
  description?: string;
}

export interface HttpServerTimeouts {
  socket_timeout_ms: number;
  headers_timeout_ms: number;
  keep_alive_timeout_ms: number;
  request_timeout_ms: number;
  response_timeout_ms: number;
  shutdown_graceful_ms: number;
  shutdown_force_ms: number;
  description?: string;
}

export interface WebSocketTimeouts {
  ping_interval_ms: number;
  pong_timeout_ms: number;
  handshake_timeout_ms: number;
  reconnect_delay_base_ms: number;
  reconnect_delay_max_ms: number;
  reconnect_max_attempts: number;
  heartbeat_interval_ms: number;
  description?: string;
}

export interface ExternalApiTimeouts {
  http_client_default_ms: number;
  http_client_max_ms: number;
  openai_request_ms?: number;
  anthropic_request_ms?: number;
  openrouter_request_ms?: number;
  ollama_request_ms?: number;
  github_api_ms?: number;
  jira_api_ms?: number;
  confluence_api_ms?: number;
  engram_operation_ms?: number;
  mcp_bridge_start_ms?: number;
  mcp_request_ms?: number;
  description?: string;
}

export interface ProcessExecutionTimeouts {
  script_default_ms: number;
  script_long_running_ms: number;
  git_operation_ms?: number;
  npm_command_ms?: number;
  pnpm_command_ms?: number;
  tsc_typecheck_ms?: number;
  pipeline_step_ms?: number;
  health_check_ms?: number;
  watchdog_restart_delay_ms?: number;
  spawn_max_buffer_bytes?: number;
  description?: string;
}

export interface PipelineTimeouts {
  session_autostart_step_ms: number;
  lazy_step_ms?: number;
  phase_timeout_ms?: number;
  required_step_ms?: number;
  orphan_cleanup_max_age_hours?: number;
  session_expiry_hours?: number;
  description?: string;
}

export interface DashboardTimeouts {
  ws_reconnect_interval_ms: number;
  http_polling_interval_ms: number;
  metrics_refresh_ms?: number;
  port_scan_timeout_ms?: number;
  watchdog_check_interval_ms?: number;
  watchdog_max_restarts: number;
  vite_dev_timeout_ms?: number;
  description?: string;
}

export interface DatabaseTimeouts {
  engram_db_query_ms?: number;
  engram_db_backup_ms?: number;
  engram_db_compact_ms?: number;
  sqlite_busy_timeout_ms?: number;
  sqlite_wal_checkpoint_ms?: number;
  codegraph_sync_ms?: number;
  description?: string;
}

export interface CacheTimeouts {
  response_cache_ttl_ms?: number;
  session_cache_ttl_ms?: number;
  metrics_cache_ttl_ms?: number;
  dns_cache_ttl_ms?: number;
  description?: string;
}

export interface SessionTimeouts {
  idle_timeout_minutes: number;
  max_duration_minutes: number;
  auth_timeout_minutes?: number;
  token_budget_daily?: number;
  token_soft_limit_pct?: number;
  token_hard_limit_pct?: number;
  description?: string;
}

export interface HookTimeouts {
  pre_process_ms: number;
  post_session_ms?: number;
  pre_commit_ms: number;
  post_merge_ms?: number;
  execution_global_ms: number;
  description?: string;
}

export interface MonitoringConfig {
  health_check_interval_ms: number;
  metrics_collection_interval_ms: number;
  alert_cooldown_ms: number;
  log_rotation_interval_ms?: number;
  cleanup_interval_ms?: number;
  description?: string;
}

export interface CircuitBreakerEntry {
  failure_threshold: number;
  reset_seconds: number;
  half_open_max_requests: number;
  timeout_ms: number;
}

export interface CircuitBreakerConfig {
  engram?: CircuitBreakerEntry;
  git_remote?: CircuitBreakerEntry;
  external_api?: CircuitBreakerEntry;
  description?: string;
}

export interface EnvironmentOverride {
  extends: string[];
  overrides: Record<string, number>;
  description?: string;
}

export interface TimeoutConfig {
  $schema?: string;
  version: string;
  description: string;
  global: GlobalConfig;
  http_server?: HttpServerTimeouts;
  websocket?: WebSocketTimeouts;
  external_api?: ExternalApiTimeouts;
  process_execution?: ProcessExecutionTimeouts;
  pipeline?: PipelineTimeouts;
  dashboard?: DashboardTimeouts;
  database?: DatabaseTimeouts;
  cache?: CacheTimeouts;
  session?: SessionTimeouts;
  hooks?: HookTimeouts;
  monitoring?: MonitoringConfig;
  circuit_breaker?: CircuitBreakerConfig;
  environments?: Record<string, EnvironmentOverride>;
}

// ---------------------------------------------------------------------------
// Fallback defaults when config file is missing
// ---------------------------------------------------------------------------

export const FALLBACK_TIMEOUTS: TimeoutConfig = {
  version: '1.0.0',
  description: 'Fallback timeouts (config file not found)',
  global: {
    default_timeout_ms: 30000,
    default_retry_attempts: 3,
    default_retry_delay_ms: 1000,
    default_retry_backoff_factor: 2.0,
  },
  http_server: {
    socket_timeout_ms: 120000,
    headers_timeout_ms: 60000,
    keep_alive_timeout_ms: 5000,
    request_timeout_ms: 30000,
    response_timeout_ms: 30000,
    shutdown_graceful_ms: 10000,
    shutdown_force_ms: 5000,
  },
  process_execution: {
    script_default_ms: 30000,
    script_long_running_ms: 120000,
    git_operation_ms: 15000,
    npm_command_ms: 60000,
    pnpm_command_ms: 60000,
    tsc_typecheck_ms: 120000,
    pipeline_step_ms: 120000,
    health_check_ms: 15000,
    watchdog_restart_delay_ms: 5000,
    spawn_max_buffer_bytes: 1048576,
  },
  pipeline: {
    session_autostart_step_ms: 120000,
    lazy_step_ms: 300000,
    phase_timeout_ms: 600000,
  },
  monitoring: {
    health_check_interval_ms: 30000,
    metrics_collection_interval_ms: 60000,
    alert_cooldown_ms: 300000,
  },
  session: {
    idle_timeout_minutes: 60,
    max_duration_minutes: 480,
    token_budget_daily: 30000,
    token_soft_limit_pct: 70,
    token_hard_limit_pct: 90,
  },
  hooks: {
    pre_process_ms: 30000,
    pre_commit_ms: 45000,
    post_merge_ms: 60000,
    execution_global_ms: 300000,
  },
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _config: TimeoutConfig | null = null;
let _activeEnv: 'development' | 'production' | 'ci' = 'development';
let _loaded = false;

// ---------------------------------------------------------------------------
// Config path resolution
// ---------------------------------------------------------------------------

function getConfigPath(): string {
  return path.resolve(ROOT, 'config', 'timeout-config.json');
}

// ---------------------------------------------------------------------------
// Simple JSON validation (no external deps)
// ---------------------------------------------------------------------------

function validateWithSchema(config: TimeoutConfig): string[] {
  const errors: string[] = [];
  if (!config.version) errors.push('Missing required field: version');
  if (!config.description) errors.push('Missing required field: description');
  if (!config.global) errors.push('Missing required field: global');
  if (!config.global?.default_timeout_ms) errors.push('Missing global.default_timeout_ms');
  if (!config.global?.default_retry_attempts) errors.push('Missing global.default_retry_attempts');
  return errors;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

function loadConfigFromDisk(): TimeoutConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    console.warn(
      '[TIMEOUT-CONFIG] Config file not found at',
      configPath,
      '— using fallback defaults',
    );
    return { ...FALLBACK_TIMEOUTS };
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as TimeoutConfig;

    const errors = validateWithSchema(parsed);
    if (errors.length > 0) {
      console.warn('[TIMEOUT-CONFIG] Validation warnings:');
      for (const e of errors) console.warn(`  - ${e}`);
      console.warn('[TIMEOUT-CONFIG] Using fallback values for missing fields');
    }

    // Deep merge with fallback to ensure all fields exist
    return deepMerge(
      { ...FALLBACK_TIMEOUTS } as unknown as Record<string, unknown>,
      parsed as unknown as Record<string, unknown>,
    ) as unknown as TimeoutConfig;
  } catch (err) {
    console.warn('[TIMEOUT-CONFIG] Failed to parse config:', (err as Error).message);
    console.warn('[TIMEOUT-CONFIG] Using fallback defaults');
    return { ...FALLBACK_TIMEOUTS };
  }
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    if (key === '$schema') continue;
    const srcVal = source[key];
    if (srcVal && typeof srcVal === 'object' && !Array.isArray(srcVal)) {
      result[key] = deepMerge(
        result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])
          ? (result[key] as Record<string, unknown>)
          : {},
        srcVal as Record<string, unknown>,
      );
    } else if (srcVal !== undefined) {
      result[key] = srcVal;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ensure config is loaded. Call once at module init.
 */
export function loadTimeoutConfig(): TimeoutConfig {
  if (!_loaded) {
    _config = loadConfigFromDisk();
    _loaded = true;
  }
  return _config!;
}

/**
 * Get the full timeout configuration object.
 */
export function getTimeoutConfig(): TimeoutConfig {
  if (!_loaded) loadTimeoutConfig();
  return _config!;
}

/**
 * Get a specific timeout value by dot-notation path.
 *
 * @param path Dot-notation path, e.g. "http_server.socket_timeout_ms"
 * @param fallback Value to return if path not found
 */
export function getTimeout(path: string, fallback?: number): number {
  const cfg = getTimeoutConfig();
  const parts = path.split('.');
  let current: unknown = cfg;

  for (const part of parts) {
    if (current === undefined || current === null || typeof current !== 'object') {
      return fallback ?? FALLBACK_TIMEOUTS.global.default_timeout_ms;
    }
    current = (current as Record<string, unknown>)[part];
  }

  if (typeof current === 'number' && !isNaN(current)) {
    return resolveEnvOverride(path, current);
  }

  return fallback ?? FALLBACK_TIMEOUTS.global.default_timeout_ms;
}

/**
 * Resolve environment overrides for a given config path.
 */
function resolveEnvOverride(path: string, baseValue: number): number {
  const cfg = getTimeoutConfig();
  if (!cfg.environments || !cfg.environments[_activeEnv]) return baseValue;

  const env = cfg.environments[_activeEnv];
  if (env.overrides && env.overrides[path] !== undefined) {
    return env.overrides[path];
  }

  // Check extended environments
  for (const parent of env.extends) {
    if (parent === 'global') continue;
    const parentEnv = cfg.environments?.[parent as keyof typeof cfg.environments] as
      EnvironmentOverride | undefined;
    if (parentEnv?.overrides?.[path] !== undefined) {
      return parentEnv.overrides[path];
    }
  }

  return baseValue;
}

/**
 * Get the default timeout value from global config.
 */
export function getDefaultTimeout(): number {
  return getTimeoutConfig().global.default_timeout_ms;
}

/**
 * Get the retry configuration from global config.
 */
export function getRetryConfig(): { attempts: number; delayMs: number; backoffFactor: number } {
  const g = getTimeoutConfig().global;
  return {
    attempts: g.default_retry_attempts,
    delayMs: g.default_retry_delay_ms,
    backoffFactor: g.default_retry_backoff_factor,
  };
}

/**
 * Get active environment name.
 */
export function getActiveEnvironment(): string {
  return _activeEnv;
}

/**
 * Set active environment (triggers override resolution).
 */
export function setEnvironment(env: 'development' | 'production' | 'ci'): void {
  _activeEnv = env;
}

// ---------------------------------------------------------------------------
// Category getters
// ---------------------------------------------------------------------------

export function getHttpServerTimeouts(): HttpServerTimeouts {
  return getTimeoutConfig().http_server ?? FALLBACK_TIMEOUTS.http_server!;
}

export function getWebSocketTimeouts(): WebSocketTimeouts | undefined {
  return getTimeoutConfig().websocket;
}

export function getExternalApiTimeouts(): ExternalApiTimeouts | undefined {
  return getTimeoutConfig().external_api;
}

export function getProcessExecutionTimeouts(): ProcessExecutionTimeouts {
  return getTimeoutConfig().process_execution ?? FALLBACK_TIMEOUTS.process_execution!;
}

export function getPipelineTimeouts(): PipelineTimeouts {
  return getTimeoutConfig().pipeline ?? FALLBACK_TIMEOUTS.pipeline!;
}

export function getDashboardTimeouts(): DashboardTimeouts | undefined {
  return getTimeoutConfig().dashboard;
}

export function getDatabaseTimeouts(): DatabaseTimeouts | undefined {
  return getTimeoutConfig().database;
}

export function getCacheTimeouts(): CacheTimeouts | undefined {
  return getTimeoutConfig().cache;
}

export function getSessionTimeouts(): SessionTimeouts {
  return getTimeoutConfig().session ?? FALLBACK_TIMEOUTS.session!;
}

export function getHookTimeouts(): HookTimeouts {
  return getTimeoutConfig().hooks ?? FALLBACK_TIMEOUTS.hooks!;
}

export function getMonitoringTimeouts(): MonitoringConfig {
  return getTimeoutConfig().monitoring ?? FALLBACK_TIMEOUTS.monitoring!;
}

export function getCircuitBreakerConfig(): CircuitBreakerConfig | undefined {
  return getTimeoutConfig().circuit_breaker;
}

/**
 * Get effective timeout for a spawned process.
 * Wraps process_execution timeouts with env resolution.
 */
export function getEffectiveProcessTimeout(
  type:
    'default' | 'long_running' | 'git' | 'npm' | 'pnpm' | 'tsc' | 'pipeline_step' | 'health_check',
): number {
  const p = getProcessExecutionTimeouts();
  switch (type) {
    case 'default':
      return getTimeout('process_execution.script_default_ms', p.script_default_ms);
    case 'long_running':
      return getTimeout('process_execution.script_long_running_ms', p.script_long_running_ms);
    case 'git':
      return getTimeout('process_execution.git_operation_ms', p.git_operation_ms ?? 15000);
    case 'npm':
      return getTimeout('process_execution.npm_command_ms', p.npm_command_ms ?? 60000);
    case 'pnpm':
      return getTimeout('process_execution.pnpm_command_ms', p.pnpm_command_ms ?? 60000);
    case 'tsc':
      return getTimeout('process_execution.tsc_typecheck_ms', p.tsc_typecheck_ms ?? 120000);
    case 'pipeline_step':
      return getTimeout('process_execution.pipeline_step_ms', p.pipeline_step_ms ?? 120000);
    case 'health_check':
      return getTimeout('process_execution.health_check_ms', p.health_check_ms ?? 15000);
  }
}

// ---------------------------------------------------------------------------
// Auto-init
// ---------------------------------------------------------------------------

// Initialize on module load
loadTimeoutConfig();

// Detect environment from NODE_ENV or CLI args
if (process.env.NODE_ENV === 'production') _activeEnv = 'production';
else if (process.env.NODE_ENV === 'ci') _activeEnv = 'ci';

// Check CLI args for --env=
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg.startsWith('--env=')) {
    const val = arg.split('=')[1].toLowerCase();
    if (val === 'production' || val === 'ci') {
      _activeEnv = val;
    }
    break;
  }
  if (arg === '--env' && i + 1 < process.argv.length) {
    const val = process.argv[i + 1].toLowerCase();
    if (val === 'production' || val === 'ci') {
      _activeEnv = val;
    }
    i++;
    break;
  }
}

// ---------------------------------------------------------------------------
// CLI mode
// ---------------------------------------------------------------------------

function printTable(label: string, data: Record<string, any>) {
  console.log(`\n\x1b[36m=== ${label} ===\x1b[0m`);
  for (const [key, value] of Object.entries(data)) {
    if (key === 'description') continue;
    if (typeof value === 'object') {
      printTable(`${label} > ${key}`, value);
    } else {
      const suffix = typeof value === 'number' && key.endsWith('_ms') ? 'ms' : '';
      console.log(
        `  \x1b[33m${key}\x1b[0m = \x1b[32m${value}\x1b[0m${suffix ? ` \x1b[90m(${suffix})\x1b[0m` : ''}`,
      );
    }
  }
}

function cliMain() {
  const cfg = getTimeoutConfig();
  console.log(`\x1b[36m═══════════════════════════════════════\x1b[0m`);
  console.log(`  \x1b[1mCentralized Timeout Configuration\x1b[0m`);
  console.log(`  Version: ${cfg.version}`);
  console.log(`  Environment: \x1b[33m${_activeEnv}\x1b[0m`);
  console.log(`  ${cfg.description}`);
  console.log(`\x1b[36m═══════════════════════════════════════\x1b[0m`);

  const categories: [string, any][] = [
    ['Global', cfg.global],
    ['HTTP Server', cfg.http_server],
    ['WebSocket', cfg.websocket],
    ['External API', cfg.external_api],
    ['Process Execution', cfg.process_execution],
    ['Pipeline', cfg.pipeline],
    ['Dashboard', cfg.dashboard],
    ['Database', cfg.database],
    ['Cache', cfg.cache],
    ['Session', cfg.session],
    ['Hooks', cfg.hooks],
    ['Monitoring', cfg.monitoring],
    ['Circuit Breaker', cfg.circuit_breaker],
  ];

  for (const [label, data] of categories) {
    if (data) printTable(label, data);
  }

  // Show environment overrides if active
  if (cfg.environments && cfg.environments[_activeEnv]) {
    const env = cfg.environments[_activeEnv];
    console.log(`\n\x1b[36m=== Active Environment: ${_activeEnv} ===\x1b[0m`);
    console.log(`  ${env.description}`);
    if (env.overrides && Object.keys(env.overrides).length > 0) {
      console.log(`  \x1b[33mOverrides:\x1b[0m`);
      for (const [k, v] of Object.entries(env.overrides)) {
        console.log(`    ${k} → \x1b[32m${v}\x1b[0m`);
      }
    }
  }
}

// Auto-run if executed directly
if (
  process.argv[1] &&
  (process.argv[1].endsWith('timeout-config.ts') || process.argv[1].endsWith('timeout-config.js'))
) {
  cliMain();
}
