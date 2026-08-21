#!/usr/bin/env node
/**
 * Ops Agent (ops-agent) - Native Implementation
 *
 * Operations agent for CI/CD, infrastructure, and deployment.
 * Works with ANY AI tool (Claude, Cursor, etc.)
 * No opencode dependency.
 */

interface OpsTask {
  task: string;
  context?: string;
  model: string;
  temperature: number;
}

const AGENT_CONFIG = {
  name: 'ops-agent',
  description: 'Operations agent — deployment, CI/CD, infrastructure',
  model: 'opencode/deepseek-v4-flash-free',
  temperature: 0.1,
  maxTokens: 4000,
  version: '1.0.0',
};

function parseArgs(): OpsTask {
  const args = process.argv.slice(2);
  const task: OpsTask = {
    task: '',
    model: process.env.AGENT_MODEL || AGENT_CONFIG.model,
    temperature: parseFloat(process.env.AGENT_TEMPERATURE || String(AGENT_CONFIG.temperature)),
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--task':
        task.task = args[++i];
        break;
      case '--context':
        task.context = args[++i];
        break;
      case '--model':
        task.model = args[++i];
        break;
      case '--temperature':
        task.temperature = parseFloat(args[++i]);
        break;
      case '--help':
      case '-h':
        showHelp();
        process.exit(0);
    }
  }

  if (!task.task) {
    console.error('Error: --task is required');
    showHelp();
    process.exit(1);
  }

  return task;
}

function showHelp(): void {
  console.log(`
${AGENT_CONFIG.name} v${AGENT_CONFIG.version}
${AGENT_CONFIG.description}

Usage:
  npx tsx src/agents/ops-agent.ts --task "setup CI/CD"
  npx tsx src/agents/ops-agent.ts --task "deploy to prod"
`);
}

function analyzeOperations(task: string, context?: string): string {
  const normalized = task.toLowerCase();
  const opsType = normalized.includes('deploy')
    ? 'DEPLOYMENT'
    : normalized.includes('ci/cd') || normalized.includes('pipeline')
      ? 'CI/CD'
      : normalized.includes('docker')
        ? 'DOCKER'
        : normalized.includes('monitor')
          ? 'MONITORING'
          : 'GENERAL';

  const ops = {
    task,
    context: context || 'N/A',
    type: opsType,
    operations: {
      workflows: [
        { name: 'ci.yml', jobs: ['lint-typecheck', 'test', 'build'] },
        { name: 'security.yml', jobs: ['gitleaks', 'secretlint', 'trivy'] },
        { name: 'release.yml', jobs: ['version-bump', 'tag', 'deploy'] },
      ],
      dockerServices: [
        'web-dashboard (port 8080)',
        'websocket-server (port 8081)',
        'mcp-server (port 3001)',
        'jaeger (tracing)',
        'prometheus (metrics)',
      ],
      monitoring: [
        'Watchtower: 60+ checks',
        'Dashboard: Real-time metrics',
        'Auto-healing: Process recovery',
        'Health API: /api/health',
      ],
    },
    deploymentSteps: [
      '1. Run quality checks (typecheck, lint, test)',
      '2. Build Docker images',
      '3. Tag with version',
      '4. Deploy to target environment',
      '5. Verify with health checks',
      '6. Monitor for 30 minutes',
    ],
  };

  return JSON.stringify(ops, null, 2);
}

async function main(): Promise<void> {
  const startTime = Date.now();
  const { task, context, model } = parseArgs();

  console.log(`
=================================================
  ${AGENT_CONFIG.name} v${AGENT_CONFIG.version}
  ${AGENT_CONFIG.description}
=================================================
`);

  try {
    const result = analyzeOperations(task, context);
    const duration = Date.now() - startTime;

    console.log('=== Operations Plan ===\n');
    console.log(result);
    console.log();
    console.log('=================================================');
    console.log(`  Status: ✅ SUCCESS`);
    console.log(`  Duration: ${duration}ms`);
    console.log('=================================================');

    console.log('\n=== JSON OUTPUT ===');
    console.log(
      JSON.stringify(
        {
          success: true,
          agent: AGENT_CONFIG.name,
          task,
          model,
          duration,
          output: JSON.parse(result),
        },
        null,
        2,
      ),
    );
  } catch (_error) {
    console.error('\n❌ Error:', _error);
    process.exit(1);
  }
}

import { pathToFileURL } from 'url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(console.error);
}

export { analyzeOperations, AGENT_CONFIG };
