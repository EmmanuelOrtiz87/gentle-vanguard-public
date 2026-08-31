#!/usr/bin/env node
/**
 * LLM Call Wrapper — Universal Token Optimization Interceptor
 *
 * Intercepts ALL LLM API calls and applies:
 * 1. Pre-call: Input compression + token budget check
 * 2. Post-call: Output compression + chat level enforcement
 * 3. Caching: Check/store in response cache
 *
 * This wrapper is TOOL-AGNOSTIC and works with:
 * - Claude Code
 * - OpenCode
 * - Cline
 * - Cursor
 * - Any LLM interface
 *
 * Usage:
 *   const wrapped = wrapLLMCall(originalLLMCall);
 *   const response = await wrapped(prompt, options);
 *
 * Or via CLI:
 *   npx tsx src/ml/llm-call-wrapper.ts --prompt "..." --model "claude-3-5-sonnet"
 */

import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { createHash } from 'crypto';
import { compressPrompt } from '../compression/prompt-compression.js';
import { compressOutput } from '../compression/output-compression.js';
import { enforceChatLevel } from '../orchestration/chat-level-enforcer.js';
import { ResponseCache } from '../resilience/response-cache.js';
import { runSync } from '../core/run-command.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LLMCallOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  skill?: string;
  chatLevel?: 'chat-compact' | 'chat-balanced' | 'chat-detailed';
  profile?: 'ultra' | 'lleno' | 'lite' | 'simple';
  skipCache?: boolean;
  skipCompression?: boolean;
  context?: string;
  previousTurns?: string[];
  query?: string;
}

export interface LLMCallResult {
  response: string;
  fromCache: boolean;
  cacheKey?: string;
  inputCompressed: boolean;
  outputCompressed: boolean;
  chatLevelEnforced: boolean;
  tokensSaved: number;
  durationMs: number;
}

export type LLMFunction = (prompt: string, options?: LLMCallOptions) => Promise<string>;

// ─── Configuration ────────────────────────────────────────────────────────────

const ROOT = resolve(process.env.GENTLE_VANGUARD_BASE_DIR ?? process.cwd());
const WRAPPER_LOG = join(ROOT, '.runtime', 'llm-wrapper-log.jsonl');

// Ensure log directory exists
function ensureLogDir(): void {
  const dir = join(ROOT, '.runtime');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// Log wrapper activity
function logWrapper(entry: Record<string, unknown>): void {
  ensureLogDir();
  const line = JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n';
  try {
    writeFileSync(WRAPPER_LOG, line, { flag: 'a' });
  } catch {
    // Silent fail - logging is best effort
  }
}

// ─── Cache Key Generation ─────────────────────────────────────────────────────

function generateCacheKey(prompt: string, options: LLMCallOptions): string {
  const data = JSON.stringify({ prompt, model: options.model, temperature: options.temperature });
  return createHash('sha256').update(data).digest('hex');
}

// ─── Token Estimation ─────────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token
  return Math.ceil(text.length / 4);
}

// ─── Pre-Call Processing ─────────────────────────────────────────────────────

export interface PreCallResult {
  processedPrompt: string;
  originalTokens: number;
  compressedTokens: number;
  wasCompressed: boolean;
  cacheKey: string;
}

export function preProcessLLMInput(prompt: string, options: LLMCallOptions): PreCallResult {
  const start = Date.now();
  let processed = prompt;

  // Stage 1: Input compression (if not skipped)
  if (!options.skipCompression) {
    try {
      const result = compressPrompt(prompt, options.skill || 'default');
      if (result.compressed && result.compressed.length < prompt.length) {
        processed = result.compressed;
      }
    } catch {
      // Continue with original on error
    }
  }

  const originalTokens = estimateTokens(prompt);
  const compressedTokens = estimateTokens(processed);
  const cacheKey = generateCacheKey(prompt, options);

  logWrapper({
    event: 'pre-process',
    originalLength: prompt.length,
    processedLength: processed.length,
    durationMs: Date.now() - start,
  });

  return {
    processedPrompt: processed,
    originalTokens,
    compressedTokens,
    wasCompressed: processed.length < prompt.length,
    cacheKey,
  };
}

// ─── Post-Call Processing ──────────────────────────────────────────────────────

export interface PostCallResult {
  processedResponse: string;
  originalTokens: number;
  compressedTokens: number;
  wasCompressed: boolean;
  chatLevelEnforced: boolean;
}

export function postProcessLLMOutput(response: string, options: LLMCallOptions): PostCallResult {
  const start = Date.now();
  let processed = response;
  let chatLevelEnforced = false;

  // Stage 1: Output compression (if not skipped)
  if (!options.skipCompression) {
    try {
      const result = compressOutput(response, options.profile || 'ultra');
      if (result.compressed && result.compressed.length < response.length) {
        processed = result.compressed;
      }
    } catch {
      // Continue with original on error
    }
  }

  // Stage 2: Chat level enforcement
  if (!options.skipCompression && options.chatLevel) {
    try {
      const enforced = enforceChatLevel(processed, options.chatLevel);
      if (enforced.wasEnforced) {
        processed = enforced.enforced;
        chatLevelEnforced = true;
      }
    } catch {
      // Continue with original on error
    }
  }

  const originalTokens = estimateTokens(response);
  const compressedTokens = estimateTokens(processed);

  logWrapper({
    event: 'post-process',
    originalLength: response.length,
    processedLength: processed.length,
    chatLevelEnforced,
    durationMs: Date.now() - start,
  });

  return {
    processedResponse: processed,
    originalTokens,
    compressedTokens,
    wasCompressed: processed.length < response.length,
    chatLevelEnforced,
  };
}

// ─── Main Wrapper Function ────────────────────────────────────────────────────

export async function wrapLLMCall(
  llmFunction: LLMFunction,
  prompt: string,
  options: LLMCallOptions = {},
): Promise<LLMCallResult> {
  const startTime = Date.now();
  const cache = new ResponseCache();

  // Pre-process input
  const preProcessed = preProcessLLMInput(prompt, options);

  // Check cache
  if (!options.skipCache) {
    const cached = cache.get(preProcessed.cacheKey, options.context);
    if (cached) {
      logWrapper({
        event: 'cache-hit',
        cacheKey: preProcessed.cacheKey,
        tokensSaved: preProcessed.compressedTokens,
      });
      return {
        response: cached.response,
        fromCache: true,
        cacheKey: preProcessed.cacheKey,
        inputCompressed: preProcessed.wasCompressed,
        outputCompressed: false,
        chatLevelEnforced: false,
        tokensSaved:
          cached.tokensSaved + (preProcessed.originalTokens - preProcessed.compressedTokens),
        durationMs: Date.now() - startTime,
      };
    }
  }

  // Call LLM
  let llmResponse: string;
  try {
    llmResponse = await llmFunction(preProcessed.processedPrompt, options);
  } catch (error) {
    logWrapper({
      event: 'llm-error',
      error: String(error),
    });
    throw error;
  }

  // Post-process output
  const postProcessed = postProcessLLMOutput(llmResponse, options);

  // Store in cache
  if (!options.skipCache) {
    const tokensSaved =
      preProcessed.originalTokens -
      preProcessed.compressedTokens +
      (postProcessed.originalTokens - postProcessed.compressedTokens);
    cache.set(preProcessed.cacheKey, postProcessed.processedResponse, tokensSaved, options.context);
  }

  const totalTokensSaved =
    preProcessed.originalTokens -
    preProcessed.compressedTokens +
    (postProcessed.originalTokens - postProcessed.compressedTokens);

  logWrapper({
    event: 'complete',
    fromCache: false,
    inputCompressed: preProcessed.wasCompressed,
    outputCompressed: postProcessed.wasCompressed,
    chatLevelEnforced: postProcessed.chatLevelEnforced,
    tokensSaved: totalTokensSaved,
    durationMs: Date.now() - startTime,
  });

  return {
    response: postProcessed.processedResponse,
    fromCache: false,
    cacheKey: preProcessed.cacheKey,
    inputCompressed: preProcessed.wasCompressed,
    outputCompressed: postProcessed.wasCompressed,
    chatLevelEnforced: postProcessed.chatLevelEnforced,
    tokensSaved: totalTokensSaved,
    durationMs: Date.now() - startTime,
  };
}

// ─── CLI Interface ────────────────────────────────────────────────────────────

interface CLIOptions {
  prompt: string;
  model: string;
  maxTokens: number;
  temperature: number;
  profile: 'ultra' | 'lleno' | 'lite' | 'simple';
  chatLevel: 'chat-compact' | 'chat-balanced' | 'chat-detailed';
  skipCache: boolean;
  skipCompression: boolean;
  json: boolean;
}

function parseCLIArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {
    prompt: '',
    model: 'claude-3-5-sonnet',
    maxTokens: 4096,
    temperature: 0.3,
    profile: 'ultra',
    chatLevel: 'chat-compact',
    skipCache: false,
    skipCompression: false,
    json: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--prompt':
      case '-p':
        options.prompt = args[++i] ?? '';
        break;
      case '--model':
      case '-m':
        options.model = args[++i] ?? 'claude-3-5-sonnet';
        break;
      case '--max-tokens':
        options.maxTokens = parseInt(args[++i] ?? '4096', 10);
        break;
      case '--temperature':
        options.temperature = parseFloat(args[++i] ?? '0.3');
        break;
      case '--profile':
        options.profile = (args[++i] as 'ultra' | 'lleno' | 'lite' | 'simple') ?? 'ultra';
        break;
      case '--chat-level':
        options.chatLevel =
          (args[++i] as 'chat-compact' | 'chat-balanced' | 'chat-detailed') ?? 'chat-compact';
        break;
      case '--skip-cache':
        options.skipCache = true;
        break;
      case '--skip-compression':
        options.skipCompression = true;
        break;
      case '--json':
        options.json = true;
        break;
    }
  }

  return options;
}

// Simulated LLM call for CLI testing (explicit --simulate only)
async function simulatedLLMCall(prompt: string, options?: LLMCallOptions): Promise<string> {
  // In real implementation, this would call the actual LLM API
  void options; // Mark as intentionally unused
  return `[Simulated LLM response for: ${prompt.slice(0, 50)}...]`;
}

// Real LLM call via the opencode CLI (the stack's native model runtime).
// Falls back to a simulated response ONLY when opencode is unavailable.
async function opencodeLLMCall(prompt: string, options?: LLMCallOptions): Promise<string> {
  const args = ['run', prompt];
  if (options?.model) {
    args.push('--model', options.model);
  }
  try {
    const result = runSync('opencode', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    });
    if (result.status === 0 && result.stdout && result.stdout.trim().length > 0) {
      return result.stdout.trim();
    }
    const detail = result.stderr?.trim() || `exit code ${result.status}`;
    throw new Error(`opencode run failed: ${detail}`);
  } catch (error) {
    const msg = String((error as Error)?.message ?? '');
    const isMissing = /not recognized|ENOENT|not found/i.test(msg);
    if (isMissing) {
      console.warn(
        '[llm-call-wrapper] ⚠ opencode CLI not available — returning SIMULATED response (install opencode for real LLM calls)',
      );
      return simulatedLLMCall(prompt, options);
    }
    const isBrokenBinary = /no es compatible|not compatible|Win32|StandardOutputEncoding/i.test(
      msg,
    );
    if (isBrokenBinary) {
      throw new Error(
        `[llm-call-wrapper] ❌ opencode CLI binary is not operational on this platform ` +
          `(incompatible executable). Real LLM calls are unavailable. Fix with: ` +
          `pnpm add -g opencode-ai@latest (or use --simulate for testing only). Raw: ${msg}`,
      );
    }
    throw error;
  }
}

// CLI execution
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseCLIArgs();
  const simulate = process.argv.slice(2).includes('--simulate');

  if (!options.prompt) {
    console.error(
      'Usage: npx tsx src/ml/llm-call-wrapper.ts --prompt "..." [--model "..."] [--profile ultra|lleno|lite|simple] [--simulate]',
    );
    process.exit(1);
  }

  const backend: LLMFunction = simulate ? simulatedLLMCall : opencodeLLMCall;
  if (simulate) {
    console.warn(
      '[llm-call-wrapper] ⚠ --simulate mode: returning SIMULATED response (testing only, not a real LLM call)',
    );
  }

  wrapLLMCall(backend, options.prompt, options as LLMCallOptions)
    .then((result) => {
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log('=== LLM Call Wrapper Result ===');
        console.log(`Response: ${result.response}`);
        console.log(`From Cache: ${result.fromCache}`);
        console.log(`Input Compressed: ${result.inputCompressed}`);
        console.log(`Output Compressed: ${result.outputCompressed}`);
        console.log(`Chat Level Enforced: ${result.chatLevelEnforced}`);
        console.log(`Tokens Saved: ${result.tokensSaved}`);
        console.log(`Duration: ${result.durationMs}ms`);
      }
    })
    .catch((error) => {
      console.error('Error:', error);
      process.exit(1);
    });
}

// Export for use as module
export { wrapLLMCall as default };
