/**
 * Model Error Interceptor - Hooks into task execution to enable smart fallback
 *
 * This module intercepts task failures and routes to alternative models
 * when the current model fails (quota, timeout, etc.)
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
const logger = log('ML-MODEL-ERROR-INTERCEPTOR');
import { log } from '../utils/logger.js';

const ROOT = process.cwd();
const REGISTRY_PATH = join(ROOT, 'config', 'model-health-registry.json');
const ACTIVE_MODEL_PATH = join(ROOT, '.runtime', 'model-active.json');

interface TaskContext {
  agent: string;
  model: string;
  error?: string;
}

// Error patterns that trigger fallback
const ERROR_PATTERNS = {
  quota: [
    'quota exceeded',
    'rate limit',
    'too many requests',
    'credits exhausted',
    'free usage exceeded',
    'subscribe',
    'payment required',
    'billing limit',
  ],
  modelNotFound: [
    'model not found',
    'invalid model',
    'unknown model',
    'not available',
    'inherit-from-session',
  ],
  timeout: [
    'timeout',
    'deadline exceeded',
    'request timed out',
    'connection timeout',
    'unreachable',
    'econnrefused',
  ],
  auth: ['unauthorized', 'invalid api key', 'authentication failed', 'forbidden', 'access denied'],
};

/**
 * Intercept task errors and provide fallback
 */
export async function interceptTaskError(
  context: TaskContext,
): Promise<{ retry: boolean; newModel?: string; message: string }> {
  if (!context.error) {
    return { retry: false, message: 'No error to intercept' };
  }

  const errorLower = context.error.toLowerCase();

  // Detect error type
  let errorType: string | null = null;
  for (const [type, patterns] of Object.entries(ERROR_PATTERNS)) {
    if (patterns.some((p) => errorLower.includes(p))) {
      errorType = type;
      break;
    }
  }

  if (!errorType) {
    return { retry: false, message: `Unrecognized error: ${context.error}` };
  }

  // Load registry for fallback
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
  const currentEntry = registry.models[context.model];

  if (!currentEntry) {
    return {
      retry: true,
      newModel: registry.routingRules.orchestrator.primary,
      message: `Model ${context.model} not in registry, falling back to default`,
    };
  }

  // Increment error counter
  currentEntry.health.consecutiveErrors++;
  currentEntry.health.lastError = context.error;
  currentEntry.health.lastChecked = new Date().toISOString();

  if (currentEntry.health.consecutiveErrors >= 3) {
    currentEntry.health.status = 'unavailable';
  }

  // Find fallback
  const fallbackId = currentEntry.fallbackChain[0];
  if (fallbackId) {
    const fallbackEntry = registry.models[fallbackId];
    if (fallbackEntry) {
      // Update active model
      writeFileSync(
        ACTIVE_MODEL_PATH,
        JSON.stringify(
          {
            model: fallbackId,
            provider: fallbackEntry.provider,
            changedAt: new Date().toISOString(),
            source: `intercept-${errorType}`,
          },
          null,
          2,
        ),
      );

      return {
        retry: true,
        newModel: fallbackId,
        message: `[FALLBACK] ${errorType}: ${context.error}\nAuto-switching ${context.model} → ${fallbackId}\nRestart session to use new model.`,
      };
    }
  }

  return {
    retry: false,
    message: `No fallback available for ${errorType}. Manual intervention required.`,
  };
}

/**
 * Wrap task() with fallback logic
 */
export function wrapTaskWithFallback(originalTask: Function): Function {
  return async (...args: unknown[]): Promise<unknown> => {
    const first = args[0] as { subagent_type?: string; agent?: string } | undefined;
    const agentName = first?.subagent_type || first?.agent || 'unknown';
    const model = process.env.GENTLE_VANGUARD_ACTIVE_MODEL || 'unknown';

    try {
      return await originalTask(...args);
    } catch (error) {
      const errorStr = String(error);
      const context: TaskContext = {
        agent: agentName,
        model,
        error: errorStr,
      };

      const result = await interceptTaskError(context);

      if (result.retry && result.newModel) {
        logger.error(result.message);
        // Retry with new model would require session restart
        // Cannot dynamically switch without restart in this architecture
        throw new Error(
          `${result.message}\n\nPlease restart your session to use model: ${result.newModel}`,
        );
      }

      throw error;
    }
  };
}

// Export for use in custom task wrappers
export { ERROR_PATTERNS };
