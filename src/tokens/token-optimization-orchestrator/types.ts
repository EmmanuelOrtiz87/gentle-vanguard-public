import type { CompressionResult as PromptCompressionResult } from '../../compression/prompt-compression.js';
import type { CompressionResult as OutputCompressionResult } from '../../compression/output-compression.js';
import type {
  ChatLevelEnforcementResult,
  ChatLevel,
} from '../../orchestration/chat-level-enforcer.js';

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
