#!/usr/bin/env npx tsx
/**
 * Smart Model Router - Intelligent fallback and health checking
 *
 * Monitors model health and auto-switches on errors.
 * Used by orchestrator and subagents for resilient model routing.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const REGISTRY_PATH = join(ROOT, 'config', 'model-health-registry.json');
const ACTIVE_MODEL_PATH = join(ROOT, '.runtime', 'model-active.json');
const LOG_PATH = join(ROOT, '.runtime', 'logs', 'model-router.log');
void LOG_PATH; // Reserved for future logging implementation

interface ModelHealth {
  status: 'available' | 'degraded' | 'unavailable' | 'unknown';
  lastChecked: string | null;
  consecutiveErrors: number;
  avgLatencyMs: number | null;
  lastError?: string;
}

interface ModelEntry {
  provider: string;
  tier: 'free' | 'balanced' | 'premium' | 'local';
  costPer1kTokens: { input: number; output: number };
  health: ModelHealth;
  fallbackChain: string[];
  capabilities: string[];
  maxTokens: number;
  requiresLocal?: boolean;
  checkEndpoint?: string;
}

interface ModelRegistry {
  models: Record<string, ModelEntry>;
  routingRules: {
    orchestrator: { primary: string; fallbackStrategy: string };
    subagents: { inheritFromOrchestrator: boolean; allowOverride: boolean };
  };
  errorPatterns: Record<string, string[]>;
  fallbackStrategies?: Record<string, string[]>;
}

interface ActiveModel {
  model: string;
  provider: string;
  changedAt: string;
  source: string;
  health?: ModelHealth;
}

// Load registry
function loadRegistry(): ModelRegistry {
  const content = readFileSync(REGISTRY_PATH, 'utf-8');
  return JSON.parse(content);
}

// Save active model
function saveActiveModel(model: string, provider: string, source: string): void {
  const entry: ActiveModel = {
    model,
    provider,
    changedAt: new Date().toISOString(),
    source,
  };
  writeFileSync(ACTIVE_MODEL_PATH, JSON.stringify(entry, null, 2));
}

// Check model health via simple ping
async function checkModelHealth(modelId: string, entry: ModelEntry): Promise<ModelHealth> {
  const startTime = Date.now();

  try {
    // For local providers like Ollama, check if endpoint is reachable
    if (entry.requiresLocal && entry.checkEndpoint) {
      const response = await fetch(entry.checkEndpoint, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        return {
          status: 'available',
          lastChecked: new Date().toISOString(),
          consecutiveErrors: 0,
          avgLatencyMs: Date.now() - startTime,
        };
      }
    }

    // For API providers, we trust the cache until an error occurs
    return {
      status: entry.health?.status || 'unknown',
      lastChecked: new Date().toISOString(),
      consecutiveErrors: entry.health?.consecutiveErrors || 0,
      avgLatencyMs: entry.health?.avgLatencyMs,
    };
  } catch (error) {
    return {
      status: 'unavailable',
      lastChecked: new Date().toISOString(),
      consecutiveErrors: (entry.health?.consecutiveErrors || 0) + 1,
      avgLatencyMs: null,
      lastError: error instanceof Error ? error.message : String(error),
    };
  }
}

// Detect error type from message
function detectErrorType(errorMessage: string, patterns: Record<string, string[]>): string | null {
  const lowerMsg = errorMessage.toLowerCase();

  for (const [type, patterns_list] of Object.entries(patterns)) {
    if (patterns_list.some((pattern) => lowerMsg.includes(pattern))) {
      return type;
    }
  }
  return null;
}

// Get next fallback model
function getFallbackModel(
  currentModel: string,
  registry: ModelRegistry,
  strategy: string = 'cost-optimized',
): { model: string; entry: ModelEntry } | null {
  const currentEntry = registry.models[currentModel];
  if (!currentEntry) return null;

  // Try fallback chain first
  for (const fallbackId of currentEntry.fallbackChain) {
    const fallbackEntry = registry.models[fallbackId];
    if (fallbackEntry && fallbackEntry.health.status !== 'unavailable') {
      return { model: fallbackId, entry: fallbackEntry };
    }
  }

  // Try strategy-based fallback
  const strategyChain = registry.fallbackStrategies?.[
    strategy as keyof typeof registry.fallbackStrategies
  ] as string[] | undefined;
  if (strategyChain) {
    for (const modelId of strategyChain) {
      if (modelId === currentModel) continue;
      const entry = registry.models[modelId];
      if (entry && entry.health.status !== 'unavailable') {
        return { model: modelId, entry };
      }
    }
  }

  return null;
}

// Main router function
async function routeModel(
  requestedModel: string,
  errorContext?: { error: string; agentType: 'orchestrator' | 'subagent' },
): Promise<{ model: string; provider: string; switched: boolean; reason?: string }> {
  const registry = loadRegistry();

  // If error occurred, try to fallback
  if (errorContext) {
    const errorType = detectErrorType(errorContext.error, registry.errorPatterns);
    const currentEntry = registry.models[requestedModel];

    // Update health status
    if (currentEntry) {
      currentEntry.health.consecutiveErrors++;
      currentEntry.health.lastError = errorContext.error;
      if (currentEntry.health.consecutiveErrors >= 3) {
        currentEntry.health.status = 'unavailable';
      }
    }

    // Get fallback
    const fallback = getFallbackModel(
      requestedModel,
      registry,
      registry.routingRules.orchestrator.fallbackStrategy,
    );

    if (fallback) {
      saveActiveModel(fallback.model, fallback.entry.provider, `fallback-${errorType}`);
      return {
        model: fallback.model,
        provider: fallback.entry.provider,
        switched: true,
        reason: `Auto-switched from ${requestedModel} due to ${errorType}: ${errorContext.error}`,
      };
    }
  }

  // No error or no fallback available, use requested model
  const entry = registry.models[requestedModel];
  if (entry) {
    return {
      model: requestedModel,
      provider: entry.provider,
      switched: false,
    };
  }

  // Model not found, return default
  const defaultModel = registry.routingRules.orchestrator.primary;
  const defaultEntry = registry.models[defaultModel];
  return {
    model: defaultModel,
    provider: defaultEntry?.provider || 'opencode',
    switched: true,
    reason: `Model ${requestedModel} not found in registry, using default`,
  };
}

// CLI interface
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'check': {
      const registry = loadRegistry();
      console.log('Model Health Status:');
      for (const [id, entry] of Object.entries(registry.models)) {
        const cost = entry.costPer1kTokens;
        console.log(`  ${id}: ${entry.health.status} ($${cost.input}/$${cost.output} per 1k)`);
      }
      break;
    }

    case 'route': {
      const model = args[1] || 'opencode/deepseek-v4-flash-free';
      const error = args[2];
      const result = await routeModel(
        model,
        error ? { error, agentType: 'orchestrator' } : undefined,
      );
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'get-active': {
      if (existsSync(ACTIVE_MODEL_PATH)) {
        const active = JSON.parse(readFileSync(ACTIVE_MODEL_PATH, 'utf-8'));
        console.log(JSON.stringify(active, null, 2));
      } else {
        console.log('No active model set');
      }
      break;
    }

    case 'health-check': {
      const registry = loadRegistry();
      const modelId = args[1] || registry.routingRules.orchestrator.primary;
      const entry = registry.models[modelId];
      if (!entry) {
        console.error(`Model ${modelId} not found`);
        process.exit(1);
      }
      const health = await checkModelHealth(modelId, entry);
      console.log(JSON.stringify(health, null, 2));
      break;
    }

    default:
      console.log(`
Smart Model Router v3.0

Commands:
  check              Show health status of all models
  route [model]      Route to model with optional error context
  get-active         Show currently active model
  health-check [id]  Check specific model health via ping

Examples:
  npx tsx src/ml/smart-model-router.ts check
  npx tsx src/ml/smart-model-router.ts route opencode/deepseek-v4-flash-free
  npx tsx src/ml/smart-model-router.ts route opencode/deepseek-v4-flash-free "quota exceeded"
`);
  }
}

main().catch(console.error);
