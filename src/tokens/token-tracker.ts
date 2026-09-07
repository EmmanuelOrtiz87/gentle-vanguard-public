#!/usr/bin/env node
/**
 * Token Tracker API Integration
 *
 * Captures actual token usage from AI API responses and integrates with
 * the token budget tracking system.
 *
 * Features:
 * - Intercepts API responses to extract token counts
 * - Tracks input/output tokens separately
 * - Calculates actual costs based on provider pricing
 * - Integrates with token-budget-guard
 * - Provides real-time token usage metrics
 *
 * Usage:
 *   Import and use in API calls:
 *   const tracker = new TokenTracker();
 *   const result = await tracker.trackApiCall(apiCallFn, args);
 */

import { pathToFileURL } from 'url';
import { createRequire } from 'module';
import type { DatabaseManager } from '../database/nexus//manager.js';

const _require = createRequire(import.meta.url);

// Lazy db import — Nexus SQLite is the single persistence authority.
let _db: DatabaseManager | null = null;
function getDb(): DatabaseManager | null {
  if (!_db) {
    try {
      const mod = _require('../database/nexus//manager');
      _db = mod.DatabaseManager.getInstance();
    } catch {
      // SQLite not available — reads return empty aggregates
    }
  }
  return _db;
}

/**
 * DI injection point (STACK-EVOLUTION-PLAN F2.6 batch 2).
 * Container-injected db handle takes precedence over the lazy require().
 */
export function setTokenTrackerDb(handle: DatabaseManager | null): void {
  _db = handle;
}

interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: string;
}

interface ApiResponse {
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
  };
}

interface ProviderPricing {
  inputPer1M: number;
  outputPer1M: number;
  cachedInputPer1M?: number;
}

// Provider pricing (USD per 1M tokens)
const PROVIDER_PRICING: Record<string, Record<string, ProviderPricing>> = {
  openai: {
    'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10.0, cachedInputPer1M: 1.25 },
    'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
    'gpt-4-turbo': { inputPer1M: 10.0, outputPer1M: 30.0 },
  },
  anthropic: {
    'claude-3-5-sonnet': { inputPer1M: 3.0, outputPer1M: 15.0 },
    'claude-3-opus': { inputPer1M: 15.0, outputPer1M: 75.0 },
    'claude-3-haiku': { inputPer1M: 0.25, outputPer1M: 1.25 },
  },
  openrouter: {
    default: { inputPer1M: 1.0, outputPer1M: 3.0 },
  },
};

// ─── Token Tracker Class ──────────────────────────────────────────────────────

export class TokenTracker {
  private provider: string;
  private model: string;
  private sessionId: string;

  constructor(provider: string = 'unknown', model: string = 'unknown', sessionId: string = '') {
    this.provider = provider.toLowerCase();
    this.model = model.toLowerCase();
    this.sessionId = sessionId || `session-${Date.now()}`;
  }

  /**
   * Extract token usage from API response
   */
  extractTokenUsage(response: ApiResponse): TokenUsage {
    const usage = response?.usage || {};

    const promptTokens = usage.prompt_tokens || 0;
    const completionTokens = usage.completion_tokens || 0;
    const totalTokens = usage.total_tokens || promptTokens + completionTokens;

    return {
      promptTokens,
      completionTokens,
      totalTokens,
    };
  }

  /**
   * Calculate cost based on provider and model
   */
  calculateCost(usage: TokenUsage): CostBreakdown {
    const pricing = this.getPricing();

    const inputCost = (usage.promptTokens / 1_000_000) * pricing.inputPer1M;
    const outputCost = (usage.completionTokens / 1_000_000) * pricing.outputPer1M;

    return {
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      currency: 'USD',
    };
  }

  private getPricing(): ProviderPricing {
    const providerPricing = PROVIDER_PRICING[this.provider];
    if (!providerPricing) {
      return { inputPer1M: 1.0, outputPer1M: 3.0 }; // Default
    }

    // Try exact model match first
    if (providerPricing[this.model]) {
      return providerPricing[this.model];
    }

    // Try partial match
    for (const [modelKey, pricing] of Object.entries(providerPricing)) {
      if (this.model.includes(modelKey) || modelKey.includes(this.model)) {
        return pricing;
      }
    }

    // Return default for provider
    return providerPricing['default'] || { inputPer1M: 1.0, outputPer1M: 3.0 };
  }

  /**
   * Persist token usage to Nexus SQLite (single authority).
   */
  logTokenUsage(
    task: string,
    usage: TokenUsage,
    cost: CostBreakdown,
    _metadata: Record<string, any> = {},
  ): void {
    try {
      const mgr = getDb();
      if (mgr) {
        mgr.recordTokenUsage(
          this.sessionId,
          usage.promptTokens,
          usage.completionTokens,
          cost.totalCost,
          `${this.provider}/${this.model}`,
        );
      }
    } catch {
      // Persistence failure is non-critical for the tracked call itself
    }
  }

  /**
   * Track an API call and extract token usage
   *
   * Usage:
   *   const tracker = new TokenTracker('openai', 'gpt-4o');
   *   const result = await tracker.trackApiCall(
   *     () => openai.chat.completions.create({...}),
   *     'my-task'
   *   );
   */
  async trackApiCall<T extends ApiResponse>(
    apiCall: () => Promise<T>,
    task: string,
    metadata: Record<string, any> = {},
  ): Promise<{ response: T; usage: TokenUsage; cost: CostBreakdown }> {
    const startTime = Date.now();

    try {
      const response = await apiCall();
      const duration = Date.now() - startTime;

      const usage = this.extractTokenUsage(response);
      const cost = this.calculateCost(usage);

      this.logTokenUsage(task, usage, cost, {
        ...metadata,
        duration,
        success: true,
      });

      return { response, usage, cost };
    } catch (error) {
      const duration = Date.now() - startTime;

      this.logTokenUsage(
        task,
        { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        {
          inputCost: 0,
          outputCost: 0,
          totalCost: 0,
          currency: 'USD',
        },
        {
          ...metadata,
          duration,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
      );

      throw error;
    }
  }

  /**
   * Get today's token usage summary (from Nexus SQLite).
   */
  getTodayUsage(): { tokens: number; cost: number; calls: number } {
    try {
      const mgr = getDb();
      if (!mgr) return { tokens: 0, cost: 0, calls: 0 };
      const row = mgr.database
        .prepare(
          `SELECT COALESCE(SUM(total_tokens), 0) AS tokens,
                  COALESCE(SUM(cost), 0) AS cost,
                  COUNT(*) AS calls
           FROM token_usage
           WHERE date(timestamp) = date('now')`,
        )
        .get() as { tokens: number; cost: number; calls: number };
      return { tokens: row.tokens, cost: row.cost, calls: row.calls };
    } catch {
      return { tokens: 0, cost: 0, calls: 0 };
    }
  }

  /**
   * Get usage statistics for a date range (from Nexus SQLite).
   */
  getUsageStats(
    startDate: string,
    endDate: string,
  ): {
    totalTokens: number;
    totalCost: number;
    totalCalls: number;
    byProvider: Record<string, { tokens: number; cost: number; calls: number }>;
    byModel: Record<string, { tokens: number; cost: number; calls: number }>;
  } {
    const empty = {
      totalTokens: 0,
      totalCost: 0,
      totalCalls: 0,
      byProvider: {} as Record<string, { tokens: number; cost: number; calls: number }>,
      byModel: {} as Record<string, { tokens: number; cost: number; calls: number }>,
    };
    try {
      const mgr = getDb();
      if (!mgr) return empty;
      const rows = mgr.database
        .prepare(
          `SELECT model,
                  COALESCE(SUM(total_tokens), 0) AS tokens,
                  COALESCE(SUM(cost), 0) AS cost,
                  COUNT(*) AS calls
           FROM token_usage
           WHERE date(timestamp) BETWEEN ? AND ?
           GROUP BY model`,
        )
        .all(startDate, endDate) as Array<{
        model: string | null;
        tokens: number;
        cost: number;
        calls: number;
      }>;

      let totalTokens = 0;
      let totalCost = 0;
      let totalCalls = 0;
      const byProvider: typeof empty.byProvider = {};
      const byModel: typeof empty.byModel = {};

      for (const row of rows) {
        const modelKey = row.model || 'unknown';
        const slash = modelKey.indexOf('/');
        const provider = slash > 0 ? modelKey.slice(0, slash) : 'unknown';
        const model = slash > 0 ? modelKey.slice(slash + 1) : modelKey;

        totalTokens += row.tokens;
        totalCost += row.cost;
        totalCalls += row.calls;

        for (const [bucket, key] of [
          [byProvider, provider],
          [byModel, model],
        ] as const) {
          if (!bucket[key]) bucket[key] = { tokens: 0, cost: 0, calls: 0 };
          bucket[key].tokens += row.tokens;
          bucket[key].cost += row.cost;
          bucket[key].calls += row.calls;
        }
      }

      return { totalTokens, totalCost, totalCalls, byProvider, byModel };
    } catch {
      return empty;
    }
  }
}

// ─── CLI Interface ──────────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`
Token Tracker API Integration

Usage:
  npx tsx src/tokens/token-tracker.ts <command> [options]

Commands:
  today                    Show today's token usage
  stats <start> <end>      Show usage stats for date range (YYYY-MM-DD)
  test                     Run integration tests
  pricing                  Show provider pricing

Examples:
  npx tsx src/tokens/token-tracker.ts today
  npx tsx src/tokens/token-tracker.ts stats 2026-07-20 2026-07-24
`);
}

function runCLI(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'today': {
      const tracker = new TokenTracker();
      const usage = tracker.getTodayUsage();
      console.log("\n=== Today's Token Usage ===\n");
      console.log(`Total Tokens: ${usage.tokens.toLocaleString()}`);
      console.log(`Total Cost:   $${usage.cost.toFixed(4)} USD`);
      console.log(`API Calls:    ${usage.calls}`);
      console.log();
      break;
    }

    case 'stats': {
      const startDate = args[1];
      const endDate = args[2];

      if (!startDate || !endDate) {
        console.error('Error: Start and end dates required (YYYY-MM-DD)');
        process.exit(1);
      }

      const tracker = new TokenTracker();
      const stats = tracker.getUsageStats(startDate, endDate);

      console.log(`\n=== Token Usage Stats (${startDate} to ${endDate}) ===\n`);
      console.log(`Total Tokens: ${stats.totalTokens.toLocaleString()}`);
      console.log(`Total Cost:   $${stats.totalCost.toFixed(4)} USD`);
      console.log(`Total Calls:  ${stats.totalCalls}`);

      console.log('\n--- By Provider ---');
      for (const [provider, data] of Object.entries(stats.byProvider)) {
        console.log(
          `${provider}: ${data.tokens.toLocaleString()} tokens, $${data.cost.toFixed(4)}, ${data.calls} calls`,
        );
      }

      console.log('\n--- By Model ---');
      for (const [model, data] of Object.entries(stats.byModel)) {
        console.log(
          `${model}: ${data.tokens.toLocaleString()} tokens, $${data.cost.toFixed(4)}, ${data.calls} calls`,
        );
      }
      console.log();
      break;
    }

    case 'pricing': {
      console.log('\n=== Provider Pricing (USD per 1M tokens) ===\n');
      for (const [provider, models] of Object.entries(PROVIDER_PRICING)) {
        console.log(`${provider}:`);
        for (const [model, pricing] of Object.entries(models)) {
          console.log(`  ${model}: $${pricing.inputPer1M} input / $${pricing.outputPer1M} output`);
        }
      }
      console.log();
      break;
    }

    case 'test': {
      console.log('\n=== Running Token Tracker Tests ===\n');

      // Test 1: Token extraction
      console.log('Test 1: Token extraction from API response');
      const tracker = new TokenTracker('openai', 'gpt-4o');
      const mockResponse = {
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 500,
          total_tokens: 1500,
        },
      };
      const usage = tracker.extractTokenUsage(mockResponse);
      console.log(
        usage.promptTokens === 1000 && usage.completionTokens === 500 ? '✅ PASS' : '❌ FAIL',
      );

      // Test 2: Cost calculation
      console.log('Test 2: Cost calculation');
      const cost = tracker.calculateCost(usage);
      const expectedCost = (1000 / 1_000_000) * 2.5 + (500 / 1_000_000) * 10.0;
      console.log(Math.abs(cost.totalCost - expectedCost) < 0.001 ? '✅ PASS' : '❌ FAIL');

      // Test 3: Today's usage (should be 0 or existing)
      console.log("Test 3: Today's usage query");
      const todayUsage = tracker.getTodayUsage();
      console.log(typeof todayUsage.tokens === 'number' ? '✅ PASS' : '❌ FAIL');

      console.log('\n=== Tests Complete ===\n');
      break;
    }

    default:
      printUsage();
      process.exit(1);
  }
}

// Run CLI if called directly
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCLI();
}
