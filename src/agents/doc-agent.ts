#!/usr/bin/env node
/**
 * Doc Agent (doc-agent) - Native Implementation
 *
 * Documentation agent for technical docs, guides, and ADRs.
 * Works with ANY AI tool (Claude, Cursor, etc.)
 * No opencode dependency.
 */

interface DocTask {
  task: string;
  context?: string;
  model: string;
  temperature: number;
}

const AGENT_CONFIG = {
  name: 'doc-agent',
  description: 'Documentation agent — technical docs and guides',
  model: 'opencode/deepseek-v4-flash-free',
  temperature: 0.4,
  maxTokens: 4000,
  version: '1.0.0',
};

function parseArgs(): DocTask {
  const args = process.argv.slice(2);
  const task: DocTask = {
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
  npx tsx src/agents/doc-agent.ts --task "update readme"
  npx tsx src/agents/doc-agent.ts --task "create ADR" --context "architecture decision"
`);
}

function createDocumentation(task: string, context?: string): string {
  const normalized = task.toLowerCase();
  const docType = normalized.includes('adr')
    ? 'ADR'
    : normalized.includes('readme')
      ? 'README'
      : normalized.includes('guide')
        ? 'GUIDE'
        : normalized.includes('api')
          ? 'API-DOC'
          : 'GENERAL';

  const doc = {
    task,
    context: context || 'N/A',
    type: docType,
    documentation: {
      title: getDocTitle(task, docType),
      sections: getDocSections(docType),
      standards: [
        'Markdown format with consistent headings',
        'Code examples must be tested',
        'Include file paths with line numbers',
        'Use tables for structured data',
        'Include Mermaid diagrams for architecture',
      ],
    },
    keyFiles: [
      'AGENTS.md — Master agent instructions',
      'README.md — Project overview',
      'CHANGELOG.md — Version history',
      'docs/architecture/ — Architecture docs',
      'docs/guides/ — Developer guides',
    ],
  };

  return JSON.stringify(doc, null, 2);
}

function getDocTitle(task: string, type: string): string {
  if (type === 'ADR') return 'Architecture Decision Record';
  if (type === 'README') return 'Project Overview';
  if (type === 'API-DOC') return 'API Documentation';
  return task.charAt(0).toUpperCase() + task.slice(1);
}

function getDocSections(type: string): string[] {
  if (type === 'ADR') {
    return ['Context', 'Decision', 'Consequences', 'Alternatives Considered'];
  }
  if (type === 'README') {
    return ['Overview', 'Installation', 'Usage', 'Contributing', 'License'];
  }
  if (type === 'API-DOC') {
    return ['Endpoints', 'Authentication', 'Request/Response', 'Examples'];
  }
  return ['Introduction', 'Body', 'Conclusion'];
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
    const result = createDocumentation(task, context);
    const duration = Date.now() - startTime;

    console.log('=== Documentation Plan ===\n');
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

export { createDocumentation, AGENT_CONFIG };
