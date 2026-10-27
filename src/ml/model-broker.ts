#!/usr/bin/env npx tsx
/**
 * Model Broker - Intelligent model delegation with automatic fallback
 *
 * Intercepts agent delegations and ensures model availability.
 * If configured model fails, automatically switches to fallback.
 */

import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { join } from 'path';

const ROOT = process.cwd();
const REGISTRY_PATH = join(ROOT, 'config', 'model-health-registry.json');
const OPENCODE_PATH = join(ROOT, 'opencode.json');

interface ModelEntry {
  provider: string;
  tier: 'free' | 'balanced' | 'premium' | 'local';
  costPer1kTokens: { input: number; output: number };
  health: {
    status: 'available' | 'degraded' | 'unavailable' | 'unknown';
    lastChecked: string | null;
    consecutiveErrors: number;
    avgLatencyMs: number | null;
    lastError?: string;
  };
  fallbackChain: string[];
  capabilities: string[];
  maxTokens?: number;
  requiresLocal?: boolean;
  checkEndpoint?: string;
}

interface ModelRegistry {
  models: Record<string, ModelEntry>;
  routingRules: {
    orchestrator: { primary: string; fallbackStrategy: string };
    subagents: { inheritFromOrchestrator: boolean; allowOverride: boolean; default: string };
  };
  errorPatterns: Record<string, string[]>;
  fallbackStrategies?: Record<string, string[]>;
}

interface AgentConfig {
  model: string;
  provider?: string;
  [key: string]: unknown;
}

interface OpenCodeAgentEntry {
  model?: string;
  provider?: string;
}

interface OpenCodeConfig {
  agent?: Record<string, OpenCodeAgentEntry>;
}

interface AgentStatus {
  model: string;
  available: boolean;
  health: string;
  fallbackChain: string[];
}

interface BrokerResult {
  success: boolean;
  agent: string;
  model: string;
  provider: string;
  switched: boolean;
  reason?: string;
  error?: string;
}

interface DelegationOptions {
  agentName: string;
  task: string;
  retryOnFailure?: boolean;
  maxRetries?: number;
  allowFallback?: boolean;
}

class ModelBroker {
  private registry!: ModelRegistry;
  private opencodeConfig!: OpenCodeConfig;
  private healthCheckCache: Map<string, { timestamp: number; status: string }> = new Map();
  private readonly HEALTH_CACHE_TTL = 60000; // 60 segundos

  constructor() {
    this.loadConfigs();
  }

  private loadConfigs(): void {
    // Load model registry
    const registryContent = readFileSync(REGISTRY_PATH, 'utf-8');
    this.registry = JSON.parse(registryContent);

    // Load opencode configuration
    const opencodeContent = readFileSync(OPENCODE_PATH, 'utf-8');
    this.opencodeConfig = JSON.parse(opencodeContent);
  }

  private async checkModelHealth(modelId: string): Promise<boolean> {
    // Check cache first
    const cached = this.healthCheckCache.get(modelId);
    if (cached && Date.now() - cached.timestamp < this.HEALTH_CACHE_TTL) {
      return cached.status === 'available';
    }

    const entry = this.registry.models[modelId];
    if (!entry) {
      return false;
    }

    const checkedAt = entry.health.lastChecked ? Date.parse(entry.health.lastChecked) : NaN;
    const ageMs = Date.now() - checkedAt;
    const isAvailable =
      entry.health.status === 'available' && Number.isFinite(checkedAt) && ageMs >= 0 && ageMs <= this.HEALTH_CACHE_TTL;

    // Cache the result
    this.healthCheckCache.set(modelId, {
      timestamp: Date.now(),
      status: isAvailable ? 'available' : 'unavailable',
    });

    return isAvailable;
  }

  private getAgentConfig(agentName: string): AgentConfig | null {
    const agents = this.opencodeConfig.agent;
    if (!agents || !agents[agentName]) {
      return null;
    }

    return {
      model: agents[agentName].model || this.registry.routingRules.subagents.default,
      provider: agents[agentName].provider,
    };
  }

  /** Report unsupported execution rather than fabricating a successful delegation. */
  async delegate(options: DelegationOptions): Promise<BrokerResult> {
    const { agentName } = options;
    const agentConfig = this.getAgentConfig(agentName);
    if (!agentConfig) {
      return {
        success: false,
        agent: agentName,
        model: 'unknown',
        provider: 'unknown',
        switched: false,
        error: `Agent ${agentName} not found in configuration`,
      };
    }

    return {
      success: false,
      agent: agentName,
      model: agentConfig.model,
      provider: agentConfig.provider || 'opencode',
      switched: false,
      error: 'Not executed: ModelBroker has no real agent execution adapter. Use native OpenCode task delegation.',
    };
  }

  /**
   * Get status of all agents and their models
   */
  async getStatus(): Promise<Record<string, AgentStatus>> {
    const agents = this.opencodeConfig.agent || {};
    const status: Record<string, AgentStatus> = {};

    for (const [agentName, agentConfig] of Object.entries(agents)) {
      const model = agentConfig.model || 'unknown';
      const isAvailable = await this.checkModelHealth(model);

      status[agentName] = {
        model,
        available: isAvailable,
        health: isAvailable
          ? 'available'
          : this.registry.models[model]?.health?.status === 'available'
            ? 'stale'
            : this.registry.models[model]?.health?.status || 'unknown',
        fallbackChain: this.registry.models[model]?.fallbackChain || [],
      };
    }

    return status;
  }
}

// CLI interface
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  const broker = new ModelBroker();

  switch (command) {
    case 'delegate': {
      const agent = args[1];
      const task = args.slice(2).join(' ');

      if (!agent || !task) {
        console.error('Usage: tsx src/ml/model-broker.ts delegate <agent> <task>');
        process.exit(1);
      }

      const result = await broker.delegate({
        agentName: agent,
        task,
        retryOnFailure: true,
      });

      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'status': {
      const status = await broker.getStatus();
      console.log('=== Model Broker Status ===');
      console.log(JSON.stringify(status, null, 2));
      break;
    }

    case 'health': {
      const status = await broker.getStatus();
      const totalAgents = Object.keys(status).length;
      const availableAgents = Object.values(status).filter((s) => s.available).length;

      console.log('📊 Model Broker Health Report');
      console.log(`Total agents: ${totalAgents}`);
      console.log(
        `Available agents: ${availableAgents} (${Math.round((availableAgents / totalAgents) * 100)}%)`,
      );

      // Show problematic agents
      const problematic = Object.entries(status)
        .filter(([_, s]) => !s.available)
        .map(([agent, s]) => `${agent}: ${s.model} (${s.health})`);

      if (problematic.length > 0) {
        console.log('\n⚠️  Agents with model issues:');
        problematic.forEach((agent) => console.log(`  ${agent}`));
      }
      break;
    }

    default:
      console.log(`
🤖 Model Broker v1.0 - Intelligent delegation with auto-fallback

Commands:
  delegate <agent> <task>   Delegate task to agent with model fallback
  status                    Show status of all agents and models
  health                    Health report with statistics

Examples:
  npx tsx src/ml/model-broker.ts delegate sdd-apply "Implement login feature"
  npx tsx src/ml/model-broker.ts status
  npx tsx src/ml/model-broker.ts health
`);
  }
}

// Run if called directly
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(console.error);
}

export { ModelBroker };
export type { BrokerResult, DelegationOptions };
