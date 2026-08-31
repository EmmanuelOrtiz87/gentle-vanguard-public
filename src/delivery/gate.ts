/**
 * delivery/gate.ts — Unified delivery gate.
 *
 * A single executable gate that consolidates the checks that were previously
 * scattered across hooks, lazy steps, and manual scripts. It produces a single
 * PASS/FAIL/BLOCKED/DEGRADED verdict and can be wired into CI and PR as the
 * one required check (`production-gate`).
 *
 * Checks run in parallel (bounded pool) with per-check timeouts, mirroring the
 * existing `prepush-gate.ts` pattern. For local pre-commit/pre-push, lefthook
 * remains the fast path; this gate is the authoritative CI/PR/release gate.
 *
 * Usage:
 *   npx tsx src/delivery/gate.ts [--stage pre-pr|release|pre-commit|pre-push]
 *                                [--json] [--quiet] [--force] [--only <name>]
 *   npx tsx src/delivery/gate.ts --list
 */

import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { GateCheckResult, DeliveryGateReport, CheckStatus } from './types.js';
import { gitStatus, diffNameOnly } from './git-adapter.js';
import { runSync } from '../core/run-command.js';

const ROOT = resolve(import.meta.dirname, '..', '..');

type GateStage = 'pre-commit' | 'pre-push' | 'pre-pr' | 'release' | 'all';

interface GateDef {
  name: string;
  command: string;
  args: string[];
  timeoutMs: number;
  stage: GateStage;
  blocking: boolean;
  description: string;
}

// ─── Gate definitions ────────────────────────────────────────────────────────
// Invocations mirror .lefthook.yml and package.json scripts. The `pre-pr`
// stage is the authoritative CI `production-gate`.

const GATES: GateDef[] = [
  // ── Pre-commit (fast, local — mirrors lefthook) ───────────────────────────
  {
    name: 'json-lint',
    command: 'npx',
    args: ['tsx', 'src/tools/json-lint.ts'],
    timeoutMs: 60_000,
    stage: 'pre-commit',
    blocking: true,
    description: 'JSON syntax validation',
  },
  {
    name: 'workflow-lint',
    command: 'npx',
    args: ['tsx', 'src/review/workflow-lint.ts', '.github/workflows'],
    timeoutMs: 60_000,
    stage: 'pre-commit',
    blocking: true,
    description: 'GitHub workflow lint',
  },
  {
    name: 'lockfile-lint',
    command: 'npx',
    args: ['tsx', 'src/infrastructure/lockfile-lint-pre-commit.ts'],
    timeoutMs: 60_000,
    stage: 'pre-commit',
    blocking: true,
    description: 'Lockfile consistency check',
  },
  {
    name: 'secretlint',
    command: 'npx',
    args: ['secretlint', '--secretlintrc', '.secretlintrc.json'],
    timeoutMs: 60_000,
    stage: 'pre-commit',
    blocking: true,
    description: 'Secretlint',
  },
  {
    name: 'secret-scanner',
    command: 'npx',
    args: ['tsx', 'src/security/secret-scanner-cli.ts', '--scan', '.', '--redact'],
    timeoutMs: 120_000,
    stage: 'pre-commit',
    blocking: true,
    description: 'Secret scanner (full repo)',
  },

  // ── Pre-push (heavier, local — mirrors prepush-gate) ──────────────────────
  {
    name: 'typecheck',
    command: 'pnpm',
    args: ['typecheck'],
    timeoutMs: 180_000,
    stage: 'pre-push',
    blocking: true,
    description: 'TypeScript strict typecheck',
  },
  {
    name: 'lint',
    command: 'pnpm',
    args: ['lint'],
    timeoutMs: 120_000,
    stage: 'pre-push',
    blocking: true,
    description: 'ESLint',
  },
  {
    name: 'npm-audit',
    command: 'npx',
    args: ['tsx', 'src/infrastructure/npm-audit-pre-push.ts', '--AuditLevel', 'moderate'],
    timeoutMs: 120_000,
    stage: 'pre-push',
    blocking: true,
    description: 'npm audit (moderate+)',
  },
  {
    name: 'shell-quoting',
    command: 'npm',
    args: ['run', 'audit:shell-quoting'],
    timeoutMs: 60_000,
    stage: 'pre-push',
    blocking: true,
    description: 'Static shell-quoting audit',
  },
  {
    name: 'ci-static-gates',
    command: 'npm',
    args: ['run', 'ci:static-gates'],
    timeoutMs: 120_000,
    stage: 'pre-push',
    blocking: true,
    description: 'CI static gates',
  },

  // ── Pre-PR (CI production-gate — authoritative) ───────────────────────────
  {
    name: 'typecheck',
    command: 'pnpm',
    args: ['typecheck'],
    timeoutMs: 180_000,
    stage: 'pre-pr',
    blocking: true,
    description: 'TypeScript strict typecheck',
  },
  {
    name: 'lint',
    command: 'pnpm',
    args: ['lint'],
    timeoutMs: 120_000,
    stage: 'pre-pr',
    blocking: true,
    description: 'ESLint',
  },
  {
    name: 'test-config',
    command: 'node',
    args: ['--test', 'tests/config/*.test.ts'],
    timeoutMs: 120_000,
    stage: 'pre-pr',
    blocking: true,
    description: 'Config tests',
  },
  {
    name: 'test-workflows',
    command: 'node',
    args: ['--test', 'tests/workflows/*.test.ts'],
    timeoutMs: 120_000,
    stage: 'pre-pr',
    blocking: true,
    description: 'Workflow tests',
  },
  {
    name: 'test-unit',
    command: 'npx',
    args: ['tsx', '--test', 'tests/unit/*.test.ts'],
    timeoutMs: 180_000,
    stage: 'pre-pr',
    blocking: true,
    description: 'Unit tests',
  },
  {
    name: 'scan-secrets',
    command: 'npx',
    args: ['tsx', 'src/security/secret-scanner-cli.ts', '--scan', '.'],
    timeoutMs: 120_000,
    stage: 'pre-pr',
    blocking: true,
    description: 'Full secret scan',
  },
  {
    name: 'workflow-lint',
    command: 'npx',
    args: ['tsx', 'src/review/workflow-lint.ts', '.github/workflows'],
    timeoutMs: 60_000,
    stage: 'pre-pr',
    blocking: true,
    description: 'GitHub workflow lint',
  },
  {
    name: 'sbom-generate',
    command: 'npx',
    args: ['tsx', 'src/security/generate-sbom.ts', '--output', 'sbom.json', '--format', 'json'],
    timeoutMs: 120_000,
    stage: 'pre-pr',
    blocking: false,
    description: 'Regenerate SBOM',
  },
  {
    name: 'container-scan',
    command: 'npx',
    args: ['tsx', 'src/security/container-scan.ts', 'scan', '--fail-on', 'high', '--json'],
    timeoutMs: 180_000,
    stage: 'pre-pr',
    blocking: true,
    description: 'Container/artifact vuln scan',
  },

  // ── Release (final, strict) ───────────────────────────────────────────────
  {
    name: 'release-clean-worktree',
    command: 'node',
    args: ['--import', 'tsx', 'src/delivery/gate.ts', '--stage', 'release-clean'],
    timeoutMs: 30_000,
    stage: 'release',
    blocking: true,
    description: 'Verify clean worktree before release',
  },
  {
    name: 'publication-gate-check',
    command: 'npx',
    args: ['tsx', 'src/review/publication-gates.ts', '--check', 'release'],
    timeoutMs: 30_000,
    stage: 'release',
    blocking: true,
    description: 'Publication gate check',
  },
  {
    name: 'rdd-release-gate',
    command: 'npx',
    args: ['tsx', 'src/rdd/rdd-gates.ts', 'validate', '--stage', 'release'],
    timeoutMs: 60_000,
    stage: 'release',
    blocking: true,
    description: 'RDD release gate',
  },
  {
    name: 'provenance-verify',
    command: 'npm',
    args: ['run', 'provenance:verify'],
    timeoutMs: 60_000,
    stage: 'release',
    blocking: true,
    description: 'SLSA provenance verification',
  },
];

// ─── Execution (parallel, bounded pool) ──────────────────────────────────────

function runGate(gate: GateDef): GateCheckResult {
  const start = Date.now();
  const r = runSync(gate.command, gate.args, {
    cwd: ROOT,
    timeout: gate.timeoutMs,
  });
  const durationMs = Date.now() - start;
  const ok = r.status === 0;
  const status: CheckStatus = ok ? 'pass' : 'fail';
  const detail = ok ? '' : (r.stderr ?? r.stdout ?? '').split('\n').slice(-5).join('\n');
  let degraded = false;
  if (!ok && gate.name === 'container-scan') {
    try {
      const scan = JSON.parse(r.stdout) as {
        tool?: string;
        sbom?: string | null;
        vulnerabilities?: unknown[];
      };
      degraded =
        scan.tool === 'none' &&
        scan.sbom === null &&
        Array.isArray(scan.vulnerabilities) &&
        scan.vulnerabilities.length === 0;
    } catch {
      degraded = false;
    }
  }
  return { name: gate.name, status, degraded, durationMs, detail, exitCode: r.status ?? -1 };
}

async function runParallel(gates: GateDef[], concurrency = 4): Promise<GateCheckResult[]> {
  const results: GateCheckResult[] = new Array(gates.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, gates.length) }, async () => {
    while (next < gates.length) {
      const idx = next++;
      results[idx] = await Promise.resolve(runGate(gates[idx]));
    }
  });
  await Promise.all(workers);
  return results;
}

export async function runDeliveryGate(opts: {
  stage: GateStage;
  json?: boolean;
  quiet?: boolean;
  force?: boolean;
  changedPaths?: string[];
  only?: string;
}): Promise<DeliveryGateReport> {
  const startedAt = new Date().toISOString();
  const stage = opts.stage;
  let applicable = GATES.filter((g) => g.stage === stage || g.stage === 'all');
  if (opts.only) {
    applicable = applicable.filter((g) => g.name === opts.only);
  }

  const results = await runParallel(applicable, 4);

  const blockingFails = results.filter(
    (r) =>
      r.status === 'fail' && !r.degraded && applicable.find((g) => g.name === r.name)?.blocking,
  );
  const nonBlockingFails = results.filter(
    (r) =>
      r.status === 'fail' && (r.degraded || !applicable.find((g) => g.name === r.name)?.blocking),
  );

  const passed = blockingFails.length === 0;
  const blocked = blockingFails.length > 0;
  const degraded = !blocked && nonBlockingFails.length > 0;

  const finishedAt = new Date().toISOString();
  const summary = blocked
    ? `BLOCKED: ${blockingFails.length} blocking check(s) failed`
    : degraded
      ? `DEGRADED: ${nonBlockingFails.length} non-blocking check(s) failed`
      : `PASS: all ${results.length} check(s) passed`;

  const report: DeliveryGateReport = {
    runId: `gate-${Date.now().toString(36)}`,
    target: 'develop',
    checks: results,
    passed,
    blocked,
    degraded,
    summary,
    startedAt,
    finishedAt,
  };

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (!opts.quiet) {
    console.log(`\n=== DELIVERY GATE (${stage}) ===`);
    for (const r of results) {
      const icon =
        r.status === 'pass'
          ? '✅'
          : r.status === 'fail'
            ? '❌'
            : r.status === 'skipped'
              ? '⏭️'
              : '⏳';
      console.log(`${icon} ${r.name.padEnd(28)} ${r.status.padEnd(8)} ${r.durationMs}ms`);
      if (r.detail) console.log(`   ${r.detail.split('\n').slice(0, 3).join('\n   ')}`);
    }
    console.log(`\n${summary}`);
  }

  return report;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  let stage: GateStage | 'release-clean' = 'pre-pr';
  let json = false;
  let quiet = false;
  let force = false;
  let only = '';

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--stage':
        stage = (args[++i] ?? 'pre-pr') as GateStage | 'release-clean';
        break;
      case '--json':
        json = true;
        break;
      case '--quiet':
        quiet = true;
        break;
      case '--force':
        force = true;
        break;
      case '--only':
        only = args[++i] ?? '';
        break;
      case '--list':
        console.log('Available gates:');
        for (const g of GATES) console.log(`  ${g.name.padEnd(28)} [${g.stage}] ${g.description}`);
        process.exit(0);
        break;
    }
  }

  // Special internal stage: release-clean (worktree check)
  if (args.includes('--stage') && args[args.indexOf('--stage') + 1] === 'release-clean') {
    const status = gitStatus();
    if (!status.clean) {
      console.error(
        `Worktree not clean. Dirty: ${status.dirty.join(', ')}. Untracked: ${status.untracked.join(', ')}`,
      );
      process.exit(1);
    }
    console.log('Worktree clean');
    process.exit(0);
  }

  // Collect changed paths for classification
  let changedPaths: string[] = [];
  try {
    const base = process.env.GITHUB_BASE_REF
      ? `origin/${process.env.GITHUB_BASE_REF}`
      : 'origin/main';
    changedPaths = diffNameOnly(base, 'HEAD');
  } catch {
    changedPaths = [];
  }

  runDeliveryGate({ stage: stage as GateStage, json, quiet, force, changedPaths, only })
    .then((report) => {
      process.exit(report.blocked ? 1 : 0);
    })
    .catch((err) => {
      console.error(`Gate error: ${(err as Error).message}`);
      process.exit(3);
    });
}
