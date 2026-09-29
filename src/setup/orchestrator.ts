#!/usr/bin/env node
/**
 * setup/orchestrator.ts — One-command setup for Gentle-Vanguard.
 *
 * `npm run setup` runs the full local installation pipeline:
 *   prereqs → deps → doctor → nexus → hooks → graphify → skills-index
 *
 * Design rules:
 * - Idempotent: safe to re-run; steps that are already done are SKIPPED.
 * - Hidden windows: all child processes go through run-command.ts (windowsHide).
 * - Plan is pure: `planSteps()` is unit-testable without executing anything.
 * - Never downloads OS runtimes or secrets (same policy as installer-bootstrap).
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runSync } from '../core/run-command.js';

const root = resolve(process.cwd());

// ─── Types ────────────────────────────────────────────────────────────

export type StepStatus = 'OK' | 'SKIP' | 'FAIL';

export interface StepPlan {
  id: string;
  label: string;
  required: boolean;
  /** Returns null to SKIP, or an argv to execute. */
  argv: string[] | null;
}

export interface StepResult {
  id: string;
  label: string;
  status: StepStatus;
  detail: string;
}

export interface MachineState {
  hasPackageJson: boolean;
  hasGit: boolean;
  hasNodeModules: boolean;
  hasGraph: boolean;
  nodeVersion: string | null;
  pnpmVersion: string | null;
  gitVersion: string | null;
}

// ─── Pure planning (unit-testable) ────────────────────────────────────

export function planSteps(state: MachineState, opts: { skipDeps?: boolean } = {}): StepPlan[] {
  const steps: StepPlan[] = [];

  steps.push({
    id: 'prereqs',
    label: 'Prerequisites (node>=20, pnpm, git)',
    required: true,
    argv:
      state.nodeVersion && state.pnpmVersion && state.gitVersion
        ? null
        : ['node', '--version'], // probe that will fail with a clear message
  });

  steps.push({
    id: 'deps',
    label: 'Install locked dependencies (pnpm)',
    required: true,
    argv:
      state.hasNodeModules || opts.skipDeps || !state.hasPackageJson
        ? null
        : ['pnpm', 'install', '--frozen-lockfile'],
  });

  steps.push({
    id: 'doctor',
    label: 'Post-install verification (install:doctor --strict)',
    required: true,
    argv: state.hasPackageJson ? ['npx', 'tsx', 'src/infrastructure/installer-doctor.ts', '--strict'] : null,
  });

  steps.push({
    id: 'nexus',
    label: 'Initialize Nexus database',
    required: true,
    argv: state.hasPackageJson ? ['npx', 'tsx', 'src/database/db-init.ts', '--quiet'] : null,
  });

  steps.push({
    id: 'hooks',
    label: 'Install git hooks (lefthook)',
    required: false,
    argv: state.hasGit && state.hasPackageJson ? ['npx', 'lefthook', 'install'] : null,
  });

  steps.push({
    id: 'graphify',
    label: 'Build code graph (graphify)',
    required: false,
    argv:
      state.hasPackageJson && !state.hasGraph
        ? ['npx', 'tsx', 'src/cli/graphify.ts', 'build']
        : null,
  });

  steps.push({
    id: 'skills-index',
    label: 'Generate skills index',
    required: false,
    argv: state.hasPackageJson
      ? ['npx', 'tsx', 'src/knowledge/skills-index-generator.ts']
      : null,
  });

  steps.push({
    id: 'local-layer',
    label: 'Validate user-local governance layer',
    required: false,
    argv: state.hasPackageJson ? ['npx', 'tsx', 'src/setup/local-layer.ts'] : null,
  });

  return steps;
}

// ─── Machine detection ────────────────────────────────────────────────

function commandVersion(command: string): string | null {
  const finder = process.platform === 'win32' ? 'where.exe' : 'which';
  if (spawnSync(finder, [command], { stdio: 'ignore', windowsHide: true }).status !== 0) return null;
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', windowsHide: true });
  return result.status === 0
    ? `${result.stdout || result.stderr}`.trim().split(/\r?\n/)[0]
    : 'available';
}

export function detectState(): MachineState {
  return {
    hasPackageJson: existsSync(join(root, 'package.json')),
    hasGit: existsSync(join(root, '.git')),
    hasNodeModules: existsSync(join(root, 'node_modules')),
    hasGraph: existsSync(join(root, 'graphify-out', 'graph.json')),
    nodeVersion: commandVersion('node'),
    pnpmVersion: commandVersion('pnpm'),
    gitVersion: commandVersion('git'),
  };
}

// ─── Execution ────────────────────────────────────────────────────────

function runStep(plan: StepPlan): StepResult {
  if (!plan.argv) {
    return { id: plan.id, label: plan.label, status: 'SKIP', detail: 'already satisfied' };
  }
  const result = runSync(plan.argv[0], plan.argv.slice(1), {
    cwd: root,
    stdio: 'pipe',
    timeout: 10 * 60 * 1000,
  });
  if (result.status === 0) {
    return { id: plan.id, label: plan.label, status: 'OK', detail: 'done' };
  }
  const err = (result.stderr || result.stdout || '').trim().split(/\r?\n/).slice(-3).join(' | ');
  return { id: plan.id, label: plan.label, status: 'FAIL', detail: err || `exit ${result.status}` };
}

function prereqsFailReason(state: MachineState): string | null {
  const missing: string[] = [];
  if (!state.nodeVersion) missing.push('node (>=20): https://nodejs.org');
  else if (!/^v(\d+)/.exec(state.nodeVersion) || Number(/^v(\d+)/.exec(state.nodeVersion)![1]) < 20)
    missing.push(`node >=20 required, found ${state.nodeVersion}`);
  if (!state.pnpmVersion) missing.push('pnpm: corepack enable | npm i -g pnpm');
  if (!state.gitVersion) missing.push('git: https://git-scm.com');
  return missing.length ? missing.join(' · ') : null;
}

function main(): number {
  const skipDeps = process.argv.includes('--skip-deps');
  const json = process.argv.includes('--json');

  const state = detectState();
  if (!state.hasPackageJson) {
    const msg = 'Run npm run setup from the Gentle-Vanguard repository root.';
    if (json) console.log(JSON.stringify({ ok: false, error: msg }));
    else console.error(`[X] ${msg}`);
    return 2;
  }

  const plans = planSteps(state, { skipDeps });
  const results: StepResult[] = [];
  let failed = false;

  for (const plan of plans) {
    if (plan.id === 'prereqs') {
      const reason = prereqsFailReason(state);
      if (reason) {
        results.push({ id: plan.id, label: plan.label, status: 'FAIL', detail: reason });
        failed = true;
        break;
      }
      results.push({ id: plan.id, label: plan.label, status: 'OK', detail: `${state.nodeVersion} · pnpm ${state.pnpmVersion} · git ${state.gitVersion}` });
      continue;
    }
    const result = runStep(plan);
    results.push(result);
    if (result.status === 'FAIL' && plan.required) {
      failed = true;
      break;
    }
  }

  if (json) {
    console.log(JSON.stringify({ ok: !failed, results }, null, 2));
  } else {
    console.log('\n=== Gentle-Vanguard setup ===');
    for (const r of results) {
      const mark = r.status === 'OK' ? '[[OK]]' : r.status === 'SKIP' ? '[SKIP]' : '[X]';
      console.log(`${mark} ${r.label}${r.detail ? ` — ${r.detail}` : ''}`);
    }
    if (!failed) {
      console.log('\nSetup complete. Next steps:');
      console.log('  1. npm run session:autostart:detached   # start a working session');
      console.log('  2. npm run watchtower:health            # verify stack health');
      console.log('  3. npm run dashboard:start              # optional: observability UI');
    }
  }
  return failed ? 1 : 0;
}

// Entry-point guard: run main() only when invoked directly as a script
// (unit tests import planSteps/detectState without triggering execution).
const invoked = process.argv[1] ?? '';
if (invoked.endsWith('orchestrator.ts') || invoked.endsWith('orchestrator')) {
  process.exit(main());
}
