#!/usr/bin/env node
/**
 * prepush-gate.ts — Composite pre-push gate (Fase 6 N8).
 *
 * Replaces the 12 sequential lefthook pre-push commands with a single parallel
 * gate. Runs all checks concurrently (bounded pool) via Promise.allSettled and
 * caches green results keyed by a tree hash: if nothing changed since the last
 * green run, the gate skips everything (<5s warm). Cold runs target <60s.
 *
 * Usage:
 *   npx tsx src/git/prepush-gate.ts            # run gate (cache-aware)
 *   npx tsx src/git/prepush-gate.ts --force    # bypass cache
 *   npx tsx src/git/prepush-gate.ts --json     # machine-readable output
 *   npx tsx src/git/prepush-gate.ts --list     # list checks and exit
 *
 * Exit codes: 0 = all checks passed (or warm cache hit), 1 = any check failed.
 */
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { run } from '../core/run-command';

const ROOT = resolve(import.meta.dirname, '..', '..');
const CACHE_FILE = join(ROOT, '.runtime', 'prepush-cache.json');
const GATE_VERSION = 3; // bump when check definitions change

// ─── Check definitions (mirrors .lefthook.yml pre-push) ─────────────────────

interface GateCheck {
  name: string;
  command: string;
  args: string[];
  timeoutMs: number;
  description: string;
}

const CHECKS: GateCheck[] = [
  {
    name: 'typecheck',
    command: 'pnpm',
    args: ['typecheck'],
    timeoutMs: 180_000,
    description: 'TypeScript strict typecheck',
  },
  {
    name: 'lint',
    command: 'pnpm',
    args: ['lint'],
    timeoutMs: 120_000,
    description: 'ESLint',
  },
  {
    name: 'audit-check',
    command: 'npx',
    args: ['tsx', 'src/infrastructure/siem-audit-bridge.ts', '--Scope', 'quick'],
    timeoutMs: 60_000,
    description: 'SIEM audit bridge (quick)',
  },
  {
    name: 'orchestrator-auto-fix',
    command: 'npx',
    args: ['tsx', 'src/orchestration/orchestrate-auto-fix.ts', '--Fix'],
    timeoutMs: 60_000,
    description: 'Orchestrator auto-fix',
  },
  {
    name: 'npm-audit',
    command: 'npx',
    args: ['tsx', 'src/infrastructure/npm-audit-pre-push.ts', '--AuditLevel', 'moderate'],
    timeoutMs: 120_000,
    description: 'npm audit (moderate+)',
  },
  {
    name: 'shell-quoting',
    command: 'npm',
    args: ['run', 'audit:shell-quoting'],
    timeoutMs: 60_000,
    description: 'Static shell-quoting audit',
  },
  {
    name: 'perf-baseline',
    command: 'npm',
    args: ['run', 'perf:baseline:check'],
    timeoutMs: 60_000,
    description: 'Perf baseline validation (self-skips if absent)',
  },
  {
    name: 'coverage-gate',
    command: 'npm',
    args: ['run', 'coverage:quick', '--', '--no-write'],
    timeoutMs: 120_000,
    description: 'Code coverage gate (quick, informational)',
  },
  {
    name: 'sbom-generate',
    command: 'npx',
    args: ['tsx', 'src/security/generate-sbom.ts', '--output', 'sbom.json', '--format', 'json'],
    timeoutMs: 120_000,
    description: 'Regenerate SBOM',
  },
  {
    name: 'container-scan',
    command: 'npx',
    args: ['tsx', 'src/security/container-scan.ts', 'scan', '--fail-on', 'high', '--json'],
    timeoutMs: 180_000,
    description: 'Container/artifact vuln scan (self-skips if toolchain absent)',
  },
  {
    name: 'content-validate',
    command: 'npm',
    args: ['run', 'content:validate'],
    timeoutMs: 60_000,
    description: 'Content operations validation',
  },
  {
    name: 'ci-static-gates',
    command: 'npm',
    args: ['run', 'ci:static-gates'],
    timeoutMs: 120_000,
    description: 'CI static gates locally',
  },
];

// ─── Tree hash ───────────────────────────────────────────────────────────────

function runGit(args: string[]): string {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf-8', windowsHide: true });
  return (result.stdout ?? '').toString().trim();
}

function fileHash(path: string): string {
  try {
    return createHash('sha256').update(readFileSync(path, 'utf-8')).digest('hex');
  } catch {
    return 'missing';
  }
}

/**
 * Tree hash = sha256(HEAD + working-tree status + dependency manifests).
 * Captures committed state, staged/unstaged/untracked changes, and dependency
 * changes (package.json / lockfile) that `git status` alone would miss.
 */
function computeTreeHash(): string {
  const head = runGit(['rev-parse', 'HEAD']);
  const status = runGit(['status', '--porcelain']);
  const pkg = fileHash(join(ROOT, 'package.json'));
  const lock = fileHash(join(ROOT, 'pnpm-lock.yaml'));
  return createHash('sha256')
    .update(`${head}\n${status}\n${pkg}\n${lock}`)
    .digest('hex')
    .slice(0, 16);
}

// ─── Cache ───────────────────────────────────────────────────────────────────

interface GateCache {
  version: number;
  entries: Record<string, { timestamp: string; checks: Record<string, string> }>;
}

function loadCache(): GateCache {
  try {
    if (existsSync(CACHE_FILE)) {
      const parsed = JSON.parse(readFileSync(CACHE_FILE, 'utf-8')) as GateCache;
      if (parsed.version === GATE_VERSION) return parsed;
    }
  } catch {
    /* corrupt cache → reset */
  }
  return { version: GATE_VERSION, entries: {} };
}

function saveCache(cache: GateCache): void {
  try {
    mkdirSync(join(ROOT, '.runtime'), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch {
    /* cache is best-effort */
  }
}

// ─── Check runner ────────────────────────────────────────────────────────────

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'error';
  durationMs: number;
  tail: string;
}

function runOne(check: GateCheck): Promise<CheckResult> {
  return new Promise((resolvePromise) => {
    const start = Date.now();
    const child = run(check.command, check.args, { cwd: ROOT, timeout: check.timeoutMs });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    const finish = (status: CheckResult['status']) => {
      const tail = (stdout + stderr).split('\n').filter(Boolean).slice(-6).join('\n');
      resolvePromise({ name: check.name, status, durationMs: Date.now() - start, tail });
    };
    child.on('error', (err) => {
      stderr += `\n[spawn error] ${err.message}`;
      finish('error');
    });
    child.on('close', (code) => {
      finish(code === 0 ? 'pass' : 'fail');
    });
  });
}

/** Bounded concurrency pool — parallel but avoids CPU thrashing. */
async function runChecks(checks: GateCheck[], concurrency = 4): Promise<CheckResult[]> {
  const results: CheckResult[] = new Array(checks.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, checks.length) }, async () => {
    while (index < checks.length) {
      const i = index++;
      results[i] = await runOne(checks[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ─── Main ────────────────────────────────────────────────────────────────────

function printSummary(results: CheckResult[], totalMs: number): void {
  const passed = results.filter((r) => r.status === 'pass').length;
  console.log(
    `\n=== Pre-push gate: ${passed}/${results.length} passed in ${(totalMs / 1000).toFixed(1)}s ===`,
  );
  for (const r of results) {
    const icon = r.status === 'pass' ? '✅' : r.status === 'fail' ? '❌' : '⚠️';
    console.log(`${icon} ${r.name} (${(r.durationMs / 1000).toFixed(1)}s)`);
    if (r.status !== 'pass' && r.tail) {
      console.log(`   └─ ${r.tail.split('\n').join('\n      ')}`);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const json = args.includes('--json');
  const list = args.includes('--list');

  if (list) {
    for (const c of CHECKS) console.log(`${c.name}\t${c.description}`);
    return;
  }

  const start = Date.now();
  const treeHash = computeTreeHash();

  if (!force) {
    const cache = loadCache();
    const hit = cache.entries[treeHash];
    if (hit) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(2);
      if (json) {
        console.log(
          JSON.stringify({ warmCache: true, treeHash, elapsedSec: elapsed, checks: hit.checks }),
        );
      } else {
        console.log(
          `[prepush-gate] Warm cache hit (${elapsed}s) — tree unchanged since green run at ${hit.timestamp}. Skipping ${CHECKS.length} checks.`,
        );
      }
      process.exit(0);
    }
  }

  const results = await runChecks(CHECKS);
  const totalMs = Date.now() - start;
  const allPass = results.every((r) => r.status === 'pass');

  if (allPass) {
    const cache = loadCache();
    cache.entries[treeHash] = {
      timestamp: new Date().toISOString(),
      checks: Object.fromEntries(results.map((r) => [r.name, 'pass'])),
    };
    saveCache(cache);
  }

  if (json) {
    console.log(JSON.stringify({ warmCache: false, treeHash, totalMs, allPass, results }));
  } else {
    printSummary(results, totalMs);
  }

  process.exit(allPass ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[prepush-gate] Fatal:', err);
    process.exit(1);
  });
}
