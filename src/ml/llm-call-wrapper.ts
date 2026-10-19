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
import {
  readSessionState,
  type SessionState,
  type SessionTurn,
} from '../core/session-context-log.js';
import {
  compactHistory,
  loadEffectiveContextConfig,
  recordContextCompactionSaving,
} from '../tools/context-truncator.js';
import { DatabaseManager, DEFAULT_TENANT_ID } from '../database/nexus/manager.js';

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
  sessionId?: string;
  useSessionHistory?: boolean;
  historyTurns?: number;
  recordContextTelemetry?: boolean;
}

export interface LLMCallResult {
  response: string;
  fromCache: boolean;
  cacheKey?: string;
  inputCompressed: boolean;
  contextCompacted: boolean;
  outputCompressed: boolean;
  chatLevelEnforced: boolean;
  tokensSaved: number;
  durationMs: number;
}

export type LLMFunction = (prompt: string, options?: LLMCallOptions) => Promise<string>;

export interface LLMUserPromptOptimizationOptions {
  skill: string;
  context: string;
  sessionId?: string;
  envSessionKeys?: string[];
  envHistoryTurnsKey?: string;
  defaultHistoryTurns?: number;
  recordContextTelemetry?: boolean;
}

export interface LLMProviderTraceOptions {
  provider: string;
  model?: string;
  operation: string;
  startTime: number;
  status: 'completed' | 'error' | 'failed';
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
  sessionId?: string;
  attributes?: Record<string, unknown>;
}

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

export function recordLLMProviderTrace(options: LLMProviderTraceOptions): void {
  try {
    const endTime = Date.now();
    const duration = Math.max(0, endTime - options.startTime);
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          provider: options.provider,
          model: options.model ?? '',
          operation: options.operation,
          startTime: options.startTime,
          duration,
          status: options.status,
        }),
      )
      .digest('hex');
    const attributes = {
      ...(options.attributes ?? {}),
      provider: options.provider,
      operation: options.operation,
    };
    DatabaseManager.getInstance().insertTrace(
      {
        span_id: hash.slice(0, 16),
        trace_id: hash.slice(0, 32),
        name: `llm.provider.${options.operation}`,
        start_time: options.startTime,
        end_time: endTime,
        duration,
        status: options.status,
        model: options.model,
        input_tokens: options.inputTokens ?? 0,
        output_tokens: options.outputTokens ?? 0,
        cost: options.cost ?? 0,
        session_id: options.sessionId,
        attributes: JSON.stringify(attributes),
      },
      DEFAULT_TENANT_ID,
    );
  } catch {
    // Telemetry is best-effort and must never break an LLM response path.
  }
}

// ─── Cache Key Generation ─────────────────────────────────────────────────────

function generateCacheKey(prompt: string, options: LLMCallOptions): string {
  const data = JSON.stringify({
    version: 2,
    prompt,
    model: options.model ?? '',
    maxTokens: options.maxTokens ?? null,
    temperature: options.temperature ?? null,
    skill: options.skill ?? '',
    chatLevel: options.chatLevel ?? '',
    profile: options.profile ?? '',
    skipCompression: options.skipCompression ?? false,
    context: options.context ?? '',
    previousTurns: options.previousTurns ?? [],
    query: options.query ?? '',
    sessionId: options.sessionId ?? '',
  });
  return createHash('sha256').update(data).digest('hex');
}

// ─── Token Estimation ─────────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token
  return Math.ceil(text.length / 4);
}

// ─── Session History Loading ─────────────────────────────────────────────────

function stringifyTurn(turn: SessionTurn, index: number): string | null {
  const parts = [
    turn.message ? `message=${turn.message}` : '',
    turn.inputSummary ? `input=${turn.inputSummary}` : '',
    turn.outputSummary ? `output=${turn.outputSummary}` : '',
    turn.toolCalls ? `tools=${turn.toolCalls}` : '',
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return `session turn ${index + 1}: ${parts.join(' | ')}`;
}

export function previousTurnsFromSessionState(state: SessionState | null, limit = 12): string[] {
  if (!state?.turns?.length) return [];
  const boundedLimit = Math.max(1, limit);
  const startIndex = Math.max(0, state.turns.length - boundedLimit);
  return state.turns
    .slice(-boundedLimit)
    .map((turn, index) => stringifyTurn(turn, startIndex + index))
    .filter((turn): turn is string => Boolean(turn));
}

export function loadPreviousTurnsFromSession(sessionId: string | undefined, limit = 12): string[] {
  if (!sessionId) return [];
  try {
    return previousTurnsFromSessionState(readSessionState(sessionId), limit);
  } catch {
    return [];
  }
}

function resolveCallOptions(options: LLMCallOptions): LLMCallOptions {
  if (options.previousTurns?.length || !options.useSessionHistory) return options;
  const sessionId = options.sessionId ?? process.env.GENTLE_VANGUARD_SESSION_ID;
  const previousTurns = loadPreviousTurnsFromSession(sessionId, options.historyTurns ?? 12);
  if (previousTurns.length === 0) return options;
  return { ...options, sessionId, previousTurns };
}

// ─── Pre-Call Processing ─────────────────────────────────────────────────────

export interface PreCallResult {
  processedPrompt: string;
  originalTokens: number;
  compressedTokens: number;
  wasCompressed: boolean;
  contextCompacted: boolean;
  contextTokensSaved: number;
  cacheKey: string;
}

function renderPreviousTurns(previousTurns: string[]): string {
  if (previousTurns.length === 0) return '';
  return [
    '[Previous context]',
    ...previousTurns.map((turn, index) => `- turn ${index + 1}: ${turn}`),
    '[/Previous context]',
  ].join('\n');
}

function buildPromptWithPreviousTurns(
  prompt: string,
  options: LLMCallOptions,
  telemetry: { recordContextTelemetry?: boolean } = {},
): {
  originalPrompt: string;
  processedPrompt: string;
  contextCompacted: boolean;
  contextTokensSaved: number;
} {
  const previousTurns = options.previousTurns ?? [];
  if (previousTurns.length === 0) {
    return {
      originalPrompt: prompt,
      processedPrompt: prompt,
      contextCompacted: false,
      contextTokensSaved: 0,
    };
  }

  const messages = previousTurns.map((content, index) => ({
    role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content,
  }));
  const result = compactHistory(messages, loadEffectiveContextConfig(), {
    recordTelemetry: false,
  });
  if (telemetry.recordContextTelemetry) {
    recordContextCompactionSaving(result, {
      source: 'llm-call-wrapper:previous-turns',
      sessionId: options.sessionId ?? process.env.GENTLE_VANGUARD_SESSION_ID,
    });
  }

  const compactTurns =
    result.truncatedMessages?.map((message) => `${message.role}: ${message.content}`) ??
    previousTurns;
  const originalContext = renderPreviousTurns(previousTurns);
  const previousContext = renderPreviousTurns(compactTurns);
  return {
    originalPrompt: `${originalContext}\n\n[Current request]\n${prompt}`,
    processedPrompt: `${previousContext}\n\n[Current request]\n${prompt}`,
    contextCompacted: result.savedTokens > 0,
    contextTokensSaved: result.savedTokens,
  };
}

export function preProcessLLMInput(
  prompt: string,
  options: LLMCallOptions,
  telemetry: { recordContextTelemetry?: boolean } = {},
): PreCallResult {
  const start = Date.now();
  const effectiveOptions = resolveCallOptions(options);
  const withContext = buildPromptWithPreviousTurns(prompt, effectiveOptions, telemetry);
  let processed = withContext.processedPrompt;

  // Stage 1: Input compression (if not skipped)
  if (!effectiveOptions.skipCompression) {
    try {
      const result = compressPrompt(
        withContext.processedPrompt,
        effectiveOptions.skill || 'default',
      );
      if (result.compressed && result.compressed.length < withContext.processedPrompt.length) {
        processed = result.compressed;
      }
    } catch {
      // Continue with original on error
    }
  }

  const originalTokens = estimateTokens(withContext.originalPrompt);
  const compressedTokens = estimateTokens(processed);
  const cacheKey = generateCacheKey(prompt, effectiveOptions);

  logWrapper({
    event: 'pre-process',
    originalLength: withContext.originalPrompt.length,
    processedLength: processed.length,
    contextCompacted: withContext.contextCompacted,
    contextTokensSaved: withContext.contextTokensSaved,
    durationMs: Date.now() - start,
  });

  return {
    processedPrompt: processed,
    originalTokens,
    compressedTokens,
    wasCompressed:
      processed.length < withContext.originalPrompt.length || withContext.contextCompacted,
    contextCompacted: withContext.contextCompacted,
    contextTokensSaved: withContext.contextTokensSaved,
    cacheKey,
  };
}

function firstEnvValue(keys: string[] = []): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return undefined;
}

function historyTurnsFromEnv(key: string | undefined, fallback: number): number {
  const configured = key ? Number(process.env[key]) : NaN;
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : fallback;
}

export function optimizeLLMUserPrompt(
  prompt: string,
  options: LLMUserPromptOptimizationOptions,
): string {
  const sessionId =
    options.sessionId ??
    firstEnvValue([...(options.envSessionKeys ?? []), 'GENTLE_VANGUARD_SESSION_ID']);
  const historyTurns = historyTurnsFromEnv(options.envHistoryTurnsKey, options.defaultHistoryTurns ?? 12);
  const processed = preProcessLLMInput(
    prompt,
    {
      skill: options.skill,
      context: options.context,
      skipCache: true,
      skipCompression: true,
      sessionId,
      useSessionHistory: Boolean(sessionId),
      historyTurns,
    },
    {
      recordContextTelemetry: options.recordContextTelemetry ?? Boolean(sessionId),
    },
  );
  return processed.processedPrompt;
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
  const effectiveOptions = resolveCallOptions(options);

  // Pre-process input
  const preProcessed = preProcessLLMInput(prompt, effectiveOptions, {
    recordContextTelemetry: effectiveOptions.recordContextTelemetry !== false,
  });

  // Check cache
  if (!effectiveOptions.skipCache) {
    const cached = cache.get(preProcessed.cacheKey, effectiveOptions.context);
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
        contextCompacted: preProcessed.contextCompacted,
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
    llmResponse = await llmFunction(preProcessed.processedPrompt, effectiveOptions);
  } catch (error) {
    logWrapper({
      event: 'llm-error',
      error: String(error),
    });
    throw error;
  }

  // Post-process output
  const postProcessed = postProcessLLMOutput(llmResponse, effectiveOptions);

  // Store in cache
  if (!effectiveOptions.skipCache) {
    const tokensSaved =
      preProcessed.originalTokens -
      preProcessed.compressedTokens +
      (postProcessed.originalTokens - postProcessed.compressedTokens);
    cache.set(
      preProcessed.cacheKey,
      postProcessed.processedResponse,
      tokensSaved,
      effectiveOptions.context,
    );
  }

  const totalTokensSaved =
    preProcessed.originalTokens -
    preProcessed.compressedTokens +
    (postProcessed.originalTokens - postProcessed.compressedTokens);

  logWrapper({
    event: 'complete',
    fromCache: false,
    inputCompressed: preProcessed.wasCompressed,
    contextCompacted: preProcessed.contextCompacted,
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
    contextCompacted: preProcessed.contextCompacted,
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
  sessionId?: string;
  useSessionHistory: boolean;
  historyTurns: number;
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
    useSessionHistory: false,
    historyTurns: 12,
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
      case '--session-id':
        options.sessionId = args[++i] ?? '';
        break;
      case '--use-session-history':
        options.useSessionHistory = true;
        break;
      case '--history-turns':
        options.historyTurns = parseInt(args[++i] ?? '12', 10);
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
      'Usage: npx tsx src/ml/llm-call-wrapper.ts --prompt "..." [--model "..."] [--profile ultra|lleno|lite|simple] [--use-session-history --session-id "..."] [--simulate]',
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
        console.log(`Context Compacted: ${result.contextCompacted}`);
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
