#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { runSyncShell } from './core/run-command.js';
import { loadConfigFile } from './core/config-loader.js';

interface CircuitState {
  state: string;
  opened_at: string;
  reset_seconds: number;
  failures: number;
}

interface OperationConfig {
  timeout_seconds?: number;
  retry_attempts?: number;
  retry_delay_ms?: number;
  retry_backoff_factor?: number;
  fallback_action?: string;
}

interface ResilienceConfig {
  timeouts?: Record<string, OperationConfig>;
  circuit_breakers?: Record<string, { failure_threshold: number; reset_seconds: number }>;
}

type FallbackAction = 'notify_user' | 'warn_skip' | 'warn_continue' | 'throw';

interface CliArgs {
  command: string;
  timeoutSeconds: number;
  retryAttempts: number;
  retryDelayMs: number;
  retryBackoffFactor: number;
  operationName: string;
  fallbackAction: FallbackAction;
  circuitBreakerName: string;
  passThru: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    command: '',
    timeoutSeconds: 30,
    retryAttempts: 3,
    retryDelayMs: 1000,
    retryBackoffFactor: 2.0,
    operationName: 'unknown',
    fallbackAction: 'warn_continue',
    circuitBreakerName: '',
    passThru: false,
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--command':
      case '-Command':
      case '-ScriptBlock':
        result.command = args[++i] || '';
        break;
      case '--timeout':
      case '-TimeoutSeconds':
        result.timeoutSeconds = parseInt(args[++i], 10) || 30;
        break;
      case '--retries':
      case '-RetryAttempts':
        result.retryAttempts = parseInt(args[++i], 10) || 3;
        break;
      case '--delay':
      case '-RetryDelayMs':
        result.retryDelayMs = parseInt(args[++i], 10) || 1000;
        break;
      case '--backoff':
      case '-RetryBackoffFactor':
        result.retryBackoffFactor = parseFloat(args[++i]) || 2.0;
        break;
      case '--name':
      case '-OperationName':
        result.operationName = args[++i] || 'unknown';
        break;
      case '--fallback':
      case '-FallbackAction':
        {
          const val = args[++i] || 'warn_continue';
          if (['notify_user', 'warn_skip', 'warn_continue', 'throw'].includes(val)) {
            result.fallbackAction = val as FallbackAction;
          }
        }
        break;
      case '--circuit':
      case '-CircuitBreakerName':
        result.circuitBreakerName = args[++i] || '';
        break;
      case '--passthru':
      case '-PassThru':
        result.passThru = true;
        break;
    }
  }
  return result;
}

const SCRIPT_DIR = path.dirname(pathToFileURL(process.argv[1]).pathname);
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const CONFIG_PATH = path.join(REPO_ROOT, 'config', 'resilience-config.json');
const CIRCUIT_DIR = path.join(REPO_ROOT, '.session', 'circuit-breakers');

function loadConfig(): ResilienceConfig {
  const result = loadConfigFile<ResilienceConfig>('resilience-config', {
    dir: path.dirname(CONFIG_PATH),
    validate: false,
  });
  if (result.warnings.length > 0) console.log('[RESILIENCE] No config loaded, using defaults');
  return result.data;
}

function getOperationConfig(name: string, config: ResilienceConfig): OperationConfig | null {
  const nameKey = name.replace(/-/g, '_');
  if (config.timeouts && config.timeouts[nameKey]) {
    return config.timeouts[nameKey];
  }
  return null;
}

function writeResLog(message: string, level: string, operationName: string): void {
  const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const logLine = `[${timestamp}] [${level}] [RESILIENCE:${operationName}] ${message}`;
  if (level === 'ERROR') {
    console.error(logLine);
  } else {
    console.log(logLine);
  }
}

function getCircuitState(name: string): string {
  if (!name) return 'closed';
  const stateFile = path.join(CIRCUIT_DIR, `${name}.json`);
  if (!fs.existsSync(stateFile)) return 'closed';
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as CircuitState;
    if (state.state === 'open') {
      const elapsed = (Date.now() - new Date(state.opened_at).getTime()) / 1000;
      if (elapsed >= state.reset_seconds) return 'half-open';
      return 'open';
    }
    return state.state;
  } catch {
    return 'closed';
  }
}

function setCircuitState(name: string, state: string, resetSeconds: number = 60): void {
  if (!name) return;
  if (!fs.existsSync(CIRCUIT_DIR)) {
    fs.mkdirSync(CIRCUIT_DIR, { recursive: true });
  }
  const stateFile = path.join(CIRCUIT_DIR, `${name}.json`);
  const data: CircuitState = {
    state,
    opened_at: new Date().toISOString(),
    reset_seconds: resetSeconds,
    failures: 0,
  };
  if (fs.existsSync(stateFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as CircuitState;
      data.failures = (existing.failures || 0) + 1;
    } catch {
      data.failures = 1;
    }
  }
  fs.writeFileSync(stateFile, JSON.stringify(data, null, 2), 'utf-8');
}

function resetCircuitState(name: string): void {
  if (!name) return;
  const stateFile = path.join(CIRCUIT_DIR, `${name}.json`);
  if (fs.existsSync(stateFile)) {
    fs.rmSync(stateFile, { force: true });
  }
}

function getUserSuggestion(fallback: string): string {
  const suggestions: Record<string, string[]> = {
    timeout: [
      'Reintentar con mas tiempo',
      'Omitir este paso',
      'Continuar con lo demas',
      'Cancelar operacion',
    ],
    generic: ['Reintentar', 'Omitir y continuar', 'Reportar falla'],
  };
  const key = fallback === 'timeout' ? 'timeout' : 'generic';
  return suggestions[key].join(', ');
}

function invokeWithTimeout(
  command: string,
  timeoutSec: number,
): { output: string | null; timedOut: boolean } {
  try {
    const result = runSyncShell(command, { timeout: timeoutSec * 1000, cwd: REPO_ROOT });
    const output = result.stdout;
    return { output, timedOut: false };
  } catch (e: unknown) {
    if (e instanceof Error && 'killed' in e && (e as { killed?: boolean }).killed) {
      return { output: null, timedOut: true };
    }
    return { output: null, timedOut: false };
  }
}

function invokeResilientWrapper(): unknown {
  const args = parseArgs();
  const config = loadConfig();
  const operationConfig = getOperationConfig(args.operationName, config);

  let timeoutSeconds = args.timeoutSeconds;
  let retryAttempts = args.retryAttempts;
  let retryDelayMs = args.retryDelayMs;
  let retryBackoffFactor = args.retryBackoffFactor;
  let fallbackAction = args.fallbackAction;

  if (operationConfig) {
    if (operationConfig.timeout_seconds !== undefined)
      timeoutSeconds = operationConfig.timeout_seconds;
    if (operationConfig.retry_attempts !== undefined)
      retryAttempts = operationConfig.retry_attempts;
    if (operationConfig.retry_delay_ms !== undefined) retryDelayMs = operationConfig.retry_delay_ms;
    if (operationConfig.retry_backoff_factor !== undefined)
      retryBackoffFactor = operationConfig.retry_backoff_factor;
    if (operationConfig.fallback_action !== undefined)
      fallbackAction = operationConfig.fallback_action as FallbackAction;
  }

  if (args.circuitBreakerName) {
    const circuitState = getCircuitState(args.circuitBreakerName);
    if (circuitState === 'open') {
      writeResLog(
        `Circuit breaker OPEN for '${args.circuitBreakerName}' — skipping`,
        'WARN',
        args.operationName,
      );
      const threshold = config.circuit_breakers?.[args.circuitBreakerName]?.failure_threshold ?? 5;
      const resetSec = config.circuit_breakers?.[args.circuitBreakerName]?.reset_seconds ?? 60;
      writeResLog(
        `Circuit will reset in ${resetSec}s (threshold: ${threshold} failures)`,
        'INFO',
        args.operationName,
      );
      return null;
    }
    if (circuitState === 'half-open') {
      writeResLog(
        `Circuit breaker HALF-OPEN for '${args.circuitBreakerName}' — allowing probe`,
        'WARN',
        args.operationName,
      );
    }
  }

  let lastError: string | null = null;
  let currentDelay = retryDelayMs;

  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    writeResLog(
      `Attempt ${attempt} of ${retryAttempts} (timeout: ${timeoutSeconds}s)`,
      'INFO',
      args.operationName,
    );
    if (!args.command) {
      writeResLog('No command provided', 'ERROR', args.operationName);
      return null;
    }

    const { timedOut } = invokeWithTimeout(args.command, timeoutSeconds);

    if (timedOut) {
      writeResLog(`TIMEOUT after ${timeoutSeconds}s`, 'WARN', args.operationName);
      lastError = `Operation timed out after ${timeoutSeconds}s`;
      if (attempt < retryAttempts) {
        writeResLog(`Retrying in ${currentDelay}ms...`, 'INFO', args.operationName);
        setTimeout(() => {}, currentDelay);
        currentDelay = Math.floor(currentDelay * retryBackoffFactor);
        continue;
      }
    } else {
      if (args.circuitBreakerName) resetCircuitState(args.circuitBreakerName);
      writeResLog(`SUCCESS on attempt ${attempt}`, 'OK', args.operationName);
      return args.passThru ? null : true;
    }
  }

  if (args.circuitBreakerName) {
    setCircuitState(args.circuitBreakerName, 'open');
    writeResLog(
      `Circuit breaker OPENED for '${args.circuitBreakerName}'`,
      'ERROR',
      args.operationName,
    );
  }

  writeResLog(`All ${retryAttempts} attempts failed: ${lastError}`, 'ERROR', args.operationName);

  switch (fallbackAction) {
    case 'notify_user':
      console.log(`\n============================================`);
      console.log(`  [STACK] Error en: ${args.operationName}`);
      console.log(`============================================`);
      console.log(`  Detalle: ${lastError}`);
      console.log(`  Intentos: ${retryAttempts}`);
      console.log(`  Timeout: ${timeoutSeconds}s`);
      console.log(
        `\n  Sugerencias: ${getUserSuggestion(lastError?.includes('timeout') ? 'timeout' : 'generic')}`,
      );
      console.log(`============================================\n`);
      break;
    case 'warn_skip':
      console.log(`[STACK] WARN: ${args.operationName} falló — omitiendo paso (${lastError})`);
      break;
    case 'warn_continue':
      console.log(`[STACK] WARN: ${args.operationName} falló — continuando (${lastError})`);
      break;
    case 'throw':
      throw new Error(
        `[STACK] ERROR: ${args.operationName} falló después de ${retryAttempts} intentos: ${lastError}`,
      );
  }

  if (args.passThru) return null;
  return false;
}

invokeResilientWrapper();
