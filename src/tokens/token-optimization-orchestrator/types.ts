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
  previousTurns?: string[];
  sessionId?: string;
  useSessionHistory?: boolean;
  historyTurns?: number;
  maxPromptTokens?: number;
  maxResponseTokens?: number;
  chatLevel?: ChatLevel;
  cacheEnabled?: boolean;
  ttlMinutes?: number;
  /**
   * The process stage of this orchestrator never calls a real LLM (it returns a
   * simulated response), so pipeline runs default to `simulated: true` and their
   * "savings" must never be reported as production token spend.
   */
  simulated?: boolean;
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
  /** All runs are simulated today; kept explicit so stats never mix both. */
  simulated: boolean;
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
  /** Runs measured over the simulated process stage (the only kind today). */
  simulatedRuns: number;
  simulatedTokenSavings: number;
  /** Runs where the caller supplied a real LLM response; 0 until one wires it. */
  realRuns: number;
  realTokenSavings: number;
  /** Real savings only — simulated figures never land here. */
  totalTokenSavings: number;
  /** Average real savings per real run (tokens). */
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
