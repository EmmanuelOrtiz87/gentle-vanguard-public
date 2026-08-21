#!/usr/bin/env node
/**
 * Domain Agent Core - Shared engine for native domain agents
 *
 * Agnostic executor for domain agents (marketing, sales, finance, HR, legal,
 * business telemetry, gitflow, knowledge, SIA). Works with ANY AI tool.
 *
 * Responsibilities:
 *  - Load the domain prompt from config/agent-prompts/<DOMAIN>.md
 *  - Validate the task and classify its intent
 *  - Produce a structured, actionable artifact (NOT a canned stub)
 *  - Persist the artifact to .session/artifacts/<domain>/ (durable, reviewable)
 *  - Emit usage to .session/skill-usage/ so learning loops consume domain data
 *
 * Wrappers: src/agents/<name>-agent.ts import this core with their domain config.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

export interface DomainAgentConfig {
  name: string;
  description: string;
  promptFile: string; // e.g. 'MKT' -> config/agent-prompts/MKT.md
  domain: string; // e.g. 'marketing' — used for artifact dir + usage key
  version?: string;
  temperature?: number;
  model?: string;
  /** Domain-specific executor: task + prompt body -> structured output */
  execute: (task: string, context: string | undefined, promptBody: string) => DomainOutput;
}

export interface DomainOutput {
  summary: string;
  analysis: Record<string, unknown>;
  checklist: string[];
  artifacts: Array<{ name: string; content: string }>;
  evidence: string[];
  flags?: Array<{
    severity: 'info' | 'warn' | 'critical';
    message: string;
    /**
     * Advisory flags are warnings inherent to the domain (e.g. "legal output
     * is advisory, escalate to counsel"). They must NOT be counted as
     * failures by the adaptive router — they are design-time notices, not
     * execution errors.
     */
    advisory?: boolean;
  }>;
}

interface DomainTask {
  task: string;
  context?: string;
  model: string;
  temperature: number;
}

const ROOT = process.cwd();
const ARTIFACT_ROOT = join(ROOT, '.session', 'artifacts');
const USAGE_DIR = join(ROOT, '.session', 'skill-usage');

function parseArgs(): DomainTask {
  const args = process.argv.slice(2);
  const task: DomainTask = {
    task: '',
    model: process.env.AGENT_MODEL || 'opencode/deepseek-v4-flash-free',
    temperature: parseFloat(process.env.AGENT_TEMPERATURE || '0.3'),
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--task':
        task.task = args[++i] ?? '';
        break;
      case '--context':
        task.context = args[++i];
        break;
      case '--model':
        task.model = args[++i] ?? task.model;
        break;
      case '--temperature':
        task.temperature = parseFloat(args[++i] ?? '0.3');
        break;
      case '--help':
      case '-h':
        return task; // handled by wrapper
    }
  }
  return task;
}

function loadPrompt(config: DomainAgentConfig): string {
  const promptPath = join(ROOT, 'config', 'agent-prompts', `${config.promptFile}.md`);
  if (!existsSync(promptPath)) {
    return `${config.name}: no domain prompt found at ${promptPath}`;
  }
  return readFileSync(promptPath, 'utf-8');
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-z0-9._-]/gi, '_').slice(0, 60);
}

function persistArtifacts(config: DomainAgentConfig, task: string, output: DomainOutput): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = join(ARTIFACT_ROOT, config.domain);
  const runDir = join(dir, stamp);
  mkdirSync(runDir, { recursive: true });

  // Index file with the structured output
  const index = {
    agent: config.name,
    domain: config.domain,
    timestamp: stamp,
    task,
    summary: output.summary,
    analysis: output.analysis,
    checklist: output.checklist,
    evidence: output.evidence,
    flags: output.flags ?? [],
  };
  writeFileSync(join(runDir, 'index.json'), JSON.stringify(index, null, 2), 'utf-8');

  // Individual artifacts (markdown by default)
  for (const artifact of output.artifacts) {
    const safe = sanitizeName(artifact.name);
    writeFileSync(join(runDir, `${safe}.md`), artifact.content, 'utf-8');
  }

  return runDir;
}

function emitUsage(config: DomainAgentConfig, task: string, output: DomainOutput): void {
  try {
    mkdirSync(USAGE_DIR, { recursive: true });
    const usageFile = join(USAGE_DIR, `${config.domain}.json`);
    const entry = {
      agent: config.name,
      domain: config.domain,
      timestamp: new Date().toISOString(),
      task: task.slice(0, 200),
      summary: output.summary,
      artifactCount: output.artifacts.length,
      checklistCount: output.checklist.length,
      flags: output.flags ?? [],
    };

    let existing: unknown[] = [];
    if (existsSync(usageFile)) {
      try {
        existing = JSON.parse(readFileSync(usageFile, 'utf-8'));
        if (!Array.isArray(existing)) existing = [];
      } catch {
        existing = [];
      }
    }
    existing.push(entry);
    writeFileSync(usageFile, JSON.stringify(existing, null, 2), 'utf-8');
  } catch {
    // Usage emission must never break the agent
  }
}

/**
 * Run a domain agent end-to-end.
 * Returns the structured result; the CLI path prints JSON and persists artifacts.
 */
export async function runDomainAgent(config: DomainAgentConfig): Promise<void> {
  const { task, context, model, temperature } = parseArgs();

  if (!task) {
    console.error(`Error: --task is required for ${config.name}`);
    process.exit(1);
  }

  console.log(`
=================================================
  ${config.name} v${config.version ?? '1.0.0'}
  ${config.description}
=================================================
`);

  const startTime = Date.now();
  try {
    const promptBody = loadPrompt(config);
    const output = config.execute(task, context, promptBody);
    const duration = Date.now() - startTime;

    // Persist + emit usage (closes the learning loop)
    const artifactDir = persistArtifacts(config, task, output);
    emitUsage(config, task, output);

    console.log('=== Domain Analysis ===\n');
    console.log(JSON.stringify(output.analysis, null, 2));
    console.log('\n=== Checklist ===');
    for (const item of output.checklist) console.log(`  [ ] ${item}`);
    if (output.flags && output.flags.length > 0) {
      console.log('\n=== Flags ===');
      for (const flag of output.flags) {
        console.log(`  [${flag.severity.toUpperCase()}] ${flag.message}`);
      }
    }
    console.log(`\n=== Artifacts persisted ===`);
    console.log(`  ${artifactDir}`);
    console.log();
    console.log('=================================================');
    console.log(`  Status: ✅ SUCCESS`);
    console.log(`  Duration: ${duration}ms`);
    console.log(`  Model: ${model} | Temp: ${temperature}`);
    console.log('=================================================');

    console.log('\n=== JSON OUTPUT ===');
    console.log(
      JSON.stringify(
        {
          success: true,
          agent: config.name,
          domain: config.domain,
          task,
          model,
          duration,
          artifactDir,
          summary: output.summary,
          output,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ ${config.name} failed: ${msg}`);
    console.error(JSON.stringify({ success: false, agent: config.name, error: msg }, null, 2));
    process.exit(1);
  }
}

export { parseArgs, sanitizeName, pathToFileURL };
