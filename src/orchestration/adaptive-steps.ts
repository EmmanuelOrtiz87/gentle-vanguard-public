#!/usr/bin/env node
/**
 * Adaptive Steps — Auto-scales the `steps` budget for orchestrator and
 * subagents based on task complexity, so agents never block on an
 * insufficient step limit.
 *
 * Two mechanisms:
 *   1. PROACTIVE: estimate required steps from task description + file scope
 *      and write the updated `steps` into opencode.json + .opencode/agents/*.md
 *      BEFORE delegating.
 *   2. REACTIVE: when an agent reports "maximum steps reached", the orchestrator
 *      calls `--resume <agent> <task_id>` to bump the limit and re-dispatch.
 *
 * Usage:
 *   npx tsx src/orchestration/adaptive-steps.ts --estimate "fix broken ps1 refs in 20 files"
 *   npx tsx src/orchestration/adaptive-steps.ts --apply sdd-apply --steps 40
 *   npx tsx src/orchestration/adaptive-steps.ts --resume sdd-apply --task_id ses_xxx
 *   npx tsx src/orchestration/adaptive-steps.ts --status
 *   npx tsx src/orchestration/adaptive-steps.ts --auto "task description"   # estimate + apply
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { normalizeSteps } from '../security/opencode-guards.js';

const ROOT = resolve(process.cwd());
const OPENCODE_JSON = join(ROOT, 'opencode.json');
const AGENTS_DIR = join(ROOT, '.opencode', 'agents');
const RESUME_LOG = join(ROOT, '.runtime', 'adaptive-steps-resume.log');

// Baseline steps per agent role (used as floor when estimating)
const BASELINE: Record<string, number> = {
  orchestrator: 24,
  'sdd-apply': 40,
  'sdd-explore': 30,
  'sdd-design': 30,
  'sdd-verify': 30,
  'sia-agent': 35,
  'doc-agent': 30,
  'ops-agent': 30,
  'gov-agent': 30,
  'premortem-agent': 30,
  'maintenance-agent': 30,
  'gitflow-agent': 30,
  'self-diag-agent': 30,
  'session-agent': 25,
  'knowledge-agent': 25,
  'mkt-agent': 20,
  'sales-agent': 20,
  'finance-agent': 20,
  'hr-agent': 20,
  'legal-agent': 20,
  'bus-tele-agent': 20,
};

// Complexity signals → step cost
const COMPLEXITY_SIGNALS: Array<{ re: RegExp; cost: number }> = [
  { re: /files|refactor|migrat|rewrite|implement|feature|module|component/i, cost: 12 },
  { re: /explore|investigat|research|analy|audit|review|diagnos/i, cost: 8 },
  { re: /test|verify|validat|typecheck|lint/i, cost: 6 },
  { re: /config|json|yaml|schema/i, cost: 4 },
  { re: /doc|readme|guide|adr/i, cost: 4 },
  { re: /parallel|multiple|batch|across/i, cost: 8 },
  { re: /complex|large|big|deep|nested|integrat/i, cost: 10 },
];

function estimateSteps(task: string, base: number): number {
  let extra = 0;
  for (const s of COMPLEXITY_SIGNALS) {
    if (s.re.test(task)) extra += s.cost;
  }
  // File-count heuristic: "N files" → N/2 steps
  const fileMatch = task.match(/(\d+)\s*(?:files?|refs?|paths?)/i);
  if (fileMatch) extra += Math.min(Number(fileMatch[1]) / 2, 20);
  // Cap at a sane max, always round up to avoid undershooting
  return Math.min(Math.ceil(base + extra), 80);
}

function loadJson<T>(p: string): T | null {
  try {
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function saveJson(p: string, data: unknown): void {
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function currentSteps(agent: string): number {
  const cfg = loadJson<{ agent?: Record<string, { steps?: number }> }>(OPENCODE_JSON);
  return cfg?.agent?.[agent]?.steps ?? BASELINE[agent] ?? 20;
}

function applyToOpencodeJson(agent: string, steps: number): boolean {
  const cfg = loadJson<{ agent?: Record<string, { steps?: number }> }>(OPENCODE_JSON);
  if (!cfg?.agent?.[agent]) return false;
  cfg.agent[agent].steps = steps;
  saveJson(OPENCODE_JSON, cfg);
  return true;
}

function applyToAgentMd(agent: string, steps: number): boolean {
  const f = join(AGENTS_DIR, `${agent}.md`);
  if (!existsSync(f)) return false;
  let content = readFileSync(f, 'utf-8');
  if (/^steps:\s*(?:[0-9]+\.[0-9]+|[0-9]+)/m.test(content)) {
    content = content.replace(/^steps:\s*(?:[0-9]+\.[0-9]+|[0-9]+)/m, `steps: ${steps}`);
  } else {
    // Insert after the model line in frontmatter
    content = content.replace(/^(model:.*)$/m, `$1\nsteps: ${steps}`);
  }
  writeFileSync(f, content, 'utf-8');
  return true;
}

function applySteps(
  agent: string,
  steps: number,
): { agent: string; steps: number; opencodeJson: boolean; agentMd: boolean } {
  const normalized = normalizeSteps(steps);
  const opencodeJson = applyToOpencodeJson(agent, normalized);
  const agentMd = applyToAgentMd(agent, normalized);
  return { agent, steps: normalized, opencodeJson, agentMd };
}

function status(): void {
  const cfg = loadJson<{ agent?: Record<string, { steps?: number }> }>(OPENCODE_JSON);
  if (!cfg?.agent) return;
  const rows = Object.entries(cfg.agent)
    .map(([k, v]) => ({ agent: k, steps: v.steps ?? '?' }))
    .sort(
      (a, b) =>
        (typeof a.steps === 'number' ? a.steps : 0) - (typeof b.steps === 'number' ? b.steps : 0),
    );
  console.log('=== Adaptive Steps Status ===');
  for (const r of rows) {
    console.log(`  ${r.agent}: ${r.steps}`);
  }
}

function checkResumeLoop(taskId: string): { isLoop: boolean; count: number } {
  try {
    if (!existsSync(RESUME_LOG)) return { isLoop: false, count: 0 };
    const lines = readFileSync(RESUME_LOG, 'utf-8').split('\n').filter(Boolean).slice(-10);
    const same = lines.filter((l) => l.trim() === taskId).length;
    return { isLoop: same >= 2, count: same };
  } catch {
    return { isLoop: false, count: 0 };
  }
}

function recordResume(taskId: string): void {
  try {
    mkdirSync(join(ROOT, '.runtime'), { recursive: true });
    appendFileSync(RESUME_LOG, `${taskId}\n`, 'utf-8');
    // keep last 50 lines
    const lines = readFileSync(RESUME_LOG, 'utf-8').split('\n').filter(Boolean);
    if (lines.length > 50) {
      writeFileSync(RESUME_LOG, lines.slice(-50).join('\n') + '\n', 'utf-8');
    }
  } catch {}
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      args[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    }
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv);

  if (args.status) {
    status();
    return;
  }

  if (args.estimate) {
    const base = args.agent ? (BASELINE[args.agent] ?? 20) : 24;
    const steps = estimateSteps(args.estimate, base);
    console.log(
      JSON.stringify(
        { agent: args.agent ?? 'orchestrator', estimatedSteps: steps, task: args.estimate },
        null,
        2,
      ),
    );
    return;
  }

  if (args.apply && args.steps) {
    const result = applySteps(args.apply, Number(args.steps));
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (args.auto) {
    // Estimate + apply to the target agent (default orchestrator)
    const agent = args.agent ?? 'orchestrator';
    const base = BASELINE[agent] ?? 20;
    const steps = estimateSteps(args.auto, base);
    const result = applySteps(agent, steps);
    console.log(JSON.stringify({ ...result, estimatedSteps: steps, task: args.auto }, null, 2));
    return;
  }

  if (args.resume && args.task_id) {
    // Reactive: bump the agent's limit and report the task_id to resume with
    // Loop-guard (ADR-0022): detect repeated resume on same task_id (≥3× = loop)
    const loop = checkResumeLoop(args.task_id);
    if (loop.isLoop) {
      console.error(
        `[adaptive-steps] WARN loop-guard: task_id=${args.task_id} resumed ${loop.count + 1}x — possible infinite loop. Consider asking for clarification or changing task description.`,
      );
    }
    recordResume(args.task_id);
    const agent = args.resume;
    const current = currentSteps(agent);
    const bumped = Math.min(current + 20, 80);
    const result = applySteps(agent, bumped);
    console.log(
      JSON.stringify(
        {
          ...result,
          previousSteps: current,
          task_id: args.task_id,
          action: 'resume',
          loopGuard: loop.isLoop ? { isLoop: true, count: loop.count + 1 } : { isLoop: false },
          note: `Re-dispatch with task_id=${args.task_id} and steps=${bumped}${loop.isLoop ? ' — loop-guard triggered' : ''}`,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    'Usage: --estimate <task> | --apply <agent> --steps <n> | --auto <task> [--agent <a>] | --resume <agent> --task_id <id> | --status',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { estimateSteps, applySteps, currentSteps };
