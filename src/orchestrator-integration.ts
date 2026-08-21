#!/usr/bin/env npx tsx
/**
 * Orchestrator Integration Wrapper
 * Demonstrates how the orchestrator would integrate with ModelBroker
 */

import { ModelBroker } from './model-broker.js';
import { pathToFileURL } from 'url';

class OrchestratorWithModelBroker {
  private broker: ModelBroker;

  constructor() {
    this.broker = new ModelBroker();
  }

  /**
   * Enhanced delegation method that uses ModelBroker
   */
  async delegateToAgent(
    agentName: string,
    task: string,
    options?: { maxRetries?: number; context?: string },
  ): Promise<{
    success: boolean;
    delegationId?: string;
    modelUsed: string;
    switched: boolean;
    error?: string;
  }> {
    console.log(`🚀 Orchestrator delegating to ${agentName}`);
    console.log(`   Task: ${task.substring(0, 100)}...`);

    // Use model broker for intelligent delegation
    const result = await this.broker.delegate({
      agentName,
      task,
      retryOnFailure: true,
      maxRetries: options?.maxRetries || 3,
      allowFallback: true,
    });

    if (result.success) {
      // In real implementation, this would trigger the actual opencode delegation
      const delegationId = `del_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      if (result.switched) {
        console.log(`   🔄 Model switched: ${result.model} (was: ${agentName} original config)`);
      } else {
        console.log(`   ✅ Using configured model: ${result.model}`);
      }

      return {
        success: true,
        delegationId,
        modelUsed: result.model,
        switched: result.switched,
      };
    } else {
      console.log(`   ❌ Delegation failed: ${result.error}`);

      // Try one more time with force fallback
      console.log(`   🔁 Attempting emergency fallback...`);

      const emergencyResult = await this.broker.delegate({
        agentName,
        task,
        retryOnFailure: false, // No more retries
        allowFallback: true,
      });

      if (emergencyResult.success) {
        const delegationId = `emergency_del_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        return {
          success: true,
          delegationId,
          modelUsed: emergencyResult.model,
          switched: true,
        };
      }

      return {
        success: false,
        modelUsed: result.model,
        switched: result.switched,
        error: `Delegation failed: ${result.error} (emergency fallback also failed)`,
      };
    }
  }

  /**
   * Get comprehensive status
   */
  async getSystemStatus() {
    const status = await this.broker.getStatus();
    const agents = Object.keys(status);

    return {
      totalAgents: agents.length,
      availableAgents: agents.filter((a) => status[a].available).length,
      agentsWithFallback: agents.filter((a) => status[a].fallbackChain.length > 0).length,
      detailedStatus: status,
    };
  }
}

// CLI for testing
async function main() {
  const orchestrator = new OrchestratorWithModelBroker();

  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'test-delegation': {
      const agent = args[1] || 'sdd-apply';
      const task = args.slice(2).join(' ') || 'Test task delegation';

      const result = await orchestrator.delegateToAgent(agent, task);
      console.log('Delegation Result:', JSON.stringify(result, null, 2));
      break;
    }

    case 'status': {
      const status = await orchestrator.getSystemStatus();
      console.log('=== System Status ===');
      console.log(`Agents: ${status.totalAgents}`);
      console.log(`Available: ${status.availableAgents}`);
      console.log(`With fallback: ${status.agentsWithFallback}`);
      console.log('\nDetailed agent status:');

      Object.entries(status.detailedStatus).forEach(([agent, info]: [string, any]) => {
        const icon = info.available ? '✅' : '❌';
        console.log(`  ${icon} ${agent}: ${info.model} (${info.health})`);
      });
      break;
    }

    case 'switch-all-native': {
      console.log('Running switch to native models...');
      // Run the switch-to-native script
      const { execSync } = require('child_process');
      execSync('npx tsx src/opencode-switch-to-native.ts', { stdio: 'inherit' });
      break;
    }

    default:
      console.log(`
🎯 Orchestrator Integration with Model Broker

Commands:
  test-delegation [agent] [task]  Test delegation to agent
  status                           Show system status
  switch-all-native                Switch all agents to native model (requires opencode restart)
  
Examples:
  npx tsx src/orchestrator-integration.ts test-delegation sdd-apply "Implement feature"
  npx tsx tsx src/orchestrator-integration.ts status
`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(console.error);
}
