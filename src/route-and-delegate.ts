#!/usr/bin/env node
/**
 * Route & Delegate — unified natural-language entry point.
 *
 * Takes ANY human request, recommends the best native agent from the adaptive
 * routing table (or high-priority overrides, or static fallback), then
 * delegates to the native TypeScript agent. This is the "operate with all
 * tools" bridge: one command in → recommended agent out.
 *
 * Flow:
 *   1. recommend-agent.ts  → best agent + confidence + source
 *   2. agent-delegator.ts  → run the native agent with the task
 *   3. Persist routing hit to .session/routing/hits.jsonl (feedback loop)
 *
 * Usage:
 *   npx tsx src/route-and-delegate.ts --task "build a revenue forecast"
 *   npx tsx src/route-and-delegate.ts --task "audit gdpr compliance" --context "..." --topn 3
 *
 * Output (JSON):
 *   { task, domain, recommended, confidence, source, compression: {taskSaved, ...}, delegation: {success, ...} }
 */

import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { recommend } from './recommend-agent.js';
import { delegate, compressDelegationLossless } from './agent-delegator.js';
import { resolveAgentTier } from './domain-tier.js';

const ROOT = resolve(process.cwd());
const HITS_FILE = join(ROOT, '.session', 'routing', 'hits.jsonl');

interface RouteArgs {
  task: string;
  context?: string;
  topN: number;
}

interface RouteResult {
  task: string;
  domain: string;
  recommended: string;
  confidence: number;
  source: string;
  tier: {
    name: string;
    temperature: number;
    hallucinationGuard: string;
  };
  delegation: {
    success: boolean;
    duration: number;
    model: string;
    artifactDir?: string;
    error?: string;
  };
  /** Lossless compression applied to task/context before delegation. */
  compression: {
    taskSaved: number;
    contextSaved: number;
    taskRatio: number;
    contextRatio: number;
  };
}

function parseArgs(argv: string[]): RouteArgs {
  const args: RouteArgs = { task: '', topN: 3 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--task' && argv[i + 1]) args.task = argv[++i];
    else if (argv[i] === '--context' && argv[i + 1]) args.context = argv[++i];
    else if (argv[i] === '--topn' && argv[i + 1]) args.topN = Number(argv[++i]);
  }
  return args;
}

function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function persistHit(hit: Record<string, unknown>): void {
  try {
    ensureDir(join(ROOT, '.session', 'routing'));
    appendFileSync(HITS_FILE, JSON.stringify(hit) + '\n', 'utf-8');
  } catch {
    // non-blocking
  }
}

async function main(): Promise<void> {
  const { task, context, topN } = parseArgs(process.argv);

  if (!task) {
    console.error('Usage: --task "description" [--context "..."] [--topn N]');
    process.exit(1);
  }

  // 1. Recommend the best agent
  const rec = recommend(task, '', topN) as {
    domain: string;
    recommended: string;
    confidence: number;
    source: string;
  };

  // 1b. Resolve the M6 quality tier for the recommended agent
  const tier = resolveAgentTier(rec.recommended);

  // 1c. Lossless compression of task/context (mode 'input' protects model
  //     reasoning). Falls back to the original when too short / not improved.
  const taskC = compressDelegationLossless(task);
  const contextC = context ? compressDelegationLossless(context) : null;

  // 2. Delegate natively — pass the M6 tier temperature override so the
  //    agent actually runs with the domain quality tier (premium: low temp /
  //    hallucination guard; fastCheap: higher temp), not the hardcoded default.
  const result = await delegate({
    agent: rec.recommended,
    task: taskC.applied ? taskC.text : task,
    context: contextC?.applied ? contextC.text : context,
    temperature: tier.temperature,
  });

  const routeResult: RouteResult = {
    task,
    domain: rec.domain,
    recommended: rec.recommended,
    confidence: rec.confidence,
    source: rec.source,
    tier: {
      name: tier.tier,
      temperature: tier.temperature,
      hallucinationGuard: tier.hallucinationGuard,
    },
    compression: {
      taskSaved: taskC.saved,
      contextSaved: contextC?.saved ?? 0,
      taskRatio: taskC.ratio,
      contextRatio: contextC?.ratio ?? 1,
    },
    delegation: {
      success: result.success,
      duration: result.duration,
      model: result.model,
      artifactDir: extractArtifactDir(result.output),
      error: result.error,
    },
  };

  // 3. Feedback loop: persist routing hit for the adaptive router
  persistHit({
    timestamp: new Date().toISOString(),
    task,
    domain: rec.domain,
    agent: rec.recommended,
    confidence: rec.confidence,
    source: rec.source,
    success: result.success,
    duration: result.duration,
  });

  console.log(JSON.stringify(routeResult, null, 2));

  if (!result.success) {
    process.exitCode = 1;
  }
}

function extractArtifactDir(output: string | undefined): string | undefined {
  if (!output) return undefined;
  const m = output.match(/Artifacts persisted[\s\S]{0,40}?([A-Za-z]:\\[^\n]+)/);
  return m ? m[1].trim() : undefined;
}

// Guard: only run as CLI; allow import as module
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}

export { recommend, persistHit, extractArtifactDir };
export type { RouteResult };
