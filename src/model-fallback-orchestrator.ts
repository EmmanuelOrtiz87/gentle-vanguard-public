#!/usr/bin/env node
/**
 * Model Fallback Orchestrator v1.0
 *
 * Sistema inteligente de fallback de modelos para subagentes.
 * Cuando un subagente falla por cuota agotada o modelo no disponible,
 * este sistema reasigna automáticamente el modelo del orquestador
 * y reintenta la operación.
 *
 * Uso:
 *   import { delegateWithFallback } from './model-fallback-orchestrator.js';
 *
 *   const result = await delegateWithFallback({
 *     agent: 'sdd-apply',
 *     task: 'implement feature',
 *     context: 'optional context',
 *   });
 */

import { runNpxTsx } from './core/run-command';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// =============================================================================
// TYPES
// =============================================================================

interface DelegationRequest {
  agent: string;
  task: string;
  context?: string;
  /** Si se especifica, usa este modelo. Si no, hereda del orquestador */
  model?: string;
  temperature?: number;
  maxRetries?: number;
}

interface DelegationResult {
  success: boolean;
  output?: string;
  error?: string;
  duration: number;
  model: string;
  originalModel?: string;
  fallbackUsed: boolean;
  attempts: number;
  errors: string[];
}

interface ModelConfig {
  model: string;
  provider: string;
  tier: string;
  fallbackChain: string[];
  health: {
    status: 'available' | 'degraded' | 'unavailable' | 'unknown';
    consecutiveErrors: number;
  };
}

interface FallbackState {
  version: string;
  lastUpdated: string;
  activeModel: string;
  exhaustedModels: string[];
  agentModelOverrides: Record<string, string>;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const ROOT = process.cwd();
const STATE_FILE = join(ROOT, '.runtime', 'model-fallback-state.json');
const REGISTRY_PATH = join(ROOT, 'config', 'model-health-registry.json');
const LOG_FILE = join(ROOT, '.logs', 'model-fallback.log');

// Error patterns that trigger auto-fallback
const FALLBACK_TRIGGERS = [
  // Quota and credit errors
  'Free usage exceeded',
  'subscribe to Go',
  'quota exceeded',
  'credits exhausted',
  'rate limit exceeded',
  'insufficient_quota',
  '429 Too Many Requests',

  // Model unavailable errors
  'Model not found',
  'ProviderModelNotFoundError',
  'model_not_found',
  'model unavailable',

  // Auth errors (might indicate subscription issues)
  'AuthenticationError',
  'unauthorized',
  'invalid api key',
  'APIConnectionError',

  // Inheritance errors
  'inherit-from-session',
  'INHERITED_MODEL_CONFIG',
];

// Default model chain for fallback
const DEFAULT_FALLBACK_CHAIN = [
  'opencode/deepseek-v4-flash-free', // Primary: opencode free tier
  'claude-haiku-4-5', // Secondary: Claude via littellmott
];

// =============================================================================
// UTILITIES
// =============================================================================

function log(level: 'info' | 'warn' | 'error', message: string): void {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

  console.log(entry);

  try {
    const logDir = join(ROOT, '.logs');
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    writeFileSync(LOG_FILE, entry + '\n', { flag: 'a' });
  } catch {
    // Non-blocking
  }
}

function loadFallbackState(): FallbackState {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch {
    log('warn', 'Could not load fallback state, using defaults');
  }

  return {
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    activeModel: 'opencode/deepseek-v4-flash-free',
    exhaustedModels: [],
    agentModelOverrides: {},
  };
}

function saveFallbackState(state: FallbackState): void {
  try {
    const runtimeDir = join(ROOT, '.runtime');
    if (!existsSync(runtimeDir)) mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {
    log('warn', 'Could not save fallback state');
  }
}

function loadModelRegistry(): Record<string, ModelConfig> {
  try {
    if (existsSync(REGISTRY_PATH)) {
      const content = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
      return content.models || {};
    }
  } catch {
    log('warn', 'Could not load model registry');
  }
  return {};
}

function shouldTriggerFallback(error: string): boolean {
  const normalizedError = error.toLowerCase();
  return FALLBACK_TRIGGERS.some((trigger) => normalizedError.includes(trigger.toLowerCase()));
}

function getOrchestratorModel(): string {
  // Try to detect current orchestrator model
  const envModel = process.env.AGENT_MODEL || process.env.SESSION_MODEL;
  if (envModel) return envModel;

  // Try to read from active model file
  const activeModelFile = join(ROOT, '.runtime', 'model-active.json');
  try {
    if (existsSync(activeModelFile)) {
      const content = JSON.parse(readFileSync(activeModelFile, 'utf-8'));
      if (content.model) return content.model;
    }
  } catch {
    // Fall through
  }

  // Default to opencode/deepseek-v4-flash-free (available free tier)
  return 'opencode/deepseek-v4-flash-free';
}

// =============================================================================
// CORE DELEGATION WITH FALLBACK
// =============================================================================

/**
 * Execute a task with automatic model fallback
 */
export async function delegateWithFallback(request: DelegationRequest): Promise<DelegationResult> {
  const startTime = Date.now();
  const state = loadFallbackState();
  const registry = loadModelRegistry();

  const errors: string[] = [];
  let originalModel: string | undefined;
  let fallbackUsed = false;

  // Determine model chain to try
  const orchestratorModel = getOrchestratorModel();
  const requestedModel = request.model;

  log(
    'info',
    `Delegating ${request.agent}: orchestrator=${orchestratorModel}, requested=${requestedModel || 'inherit'}`,
  );

  // Build fallback chain
  const modelChain: string[] = [];

  // 1. Requested model (if specified)
  if (requestedModel && !state.exhaustedModels.includes(requestedModel)) {
    modelChain.push(requestedModel);
  }

  // 2. Orchestrator model (inheritance)
  if (
    !modelChain.includes(orchestratorModel) &&
    !state.exhaustedModels.includes(orchestratorModel)
  ) {
    modelChain.push(orchestratorModel);
  }

  // 3. Agent-specific fallback from registry
  const agentConfig = registry[request.agent];
  if (agentConfig?.fallbackChain) {
    for (const fbModel of agentConfig.fallbackChain) {
      if (!modelChain.includes(fbModel) && !state.exhaustedModels.includes(fbModel)) {
        modelChain.push(fbModel);
      }
    }
  }

  // 4. Default chain
  for (const fbModel of DEFAULT_FALLBACK_CHAIN) {
    if (!modelChain.includes(fbModel) && !state.exhaustedModels.includes(fbModel)) {
      modelChain.push(fbModel);
    }
  }

  log('info', `Fallback chain: ${modelChain.join(' → ')}`);

  // Try each model in chain
  for (let attempt = 0; attempt < modelChain.length; attempt++) {
    const model = modelChain[attempt];
    const isFallback = attempt > 0;

    if (isFallback) {
      fallbackUsed = true;
      log('info', `Retry attempt ${attempt + 1} with model: ${model}`);
    }

    try {
      const result = await executeWithModel(request, model);

      if (result.success) {
        // Success! Update state
        state.activeModel = model;
        state.lastUpdated = new Date().toISOString();

        // If we used a fallback, mark original as exhausted temporarily
        if (isFallback && originalModel) {
          if (!state.exhaustedModels.includes(originalModel)) {
            state.exhaustedModels.push(originalModel);
          }
        }

        // Save agent override for future calls
        if (fallbackUsed) {
          state.agentModelOverrides[request.agent] = model;
        }

        saveFallbackState(state);

        return {
          success: true,
          output: result.output,
          duration: Date.now() - startTime,
          model,
          originalModel,
          fallbackUsed,
          attempts: attempt + 1,
          errors,
        };
      }

      // Check if we should fallback
      if (shouldTriggerFallback(result.error || '')) {
        if (!originalModel) originalModel = model;
        errors.push(`Attempt ${attempt + 1} (${model}): ${result.error}`);
        log('warn', `Model ${model} exhausted: ${result.error}`);

        // Mark as exhausted
        if (!state.exhaustedModels.includes(model)) {
          state.exhaustedModels.push(model);
        }

        // Continue to next model in chain
        continue;
      }

      // Non-fallback error, return immediately
      return {
        success: false,
        error: result.error,
        duration: Date.now() - startTime,
        model,
        originalModel,
        fallbackUsed: isFallback,
        attempts: attempt + 1,
        errors: [...errors, result.error || 'Unknown error'],
      };
    } catch (error) {
      const errorStr = String(error);

      if (shouldTriggerFallback(errorStr)) {
        if (!originalModel) originalModel = model;
        errors.push(`Attempt ${attempt + 1} (${model}): ${errorStr}`);
        log('warn', `Model ${model} error: ${errorStr}`);

        // Mark as exhausted
        if (!state.exhaustedModels.includes(model)) {
          state.exhaustedModels.push(model);
        }

        // Continue to next model
        continue;
      }

      // Non-fallback error
      return {
        success: false,
        error: errorStr,
        duration: Date.now() - startTime,
        model,
        originalModel,
        fallbackUsed: isFallback,
        attempts: attempt + 1,
        errors: [...errors, errorStr],
      };
    }
  }

  // Exhausted all fallbacks
  const finalError = `All models exhausted after ${modelChain.length} attempts. Last error: ${errors[errors.length - 1]}`;
  log('error', finalError);

  return {
    success: false,
    error: finalError,
    duration: Date.now() - startTime,
    model: 'none',
    originalModel,
    fallbackUsed: true,
    attempts: modelChain.length,
    errors,
  };
}

/**
 * Execute task with specific model using agent-delegator
 */
async function executeWithModel(
  request: DelegationRequest,
  model: string,
): Promise<{ success: boolean; output?: string; error?: string }> {
  return new Promise((resolve) => {
    const delegatorPath = join(ROOT, 'src', 'agent-delegator.ts');

    // Build command with model override
    const args = ['--agent', request.agent, '--task', request.task, '--model', model];

    if (request.context) {
      args.push('--context', request.context);
    }

    if (request.temperature !== undefined) {
      args.push('--temperature', String(request.temperature));
    }

    // node --import tsx (hidden, shell-free). Raw spawn('npx.cmd') without a
    // shell fails with EINVAL on modern Node.
    const child = runNpxTsx(delegatorPath, args, {
      cwd: ROOT,
      env: {
        AGENT_MODEL: model,
        DELEGATION_ATTEMPT: '1',
        FORCE_MODEL: model,
      },
      timeout: 300000, // 5 minute timeout
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
        resolve({
          success: true,
          output: stdout.trim(),
        });
      } else {
        resolve({
          success: false,
          error: stderr.trim() || stdout.trim() || `Exit code: ${code}`,
        });
      }
    });

    child.on('error', (error) => {
      resolve({
        success: false,
        error: error.message,
      });
    });
  });
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
        console.error('Usage: delegate --agent <name> --task "<description>" [--context "..."]');
        process.exit(1);
      }

      const agent = args[agentIndex + 1];
      const task = args[taskIndex + 1];
      const contextIndex = args.indexOf('--context');
      const context = contextIndex > -1 ? args[contextIndex + 1] : undefined;

      void (async () => {
        const result = await delegateWithFallback({ agent, task, context });
        console.log('\n=== Delegation Result ===\n');
        console.log(JSON.stringify(result, null, 2));

        if (!result.success) {
          process.exit(1);
        }
      })();
      break;
    }

    case 'status': {
      const state = loadFallbackState();
      const registry = loadModelRegistry();

      console.log('\n=== Model Fallback Status ===\n');
      console.log(`Active Model: ${state.activeModel}`);
      console.log(`Exhausted Models: ${state.exhaustedModels.join(', ') || 'none'}`);
      console.log(`\nAgent Overrides:`);
      for (const [agent, model] of Object.entries(state.agentModelOverrides)) {
        console.log(`  ${agent}: ${model}`);
      }

      console.log(`\nRegistry Status:`);
      for (const [name, config] of Object.entries(registry)) {
        console.log(
          `  ${name}: ${config.health?.status || 'unknown'} (${config.health?.consecutiveErrors || 0} errors)`,
        );
      }

      break;
    }

    case 'reset': {
      const emptyState: FallbackState = {
        version: '1.0.0',
        lastUpdated: new Date().toISOString(),
        activeModel: 'opencode/deepseek-v4-flash-free',
        exhaustedModels: [],
        agentModelOverrides: {},
      };
      saveFallbackState(emptyState);
      console.log('Fallback state reset to defaults.');
      break;
    }

    default:
      console.log(`
Model Fallback Orchestrator v1.0

Commands:
  delegate --agent <name> --task "<desc>" [--context "..."]
    Delegate task with automatic model fallback

  status
    Show current fallback state and model registry

  reset
    Reset fallback state to defaults

Environment Variables:
  AGENT_MODEL: Override model for delegation
  FORCE_MODEL: Force specific model (skip fallback chain)
`);
  }
}

// Run CLI if executed directly
import { pathToFileURL } from 'url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli();
}

// Exports
export { getOrchestratorModel, loadFallbackState, saveFallbackState, shouldTriggerFallback };
