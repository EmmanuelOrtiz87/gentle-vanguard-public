#!/usr/bin/env node
/**
 * GGA (Guardian Angel) - AI Provider Switcher
 * Implementación nativa inspirada por gentle-ai
 *
 * Proporciona switching automático de proveedores de IA cuando:
 * - Se agota la cuota ("Free usage exceeded")
 * - Hay errores de autenticación
 * - El modelo no responde (timeout)
 * - Rate limiting
 *
 * Uso:
 *   // En lugar de usar task() directamente, usar GGA::delegate()
 *   const result = await GuardianAngel.delegate({
 *     agent: 'sdd-apply',
 *     task: 'implement feature',
 *     fallback: ['opencode/deepseek-v4-flash-free', 'claude-haiku-4-5']
 *   });
 *
 *   // O con auto-detección de provider
 *   const result = await GuardianAngel.delegateWithAutoSwitch({
 *     agent: 'sdd-apply',
 *     task: 'implement feature'
 *   });
 */

import { runNpxTsx } from '../core/run-command';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// =============================================================================
// TYPES
// =============================================================================

interface GGADelegationOptions {
  agent: string;
  task: string;
  context?: string;
  /**
   * Modelo preferido (si no se especifica, auto-detecta)
   */
  preferredModel?: string;
  /**
   * Cadena de fallback explícita (opcional)
   */
  fallbackChain?: string[];
  /**
   * Número máximo de reintentos (default: 3)
   */
  maxRetries?: number;
  /**
   * Tiempo de espera por intento (ms)
   */
  timeout?: number;
}

interface GGADelegationResult {
  success: boolean;
  output: string;
  error?: string;
  model: string;
  originalModel?: string;
  duration: number;
  attempts: number;
  switchOccurred: boolean;
  exhaustedProviders: string[];
}

interface ProviderHealth {
  provider: string;
  model: string;
  status: 'healthy' | 'degraded' | 'unavailable';
  lastChecked: string;
  consecutiveErrors: number;
  quotaExhausted?: boolean;
}

interface GGAState {
  version: string;
  lastUpdated: string;
  currentProvider: string;
  health: Record<string, ProviderHealth>;
  exhaustedProviders: string[];
  switchHistory: {
    timestamp: string;
    from: string;
    to: string;
    reason: string;
  }[];
}

// =============================================================================
// CONSTANTS
// =============================================================================

const ROOT = process.cwd();
const GGA_STATE_FILE = join(ROOT, '.runtime', 'gga-state.json');
const GGA_LOG_FILE = join(ROOT, '.logs', 'gga.log');
// Provider health file (reserved for future use)
// const PROVIDER_HEALTH_FILE = join(ROOT, '.runtime', 'provider-health.json');

// Default providers in order of preference (absorbed from gentle-ai pattern)
const DEFAULT_PROVIDER_CHAIN = [
  { provider: 'opencode', model: 'deepseek-v4-flash-free', id: 'opencode/deepseek-v4-flash-free' },
  { provider: 'littellmott-nuevo', model: 'claude-haiku-4-5', id: 'claude-haiku-4-5' },
  { provider: 'ollama', model: 'qwen2.5-coder:14b', id: 'ollama/qwen2.5-coder:14b' },
];

// Error patterns that trigger provider switch (comprehensive list from gentle-ai)
const SWITCH_TRIGGERS = [
  // Quota/Credit errors
  { pattern: /Free usage exceeded/i, reason: 'quota_exhausted' },
  { pattern: /subscribe to go/i, reason: 'subscription_required' },
  { pattern: /quota exceeded/i, reason: 'quota_exhausted' },
  { pattern: /credits exhausted/i, reason: 'credits_exhausted' },
  { pattern: /rate limit/i, reason: 'rate_limited' },
  { pattern: /429 too many requests/i, reason: 'rate_limited' },
  { pattern: /insufficient_quota/i, reason: 'quota_exhausted' },
  { pattern: /daily limit exceeded/i, reason: 'daily_quota_exhausted' },
  { pattern: /API rate limit/i, reason: 'api_rate_limited' },

  // Model availability errors
  { pattern: /model not found/i, reason: 'model_unavailable' },
  { pattern: /provider.*not found/i, reason: 'provider_unavailable' },
  { pattern: /model unavailable/i, reason: 'model_unavailable' },
  { pattern: /unknown model/i, reason: 'model_unavailable' },

  // Auth errors
  { pattern: /authentication error/i, reason: 'auth_failed' },
  { pattern: /unauthorized/i, reason: 'auth_failed' },
  { pattern: /invalid api key/i, reason: 'auth_failed' },
  { pattern: /forbidden/i, reason: 'auth_forbidden' },

  // Connection errors
  { pattern: /api connection error/i, reason: 'connection_failed' },
  { pattern: /ECONNREFUSED/i, reason: 'connection_failed' },
  { pattern: /ENOTFOUND/i, reason: 'dns_failed' },
  { pattern: /timeout/i, reason: 'timeout' },
  { pattern: /deadline exceeded/i, reason: 'timeout' },
  { pattern: /request timed out/i, reason: 'timeout' },
  { pattern: /socket hang up/i, reason: 'socket_error' },

  // Inheritance errors
  { pattern: /inherit-from-session/i, reason: 'inheritance_failed' },
  { pattern: /INHERITED_MODEL_CONFIG/i, reason: 'config_inheritance_failed' },
];

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function log(level: 'info' | 'warn' | 'error' | 'debug', message: string): void {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] [${level.toUpperCase()}] [GGA] ${message}`;

  // Console output
  if (level === 'error') {
    console.error(entry);
  } else if (level === 'warn') {
    console.warn(entry);
  } else {
    console.log(entry);
  }

  // File logging
  try {
    const logDir = join(ROOT, '.logs');
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    writeFileSync(GGA_LOG_FILE, entry + '\n', { flag: 'a' });
  } catch {
    // Non-blocking
  }
}

function loadGGAState(): GGAState {
  try {
    if (existsSync(GGA_STATE_FILE)) {
      return JSON.parse(readFileSync(GGA_STATE_FILE, 'utf-8'));
    }
  } catch {
    log('warn', 'Could not load GGA state, using defaults');
  }

  return {
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    currentProvider: 'opencode/deepseek-v4-flash-free',
    health: {},
    exhaustedProviders: [],
    switchHistory: [],
  };
}

function saveGGAState(state: GGAState): void {
  try {
    const runtimeDir = join(ROOT, '.runtime');
    if (!existsSync(runtimeDir)) mkdirSync(runtimeDir, { recursive: true });
    state.lastUpdated = new Date().toISOString();
    writeFileSync(GGA_STATE_FILE, JSON.stringify(state, null, 2));
  } catch {
    log('warn', 'Could not save GGA state');
  }
}

function checkSwitchTrigger(error: string): { shouldSwitch: boolean; reason?: string } {
  const normalizedError = error.toLowerCase();

  for (const trigger of SWITCH_TRIGGERS) {
    if (trigger.pattern.test(normalizedError)) {
      return { shouldSwitch: true, reason: trigger.reason };
    }
  }

  return { shouldSwitch: false };
}

function getDetectedModel(): string {
  // Priority 1: Environment variable
  const envModel =
    process.env.GGA_MODEL ||
    process.env.ORCHESTRATOR_MODEL ||
    process.env.AGENT_MODEL ||
    process.env.FORCE_MODEL;

  if (envModel) {
    log('debug', `Detected model from env: ${envModel}`);
    return envModel;
  }

  // Priority 2: Active model file
  const activeModelFile = join(ROOT, '.runtime', 'model-active.json');
  try {
    if (existsSync(activeModelFile)) {
      const content = JSON.parse(readFileSync(activeModelFile, 'utf-8'));
      if (content.model) {
        log('debug', `Detected model from active file: ${content.model}`);
        return content.model;
      }
    }
  } catch {
    // Fall through
  }

  // Priority 3: Session context
  const sessionFile = join(ROOT, '.session', 'session-current.json');
  try {
    if (existsSync(sessionFile)) {
      const content = JSON.parse(readFileSync(sessionFile, 'utf-8'));
      if (content.model) {
        log('debug', `Detected model from session: ${content.model}`);
        return content.model;
      }
    }
  } catch {
    // Fall through
  }

  // Default
  log('debug', 'Using default model: opencode/deepseek-v4-flash-free');
  return 'opencode/deepseek-v4-flash-free';
}

function getFallbackChain(preferredModel?: string): string[] {
  const state = loadGGAState();
  const chain: string[] = [];

  // Add preferred model first if specified and not exhausted
  if (preferredModel && !state.exhaustedProviders.includes(preferredModel)) {
    chain.push(preferredModel);
  }

  // Add current detected model
  const detected = getDetectedModel();
  if (!chain.includes(detected) && !state.exhaustedProviders.includes(detected)) {
    chain.push(detected);
  }

  // Add default chain
  for (const provider of DEFAULT_PROVIDER_CHAIN) {
    if (!chain.includes(provider.id) && !state.exhaustedProviders.includes(provider.id)) {
      chain.push(provider.id);
    }
  }

  return chain;
}

// =============================================================================
// CORE DELEGATION WITH SWITCHING
// =============================================================================

/**
 * Execute with a specific provider
 */
async function executeWithProvider(
  options: GGADelegationOptions,
  provider: string,
  attempt: number,
): Promise<{ success: boolean; output?: string; error?: string }> {
  return new Promise((resolve) => {
    const delegatorPath = join(ROOT, 'src', 'orchestration', 'agent-delegator.ts');

    log('info', `[Attempt ${attempt}] Executing with provider: ${provider}`);

    // argv-array spawn via `node --import tsx`: no shell string, no quoting
    // hazards, hidden on Windows.
    const args = ['--agent', options.agent, '--task', options.task, '--model', provider];
    if (options.context) {
      args.push('--context', options.context);
    }

    const child = runNpxTsx(delegatorPath, args, {
      cwd: ROOT,
      env: {
        GGA_ACTIVE_PROVIDER: provider,
        GGA_ATTEMPT: String(attempt),
        FORCE_MODEL: provider,
        AGENT_MODEL: provider,
      },
      timeout: options.timeout || 300000,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, output: stdout.trim() });
      } else {
        resolve({
          success: false,
          error: stderr.trim() || stdout.trim() || `Process exited with code ${code}`,
        });
      }
    });

    child.on('error', (error) => {
      resolve({ success: false, error: error.message });
    });
  });
}

/**
 * Main delegation method with auto-switching
 */
export async function GuardianAngel(options: GGADelegationOptions): Promise<GGADelegationResult> {
  const startTime = Date.now();
  const state = loadGGAState();

  log('info', `=== GGA Delegation Started ===`);
  log('info', `Agent: ${options.agent}`);
  log('info', `Task: ${options.task.substring(0, 100)}${options.task.length > 100 ? '...' : ''}`);

  // Build fallback chain
  const chain = options.fallbackChain || getFallbackChain(options.preferredModel);

  if (chain.length === 0) {
    const error = 'All providers exhausted - no fallback chain available';
    log('error', error);
    return {
      success: false,
      output: '',
      error,
      model: 'none',
      duration: Date.now() - startTime,
      attempts: 0,
      switchOccurred: false,
      exhaustedProviders: state.exhaustedProviders,
    };
  }

  log('info', `Fallback chain: ${chain.join(' → ')}`);

  const originalProvider = chain[0];
  let switchOccurred = false;
  const exhaustedProviders: string[] = [...state.exhaustedProviders];
  let lastError: string | undefined;

  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i];
    const attempt = i + 1;

    if (i > 0) {
      switchOccurred = true;
      log('info', `Auto-switching to provider: ${provider} (attempt ${attempt}/${chain.length})`);
    }

    try {
      const result = await executeWithProvider(options, provider, attempt);

      if (result.success) {
        log('info', `✓ Success with provider: ${provider}`);

        // Record switch if occurred
        if (switchOccurred) {
          state.switchHistory.push({
            timestamp: new Date().toISOString(),
            from: originalProvider,
            to: provider,
            reason: lastError || 'auto-recovery',
          });
          state.currentProvider = provider;
        }

        // Mark exhausted providers if we switched
        if (switchOccurred) {
          for (let j = 0; j < i; j++) {
            if (!exhaustedProviders.includes(chain[j])) {
              exhaustedProviders.push(chain[j]);
            }
          }
          state.exhaustedProviders = exhaustedProviders;
        }

        saveGGAState(state);

        return {
          success: true,
          output: result.output || '',
          model: provider,
          originalModel: switchOccurred ? originalProvider : undefined,
          duration: Date.now() - startTime,
          attempts: attempt,
          switchOccurred,
          exhaustedProviders,
        };
      }

      // Check if should switch
      const switchCheck = checkSwitchTrigger(result.error || '');

      if (switchCheck.shouldSwitch && switchCheck.reason) {
        lastError = result.error;
        log('warn', `Provider ${provider} failed (${switchCheck.reason}): ${result.error}`);

        // Mark as exhausted
        if (!exhaustedProviders.includes(provider)) {
          exhaustedProviders.push(provider);
        }

        state.health[provider] = {
          provider: provider.split('/')[0] || 'unknown',
          model: provider,
          status: 'unavailable',
          lastChecked: new Date().toISOString(),
          consecutiveErrors: (state.health[provider]?.consecutiveErrors || 0) + 1,
          quotaExhausted:
            switchCheck.reason.includes('quota') || switchCheck.reason.includes('credit'),
        };

        continue; // Try next provider
      }

      // Non-switchable error
      log('error', `Non-recoverable error with ${provider}: ${result.error}`);
      return {
        success: false,
        output: '',
        error: result.error,
        model: provider,
        duration: Date.now() - startTime,
        attempts: attempt,
        switchOccurred: false,
        exhaustedProviders,
      };
    } catch (error) {
      const errorStr = String(error);
      lastError = errorStr;
      log('error', `Exception with ${provider}: ${errorStr}`);

      const switchCheck = checkSwitchTrigger(errorStr);

      if (switchCheck.shouldSwitch && i < chain.length - 1) {
        if (!exhaustedProviders.includes(provider)) {
          exhaustedProviders.push(provider);
        }
        continue;
      }

      return {
        success: false,
        output: '',
        error: errorStr,
        model: provider,
        duration: Date.now() - startTime,
        attempts: attempt,
        switchOccurred: i > 0,
        exhaustedProviders,
      };
    }
  }

  // All providers exhausted
  const finalError = `All providers exhausted. Last error: ${lastError || 'Unknown'}`;
  log('error', finalError);

  state.exhaustedProviders = exhaustedProviders;
  saveGGAState(state);

  return {
    success: false,
    output: '',
    error: finalError,
    model: 'none',
    duration: Date.now() - startTime,
    attempts: chain.length,
    switchOccurred: true,
    exhaustedProviders,
  };
}

// =============================================================================
// CONVENIENCE METHODS
// =============================================================================

/**
 * Quick delegation with auto-switching
 */
export const delegate = GuardianAngel;

// =============================================================================
// UTILITY EXPORTS (required for module interface)
// =============================================================================

/**
 * Check provider health status
 */
export function checkProviderHealth(providerName: string): ProviderHealth | null {
  const state = loadGGAState();
  return state.health[providerName] || null;
}

/**
 * Reset exhausted providers list
 */
export function resetProviders(): void {
  const state = loadGGAState();
  state.exhaustedProviders = [];
  state.health = {};
  state.lastUpdated = new Date().toISOString();
  saveGGAState(state);
  log('info', 'Provider health reset - all providers available');
}

/**
 * Get current provider
 */
export function getCurrentProvider(): string {
  const state = loadGGAState();
  return state.currentProvider;
}

/**
 * Get switch history
 */
export function getSwitchHistory(): GGAState['switchHistory'] {
  const state = loadGGAState();
  return state.switchHistory;
}

// =============================================================================
// CLI
// =============================================================================

function cli(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'delegate': {
      const agentIndex = args.indexOf('--agent');
      const taskIndex = args.indexOf('--task');

      if (agentIndex === -1 || taskIndex === -1) {
        console.error(
          'Usage: delegate --agent <name> --task "<description>" [--preferred-model <model>]',
        );
        process.exit(1);
      }

      const options: GGADelegationOptions = {
        agent: args[agentIndex + 1],
        task: args[taskIndex + 1],
      };

      const preferredIndex = args.indexOf('--preferred-model');
      if (preferredIndex > -1) {
        options.preferredModel = args[preferredIndex + 1];
      }

      const contextIndex = args.indexOf('--context');
      if (contextIndex > -1) {
        options.context = args[contextIndex + 1];
      }

      void (async () => {
        const result = await GuardianAngel(options);
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.success ? 0 : 1);
      })();
      break;
    }

    case 'status': {
      const state = loadGGAState();
      console.log('\n=== GGA Status ===\n');
      console.log(`Current Provider: ${state.currentProvider}`);
      console.log(
        `Exhausted Providers: ${state.exhaustedProviders.length > 0 ? state.exhaustedProviders.join(', ') : 'none'}`,
      );
      console.log(`\nHealth Status:`);
      for (const [provider, health] of Object.entries(state.health)) {
        const quotaStatus = health.quotaExhausted ? ' [QUOTA EXHAUSTED]' : '';
        console.log(
          `  ${provider}: ${health.status} (${health.consecutiveErrors} errors)${quotaStatus}`,
        );
      }
      console.log(`\nRecent Switches (last 5):`);
      state.switchHistory.slice(-5).forEach((switch_) => {
        console.log(`  ${switch_.timestamp}: ${switch_.from} → ${switch_.to} (${switch_.reason})`);
      });
      break;
    }

    case 'reset':
      resetProviders();
      console.log('Provider health reset complete.');
      break;

    case 'health': {
      const providerArg = args[1];
      if (!providerArg) {
        console.error('Usage: health <provider-id>');
        process.exit(1);
      }
      const health = checkProviderHealth(providerArg);
      if (health) {
        console.log(JSON.stringify(health, null, 2));
      } else {
        console.log(`No health data for provider: ${providerArg}`);
      }
      break;
    }

    default:
      console.log(`
Guardian Angel (GGA) - AI Provider Switcher v1.0

Commands:
  delegate --agent <name> --task "<task>" [--preferred-model <model>] [--context "..."]
    Execute task with automatic provider switching on failure

  status
    Show current provider, exhausted providers, health status, and switch history

  reset
    Reset exhausted providers list

  health <provider-id>
    Check health for specific provider

Examples:
  npx tsx src/tools/gga.ts delegate --agent sdd-apply --task "fix bug" --preferred-model opencode/deepseek-v4-flash-free
  npx tsx src/tools/gga.ts status
  npx tsx src/tools/gga.ts reset

Environment Variables:
  GGA_MODEL, ORCHESTRATOR_MODEL, AGENT_MODEL, FORCE_MODEL - Override detected model
  GGA_ACTIVE_PROVIDER - Set during delegation (internal use)

Features:
  ✓ Auto-detects quota/credit exhaustion ("Free usage exceeded")
  ✓ Switches to next available provider automatically
  ✓ Tracks provider health
  ✓ Persistent state across sessions
  ✓ Inspired by gentle-ai's GGA component
`);
  }
}

// Run CLI if executed directly
import { pathToFileURL } from 'url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli();
}

// Export everything for module use
// Note: Functions are exported above with 'export function'
export type { GGADelegationOptions, GGADelegationResult, ProviderHealth };
