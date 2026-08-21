/**
 * Agent Delegator - Native Agent Delegation System
 *
 * Agnostic agent delegator that works with ANY AI tool.
 * Replaces opencode task() which has model inheritance bugs.
 *
 * Usage:
 *   npx tsx src/agent-delegator.ts --agent sdd-apply --task "implement feature"
 *   npx tsx src/agent-delegator.ts --agent sdd-explore --prompt "Analyze requirements"
 *   npx tsx src/agent-delegator.ts --list
 */

import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { writeFileSync } from 'fs';
import { compressStructural, estimateTokens } from './structural-compression.js';

interface AgentConfig {
  name: string;
  description: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
}

interface DelegationRequest {
  agent: string;
  task: string;
  context?: string;
  model?: string;
  /** M6: quality-tier override from domainTiering. Falls back to config default. */
  temperature?: number;
}

interface DelegationResult {
  success: boolean;
  output?: string;
  error?: string;
  duration: number;
  model: string;
}

/**
 * Lossless delegation compression result.
 * `text` holds the compressed form when `applied` is true, otherwise the original.
 */
export interface DelegationCompression {
  text: string;
  originalChars: number;
  compressedChars: number;
  originalTokens: number;
  compressedTokens: number;
  ratio: number;
  saved: number;
  applied: boolean;
}

/**
 * Compress a task/context string with the lossless-only structural pass
 * (mode 'input'). Falls back to the original when the input is too short,
 * compression does not improve the size, or the engine throws.
 */
export function compressDelegationLossless(text: string): DelegationCompression {
  const originalTokens = estimateTokens(text);
  if (!text || text.length < 200) {
    return {
      text,
      originalChars: text.length,
      compressedChars: text.length,
      originalTokens,
      compressedTokens: originalTokens,
      ratio: 1,
      saved: 0,
      applied: false,
    };
  }
  try {
    const result = compressStructural(text, { mode: 'input' });
    if (result.compressedChars < result.originalChars && result.compressed.length < text.length) {
      return {
        text: result.compressed,
        originalChars: result.originalChars,
        compressedChars: result.compressedChars,
        originalTokens: result.originalTokens,
        compressedTokens: result.compressedTokens,
        ratio: result.compressionRatio,
        saved: result.originalTokens - result.compressedTokens,
        applied: true,
      };
    }
  } catch {
    /* fall back to original on any failure */
  }
  return {
    text,
    originalChars: text.length,
    compressedChars: text.length,
    originalTokens,
    compressedTokens: originalTokens,
    ratio: 1,
    saved: 0,
    applied: false,
  };
}

const AGENTS_DIR = join(process.cwd(), 'src', 'agents');
const CONFIG_PATH = join(process.cwd(), 'config', 'agents.json');

// Default agent configurations
const DEFAULT_AGENTS: Record<string, AgentConfig> = {
  'sdd-explore': {
    name: 'sdd-explore',
    description: 'BA exploration agent — requirements gathering and analysis',
    model: 'opencode/deepseek-v4-flash-free',
    temperature: 0.7,
    maxTokens: 4000,
    systemPrompt: `You are the BA exploration agent for Gentle-Vanguard.

Core Responsibilities:
- Gather and clarify requirements through structured questioning
- Analyze user intent and map to appropriate SDD lifecycle phase
- Document acceptance criteria and edge cases

When activated:
- User request is ambiguous or multi-faceted
- Confidence scoring below 60%
- New feature or significant change requested

Output Format:
- Structured requirements document
- Acceptance criteria list
- Risk assessment
- Recommended SDD phase`,
  },
  'sdd-design': {
    name: 'sdd-design',
    description: 'SAD architecture design agent — system design and API contracts',
    model: 'opencode/deepseek-v4-flash-free',
    temperature: 0.3,
    maxTokens: 4000,
    systemPrompt: `You are the SAD architecture design agent for Gentle-Vanguard.

Core Responsibilities:
- Design system architecture following existing patterns
- Define API contracts and data schemas
- Create ADRs for significant decisions

Architecture Principles:
- TypeScript strict mode
- Event sourcing for audit trail
- Circuit breaker pattern
- Multi-tenant isolation by default

Output:
- Component diagrams (Mermaid)
- API contracts (TypeScript interfaces)
- Data flow diagrams`,
  },
  'sdd-apply': {
    name: 'sdd-apply',
    description: 'DEV implementation agent — code generation and feature building',
    model: 'opencode/deepseek-v4-flash-free',
    temperature: 0.15,
    maxTokens: 6000,
    systemPrompt: `You are the DEV implementation agent for Gentle-Vanguard.

Core Responsibilities:
- Implement features following SDD lifecycle
- Write TypeScript code with strict mode compliance
- Ensure all changes pass typecheck and lint

Code Standards:
- TypeScript: strict: true, noImplicitAny
- No comments unless explicitly requested
- Use Zod schemas for runtime validation
- Never commit secrets

Quality Gates (must pass):
1. npm run typecheck — 0 errors
2. npm run lint — 0 warnings
3. Manual review of changed files
4. No new TODO comments`,
  },
  'sdd-verify': {
    name: 'sdd-verify',
    description: 'QA verification agent — testing and validation',
    model: 'opencode/deepseek-v4-flash-free',
    temperature: 0.1,
    maxTokens: 4000,
    systemPrompt: `You are the QA verification agent for Gentle-Vanguard.

Core Responsibilities:
- Write and execute tests (unit, integration)
- Verify all quality gates pass
- Run security scans
- Check for regressions

Verification Checklist:
1. npm run typecheck — 0 errors
2. npm run test:config — 6 tests pass
3. npm run test:workflows — 2 tests pass
4. Dashboard build exits 0
5. No new security vulnerabilities

Evidence Required:
- Test execution output
- Coverage report
- Impact analysis`,
  },
  'doc-agent': {
    name: 'doc-agent',
    description: 'Documentation agent — technical docs and guides',
    model: 'opencode/deepseek-v4-flash-free',
    temperature: 0.4,
    maxTokens: 4000,
    systemPrompt: `You are the Documentation agent for Gentle-Vanguard.

Core Responsibilities:
- Write technical documentation
- Create ADRs for significant decisions
- Update README, CHANGELOG
- Generate guides for new features

Documentation Standards:
- Markdown with consistent headings
- Code examples must be tested
- Include file paths with line numbers
- Use tables for structured data
- Include Mermaid diagrams`,
  },
  'ops-agent': {
    name: 'ops-agent',
    description: 'Operations agent — deployment, CI/CD, infrastructure',
    model: 'opencode/deepseek-v4-flash-free',
    temperature: 0.1,
    maxTokens: 4000,
    systemPrompt: `You are the Operations agent for Gentle-Vanguard.

Core Responsibilities:
- Manage CI/CD pipelines
- Handle Docker builds
- Monitor infrastructure health
- Manage deployments

Expertise:
- GitHub Actions
- Docker & Kubernetes
- Prometheus & Grafana
- Incident response`,
  },
  'gov-agent': {
    name: 'gov-agent',
    description: 'Governance agent — compliance, security, audit',
    model: 'opencode/deepseek-v4-flash-free',
    temperature: 0.1,
    maxTokens: 4000,
    systemPrompt: `You are the Governance agent for Gentle-Vanguard.

Core Responsibilities:
- Enforce compliance policies
- Security audits
- Risk assessment
- Policy enforcement

Areas:
- OWASP security guidelines
- GDPR compliance
- Audit trail validation
- Access control review`,
  },
  'session-agent': {
    name: 'session-agent',
    description: 'Session management agent — state tracking and lifecycle',
    model: 'opencode/deepseek-v4-flash-free',
    temperature: 0.3,
    maxTokens: 3000,
    systemPrompt: `You are the Session agent for Gentle-Vanguard.

Core Responsibilities:
- Manage session lifecycle
- Track state and context
- Handle session cleanup
- Score session quality`,
  },
  'self-diag-agent': {
    name: 'self-diag-agent',
    description: 'Self-diagnosis agent — auto-debug and recovery',
    model: 'opencode/deepseek-v4-flash-free',
    temperature: 0.1,
    maxTokens: 4000,
    systemPrompt: `You are the Self-Diagnosis agent for Gentle-Vanguard.

Core Responsibilities:
- Diagnose system issues
- Auto-recovery procedures
- Break-glass scenarios
- Error analysis`,
  },
  'premortem-agent': {
    name: 'premortem-agent',
    description: 'Premortem analysis agent — risk identification',
    model: 'opencode/deepseek-v4-flash-free',
    temperature: 0.2,
    maxTokens: 4000,
    systemPrompt: `You are the Premortem agent for Gentle-Vanguard.

Core Responsibilities:
- Identify potential failures
- Stress test scenarios
- Risk mitigation planning
- Failure prediction`,
  },
  'maintenance-agent': {
    name: 'maintenance-agent',
    description: 'Maintenance agent — cleanup and optimization',
    model: 'opencode/deepseek-v4-flash-free',
    temperature: 0.1,
    maxTokens: 3000,
    systemPrompt: `You are the Maintenance agent for Gentle-Vanguard.

Core Responsibilities:
- Cleanup and optimization
- Health monitoring
- Resource management
- Performance tuning`,
  },
};

/**
 * Load agent configuration with dynamic model override support
 */
function loadAgents(): Record<string, AgentConfig> {
  let agents: Record<string, AgentConfig> = { ...DEFAULT_AGENTS };

  // Load from config file
  if (existsSync(CONFIG_PATH)) {
    try {
      const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      agents = { ...agents, ...config.agents };
    } catch {
      console.warn('Failed to load config/agents.json, using defaults');
    }
  }

  // CRITICAL: Check for model override from environment (for fallback orchestrator)
  const envModel = process.env.AGENT_MODEL || process.env.FORCE_MODEL;
  const orchestratorModel = process.env.ORCHESTRATOR_MODEL;

  if (envModel || orchestratorModel) {
    // Apply model override to ALL agents
    const effectiveModel = envModel || orchestratorModel || agents['sdd-explore']?.model;

    for (const [, config] of Object.entries(agents)) {
      // Note: Store original model for reference
      (config as AgentConfig & { _originalModel?: string })._originalModel = config.model;
      config.model = effectiveModel;
    }

    console.log(`[agent-delegator] Model override applied: ${effectiveModel}`);
  }

  return agents;
}

/**
 * Delegate task to an agent using npx tsx
 * This is the native approach that works with any tool
 */
export async function delegate(request: DelegationRequest): Promise<DelegationResult> {
  const startTime = Date.now();
  const agents = loadAgents();
  const agentConfig = agents[request.agent];

  if (!agentConfig) {
    return {
      success: false,
      error: `Unknown agent: ${request.agent}`,
      duration: 0,
      model: 'unknown',
    };
  }

  // M6: effective temperature = tier override ?? agent config default.
  // A tier override of 0 (premium precision) must still be honored — only
  // `undefined` falls back to the hardcoded config value.
  const effectiveTemp = request.temperature ?? agentConfig.temperature;

  // Check if native agent implementation exists
  const agentScript = join(AGENTS_DIR, `${request.agent}.ts`);

  if (existsSync(agentScript)) {
    // Use native implementation if available
    return runNativeAgent(agentScript, request, agentConfig, startTime, effectiveTemp);
  } else {
    // Fallback: Generate agent output directly
    return generateAgentResponse(request, agentConfig, startTime);
  }
}

/**
 * Resolve the correct npx binary for the current platform.
 * Windows ships `npx.cmd`; spawn('npx') fails with ENOENT on win32.
 */
function resolveNpx(): string {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

/**
 * Escape a single shell argument for the current platform.
 * On Windows (cmd.exe) arguments containing spaces must be double-quoted
 * and inner quotes doubled; on POSIX shells use single-quote wrapping.
 */
function shellQuote(value: string): string {
  if (process.platform === 'win32') {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Run native agent TypeScript file.
 *
 * Windows note: Node spawn() cannot exec `.cmd` shims without `shell: true`,
 * and with `shell: true` Node only concatenates args (it does not escape them),
 * which truncates args containing spaces. We therefore build the full command
 * line ourselves with proper quoting and run it via the shell.
 */
async function runNativeAgent(
  scriptPath: string,
  request: DelegationRequest,
  config: AgentConfig,
  startTime: number,
  effectiveTemperature: number,
): Promise<DelegationResult> {
  return new Promise((resolve) => {
    // CRITICAL: Priority for model selection:
    // 1. Request override (from fallback orchestrator)
    // 2. Environment variable (AGENT_MODEL, FORCE_MODEL)
    // 3. Agent config default
    let model = request.model || config.model;

    // Check for environment override (from fallback system)
    const envModel = process.env.AGENT_MODEL || process.env.FORCE_MODEL;
    if (envModel) {
      model = envModel;
      console.log(`[agent-delegator] Using environment model: ${model}`);
    }

    // Lossless compression of task/context (defense in depth): the original
    // request stays intact for logging; only the spawned command uses the
    // compressed forms.
    const taskCompressed = compressDelegationLossless(request.task);
    const contextCompressed = request.context ? compressDelegationLossless(request.context) : null;

    if (taskCompressed.applied) {
      console.log(
        `[agent-delegator] compressed task: ${taskCompressed.originalChars} -> ${taskCompressed.compressedChars} chars (ratio ${taskCompressed.ratio.toFixed(3)})`,
      );
    }
    if (contextCompressed?.applied) {
      console.log(
        `[agent-delegator] compressed context: ${contextCompressed.originalChars} -> ${contextCompressed.compressedChars} chars (ratio ${contextCompressed.ratio.toFixed(3)})`,
      );
    }

    const parts = [
      resolveNpx(),
      'tsx',
      scriptPath,
      '--task',
      shellQuote(taskCompressed.text),
      '--model',
      shellQuote(model),
    ];

    if (request.context) {
      parts.push('--context', shellQuote(contextCompressed ? contextCompressed.text : request.context));
    }

    const command = parts.join(' ');

    const child = spawn(command, {
      cwd: process.cwd(),
      shell: true,
      windowsHide: true,
      env: {
        ...process.env,
        // Propagate model to subprocess
        AGENT_MODEL: model,
        AGENT_TEMPERATURE: String(effectiveTemperature),
        // Track that this is a delegator spawn for fallback purposes
        DELEGATOR_SPAWN: 'true',
        ORIGINAL_AGENT_MODEL: config.model,
      },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      const duration = Date.now() - startTime;

      if (code === 0) {
        resolve({
          success: true,
          output: stdout.trim(),
          duration,
          model,
        });
      } else {
        resolve({
          success: false,
          output: stdout.trim(),
          error: stderr.trim() || `Exit code: ${code}`,
          duration,
          model,
        });
      }
    });

    child.on('error', (error) => {
      resolve({
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
        model,
      });
    });
  });
}

/**
 * Generate agent response directly (no external process)
 * Used when native implementation doesn't exist.
 *
 * CRITICAL (premortem M2): This must return success:false, NOT a canned stub.
 * Returning success:true for work that never happened makes failure invisible
 * and poisons session scoring and learning loops.
 */
async function generateAgentResponse(
  request: DelegationRequest,
  config: AgentConfig,
  startTime: number,
): Promise<DelegationResult> {
  const duration = Date.now() - startTime;

  const response = `[DELEGATION FAILED — NOT IMPLEMENTED]
Agent: ${config.name}
Description: ${config.description}
Task: ${request.task}
Context: ${request.context || 'N/A'}
Model: ${request.model || config.model}

[ERROR]
Native agent implementation not found at ${join(AGENTS_DIR, `${request.agent}.ts`)}.
To enable this agent, create the agent implementation file:
  npx tsx src/agent-delegator.ts --generate ${request.agent}
Or register a native implementation in src/agents/.
`;

  return {
    success: false,
    output: response,
    error: `Native agent implementation not found: ${request.agent}. Create src/agents/${request.agent}.ts to enable.`,
    duration,
    model: request.model || config.model,
  };
}

/**
 * Generate agent template
 */
function generateAgentTemplate(agentName: string): void {
  const template = `#!/usr/bin/env node
/**
 * ${agentName} - Native Agent Implementation
 * 
 * Generated by agent-delegator.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';

interface AgentTask {
  task: string;
  context?: string;
  model: string;
}

function parseArgs(): AgentTask {
  const args = process.argv.slice(2);
  const task: AgentTask = { task: '', model: process.env.AGENT_MODEL || 'default' };
  
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
    }
  }
  
  return task;
}

async function main(): Promise<void> {
  const { task, context, model } = parseArgs();
  
  console.log(\`[\${agentName}] Processing task: \${task}\`);
  console.log(\`[\${agentName}] Model: \${model}\`);
  
  if (context) {
    console.log(\`[\${agentName}] Context: \${context}\`);
  }
  
  // TODO: Implement agent logic here
  
  console.log(\`[\${agentName}] Task completed successfully\`);
}

main().catch(console.error);
`;

  const outputPath = join(AGENTS_DIR, `${agentName}.ts`);
  writeFileSync(outputPath, template, 'utf-8');
  console.log(`✓ Generated agent template: ${outputPath}`);
}

/**
 * CLI interface
 */
function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case '--list':
      const agents = loadAgents();
      console.log('\n=== Available Agents ===\n');
      for (const [name, config] of Object.entries(agents)) {
        console.log(`${name}`);
        console.log(`  Description: ${config.description}`);
        console.log(`  Model: ${config.model}`);
        console.log(`  Temp: ${config.temperature}`);
        console.log(`  Max Tokens: ${config.maxTokens}`);
        console.log();
      }
      break;

    case '--agent':
      const agentName = args[1];
      const taskIndex = args.indexOf('--task');
      const task = taskIndex > -1 ? args[taskIndex + 1] : '';

      if (!agentName || !task) {
        console.error('Usage: --agent <name> --task "description"');
        process.exit(1);
      }

      void (async () => {
        const result = await delegate({ agent: agentName, task });
        console.log('\n=== Delegation Result ===\n');
        console.log(JSON.stringify(result, null, 2));
      })();
      break;

    case '--generate':
      const genAgent = args[1];
      if (!genAgent) {
        console.error('Usage: --generate <agent-name>');
        process.exit(1);
      }
      generateAgentTemplate(genAgent);
      break;

    default:
      console.log(`
Native Agent Delegator - Gentle-Vanguard

Usage:
  --list                    # List all available agents
  --agent <name> --task "t" # Delegate task to agent
  --generate <name>         # Generate agent template

Examples:
  npx tsx src/agent-delegator.ts --agent sdd-apply --task "fix bug"
  npx tsx src/agent-delegator.ts --generate my-agent

Features:
  - Works with ANY AI tool (Claude, Cursor, etc.)
  - No opencode task() dependency
  - Native TypeScript agents
  - Fallback generation mode
`);
  }
}

// Export for module use
export { loadAgents, generateAgentTemplate };

// Run CLI
import { pathToFileURL } from 'url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
