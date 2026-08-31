#!/usr/bin/env node
/**
 * Universal Task Wrapper with Model Fallback
 *
 * Drop-in replacement for OpenCode's task() function that provides:
 * - Automatic model fallback on quota/credit errors
 * - Dynamic model inheritance from orchestrator
 * - Chain-based retry with multiple models
 * - Caching of exhausted models
 *
 * Usage:
 *   import { taskWithFallback } from '../orchestration/universal-task-wrapper.js';
 *
 *   const result = await taskWithFallback({
 *     subagent_type: 'sdd-apply',
 *     prompt: 'implement feature',
 *     description: 'optional description'
 *   });
 */

import { runNpxTsx } from '../core/run-command';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// =============================================================================
// TYPES
// =============================================================================

interface TaskOptions {
  subagent_type: string;
  prompt: string;
  description?: string;
  context?: string;
  /**
   * Optional model override.
   * If not specified, inherits from orchestrator or uses fallback chain.
   */
  model?: string;
  /**
   * Maximum fallback attempts (default: 3)
   */
  maxFallbacks?: number;
}

interface TaskResult {
  success: boolean;
  output?: string;
  error?: string;
  model: string;
  duration: number;
  attempts: number;
  fallbackApplied: boolean;
  originalModel?: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const ROOT = process.cwd();
const STATE_FILE = join(ROOT, '.runtime', 'universal-task-state.json');
const LOG_FILE = join(ROOT, '.logs', 'universal-task.log');

// Fallback chain ordering (from most desirable to least)
const FALLBACK_CHAIN = [
  // Primary: Inherit from orchestrator (detected at runtime)
  null, // Placeholder - will be replaced with orchestrator model

  // Explicit fallbacks in order of preference
  'opencode/deepseek-v4-flash-free', // Free tier (opencode)
  'claude-haiku-4-5', // Balanced (littellmott)
  'ollama/qwen2.5-coder:14b', // Local (ollama)
];

// Error patterns that trigger fallback
const FALLBACK_ERRORS = [
  'Free usage exceeded',
  'subscribe to Go',
  'quota exceeded',
  'credits exhausted',
  'rate limit exceeded',
  'RateLimitError',
  '429 Too Many Requests',
  'insufficient_quota',
  'Model not found',
  'ProviderModelNotFoundError',
  'model_not_found',
  'AuthenticationError',
  'unauthorized',
  'invalid api key',
  'APIConnectionError',
  'ECONNREFUSED',
  'inherit-from-session',
  'INHERITED_MODEL_CONFIG',
  'timeout',
  'deadline exceeded',
];

// =============================================================================
// UTILITIES
// =============================================================================

function log(level: 'info' | 'warn' | 'error', message: string): void {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] [${level.toUpperCase()}] [task-wrapper] ${message}`;

  console.log(entry);

  try {
    const logDir = join(ROOT, '.logs');
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    writeFileSync(LOG_FILE, entry + '\n', { flag: 'a' });
  } catch {
    // Non-blocking
  }
}

interface FallbackState {
  exhaustedModels: string[];
  lastCheckedAt: string;
  agentModelOverrides: Record<string, string>;
}

function loadState(): FallbackState {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch {
    log('warn', 'Could not load state, using defaults');
  }

  return {
    exhaustedModels: [],
    lastCheckedAt: new Date().toISOString(),
    agentModelOverrides: {},
  };
}

function saveState(state: FallbackState): void {
  try {
    const runtimeDir = join(ROOT, '.runtime');
    if (!existsSync(runtimeDir)) mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {
    log('warn', 'Could not save state');
  }
}

function shouldFallback(error: string): boolean {
  const normalized = error.toLowerCase();
  return FALLBACK_ERRORS.some((pattern) => normalized.includes(pattern.toLowerCase()));
}

function getOrchestratorModel(): string | null {
  // Priority order for model detection:

  // 1. Environment variable (set by orchestrator or system)
  const envModel =
    process.env.ORCHESTRATOR_MODEL || process.env.SESSION_MODEL || process.env.AGENT_MODEL;
  if (envModel) return envModel;

  // 2. Active model file (maintained by session manager)
  const activeFile = join(ROOT, '.runtime', 'model-active.json');
  try {
    if (existsSync(activeFile)) {
      const content = JSON.parse(readFileSync(activeFile, 'utf-8'));
      if (content.model) return content.model;
    }
  } catch {
    // Fall through
  }

  // 3. Session context file
  const contextFile = join(ROOT, '.session', 'session-current.json');
  try {
    if (existsSync(contextFile)) {
      const content = JSON.parse(readFileSync(contextFile, 'utf-8'));
      if (content.model) return content.model;
    }
  } catch {
    // Fall through
  }

  // 4. Try to infer from current process (fallback)
  return null;
}

// =============================================================================
// CORE FUNCTION
// =============================================================================

/**
 * Execute task with automatic model fallback
 *
 * This function intercepts errors from subagent execution and automatically
 * retries with alternative models when the primary fails due to quota,
 * credits, or availability issues.
 */
export async function taskWithFallback(options: TaskOptions): Promise<TaskResult> {
  const startTime = Date.now();
  const state = loadState();

  // Determine model chain
  const orchestratorModel = getOrchestratorModel();
  const requestedModel = options.model;

  log('info', `Starting task delegation for agent: ${options.subagent_type}`);
  log('info', `  Orchestrator model: ${orchestratorModel || 'unknown'}`);
  log('info', `  Requested model: ${requestedModel || 'inherit'}`);

  // Build effective chain
  const modelChain: string[] = [];

  // Priority 1: Requested model
  if (requestedModel && !state.exhaustedModels.includes(requestedModel)) {
    modelChain.push(requestedModel);
  }

  // Priority 2: Orchestrator model (inheritance)
  if (
    orchestratorModel &&
    !modelChain.includes(orchestratorModel) &&
    !state.exhaustedModels.includes(orchestratorModel)
  ) {
    modelChain.push(orchestratorModel);
  }

  // Priority 3: Fallback chain
  for (const model of FALLBACK_CHAIN) {
    if (model === null) continue; // Skip placeholder
    if (!modelChain.includes(model) && !state.exhaustedModels.includes(model)) {
      modelChain.push(model);
    }
  }

  if (modelChain.length === 0) {
    return {
      success: false,
      error: 'All models exhausted - no available models in fallback chain',
      model: 'none',
      duration: Date.now() - startTime,
      attempts: 0,
      fallbackApplied: false,
    };
  }

  log('info', `Fallback chain: ${modelChain.join(' → ')}`);

  // Try each model
  const originalModel = modelChain[0];
  let lastError: string | undefined;

  for (let i = 0; i < modelChain.length; i++) {
    const model = modelChain[i];
    const isRetry = i > 0;

    if (isRetry) {
      log('info', `Retrying with fallback model: ${model} (attempt ${i + 1}/${modelChain.length})`);
    } else {
      log('info', `Attempting with model: ${model}`);
    }

    try {
      const result = await executeSubagent(options, model);

      if (result.success) {
        log('info', `Successfully completed with model: ${model}`);

        // Save successful agent override
        if (isRetry) {
          state.agentModelOverrides[options.subagent_type] = model;
          saveState(state);
        }

        return {
          success: true,
          output: result.output,
          model,
          duration: Date.now() - startTime,
          attempts: i + 1,
          fallbackApplied: isRetry,
          originalModel: isRetry ? originalModel : undefined,
        };
      }

      // Check if error should trigger fallback
      lastError = result.error;

      if (shouldFallback(result.error || '')) {
        log('warn', `Model ${model} failed with retriable error: ${lastError}`);

        // Mark as exhausted
        if (!state.exhaustedModels.includes(model)) {
          state.exhaustedModels.push(model);
        }

        // Continue to next model
        continue;
      }

      // Non-retriable error
      log('error', `Model ${model} failed with non-retriable error: ${lastError}`);
      return {
        success: false,
        error: lastError,
        model,
        duration: Date.now() - startTime,
        attempts: i + 1,
        fallbackApplied: isRetry,
        originalModel: isRetry ? originalModel : undefined,
      };
    } catch (error) {
      lastError = String(error);

      if (shouldFallback(lastError)) {
        log('warn', `Model ${model} threw retriable exception: ${lastError}`);

        if (!state.exhaustedModels.includes(model)) {
          state.exhaustedModels.push(model);
        }

        continue;
      }

      log('error', `Model ${model} threw non-retriable exception: ${lastError}`);
      return {
        success: false,
        error: lastError,
        model,
        duration: Date.now() - startTime,
        attempts: i + 1,
        fallbackApplied: isRetry,
        originalModel: isRetry ? originalModel : undefined,
      };
    }
  }

  // All models exhausted
  const errorMsg = `All models exhausted. Last error: ${lastError}`;
  log('error', errorMsg);

  return {
    success: false,
    error: errorMsg,
    model: 'none',
    duration: Date.now() - startTime,
    attempts: modelChain.length,
    fallbackApplied: true,
    originalModel,
  };
}

/**
 * Execute subagent using the agent-delegator
 */
async function executeSubagent(
  options: TaskOptions,
  model: string,
): Promise<{ success: boolean; output?: string; error?: string }> {
  return new Promise((resolve) => {
    const delegatorPath = join(ROOT, 'src', 'orchestration', 'agent-delegator.ts');

    const args: string[] = [
      '--agent',
      options.subagent_type,
      '--task',
      options.prompt,
      '--model',
      model,
    ];

    if (options.context) {
      args.push('--context', options.context);
    }

    // node --import tsx (hidden, shell-free). Raw spawn('npx.cmd') without a
    // shell fails with EINVAL on modern Node.
    const child = runNpxTsx(delegatorPath, args, {
      cwd: ROOT,
      env: {
        AGENT_MODEL: model,
        FORCE_MODEL: model,
        DELEGATION_MODE: 'fallback',
      },
      timeout: 300000, // 5 minutes
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

// =============================================================================
// LEGACY COMPATIBILITY
// =============================================================================

/**
 * Legacy task() compatible interface
 *
 * Allows drop-in replacement:
 *   import { task } from '../orchestration/universal-task-wrapper.js';
 *
 * Instead of OpenCode's task()
 */
export async function task(options: TaskOptions): Promise<string> {
  const result = await taskWithFallback(options);

  if (result.success) {
    return result.output || '';
  }

  throw new Error(result.error || 'Task failed without error message');
}

// =============================================================================
// CLI
// =============================================================================

function cli(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'test': {
      const agentIndex = args.indexOf('--agent');
      const promptIndex = args.indexOf('--prompt');

      if (agentIndex === -1 || promptIndex === -1) {
        console.error('Usage: test --agent <name> --prompt "<task>"');
        process.exit(1);
      }

      const agent = args[agentIndex + 1];
      const prompt = args[promptIndex + 1];

      void (async () => {
        const result = await taskWithFallback({ subagent_type: agent, prompt });
        console.log('\n=== Test Result ===\n');
        console.log(JSON.stringify(result, null, 2));
      })();
      break;
    }

    case 'status': {
      const state = loadState();
      console.log('\n=== Task Wrapper Status ===\n');
      console.log(`Exhausted models: ${state.exhaustedModels.join(', ') || 'none'}`);
      console.log(`\nAgent overrides:`);
      for (const [agent, model] of Object.entries(state.agentModelOverrides)) {
        console.log(`  ${agent} → ${model}`);
      }
      console.log(`\nCurrent orchestrator model: ${getOrchestratorModel() || 'unknown'}`);
      break;
    }

    case 'reset': {
      const emptyState: FallbackState = {
        exhaustedModels: [],
        lastCheckedAt: new Date().toISOString(),
        agentModelOverrides: {},
      };
      saveState(emptyState);
      console.log('Task wrapper state reset.');
      break;
    }

    default:
      console.log(`
Universal Task Wrapper with Model Fallback

Commands:
  test --agent <name> --prompt "<task>"
    Test delegation with automatic fallback

  status
    Show current state

  reset
    Reset state

Environment:
  ORCHESTRATOR_MODEL: Override orchestrator model detection
  AGENT_MODEL: Override agent model
  FORCE_MODEL: Force specific model
`);
  }
}

// Run CLI if executed directly
import { pathToFileURL } from 'url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli();
}
