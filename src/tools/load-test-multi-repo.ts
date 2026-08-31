#!/usr/bin/env node
/**
 * Load Test — Multi-Repo Scenario
 *
 * Harness that simulates operating on N git repositories in parallel: it
 * creates temporary repos, runs a realistic workload (a mix of core stack
 * operations) against each one, and reports latency / throughput / memory /
 * success metrics.
 *
 * Operations are read-only and safe to run concurrently (no global locks).
 * session-autostart is intentionally NOT part of the workload — it holds a
 * global lock (.runtime/session-autostart.lock) and only one instance may run.
 *
 * Usage:
 *   npx tsx src/tools/load-test-multi-repo.ts --repos 5 --ops 3 --concurrency 3
 *   npx tsx src/tools/load-test-multi-repo.ts --repos 3 --ops health-check,watchtower,recommend --json
 *   npx tsx src/tools/load-test-multi-repo.ts --repos 5 --ops 3 --report .runtime/load-test-report.json
 *
 * Flags:
 *   --repos N        number of temporary git repos (default 5)
 *   --ops N|list     operations per repo (default 3) or comma-separated list
 *   --concurrency C  repos processed in parallel (default 2)
 *   --json           emit the report as JSON
 *   --report <path>  persist the JSON report to a file
 *   --skip-git       use flat temp dirs instead of git repos (CI without git)
 *
 * Exit code: 0 when success_rate >= 0.9, 1 otherwise.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { performance } from 'perf_hooks';
import { runNpxTsx, runSync, type RunOptions } from '../core/run-command.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Stack root resolved from this module's location (cwd-independent). */
const STACK_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_OPS = ['health-check', 'watchtower', 'recommend'];
const SUCCESS_THRESHOLD = 0.9;
const OP_TIMEOUT_MS = 120000;
const TMP_PREFIX = 'gv-loadtest-';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LoadTestConfig {
  repos: number;
  ops: string[];
  concurrency: number;
  skipGit: boolean;
  /** Base directory for temp repos (defaults to os.tmpdir()). */
  tmpBase?: string;
}

export interface OpResult {
  name: string;
  duration_ms: number;
  exit_code: number | null;
  success: boolean;
  stdout_bytes: number;
}

export interface RepoResult {
  repoDir: string;
  total_ms: number;
  ops_ok: number;
  ops_total: number;
  operations: OpResult[];
}

export interface LoadTestReport {
  config: LoadTestConfig;
  repos_created: number;
  total_ms: number;
  throughput_ops_per_sec: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  success_rate: number;
  memory_delta_mb: number;
  repos: RepoResult[];
  pass: boolean;
}

// ─── Operation map ────────────────────────────────────────────────────────────

interface OperationSpec {
  script: string;
  args: string[];
  /** Run inside the temp repo instead of the stack root. */
  inRepo?: boolean;
}

const OPERATION_MAP: Record<string, OperationSpec> = {
  // Deterministic subset of health checks (file/config existence) — the full
  // health-check includes an embeddings-freshness check that flakes on stale
  // .atl/skill-embeddings.json, which would fail load runs for environmental
  // reasons unrelated to the stack's responsiveness.
  'health-check': {
    script: 'src/core/health-check.ts',
    args: [
      '--quiet',
      '--component',
      'session,factory,sdd,pnpm,lefthook,optimization,costtracking,mcpbridge',
    ],
  },
  watchtower: {
    script: 'src/core/maintenance-watchtower.ts',
    args: ['-Action', 'health', '-Quiet'],
  },
  recommend: {
    script: 'src/orchestration/recommend-agent.ts',
    args: ['--task', 'code review', '--topn', '3'],
  },
  'sdd-gate': {
    script: 'src/sdd/check-sdd-gate.ts',
    args: [],
    inRepo: true,
  },
};

// ─── Worker pool ──────────────────────────────────────────────────────────────

/**
 * Run `fn` over `items` in chunks of `concurrency`, awaiting each chunk with
 * Promise.all. Results are returned in input order.
 */
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  const limit = Math.max(1, Math.floor(concurrency));
  for (let i = 0; i < items.length; i += limit) {
    const slice = items.slice(i, i + limit);
    const sliceResults = await Promise.all(slice.map((item) => fn(item)));
    results.push(...sliceResults);
  }
  return results;
}

// ─── Operations ───────────────────────────────────────────────────────────────

interface AsyncRunResult {
  stdout: string;
  stderr: string;
  status: number | null;
}

/** Async spawn wrapper: collects output and resolves on process close. */
function runNpxTsxAsync(
  script: string,
  scriptArgs: string[],
  options: RunOptions,
): Promise<AsyncRunResult> {
  return new Promise((resolvePromise) => {
    const child = runNpxTsx(script, scriptArgs, options);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', () => resolvePromise({ stdout, stderr, status: -1 }));
    child.on('close', (code) => resolvePromise({ stdout, stderr, status: code }));
  });
}

/**
 * Run a single named operation. Stack-level operations run at the stack root;
 * repo-scoped operations (sdd-gate) run inside `cwd`.
 */
export async function runOperation(name: string, cwd: string): Promise<OpResult> {
  const spec = OPERATION_MAP[name];
  if (!spec) {
    return { name, duration_ms: 0, exit_code: -1, success: false, stdout_bytes: 0 };
  }
  const opCwd = spec.inRepo ? cwd : STACK_ROOT;
  const start = performance.now();
  // Resolve the script to an absolute path so it works regardless of the
  // child's cwd (repo-scoped ops run inside a temp repo).
  const result = await runNpxTsxAsync(join(STACK_ROOT, spec.script), spec.args, {
    cwd: opCwd,
    timeout: OP_TIMEOUT_MS,
  });
  const duration_ms = performance.now() - start;
  const exit_code = result.status;
  return {
    name,
    duration_ms,
    exit_code,
    success: exit_code === 0,
    stdout_bytes: Buffer.byteLength(result.stdout, 'utf-8'),
  };
}

/** Run the workload (list of ops) against one repo dir with a concurrency cap. */
export async function runRepoWorkload(
  repoDir: string,
  ops: string[],
  concurrency: number,
): Promise<RepoResult> {
  const start = performance.now();
  const operations = await mapPool(ops, concurrency, (op) => runOperation(op, repoDir));
  const total_ms = performance.now() - start;
  const ops_ok = operations.filter((o) => o.success).length;
  return { repoDir, total_ms, ops_ok, ops_total: operations.length, operations };
}

// ─── Git repo setup ───────────────────────────────────────────────────────────

/** Best-effort git init + initial commit so repo-scoped ops have git context. */
function initGitRepo(dir: string): void {
  runSync('git', ['init', '-q'], { cwd: dir });
  runSync('git', ['config', 'user.email', 'loadtest@gentle-vanguard.local'], { cwd: dir });
  runSync('git', ['config', 'user.name', 'Load Test'], { cwd: dir });
  writeFileSync(join(dir, 'README.md'), '# Load Test Repo\n', 'utf-8');
  runSync('git', ['add', '.'], { cwd: dir });
  runSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
}

// ─── Load test ────────────────────────────────────────────────────────────────

/**
 * Create `config.repos` temp repos, run the workload against each with the
 * given concurrency, and return an aggregated report. Temp dirs are always
 * removed (try/finally).
 */
export async function runLoadTest(config: LoadTestConfig): Promise<LoadTestReport> {
  const memBefore = process.memoryUsage().heapUsed;
  const tmpBase = config.tmpBase ?? tmpdir();
  mkdirSync(tmpBase, { recursive: true });
  const createdDirs: string[] = [];
  const start = performance.now();

  try {
    for (let i = 0; i < config.repos; i++) {
      const dir = mkdtempSync(join(tmpBase, TMP_PREFIX));
      createdDirs.push(dir);
      if (!config.skipGit) initGitRepo(dir);
    }

    const repos = await mapPool(createdDirs, config.concurrency, (dir) =>
      runRepoWorkload(dir, config.ops, config.concurrency),
    );

    return buildReport({
      config,
      repos_created: createdDirs.length,
      total_ms: performance.now() - start,
      memory_delta_mb: (process.memoryUsage().heapUsed - memBefore) / (1024 * 1024),
      repos,
    });
  } finally {
    for (const dir of createdDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }
}

// ─── Report ───────────────────────────────────────────────────────────────────

/** Nearest-rank percentile over a sorted array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

/** Aggregate per-repo results into a global report. */
export function buildReport(input: {
  config: LoadTestConfig;
  repos_created: number;
  total_ms: number;
  memory_delta_mb: number;
  repos: RepoResult[];
}): LoadTestReport {
  const allOps = input.repos.flatMap((r) => r.operations);
  const totalOps = allOps.length;
  const successCount = allOps.filter((o) => o.success).length;
  const success_rate = totalOps === 0 ? 0 : successCount / totalOps;
  const latencies = allOps.map((o) => o.duration_ms).sort((a, b) => a - b);
  const avg_latency_ms = totalOps === 0 ? 0 : latencies.reduce((a, b) => a + b, 0) / totalOps;
  const p95_latency_ms = percentile(latencies, 0.95);
  const throughput_ops_per_sec = input.total_ms === 0 ? 0 : totalOps / (input.total_ms / 1000);
  return {
    config: input.config,
    repos_created: input.repos_created,
    total_ms: input.total_ms,
    throughput_ops_per_sec,
    avg_latency_ms,
    p95_latency_ms,
    success_rate,
    memory_delta_mb: input.memory_delta_mb,
    repos: input.repos,
    pass: success_rate >= SUCCESS_THRESHOLD,
  };
}

/** Exit code decision: 0 when the run passes the success threshold, else 1. */
export function decideExitCode(report: LoadTestReport): number {
  return report.pass ? 0 : 1;
}

/** Human-readable rendering of the report. */
export function renderHuman(report: LoadTestReport): string {
  const lines = [
    '===============================================',
    ' [LOAD-TEST] Multi-Repo Scenario',
    '===============================================',
    ` Repos created: ${report.repos_created}`,
    ` Operations: ${report.config.ops.join(', ')}`,
    ` Concurrency: ${report.config.concurrency}`,
    ` Total time: ${report.total_ms.toFixed(0)} ms`,
    ` Throughput: ${report.throughput_ops_per_sec.toFixed(2)} ops/sec`,
    ` Avg latency: ${report.avg_latency_ms.toFixed(1)} ms`,
    ` P95 latency: ${report.p95_latency_ms.toFixed(1)} ms`,
    ` Success rate: ${(report.success_rate * 100).toFixed(1)}%`,
    ` Memory delta: ${report.memory_delta_mb.toFixed(1)} MB`,
    ` Verdict: ${report.pass ? 'PASS' : 'FAIL'}`,
    '-----------------------------------------------',
  ];
  for (const repo of report.repos) {
    lines.push(
      ` Repo ${repo.repoDir}: ${repo.ops_ok}/${repo.ops_total} ops OK (${repo.total_ms.toFixed(0)} ms)`,
    );
  }
  lines.push('===============================================');
  return lines.join('\n');
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

export interface CliOptions {
  config: LoadTestConfig;
  json: boolean;
  reportPath: string | null;
}

/** Parse --ops: a number selects the first N default ops; a list is used as-is. */
function parseOps(raw: string): string[] {
  if (raw.includes(',')) {
    const list = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return list.length > 0 ? list : DEFAULT_OPS;
  }
  if (OPERATION_MAP[raw]) return [raw];
  const n = parseInt(raw, 10);
  if (!Number.isNaN(n) && n > 0) return DEFAULT_OPS.slice(0, n);
  return DEFAULT_OPS;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    config: { repos: 5, ops: [...DEFAULT_OPS], concurrency: 2, skipGit: false },
    json: false,
    reportPath: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--repos' && argv[i + 1]) {
      options.config.repos = Math.max(1, parseInt(argv[++i], 10) || 1);
    } else if (arg === '--ops' && argv[i + 1]) {
      options.config.ops = parseOps(argv[++i]);
    } else if (arg === '--concurrency' && argv[i + 1]) {
      options.config.concurrency = Math.max(1, parseInt(argv[++i], 10) || 1);
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--report' && argv[i + 1]) {
      options.reportPath = argv[++i];
    } else if (arg === '--skip-git') {
      options.config.skipGit = true;
    }
  }
  return options;
}

async function main(): Promise<void> {
  const { config, json, reportPath } = parseArgs(process.argv);
  const report = await runLoadTest(config);
  if (reportPath) {
    writeFileSync(resolve(reportPath), JSON.stringify(report, null, 2), 'utf-8');
  }
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderHuman(report));
  }
  process.exitCode = decideExitCode(report);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error('[LOAD-TEST] FATAL:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
