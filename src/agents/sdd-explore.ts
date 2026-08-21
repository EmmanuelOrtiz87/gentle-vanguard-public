#!/usr/bin/env node
/**
 * SDD Explore Agent (sdd-explore) - Native Implementation
 *
 * BA exploration agent for requirements gathering and analysis.
 * Works with ANY AI tool (Claude, Cursor, etc.)
 * No opencode dependency.
 */

interface ExploreTask {
  task: string;
  context?: string;
  model: string;
  temperature: number;
}

const AGENT_CONFIG = {
  name: 'sdd-explore',
  description: 'BA exploration agent — requirements gathering and analysis',
  model: 'opencode/deepseek-v4-flash-free',
  temperature: 0.7,
  maxTokens: 4000,
  version: '1.0.0',
};

function parseArgs(): ExploreTask {
  const args = process.argv.slice(2);
  const task: ExploreTask = {
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
        break;
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
  npx tsx src/agents/sdd-explore.ts [options]

Options:
  --task "description"     Task description (required)
  --context "text"         Additional context
  --model "name"           Model to use
  --temperature N          Temperature
  --help, -h               Show this help
`);
}

function exploreRequirements(task: string, context?: string): string {
  const requirementAnalysis = {
    task,
    context: context || 'N/A',
    questions: [
      {
        question: 'What is the expected outcome?',
        guidance: 'Define the success criteria and deliverables',
        category: 'scope',
      },
      {
        question: 'What constraints exist (time, budget, technology)?',
        guidance: 'Identify limitations that affect the solution',
        category: 'constraints',
      },
      {
        question: 'What are the edge cases?',
        guidance: 'Consider boundary conditions and error scenarios',
        category: 'edge-cases',
      },
      {
        question: 'Who are the stakeholders?',
        guidance: 'Identify users, maintainers, and decision makers',
        category: 'stakeholders',
      },
      {
        question: 'What does success look like?',
        guidance: 'Define measurable acceptance criteria',
        category: 'success',
      },
    ],
    recommendedPhase: determinePhase(task),
  };

  return JSON.stringify(requirementAnalysis, null, 2);
}

function determinePhase(task: string): string {
  const normalized = task.toLowerCase();

  if (
    normalized.includes('implement') ||
    normalized.includes('code') ||
    normalized.includes('build')
  ) {
    return 'IMPLEMENT';
  } else if (
    normalized.includes('design') ||
    normalized.includes('architecture') ||
    normalized.includes('plan')
  ) {
    return 'PLAN → TASKS → IMPLEMENT';
  } else if (
    normalized.includes('task') ||
    normalized.includes('breakdown') ||
    normalized.includes('spec')
  ) {
    return 'TASKS → IMPLEMENT';
  } else {
    return 'SPECIFY → PLAN → TASKS → IMPLEMENT';
  }
}

async function main(): Promise<void> {
  const startTime = Date.now();
  const { task, context, model, temperature } = parseArgs();

  console.log(`
=================================================
  ${AGENT_CONFIG.name} v${AGENT_CONFIG.version}
  ${AGENT_CONFIG.description}
=================================================
`);
  console.log(`Task: ${task}`);
  console.log(`Context: ${context || 'N/A'}`);
  console.log(`Model: ${model}`);
  console.log(`Temperature: ${temperature}`);
  console.log();

  try {
    const result = exploreRequirements(task, context);
    const duration = Date.now() - startTime;

    console.log('=== Requirements Analysis ===\n');
    console.log(result);
    console.log();
    console.log('=================================================');
    console.log(`  Status: ✅ SUCCESS`);
    console.log(`  Duration: ${duration}ms`);
    console.log(`  Recommended Phase: ${JSON.parse(result).recommendedPhase}`);
    console.log('=================================================');

    console.log('\n=== JSON OUTPUT ===');
    console.log(
      JSON.stringify(
        {
          success: true,
          agent: AGENT_CONFIG.name,
          version: AGENT_CONFIG.version,
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

export { exploreRequirements, determinePhase, AGENT_CONFIG };
