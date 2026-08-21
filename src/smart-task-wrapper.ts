/**
 * Task Wrapper - Provides smart model fallback for task() calls
 *
 * Usage: Replace task() with smartTask() to enable auto-fallback
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

// Declare task function from OpenCode runtime
declare const task: (options: TaskOptions) => Promise<string>;

interface TaskOptions {
  subagent_type: string;
  prompt: string;
  description?: string;
}

/**
 * Smart task wrapper that handles model errors gracefully
 */
export async function smartTask(
  options: TaskOptions,
): Promise<{ success: boolean; output?: string; error?: string; fallbackSuggested?: string }> {
  // Get current model from registry
  const ACTIVE_MODEL = join(ROOT, '.runtime', 'model-active.json');
  let currentModel: string;

  try {
    const active = JSON.parse(readFileSync(ACTIVE_MODEL, 'utf-8'));
    currentModel = active.model;
  } catch {
    currentModel = 'opencode/deepseek-v4-flash-free'; // Default
  }

  console.log(`[smartTask] Executing ${options.subagent_type} with model: ${currentModel}`);

  // Try native task first
  try {
    // Use task from OpenCode runtime (declared above)
    const result = await task({
      subagent_type: options.subagent_type,
      prompt: options.prompt,
      description: options.description,
    });

    return { success: true, output: result };
  } catch (error) {
    const errorStr = String(error);
    console.error(`[smartTask] Error: ${errorStr}`);

    // Check if error is model-related
    if (
      errorStr.includes('Model not found') ||
      errorStr.includes('quota') ||
      errorStr.includes('credit') ||
      errorStr.includes('inherit-from-session')
    ) {
      // Suggest fallback
      const registry = JSON.parse(
        readFileSync(join(ROOT, 'config', 'model-health-registry.json'), 'utf-8'),
      );

      const currentEntry = registry.models[currentModel];
      const fallback = currentEntry?.fallbackChain?.[0] || 'opencode/deepseek-v4-flash-free';

      return {
        success: false,
        error: errorStr,
        fallbackSuggested: fallback,
      };
    }

    return { success: false, error: errorStr };
  }
}

/**
 * Check if fallback should be used
 */
export function shouldUseFallback(error: string): boolean {
  const fallbackTriggers = [
    'Model not found',
    'quota exceeded',
    'rate limit',
    'credits exhausted',
    'inherit-from-session',
    'timeout',
    'unreachable',
  ];

  return fallbackTriggers.some((trigger) => error.toLowerCase().includes(trigger.toLowerCase()));
}

// CLI test
if (require.main === module) {
  void (async (): Promise<void> => {
    try {
      const result = await smartTask({
        subagent_type: 'sdd-explore',
        prompt: 'What model are you using?',
        description: 'Test smart task wrapper',
      });

      console.log('\nResult:', JSON.stringify(result, null, 2));
    } catch (error) {
      console.error('CLI test failed:', error);
      process.exit(1);
    }
  })();
}
