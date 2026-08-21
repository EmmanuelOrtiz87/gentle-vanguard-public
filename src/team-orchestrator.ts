#!/usr/bin/env node
/**
 * Team Orchestrator — Parallel Swarm Mode (Leader-Worker).
 *
 * A Leader agent decomposes complex tasks into sub-tasks, dispatches them to
 * parallel Worker agents (child_process), and synthesizes results.
 *
 * Usage:
 *   npx tsx src/team-orchestrator.ts start --task "Build a React dashboard" --skills "react-19,api-design"
 *   npx tsx src/team-orchestrator.ts start --task "Security audit" --max-parallel 5
 *   npx tsx src/team-orchestrator.ts status
 *   npx tsx src/team-orchestrator.ts report
 *   npx tsx src/team-orchestrator.ts stop
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  appendFileSync,
  rmSync,
} from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { runSyncShell } from './core/run-command.js';
import { randomBytes } from 'crypto';

// ---- Types ----

interface SubTask {
  name: string;
  description: string;
}

interface WorkerResult {
  skill: string;
  status: 'running' | 'completed' | 'failed' | 'timeout';
  started: string;
  finished?: string;
  output: string;
  error: string | null;
  exitCode: number | null;
  workerDir: string;
}

interface OrchestratorOptions {
  task: string;
  skills: string[];
  maxParallel: number;
  timeoutSeconds: number;
  dryRun: boolean;
  quiet: boolean;
  action: string;
  skill: string;
  decompose: boolean;
  worktree: boolean;
}

// ---- Constants ----

const ROOT = resolve(process.env.GENTLE_VANGUARD_BASE_DIR ?? process.cwd());
const RESULTS_DIR = join(ROOT, '.session', 'team-mode');
const ORCHESTRATOR_LOG = join(ROOT, '.session', 'team-orchestrator.log');
const SWARM_WORK_DIR = join(ROOT, '.session', 'swarm-workers');

let quiet = false;

// ---- Logging ----

function log(msg: string, level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS' = 'INFO') {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const colors: Record<string, string> = {
    INFO: '\x1b[36m',
    WARN: '\x1b[33m',
    ERROR: '\x1b[31m',
    SUCCESS: '\x1b[32m',
  };
  if (!quiet) console.log(`${colors[level] ?? ''}[${ts}] [SWARM] [${level}] ${msg}\x1b[0m`);
  try {
    appendFileSync(ORCHESTRATOR_LOG, `[${ts}] [SWARM] [${level}] ${msg}\n`);
  } catch {
    /* ignore */
  }
}

function ensureDirs() {
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
  if (!existsSync(SWARM_WORK_DIR)) mkdirSync(SWARM_WORK_DIR, { recursive: true });
}

function timestamp(): string {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

function dateStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${(d.getMonth() + 1).toString().padStart(2, '0')}${d.getDate().toString().padStart(2, '0')}-${d.getHours().toString().padStart(2, '0')}${d.getMinutes().toString().padStart(2, '0')}${d.getSeconds().toString().padStart(2, '0')}`;
}

// ---- Leader: Task Decomposition ----

/**
 * Leader decomposes a complex task into sub-tasks using the skill-router.
 * Each skill matched becomes a worker assignment.
 */
function leaderDecompose(task: string, explicitSkills: string[]): SubTask[] {
  if (explicitSkills.length > 0) {
    return explicitSkills.map((s) => ({
      name: s,
      description: `[${s}] ${task}`,
    }));
  }

  // Call the semantic skill router to find relevant skills
  try {
    const routerPath = join(ROOT, 'src', 'skills', 'skill-router.ts').replace(/\\/g, '/');
    const escapedTask = task.replace(/"/g, '\\"');
    const result = runSyncShell(
      `npx tsx "${routerPath}" --query "${escapedTask}" --top-k 5 --json`,
      {
        cwd: ROOT,
        timeout: 15000,
      },
    );

    if (result.status === 0 && result.stdout) {
      const parsed = JSON.parse(result.stdout);
      if (parsed.Status === 'Routed' && parsed.Matches?.length > 0) {
        const subTasks: SubTask[] = parsed.Matches.map(
          (m: { skill: string; confidence: number }) => ({
            name: m.skill,
            description: `[${m.skill} (confidence: ${(m.confidence * 100).toFixed(0)}%)] ${task}`,
          }),
        );
        log(
          `Leader decomposed task into ${subTasks.length} sub-tasks via semantic router`,
          'SUCCESS',
        );
        return subTasks;
      }
    }
  } catch {
    log('Leader decomposition via skill-router failed, using fallback', 'WARN');
  }

  // Fallback: use a single generic worker
  log('Leader fallback: single worker for task', 'WARN');
  return [{ name: 'auto-delegation-router', description: `[auto-delegation-router] ${task}` }];
}

// ---- Worker: Real Agent Execution ----

/**
 * Worker spawns a fresh tsx process as an isolated agent.
 * Each worker runs in its own temp directory under .session/swarm-workers/.
 */
function spawnWorker(
  skillName: string,
  subTask: string,
  timeoutSec: number,
  workerId: string,
): WorkerResult {
  const started = timestamp();
  const workerDir = join(SWARM_WORK_DIR, `${skillName}-${workerId}`);
  if (!existsSync(workerDir)) mkdirSync(workerDir, { recursive: true });

  const result: WorkerResult = {
    skill: skillName,
    status: 'running',
    started,
    output: '',
    error: null,
    exitCode: null,
    workerDir,
  };

  // Write the task to the worker directory
  writeFileSync(
    join(workerDir, 'task.json'),
    JSON.stringify({ skill: skillName, task: subTask }, null, 2),
    'utf-8',
  );

  const workerScript = join(ROOT, 'src', 'skills', 'skill-router.ts');

  try {
    log(`[WORKER:${skillName}] Spawning in ${workerDir}`, 'INFO');

    const escapedScript = workerScript.replace(/\\/g, '/');
    const escapedQuery = subTask.replace(/"/g, '\\"');
    const proc = runSyncShell(`npx tsx "${escapedScript}" --query "${escapedQuery}" --json`, {
      cwd: workerDir,
      timeout: timeoutSec * 1000,
      env: {
        ...process.env,
        GENTLE_VANGUARD_BASE_DIR: ROOT,
        SWARM_WORKER_ID: workerId,
        SWARM_WORKER_SKILL: skillName,
      },
    });

    const stdout = proc.stdout?.trim() || '';
    const stderr = proc.stderr?.trim() || '';

    result.exitCode = proc.status;
    result.output = stdout || stderr || '(no output)';
    result.error = proc.error ? proc.error.message : stderr || null;
    result.status = proc.status === 0 ? 'completed' : 'failed';

    // Write worker output files
    writeFileSync(
      join(workerDir, 'output.json'),
      JSON.stringify(
        {
          skill: skillName,
          status: result.status,
          exitCode: result.exitCode,
          stdout,
          stderr,
          finished: timestamp(),
        },
        null,
        2,
      ),
      'utf-8',
    );

    // Write stdout log
    if (stdout) writeFileSync(join(workerDir, 'output.log'), stdout, 'utf-8');
    if (stderr) writeFileSync(join(workerDir, 'error.log'), stderr, 'utf-8');
  } catch (err: unknown) {
    result.status = 'failed';
    result.error = err instanceof Error ? err.message : String(err);
    result.exitCode = -1;
  }

  result.finished = timestamp();
  return result;
}

// ---- Synthesis ----

function leaderSynthesize(allResults: WorkerResult[], subTasks: SubTask[], task: string): string {
  const completedCount = allResults.filter((r) => r.status === 'completed').length;
  const failedCount = allResults.filter((r) => r.status === 'failed').length;
  const duration =
    allResults.length > 0 && allResults[0].started && allResults[allResults.length - 1].finished
      ? `${allResults[allResults.length - 1].finished}`
      : 'unknown';

  const lines: string[] = [
    '# Swarm Mode Report',
    `**Task**: ${task}`,
    `**Date**: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    `**Leader decomposition**: ${subTasks.length} sub-tasks into ${allResults.length} workers`,
    `**Results**: ${completedCount} completed, ${failedCount} failed`,
    `**Duration**: ${duration}`,
    '',
    '## Per-Worker Results',
    '',
  ];

  for (const r of allResults) {
    const statusIcon = r.status === 'completed' ? '✅' : r.status === 'failed' ? '❌' : '⏳';
    lines.push(`### ${statusIcon} ${r.skill}`);
    lines.push(`- **Status**: ${r.status}`);
    lines.push(`- **Exit Code**: ${r.exitCode ?? 'N/A'}`);
    lines.push(`- **Started**: ${r.started} | **Finished**: ${r.finished ?? 'N/A'}`);
    lines.push(`- **Worker Dir**: \`${r.workerDir}\``);
    if (r.output) lines.push(`- **Output**: ${r.output.substring(0, 300)}`);
    if (r.error) lines.push(`- **Error**: ${r.error.substring(0, 300)}`);
    lines.push('');
  }

  lines.push('## Next Steps');
  lines.push('- Review individual worker dirs for detailed output');
  lines.push('- Re-run failed workers: `--action rerun --skill <name>`');
  if (failedCount > 0) {
    lines.push(
      '- Fix issues and re-run: `npm run team:run -- --action rerun --skill <failed-skill>`',
    );
  }

  const report = lines.join('\n');
  const reportFile = join(RESULTS_DIR, `swarm-report-${dateStamp()}.md`);
  writeFileSync(reportFile, report, 'utf-8');
  log(`Swarm report written to ${reportFile}`, 'SUCCESS');
  if (!quiet) console.log(`\n${report}\n`);
  return report;
}

// ---- Actions ----

async function actionStart(opts: OrchestratorOptions): Promise<WorkerResult[]> {
  ensureDirs();
  log(`🚀 SWARM MODE — Leader initializing`, 'SUCCESS');
  log(`Task: ${opts.task}`, 'INFO');

  // LEADER: Decompose task
  log(`Leader decomposing task...`, 'INFO');
  const subTasks = leaderDecompose(opts.task, opts.skills);
  log(`Leader: ${subTasks.length} sub-tasks created`, 'SUCCESS');
  for (const st of subTasks) {
    log(`  🧩 ${st.name}`, 'INFO');
  }

  if (opts.dryRun) {
    log(
      `[DRY-RUN] Would execute ${subTasks.length} workers in parallel (max ${opts.maxParallel})`,
      'WARN',
    );
    return [];
  }

  // WORKERS: Parallel execution
  log(
    `Workers deploying (maxParallel=${opts.maxParallel}, timeout=${opts.timeoutSeconds}s)...`,
    'INFO',
  );
  const allResults: WorkerResult[] = [];
  const queue = [...subTasks];
  const swarmId = randomBytes(4).toString('hex');

  // Process tasks in parallel with concurrency limit
  async function processQueue(): Promise<void> {
    const promises: Promise<void>[] = [];

    function runNext(): Promise<void> {
      if (queue.length === 0) return Promise.resolve();
      const task = queue.shift()!;
      return new Promise<void>((resolvePromise) => {
        const workerId = `${swarmId}-${randomBytes(2).toString('hex')}`;
        log(`  [LAUNCH] Worker for ${task.name} (${workerId})`, 'INFO');
        const result = spawnWorker(task.name, task.description, opts.timeoutSeconds, workerId);
        allResults.push(result);
        const level = result.status === 'completed' ? 'SUCCESS' : 'ERROR';
        log(
          `  [DONE] ${task.name}: ${result.status} (exit: ${result.exitCode})`,
          level as 'SUCCESS' | 'ERROR',
        );
        resolvePromise();
      });
    }

    // Fill initial batch
    for (let i = 0; i < Math.min(opts.maxParallel, subTasks.length); i++) {
      promises.push(runNext());
    }

    await Promise.allSettled(promises);

    // Process remaining sequentially (in batches)
    while (queue.length > 0) {
      const batch: Promise<void>[] = [];
      for (let i = 0; i < opts.maxParallel && queue.length > 0; i++) {
        batch.push(runNext());
      }
      await Promise.allSettled(batch);
    }
  }

  await processQueue();

  // LEADER: Synthesize results
  log(`Leader synthesizing ${allResults.length} worker results...`, 'INFO');
  leaderSynthesize(allResults, subTasks, opts.task);

  const completed = allResults.filter((r) => r.status === 'completed').length;
  const failed = allResults.filter((r) => r.status === 'failed').length;
  log(
    `🏁 Swarm complete: ${completed} completed, ${failed} failed of ${allResults.length} total`,
    'SUCCESS',
  );

  return allResults;
}

function actionStop(): void {
  log('Stopping swarm workers...', 'WARN');
  try {
    // Kill any lingering npx tsx processes spawned by team-orchestrator
    if (process.platform === 'win32') {
      runSyncShell('taskkill /F /IM node.exe /FI "WINDOWTITLE eq *.tsx*" 2>nul', {
        stdio: 'ignore',
      });
    } else {
      runSyncShell('pkill -f "team-orchestrator" 2>/dev/null', { stdio: 'ignore' });
    }
    log('Swarm workers stopped.', 'SUCCESS');
  } catch {
    log('No swarm workers found to stop.', 'INFO');
  }
}

function actionStatus(): void {
  ensureDirs();
  const files = existsSync(RESULTS_DIR)
    ? readdirSync(RESULTS_DIR).filter((f) => f.startsWith('swarm-report') && f.endsWith('.md'))
    : [];
  const workerDirs = existsSync(SWARM_WORK_DIR)
    ? readdirSync(SWARM_WORK_DIR).filter((d) => {
        const full = join(SWARM_WORK_DIR, d);
        try {
          return existsSync(full) && !rmSync;
        } catch {
          return false;
        }
      })
    : [];

  log(`=== Swarm Status ===`, 'INFO');
  log(`Reports: ${files.length} in ${RESULTS_DIR}`, 'INFO');
  log(`Worker dirs: ${workerDirs.length} in ${SWARM_WORK_DIR}`, 'INFO');

  // Show recent reports
  const recentFiles = files.slice(-5);
  for (const f of recentFiles) {
    try {
      const content = readFileSync(join(RESULTS_DIR, f), 'utf-8');
      const taskMatch = content.match(/\*\*Task\*\*: (.+)/);
      const resultsMatch = content.match(/\*\*Results\*\*: (.+)/);
      log(
        `  📄 ${f}${taskMatch ? ` — ${taskMatch[1]}` : ''}${resultsMatch ? ` [${resultsMatch[1]}]` : ''}`,
        'INFO',
      );
    } catch {
      log(`  📄 ${f} (unreadable)`, 'WARN');
    }
  }

  // Show active workers
  if (workerDirs.length > 0) {
    log(`Active worker directories:`, 'INFO');
    for (const d of workerDirs.slice(-10)) {
      const outputFile = join(SWARM_WORK_DIR, d, 'output.json');
      let status = 'unknown';
      try {
        const data = JSON.parse(readFileSync(outputFile, 'utf-8'));
        status = data.status;
      } catch {
        /* no output yet */
      }
      log(
        `  🧩 ${d}: ${status}`,
        status === 'completed' ? 'SUCCESS' : status === 'failed' ? 'ERROR' : 'INFO',
      );
    }
  }
}

function actionDelegate(opts: OrchestratorOptions): WorkerResult {
  ensureDirs();
  const skillName = opts.skill || opts.skills[0] || 'default';
  log(`Delegate — invoking skill "${skillName}" as single worker`, 'INFO');
  const swarmId = randomBytes(4).toString('hex');
  const workerId = `${swarmId}-${randomBytes(2).toString('hex')}`;
  const result = spawnWorker(
    skillName,
    `[${skillName}] ${opts.task}`,
    opts.timeoutSeconds,
    workerId,
  );
  log(`[DONE] ${skillName}: ${result.status}`, result.status === 'completed' ? 'SUCCESS' : 'ERROR');
  return result;
}

function actionRerun(opts: OrchestratorOptions): void {
  const skillToRerun = opts.skill || opts.skills[0];
  if (!skillToRerun) {
    log('Rerun requires --skill <name>', 'ERROR');
    return;
  }
  log(`Rerunning failed skill: ${skillToRerun}`, 'INFO');
  const result = actionDelegate({ ...opts, skill: skillToRerun });
  log(
    `Rerun complete: ${skillToRerun} → ${result.status}`,
    result.status === 'completed' ? 'SUCCESS' : 'ERROR',
  );
}

function actionClean(): void {
  log('Cleaning swarm worker directories...', 'WARN');
  let cleaned = 0;
  if (existsSync(SWARM_WORK_DIR)) {
    const dirs = readdirSync(SWARM_WORK_DIR);
    for (const d of dirs) {
      try {
        rmSync(join(SWARM_WORK_DIR, d), { recursive: true, force: true });
        cleaned++;
      } catch {
        /* skip */
      }
    }
  }
  log(`Cleaned ${cleaned} worker directories`, 'SUCCESS');
}

// ---- CLI Parsing ----

function parseArgs(): OrchestratorOptions {
  const args = process.argv.slice(2);
  const opts: OrchestratorOptions = {
    task: '',
    skills: [],
    maxParallel: 3,
    timeoutSeconds: 300,
    dryRun: false,
    quiet: false,
    action: 'start',
    skill: '',
    decompose: true,
    worktree: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--task':
        opts.task = args[++i] ?? '';
        break;
      case '--skills':
        if (args[i + 1] && !args[i + 1].startsWith('-')) {
          opts.skills = args[++i].split(',').map((s) => s.trim());
        }
        break;
      case '--max-parallel':
      case '--maxParallel':
        opts.maxParallel = parseInt(args[++i] ?? '3', 10);
        break;
      case '--timeout-seconds':
      case '--timeoutSeconds':
        opts.timeoutSeconds = parseInt(args[++i] ?? '300', 10);
        break;
      case '--dry-run':
      case '--dryRun':
        opts.dryRun = true;
        break;
      case '--quiet':
        opts.quiet = true;
        break;
      case '--action':
        opts.action = args[++i] ?? 'start';
        break;
      case '--skill':
        opts.skill = args[++i] ?? '';
        break;
      case '--no-decompose':
        opts.decompose = false;
        break;
      case '--worktree':
        opts.worktree = true;
        break;
    }
  }

  return opts;
}

// ---- Main ----

async function main() {
  quiet = process.argv.includes('--quiet');
  const opts = parseArgs();

  log(`Swarm Orchestrator v2.0 — action: ${opts.action}`, 'INFO');

  switch (opts.action) {
    case 'start':
      await actionStart(opts);
      break;
    case 'stop':
      actionStop();
      break;
    case 'status':
      actionStatus();
      break;
    case 'delegate':
      actionDelegate(opts);
      break;
    case 'rerun':
      actionRerun(opts);
      break;
    case 'clean':
      actionClean();
      break;
    case 'synthesize':
    case 'report': {
      ensureDirs();
      const files = existsSync(RESULTS_DIR)
        ? readdirSync(RESULTS_DIR).filter((f) => f.startsWith('swarm-report') && f.endsWith('.md'))
        : [];
      log(
        `${opts.action === 'report' ? 'Report' : 'Synthesis'} — ${files.length} report(s) available`,
        'INFO',
      );
      if (files.length > 0) {
        const latest = files[files.length - 1];
        console.log(readFileSync(join(RESULTS_DIR, latest), 'utf-8'));
      }
      break;
    }
    default:
      log(
        `Unknown action: ${opts.action}. Use: start, stop, status, delegate, rerun, clean, report`,
        'ERROR',
      );
      process.exit(1);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
