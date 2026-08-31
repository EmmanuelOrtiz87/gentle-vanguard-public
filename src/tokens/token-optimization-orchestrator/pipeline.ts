import { compressPrompt } from '../../compression/prompt-compression.js';
import { compressOutput } from '../../compression/output-compression.js';
import { enforceChatLevel } from '../../orchestration/chat-level-enforcer.js';
import { ResponseCache, generateCacheKey } from '../../resilience/response-cache.js';
import { getConfig } from './config.js';
import { saveMetrics } from './metrics.js';
import type {
  PipelineInput,
  PipelineResult,
  PipelineStageResult,
  OrchestratorConfig,
} from './types.js';

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

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

export { estimateTokens };
export type { StageContext };
