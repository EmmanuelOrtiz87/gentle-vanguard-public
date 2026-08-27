#!/usr/bin/env node
/**
 * Token Optimization Orchestrator — Central token optimization coordinator
 *
 * Coordinates all token optimization systems:
 * - Input compression (prompt-compression.ts)
 * - Output compression (output-compression.ts)
 * - Chat level enforcement (chat-level-enforcer.ts)
 * - Response caching (response-cache.ts)
 * - Token budget guard (token-budget-guard.ts)
 *
 * Pipeline: Pre-process → Process → Post-process
 * Metrics collection and reporting
 *
 * Usage:
 *   npx tsx src/tokens/token-optimization-orchestrator.ts --mode optimize --input "..."
 *   npx tsx src/tokens/token-optimization-orchestrator.ts --mode pipeline --file input.txt
 *   npx tsx src/tokens/token-optimization-orchestrator.ts --metrics
 *   npx tsx src/tokens/token-optimization-orchestrator.ts --status
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { pathToFileURL } from 'url';
import {
  compressPrompt,
  CompressionResult as PromptCompressionResult,
} from '../compression/prompt-compression.js';
import {
  compressOutput,
  CompressionResult as OutputCompressionResult,
} from '../compression/output-compression.js';
import { enforceChatLevel, ChatLevelEnforcementResult, ChatLevel } from '../chat-level-enforcer.js';
import { ResponseCache, generateCacheKey } from '../response-cache.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type OrchestratorMode = 'optimize' | 'pipeline' | 'check' | 'report';
export type PipelineStage =
  'pre-process' | 'process' | 'post-process' | 'cache-check' | 'cache-store';

export interface PipelineInput {
  prompt: string;
  context?: string;
  skill?: string;
  maxPromptTokens?: number;
  maxResponseTokens?: number;
  chatLevel?: ChatLevel;
  cacheEnabled?: boolean;
  ttlMinutes?: number;
}

export interface PipelineOutput {
  response: string;
  fromCache: boolean;
  cacheKey?: string;
}

export interface PipelineResult {
  input: PipelineInput;
  output: PipelineOutput;
  stages: PipelineStageResult[];
  metrics: OptimizationMetrics;
  durationMs: number;
}

export interface PipelineStageResult {
  stage: PipelineStage;
  input: unknown;
  output: unknown;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  savings: number;
  success: boolean;
  error?: string;
}

export interface OptimizationMetrics {
  promptCompression?: PromptCompressionResult;
  chatLevelEnforcement?: ChatLevelEnforcementResult;
  outputCompression?: OutputCompressionResult;
  cacheHit: boolean;
  cacheTokensSaved: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalSavings: number;
  totalReduction: number; // percentage
  estimatedCostSaved: number; // in arbitrary units
}

export interface OrchestratorConfig {
  enabled: boolean;
  mode: OrchestratorMode;
  defaultChatLevel: ChatLevel;
  cacheEnabled: boolean;
  cacheTtlMinutes: number;
  preProcessCompression: boolean;
  postProcessCompression: boolean;
  tokenBudgetAware: boolean;
  metricsEnabled: boolean;
  metricsStoragePath: string;
  reportInterval: number;
}

export interface OrchestratorStats {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number;
  totalTokenSavings: number;
  avgSavingsPct: number;
  byStage: Record<
    PipelineStage,
    {
      runs: number;
      avgDurationMs: number;
      avgSavings: number;
    }
  >;
}

// ─── Paths ────────────────────────────────────────────────────────────────────

const ROOT = resolve(process.env.GENTLE_VANGUARD_BASE_DIR ?? process.cwd());
const CONFIG_PATH = join(ROOT, 'config', 'orchestrator.json');
const METRICS_PATH = join(ROOT, '.runtime', 'token-optimization-metrics.json');
const STATS_PATH = join(ROOT, '.runtime', 'token-optimization-stats.json');

// ─── Config Loader ────────────────────────────────────────────────────────────

let _config: OrchestratorConfig | null = null;

export function getConfig(): OrchestratorConfig {
  if (_config) return _config;

  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      const compression = raw?.compression ?? {};
      const chat = raw?.chat_response ?? {};
      const cache = raw?.caching ?? { enabled: true };

      _config = {
        enabled: compression?.enabled ?? true,
        mode: 'optimize',
        defaultChatLevel: chat?.default_level ?? 'chat-compact',
        cacheEnabled: cache?.enabled ?? true,
        cacheTtlMinutes: cache?.ttlMinutes ?? 60,
        preProcessCompression: true,
        postProcessCompression: true,
        tokenBudgetAware: true,
        metricsEnabled: true,
        metricsStoragePath: '.runtime/token-optimization-metrics.json',
        reportInterval: 100,
      };
      return _config;
    }
  } catch {
    /* ignore */
  }

  _config = {
    enabled: true,
    mode: 'optimize',
    defaultChatLevel: 'chat-compact',
    cacheEnabled: true,
    cacheTtlMinutes: 60,
    preProcessCompression: true,
    postProcessCompression: true,
    tokenBudgetAware: true,
    metricsEnabled: true,
    metricsStoragePath: '.runtime/token-optimization-metrics.json',
    reportInterval: 100,
  };
  return _config;
}

// ─── Token Estimation ───────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Stage Handlers ────────────────────────────────────────────────────────────

interface StageContext {
  cache: ResponseCache;
  cacheKey?: string;
}

async function runCacheCheckStage(
  input: PipelineInput,
  context: StageContext,
): Promise<PipelineStageResult> {
  const start = Date.now();
  const tokensIn = estimateTokens(input.prompt);

  try {
    if (!input.cacheEnabled) {
      return {
        stage: 'cache-check',
        input: input.prompt,
        output: null,
        durationMs: Date.now() - start,
        tokensIn,
        tokensOut: 0,
        savings: 0,
        success: true,
      };
    }

    const cacheKey = generateCacheKey(input.prompt, input.context ?? '');
    context.cacheKey = cacheKey;

    const cached = context.cache.get(input.prompt, input.context ?? '');

    if (cached?.response) {
      const tokensOut = estimateTokens(cached.response);
      return {
        stage: 'cache-check',
        input: input.prompt,
        output: cached.response,
        durationMs: Date.now() - start,
        tokensIn,
        tokensOut,
        savings: tokensIn - tokensOut,
        success: true,
      };
    }

    return {
      stage: 'cache-check',
      input: input.prompt,
      output: null,
      durationMs: Date.now() - start,
      tokensIn,
      tokensOut: 0,
      savings: 0,
      success: true,
    };
  } catch (err) {
    return {
      stage: 'cache-check',
      input: input.prompt,
      output: null,
      durationMs: Date.now() - start,
      tokensIn,
      tokensOut: 0,
      savings: 0,
      success: false,
      error: String(err),
    };
  }
}

async function runPreProcessStage(
  input: PipelineInput,
  config: OrchestratorConfig,
): Promise<PipelineStageResult> {
  const start = Date.now();
  const original = input.prompt;
  const originalTokens = estimateTokens(original);

  try {
    if (!config.preProcessCompression) {
      return {
        stage: 'pre-process',
        input: original,
        output: original,
        durationMs: Date.now() - start,
        tokensIn: originalTokens,
        tokensOut: originalTokens,
        savings: 0,
        success: true,
      };
    }

    // Use prompt compression
    const compressed = compressPrompt(original, input.skill ?? 'default');
    const tokensOut = estimateTokens(compressed.compressed);

    return {
      stage: 'pre-process',
      input: original,
      output: compressed.compressed,
      durationMs: Date.now() - start,
      tokensIn: originalTokens,
      tokensOut,
      savings: originalTokens - tokensOut,
      success: true,
    };
  } catch (err) {
    return {
      stage: 'pre-process',
      input: original,
      output: original,
      durationMs: Date.now() - start,
      tokensIn: originalTokens,
      tokensOut: originalTokens,
      savings: 0,
      success: false,
      error: String(err),
    };
  }
}

async function runProcessStage(
  _input: PipelineInput,
  preProcessed: string,
  _stageContext: StageContext,
): Promise<PipelineStageResult> {
  const start = Date.now();
  const tokensIn = estimateTokens(preProcessed);

  // In a real implementation, this would call the LLM
  // For now, simulate with a placeholder
  const simulatedResponse = `[Simulated response for: ${preProcessed.slice(0, 100)}...]`;
  const tokensOut = estimateTokens(simulatedResponse);

  return {
    stage: 'process',
    input: preProcessed,
    output: simulatedResponse,
    durationMs: Date.now() - start,
    tokensIn,
    tokensOut,
    savings: 0,
    success: true,
  };
}

async function runPostProcessStage(
  response: string,
  input: PipelineInput,
  config: OrchestratorConfig,
): Promise<PipelineStageResult> {
  const start = Date.now();
  const originalTokens = estimateTokens(response);

  try {
    if (!config.postProcessCompression) {
      return {
        stage: 'post-process',
        input: response,
        output: response,
        durationMs: Date.now() - start,
        tokensIn: originalTokens,
        tokensOut: originalTokens,
        savings: 0,
        success: true,
      };
    }

    // First apply chat level enforcement
    const enforced = enforceChatLevel(response, input.chatLevel ?? config.defaultChatLevel);

    // Then apply output compression
    const compressed = compressOutput(enforced.enforced, enforced.profile, {
      maxTokens: input.maxResponseTokens,
    });

    const tokensOut = estimateTokens(compressed.compressed);

    return {
      stage: 'post-process',
      input: response,
      output: compressed.compressed,
      durationMs: Date.now() - start,
      tokensIn: originalTokens,
      tokensOut,
      savings: originalTokens - tokensOut,
      success: true,
    };
  } catch (err) {
    return {
      stage: 'post-process',
      input: response,
      output: response,
      durationMs: Date.now() - start,
      tokensIn: originalTokens,
      tokensOut: originalTokens,
      savings: 0,
      success: false,
      error: String(err),
    };
  }
}

async function runCacheStoreStage(
  originalInput: string,
  response: string,
  tokensSaved: number,
  context: StageContext,
  input: PipelineInput,
): Promise<PipelineStageResult> {
  const start = Date.now();
  const tokensIn = estimateTokens(response);

  try {
    if (!input.cacheEnabled || !context.cacheKey) {
      return {
        stage: 'cache-store',
        input: response,
        output: null,
        durationMs: Date.now() - start,
        tokensIn,
        tokensOut: 0,
        savings: 0,
        success: true,
      };
    }

    context.cache.set(originalInput, response, tokensSaved, input.context ?? '', input.ttlMinutes);

    return {
      stage: 'cache-store',
      input: response,
      output: null,
      durationMs: Date.now() - start,
      tokensIn,
      tokensOut: 0,
      savings: tokensSaved,
      success: true,
    };
  } catch (err) {
    return {
      stage: 'cache-store',
      input: response,
      output: null,
      durationMs: Date.now() - start,
      tokensIn,
      tokensOut: 0,
      savings: 0,
      success: false,
      error: String(err),
    };
  }
}

// ─── Main Pipeline ───────────────────────────────────────────────────────────

export async function runPipeline(
  input: PipelineInput,
  options: {
    skipCache?: boolean;
    skipPreProcess?: boolean;
    skipPostProcess?: boolean;
  } = {},
): Promise<PipelineResult> {
  const startTime = Date.now();
  const config = getConfig();
  const stages: PipelineStageResult[] = [];
  const originalPrompt = input.prompt;
  const originalContext = input.context ?? '';

  // Initialize cache (lazy singleton)
  const cache = new ResponseCache({
    enabled: input.cacheEnabled ?? config.cacheEnabled,
    defaultTtlMinutes: input.ttlMinutes ?? config.cacheTtlMinutes,
  });

  const context: StageContext = { cache };

  // Stage 1: Cache Check
  const cacheCheck = await runCacheCheckStage(input, context);
  stages.push(cacheCheck);

  // If cache hit, return cached response
  if (cacheCheck.output && typeof cacheCheck.output === 'string' && cacheCheck.savings > 0) {
    const result: PipelineResult = {
      input,
      output: {
        response: cacheCheck.output,
        fromCache: true,
        cacheKey: context.cacheKey,
      },
      stages,
      metrics: {
        cacheHit: true,
        cacheTokensSaved: cacheCheck.savings,
        totalTokensIn: cacheCheck.tokensIn,
        totalTokensOut: cacheCheck.tokensOut,
        totalSavings: cacheCheck.savings,
        totalReduction: (cacheCheck.tokensOut / cacheCheck.tokensIn) * 100,
        estimatedCostSaved: cacheCheck.savings * 0.001, // Arbitrary unit
      },
      durationMs: Date.now() - startTime,
    };

    saveMetrics(result);
    return result;
  }

  // Stage 2: Pre-process (prompt compression)
  if (!options.skipPreProcess && config.preProcessCompression) {
    const preProcess = await runPreProcessStage(input, config);
    stages.push(preProcess);
    input = { ...input, prompt: preProcess.output as string };
  }

  // Stage 3: Process (LLM call - simulated)
  const process = await runProcessStage(input, input.prompt, context);
  stages.push(process);
  let response = process.output as string;

  // Stage 4: Post-process (output compression + chat level)
  if (!options.skipPostProcess && config.postProcessCompression) {
    const postProcess = await runPostProcessStage(response, input, config);
    stages.push(postProcess);
    response = postProcess.output as string;
  }

  // Stage 5: Cache Store
  const totalSavings = stages.reduce((sum, s) => sum + s.savings, 0);
  const cacheStore = await runCacheStoreStage(originalPrompt, response, totalSavings, context, {
    ...input,
    context: originalContext,
  });
  stages.push(cacheStore);

  const totalTokensIn = stages.reduce((sum, s) => sum + s.tokensIn, 0);
  const totalTokensOut = estimateTokens(response);

  const result: PipelineResult = {
    input: input,
    output: {
      response,
      fromCache: false,
      cacheKey: context.cacheKey,
    },
    stages,
    metrics: {
      cacheHit: false,
      cacheTokensSaved: 0,
      totalTokensIn,
      totalTokensOut,
      totalSavings: totalSavings,
      totalReduction:
        totalTokensIn > 0 ? ((totalTokensIn - totalTokensOut) / totalTokensIn) * 100 : 0,
      estimatedCostSaved: totalSavings * 0.001,
    },
    durationMs: Date.now() - startTime,
  };

  saveMetrics(result);
  return result;
}

// ─── Quick Optimization Functions ─────────────────────────────────────────────

export function optimizePrompt(prompt: string, skill?: string): PromptCompressionResult {
  return compressPrompt(prompt, skill ?? 'default');
}

export function optimizeResponse(
  response: string,
  chatLevel: ChatLevel = 'chat-compact',
  profile?: 'ultra' | 'lleno' | 'lite' | 'simple',
): { chatEnforcement: ChatLevelEnforcementResult; outputCompression: OutputCompressionResult } {
  const chatEnforcement = enforceChatLevel(response, chatLevel);
  const outputCompression = compressOutput(chatEnforcement.enforced, profile ?? 'auto');

  return { chatEnforcement, outputCompression };
}

export function checkCache(prompt: string, context?: string): { hit: boolean; response?: string } {
  const cache = new ResponseCache();
  const cached = cache.get(prompt, context ?? '');
  return { hit: !!cached, response: cached?.response };
}

// ─── Metrics & Stats ──────────────────────────────────────────────────────────

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function saveMetrics(result: PipelineResult): void {
  try {
    const config = getConfig();
    if (!config.metricsEnabled) return;

    const metricsPath = join(ROOT, config.metricsStoragePath);
    const metrics: PipelineResult[] = [];

    if (existsSync(metricsPath)) {
      const existing = JSON.parse(readFileSync(metricsPath, 'utf-8'));
      if (Array.isArray(existing)) metrics.push(...existing);
    }

    metrics.push(result);

    // Keep only last 1000 results
    while (metrics.length > 1000) metrics.shift();

    ensureDir(metricsPath);
    writeFileSync(metricsPath, JSON.stringify(metrics, null, 2));

    // Update aggregate stats
    updateStats(result);
  } catch {
    /* ignore */
  }
}

function updateStats(result: PipelineResult): void {
  try {
    let stats: OrchestratorStats = {
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      cacheHits: 0,
      cacheMisses: 0,
      cacheHitRate: 0,
      totalTokenSavings: 0,
      avgSavingsPct: 0,
      byStage: {
        'cache-check': { runs: 0, avgDurationMs: 0, avgSavings: 0 },
        'pre-process': { runs: 0, avgDurationMs: 0, avgSavings: 0 },
        process: { runs: 0, avgDurationMs: 0, avgSavings: 0 },
        'post-process': { runs: 0, avgDurationMs: 0, avgSavings: 0 },
        'cache-store': { runs: 0, avgDurationMs: 0, avgSavings: 0 },
      },
    };

    if (existsSync(STATS_PATH)) {
      stats = JSON.parse(readFileSync(STATS_PATH, 'utf-8'));
    }

    stats.totalRuns++;
    stats.successfulRuns++;
    stats.totalTokenSavings += result.metrics.totalSavings;

    if (result.metrics.cacheHit) {
      stats.cacheHits++;
    } else {
      stats.cacheMisses++;
    }

    const total = stats.cacheHits + stats.cacheMisses;
    stats.cacheHitRate = total > 0 ? (stats.cacheHits / total) * 100 : 0;

    // Update per-stage stats
    for (const stage of result.stages) {
      const s = stats.byStage[stage.stage];
      if (s) {
        s.runs++;
        s.avgDurationMs = (s.avgDurationMs * (s.runs - 1) + stage.durationMs) / s.runs;
        s.avgSavings = (s.avgSavings * (s.runs - 1) + stage.savings) / s.runs;
      }
    }

    // Calculate average savings
    const orchestratorConfig = getConfig();
    const allRuns = JSON.parse(
      readFileSync(join(ROOT, orchestratorConfig.metricsStoragePath), 'utf-8') || '[]',
    );
    if (Array.isArray(allRuns) && allRuns.length > 0) {
      const totalSavings = allRuns.reduce(
        (sum: number, r: PipelineResult) => sum + r.metrics.totalSavings,
        0,
      );
      stats.avgSavingsPct = totalSavings / allRuns.length;
    }

    ensureDir(STATS_PATH);
    writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2));
  } catch {
    /* ignore */
  }
}

function loadStats(): OrchestratorStats {
  try {
    if (existsSync(STATS_PATH)) {
      return JSON.parse(readFileSync(STATS_PATH, 'utf-8')) as OrchestratorStats;
    }
  } catch {
    /* ignore */
  }

  return {
    totalRuns: 0,
    successfulRuns: 0,
    failedRuns: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheHitRate: 0,
    totalTokenSavings: 0,
    avgSavingsPct: 0,
    byStage: {
      'cache-check': { runs: 0, avgDurationMs: 0, avgSavings: 0 },
      'pre-process': { runs: 0, avgDurationMs: 0, avgSavings: 0 },
      process: { runs: 0, avgDurationMs: 0, avgSavings: 0 },
      'post-process': { runs: 0, avgDurationMs: 0, avgSavings: 0 },
      'cache-store': { runs: 0, avgDurationMs: 0, avgSavings: 0 },
    },
  };
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export function generateReport(): {
  stats: OrchestratorStats;
  config: OrchestratorConfig;
  recommendations: string[];
} {
  const stats = loadStats();
  const config = getConfig();

  const recommendations: string[] = [];

  if (stats.cacheHitRate < 10) {
    recommendations.push('Consider increasing cache TTL to improve hit rate');
  }

  if (stats.byStage['pre-process'].avgSavings < 50) {
    recommendations.push('Pre-process compression savings are low - review prompt patterns');
  }

  if (stats.byStage['post-process'].avgSavings < 100) {
    recommendations.push(
      'Post-process compression savings are low - consider stricter chat levels',
    );
  }

  return { stats, config, recommendations };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`
Token Optimization Orchestrator

Usage:
  npx tsx src/tokens/token-optimization-orchestrator.ts --mode pipeline --input "prompt text"
  npx tsx src/tokens/token-optimization-orchestrator.ts --mode optimize-prompt --input "..." [--skill name]
  npx tsx src/tokens/token-optimization-orchestrator.ts --mode optimize-response --input "..." [--level chat-compact]
  npx tsx src/tokens/token-optimization-orchestrator.ts --cache-check --input "prompt"
  npx tsx src/tokens/token-optimization-orchestrator.ts --stats
  npx tsx src/tokens/token-optimization-orchestrator.ts --report

Modes:
  pipeline         - Run full optimization pipeline
  optimize-prompt  - Compress input prompt only
  optimize-response - Compress output response only
  check            - Check token budget status

Options:
  --input TEXT          Input text
  --file PATH           Read input from file
  --skill NAME          Skill for prompt compression
  --level NAME          Chat level (chat-compact|chat-balanced|chat-detailed)
  --profile NAME        Compression profile (ultra|lleno|lite|simple)
  --context TEXT        Context for cache key
  --ttl MINUTES         Cache TTL in minutes
  --skip-cache          Skip cache check/store
  --skip-pre-process    Skip prompt compression
  --skip-post-process   Skip response compression
  --json                Output as JSON
  --quiet               Suppress extra output
  --stats               Show statistics
  --report              Generate optimization report
  --clear-metrics       Clear all stored metrics

Examples:
  npx tsx src/tokens/token-optimization-orchestrator.ts --mode optimize-prompt --input "Long prompt..."
  npx tsx src/tokens/token-optimization-orchestrator.ts --mode optimize-response --input "Long response..." --level chat-compact
  npx tsx src/tokens/token-optimization-orchestrator.ts --mode pipeline --input "Create a function..." --skill typescript

Note:
  The "process" stage of --mode pipeline uses a SIMULATED LLM response.
  This mode benchmarks the compression pipeline and measures token savings
  WITHOUT making real LLM calls. For real LLM calls use the LLM Call Wrapper:
    npx tsx src/llm-call-wrapper.ts --prompt "..." [--model "..."]
`);
}

function formatPipelineResult(result: PipelineResult): string {
  const lines: string[] = [
    '',
    '╔═══════════════════════════════════════════════════╗',
    '║     Token Optimization Orchestrator Result        ║',
    '╚═══════════════════════════════════════════════════╝',
    '',
    `  Duration:      ${result.durationMs}ms`,
    `  From Cache:    ${result.output.fromCache ? 'Yes ✓' : 'No'}`,
    '',
    '  ── Stages ──────────────────────────────────────',
    '',
  ];

  for (const stage of result.stages) {
    const status = stage.success ? '✓' : '✗';
    const savings = stage.savings > 0 ? `(-${stage.savings} tokens)` : '';
    lines.push(`    ${status} ${stage.stage.padEnd(15)} ${stage.durationMs}ms  ${savings}`);
  }

  lines.push(
    '',
    '  ── Metrics ─────────────────────────────────────',
    '',
    `    Total Input:           ~${result.metrics.totalTokensIn} tokens`,
    `    Total Output:          ~${result.metrics.totalTokensOut} tokens`,
    `    Total Savings:         ${result.metrics.totalSavings} tokens`,
    `    Reduction:             ${result.metrics.totalReduction.toFixed(1)}%`,
    `    Cache Hit:             ${result.metrics.cacheHit ? 'Yes' : 'No'}`,
  );

  if (result.metrics.cacheHit) {
    lines.push(`    Cache Tokens Saved:    ${result.metrics.cacheTokensSaved}`);
  }

  lines.push(
    '',
    '  ── Output ───────────────────────────────────────',
    '',
    result.output.response.slice(0, 500),
  );

  if (result.output.response.length > 500) {
    lines.push('...');
  }

  lines.push('');
  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const modeIdx = args.indexOf('--mode');
  const inputIdx = args.indexOf('--input');
  const fileIdx = args.indexOf('--file');
  const skillIdx = args.indexOf('--skill');
  const levelIdx = args.indexOf('--level');
  const profileIdx = args.indexOf('--profile');
  const contextIdx = args.indexOf('--context');
  const ttlIdx = args.indexOf('--ttl');
  const cacheCheckFlag = args.includes('--cache-check');
  const statsFlag = args.includes('--stats');
  const reportFlag = args.includes('--report');
  const skipCacheFlag = args.includes('--skip-cache');
  const quietFlag = args.includes('--quiet');
  const jsonFlag = args.includes('--json');
  const clearMetricsFlag = args.includes('--clear-metrics');

  if (clearMetricsFlag) {
    try {
      if (existsSync(METRICS_PATH)) {
        writeFileSync(METRICS_PATH, '[]');
        console.log('[OK] Metrics cleared');
      }
      if (existsSync(STATS_PATH)) {
        writeFileSync(
          STATS_PATH,
          JSON.stringify(
            {
              totalRuns: 0,
              successfulRuns: 0,
              failedRuns: 0,
              cacheHits: 0,
              cacheMisses: 0,
              cacheHitRate: 0,
              totalTokenSavings: 0,
              avgSavingsPct: 0,
              byStage: {},
            },
            null,
            2,
          ),
        );
        console.log('[OK] Stats cleared');
      }
    } catch (err) {
      console.error('Error clearing metrics:', err);
    }
    return;
  }

  if (statsFlag) {
    const stats = loadStats();
    if (jsonFlag) {
      console.log(JSON.stringify(stats, null, 2));
      return;
    }
    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log('║    Token Optimization Statistics     ║');
    console.log('╚══════════════════════════════════════╝');
    console.log('');
    console.log(`  Total Runs:           ${stats.totalRuns}`);
    console.log(`  Successful:           ${stats.successfulRuns}`);
    console.log(`  Cache Hits:           ${stats.cacheHits} (${stats.cacheHitRate.toFixed(1)}%)`);
    console.log(`  Total Token Savings:  ${stats.totalTokenSavings.toLocaleString()}`);
    console.log(`  Avg Savings Per Run:  ${stats.avgSavingsPct.toFixed(0)} tokens`);
    console.log('');
    console.log('  By Stage:');
    for (const [stage, s] of Object.entries(stats.byStage)) {
      console.log(
        `    ${stage.padEnd(15)} ${s.runs} runs, ${s.avgDurationMs.toFixed(0)}ms avg, ${s.avgSavings.toFixed(0)} tokens saved`,
      );
    }
    console.log('');
    return;
  }

  if (reportFlag) {
    const report = generateReport();
    if (jsonFlag) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log('║    Token Optimization Report         ║');
    console.log('╚══════════════════════════════════════╝');
    console.log('');
    console.log(`  Total Runs:       ${report.stats.totalRuns}`);
    console.log(`  Cache Hit Rate:   ${report.stats.cacheHitRate.toFixed(1)}%`);
    console.log(`  Token Savings:    ${report.stats.totalTokenSavings.toLocaleString()}`);
    console.log('');
    console.log('  Recommendations:');
    if (report.recommendations.length === 0) {
      console.log('    No recommendations - optimization is performing well');
    } else {
      for (const rec of report.recommendations) {
        console.log(`    • ${rec}`);
      }
    }
    console.log('');
    return;
  }

  if (cacheCheckFlag) {
    let input = '';
    if (inputIdx >= 0) {
      input = args[inputIdx + 1] ?? '';
    } else if (fileIdx >= 0) {
      const filePath = args[fileIdx + 1] ?? '';
      if (existsSync(filePath)) {
        input = readFileSync(filePath, 'utf-8');
      }
    }
    const context = contextIdx >= 0 ? args[contextIdx + 1] : '';
    const result = checkCache(input, context);

    if (jsonFlag) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(result.hit ? 'Cache HIT' : 'Cache MISS');
    if (result.response) {
      console.log(`Response: ${result.response.slice(0, 200)}...`);
    }
    return;
  }

  const mode = modeIdx >= 0 ? args[modeIdx + 1] : 'pipeline';

  let input = '';
  if (inputIdx >= 0) {
    input = args[inputIdx + 1] ?? '';
  } else if (fileIdx >= 0) {
    const filePath = args[fileIdx + 1] ?? '';
    if (!existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }
    input = readFileSync(filePath, 'utf-8');
  }

  if (!input && !statsFlag && !reportFlag) {
    printUsage();
    process.exit(1);
  }

  const skill = skillIdx >= 0 ? args[skillIdx + 1] : undefined;
  const level = (levelIdx >= 0 ? args[levelIdx + 1] : 'chat-compact') as ChatLevel;
  const profile =
    profileIdx >= 0 ? (args[profileIdx + 1] as 'ultra' | 'lleno' | 'lite' | 'simple') : undefined;
  const context = contextIdx >= 0 ? args[contextIdx + 1] : undefined;
  const ttl = ttlIdx >= 0 ? parseInt(args[ttlIdx + 1] ?? '60', 10) : undefined;

  switch (mode) {
    case 'optimize-prompt': {
      const result = optimizePrompt(input, skill);
      if (jsonFlag) {
        console.log(JSON.stringify(result, null, 2));
      } else if (!quietFlag) {
        console.log(result.compressed);
      } else {
        console.log(result.compressed);
      }
      break;
    }

    case 'optimize-response': {
      const result = optimizeResponse(input, level, profile);
      if (jsonFlag) {
        console.log(JSON.stringify(result, null, 2));
      } else if (!quietFlag) {
        console.log('Chat Level Enforcement:');
        console.log(`  Level: ${result.chatEnforcement.level}`);
        console.log(
          `  Lines: ${result.chatEnforcement.originalLines} → ${result.chatEnforcement.enforcedLines}`,
        );
        console.log('');
        console.log('Output Compression:');
        console.log(`  Profile: ${result.outputCompression.profile}`);
        console.log(`  Savings: ${result.outputCompression.tokenSavings} tokens`);
        console.log('');
        console.log('Result:');
        console.log(result.outputCompression.compressed);
      } else {
        console.log(result.outputCompression.compressed);
      }
      break;
    }

    case 'pipeline':
    default: {
      if (!quietFlag) {
        console.warn(
          '[token-optimization] ℹ Mode "pipeline" uses a SIMULATED LLM response — benchmarks the compression pipeline without real LLM calls. Use src/llm-call-wrapper.ts for real calls.',
        );
      }
      const pipelineInput: PipelineInput = {
        prompt: input,
        context,
        skill,
        chatLevel: level,
        cacheEnabled: !skipCacheFlag,
        ttlMinutes: ttl,
      };

      const result = await runPipeline(pipelineInput);

      if (jsonFlag) {
        console.log(JSON.stringify(result, null, 2));
      } else if (!quietFlag) {
        console.log(formatPipelineResult(result));
      } else {
        console.log(result.output.response);
      }
      break;
    }
  }
}

// ─── Run CLI if called directly
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
