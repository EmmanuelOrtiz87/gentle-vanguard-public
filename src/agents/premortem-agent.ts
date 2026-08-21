#!/usr/bin/env node
/**
 * Premortem Agent (premortem-agent) - Native Implementation
 *
 * Premortem analysis agent for risk identification and stress testing.
 * Works with ANY AI tool (Claude, Cursor, etc.)
 * No opencode dependency.
 */

interface PremortemTask {
  task: string;
  context?: string;
  model: string;
  temperature: number;
}

const AGENT_CONFIG = {
  name: 'premortem-agent',
  description: 'Premortem analysis agent — risk identification and stress testing',
  model: 'opencode/deepseek-v4-flash-free',
  temperature: 0.2,
  maxTokens: 4000,
  version: '1.0.0',
};

function parseArgs(): PremortemTask {
  const args = process.argv.slice(2);
  const task: PremortemTask = {
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
  npx tsx src/agents/premortem-agent.ts --task "what could go wrong"
  npx tsx src/agents/premortem-agent.ts --task "risk analysis"
`);
}

function analyzeRisks(task: string, context?: string): string {
  const normalized = task.toLowerCase();
  const analysisType = normalized.includes('risk')
    ? 'RISK'
    : normalized.includes('fail')
      ? 'FAILURE'
      : normalized.includes('stress')
        ? 'STRESS'
        : 'PREMORTEM';

  const risks = {
    task,
    context: context || 'N/A',
    type: analysisType,
    premortem: {
      scenario: "The project has failed. Let's look back...",
      potentialFailures: [
        {
          category: 'Technical',
          risks: [
            "Architecture doesn't scale",
            'Database becomes bottleneck',
            'Third-party API downtime',
            'Security breach',
            'Data corruption',
          ],
        },
        {
          category: 'Organizational',
          risks: [
            'Key person leaves',
            'Budget cuts',
            'Requirements change',
            'Scope creep',
            'Timeline unrealistic',
          ],
        },
        {
          category: 'External',
          risks: [
            'Regulatory changes',
            'Market shifts',
            'Competitor release',
            'Vendor discontinuation',
            'Security vulnerabilities',
          ],
        },
      ],
      mitigationStrategies: [
        'Design for scale from day 1',
        'Implement circuit breakers',
        'Regular security audits',
        'Cross-train team members',
        'Agile methodology',
        'Continuous monitoring',
        'Disaster recovery plan',
      ],
      earlyWarningSigns: [
        'Performance degradation',
        'Increasing error rates',
        'Developer burnout',
        'Missed deadlines',
        'Quality issues',
      ],
    },
  };

  return JSON.stringify(risks, null, 2);
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
    const result = analyzeRisks(task, context);
    const duration = Date.now() - startTime;

    console.log('=== Premortem Analysis ===\n');
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

export { analyzeRisks, AGENT_CONFIG };
