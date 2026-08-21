#!/usr/bin/env node
/**
 * SDD Design Agent (sdd-design) - Native Implementation
 *
 * SAD architecture design agent for system design and API contracts.
 * Works with ANY AI tool (Claude, Cursor, etc.)
 * No opencode dependency.
 */

interface DesignTask {
  task: string;
  context?: string;
  model: string;
  temperature: number;
}

const AGENT_CONFIG = {
  name: 'sdd-design',
  description: 'SAD architecture design agent — system design and API contracts',
  model: 'opencode/deepseek-v4-flash-free',
  temperature: 0.3,
  maxTokens: 4000,
  version: '1.0.0',
};

function parseArgs(): DesignTask {
  const args = process.argv.slice(2);
  const task: DesignTask = {
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
  npx tsx src/agents/sdd-design.ts --task "design API"
  npx tsx src/agents/sdd-design.ts --task "architecture" --context "microservices"
`);
}

function designArchitecture(task: string, context?: string): string {
  const design = {
    task,
    context: context || 'N/A',
    architecturePatterns: [
      'Layered Architecture',
      'Microservices',
      'Event-Driven',
      'CQRS',
      'Clean Architecture',
    ].filter((p) => {
      const ctx = (task + ' ' + (context || '')).toLowerCase();
      if (p === 'Microservices' && ctx.includes('microservice')) return true;
      if (p === 'Event-Driven' && (ctx.includes('event') || ctx.includes('async'))) return true;
      if (p === 'CQRS' && (ctx.includes('read') || ctx.includes('write'))) return true;
      return ctx.includes('api') || ctx.includes('system');
    }),
    components: [
      { name: 'API Gateway', purpose: 'Entry point and routing' },
      { name: 'Service Layer', purpose: 'Business logic' },
      { name: 'Data Layer', purpose: 'Persistence and caching' },
      { name: 'Event Bus', purpose: 'Async communication' },
    ],
    apiContracts: [
      { method: 'GET', endpoint: '/api/resource', description: 'List resources' },
      { method: 'POST', endpoint: '/api/resource', description: 'Create resource' },
      { method: 'PUT', endpoint: '/api/resource/:id', description: 'Update resource' },
      { method: 'DELETE', endpoint: '/api/resource/:id', description: 'Delete resource' },
    ],
    dataModels: [
      { entity: 'Resource', fields: ['id', 'name', 'createdAt', 'updatedAt'] },
      { entity: 'User', fields: ['id', 'email', 'role', 'createdAt'] },
    ],
    considerations: [
      'Scalability: Horizontal pod autoscaling',
      'Reliability: Circuit breaker pattern',
      'Observability: Distributed tracing',
      'Security: JWT authentication',
    ],
    mermaidDiagram: generateMermaidDiagram(task),
  };

  return JSON.stringify(design, null, 2);
}

function generateMermaidDiagram(_task: string): string {
  return `
\`\`\`mermaid
graph TB
    Client[Client] --> Gateway[API Gateway]
    Gateway --> ServiceA[Service A]
    Gateway --> ServiceB[Service B]
    ServiceA --> DB[(Database)]
    ServiceB --> Cache[(Cache)]
    ServiceA --> EventBus[Event Bus]
    ServiceB --> EventBus
\`\`\`
  `.trim();
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
    const result = designArchitecture(task, context);
    const duration = Date.now() - startTime;

    console.log('=== Architecture Design ===\n');
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
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

import { pathToFileURL } from 'url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(console.error);
}

export { designArchitecture, AGENT_CONFIG };
