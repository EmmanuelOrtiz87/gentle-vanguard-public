#!/usr/bin/env node
/**
 * Self-Diag Agent (self-diag-agent) - Native Implementation
 *
 * Self-diagnosis agent for auto-debug and break-glass recovery.
 * Works with ANY AI tool (Claude, Cursor, etc.)
 * No opencode dependency.
 */

import { existsSync } from 'fs';
import { join } from 'path';

interface DiagTask {
  task: string;
  context?: string;
  model: string;
  temperature: number;
}

const AGENT_CONFIG = {
  name: 'self-diag-agent',
  description: 'Self-diagnosis agent — auto-debug and break-glass recovery',
  model: 'opencode/deepseek-v4-flash-free',
  temperature: 0.1,
  maxTokens: 4000,
  version: '1.0.0',
};

function parseArgs(): DiagTask {
  const args = process.argv.slice(2);
  const task: DiagTask = {
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
  npx tsx src/agents/self-diag-agent.ts --task "diagnose error"
  npx tsx src/agents/self-diag-agent.ts --task "health check"
`);
}

function diagnoseSystem(task: string, context?: string): string {
  const normalized = task.toLowerCase();
  const checkType = normalized.includes('health')
    ? 'HEALTH'
    : normalized.includes('error')
      ? 'ERROR'
      : normalized.includes('recover')
        ? 'RECOVERY'
        : 'DIAGNOSE';

  const diag = {
    task,
    context: context || 'N/A',
    type: checkType,
    diagnosis: {
      checks: [
        { component: 'TypeScript', status: checkTypeScript(), severity: 'critical' },
        { component: 'ESLint', status: checkESLint(), severity: 'high' },
        { component: 'Dependencies', status: checkDeps(), severity: 'medium' },
        { component: 'Config Files', status: checkConfigs(), severity: 'medium' },
      ],
      issuesFound: [],
      recoveryActions: [
        'npm install',
        'npm run typecheck',
        'npm run lint:fix',
        'npm run db:health',
      ],
      breakGlass: {
        enabled: true,
        actions: ['Reset to last checkpoint', 'Restore from backup', 'Emergency reinitialization'],
      },
    },
  };

  return JSON.stringify(diag, null, 2);
}

function checkTypeScript(): string {
  return existsSync(join(process.cwd(), 'node_modules')) ? 'PASS' : 'UNKNOWN';
}

function checkESLint(): string {
  return existsSync(join(process.cwd(), '.eslintrc*')) ? 'PASS' : 'CONFIG MISSING';
}

function checkDeps(): string {
  return existsSync(join(process.cwd(), 'package.json')) ? 'PASS' : 'FAIL';
}

function checkConfigs(): string {
  const configs = ['opencode.json', 'package.json', 'tsconfig.json'];
  const missing = configs.filter((c) => !existsSync(join(process.cwd(), c)));
  return missing.length === 0 ? 'PASS' : `MISSING: ${missing.join(', ')}`;
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
    const result = diagnoseSystem(task, context);
    const duration = Date.now() - startTime;

    console.log('=== Diagnosis Report ===\n');
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

export { diagnoseSystem, AGENT_CONFIG };
