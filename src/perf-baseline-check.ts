#!/usr/bin/env node
/**
 * perf-baseline-check.ts — Pre-push performance baseline validation.
 *
 * Reads tests/performance/baseline.json, measures (or accepts) the real
 * duration of pre-push hook commands, and compares each against its
 * warn_seconds / max_seconds thresholds.
 *
 * Exit codes:
 *   0 — all measurements under warn (or baseline missing / --skip)
 *   1 — any max_seconds exceeded, or any warn when alert_policy.warn_on_warn
 *
 * Usage:
 *   npx tsx src/perf-baseline-check.ts
 *   npx tsx src/perf-baseline-check.ts --report
 *   npx tsx src/perf-baseline-check.ts --duration=audit-check=1.5 --duration=npm-audit=3
 *   npx tsx src/perf-baseline-check.ts --baseline=/path/to/baseline.json --skip
 */

import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { runSync } from './core/run-command.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface BaselineEntry {
  description?: string;
  baseline_seconds: number;
  max_seconds: number;
  warn_seconds: number;
  note?: string;
}

export interface AlertPolicy {
  block_on_max?: boolean;
  warn_on_warn?: boolean;
}

export interface BaselineFile {
  version?: string;
  last_measured?: string;
  baselines: Record<string, BaselineEntry>;
  alert_policy?: AlertPolicy;
}

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skipped';

export interface CheckResult {
  name: string;
  measured_seconds: number | null;
  baseline_seconds: number;
  warn_seconds: number;
  max_seconds: number;
  status: CheckStatus;
}

export interface BaselineReport {
  ok: boolean;
  timestamp: string;
  baseline_file: string;
  policy: { block_on_max: boolean; warn_on_warn: boolean };
  results: CheckResult[];
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_BASELINE = join(resolve(process.cwd()), 'tests', 'performance', 'baseline.json');

// Pre-push hook commands that map to baseline entries. Measured in-place when no
// --duration override is provided for the entry.
const HOOK_COMMANDS: Record<string, string[]> = {
  'audit-check': ['npx', 'tsx', 'src/infrastructure/siem-audit-bridge.ts', '--Scope', 'quick'],
  'npm-audit': [
    'npx',
    'tsx',
    'src/infrastructure/npm-audit-pre-push.ts',
    '--AuditLevel',
    'moderate',
  ],
  'orchestrator-auto-fix': ['npx', 'tsx', 'src/orchestrate-auto-fix.ts', '--Fix'],
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

export function loadBaseline(path: string): BaselineFile | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as BaselineFile;
  } catch {
    return null;
  }
}

function measureCommand(command: string, args: string[]): number {
  const start = Date.now();
  runSync(command, args);
  return (Date.now() - start) / 1000;
}

export function evaluate(
  name: string,
  entry: BaselineEntry,
  measured: number | null,
  blockOnMax = true,
): CheckResult {
  const base = {
    name,
    baseline_seconds: entry.baseline_seconds,
    warn_seconds: entry.warn_seconds,
    max_seconds: entry.max_seconds,
  };
  if (measured === null) {
    return { ...base, measured_seconds: null, status: 'skipped' as const };
  }
  let status: CheckStatus = 'ok';
  if (measured > entry.max_seconds) status = blockOnMax ? 'fail' : 'warn';
  else if (measured > entry.warn_seconds) status = 'warn';
  return { ...base, measured_seconds: measured, status };
}

export function parseDurations(args: string[]): Map<string, number> {
  const durations = new Map<string, number>();
  for (const arg of args) {
    if (!arg.startsWith('--duration=')) continue;
    const value = arg.slice('--duration='.length);
    const eq = value.indexOf('=');
    if (eq === -1) continue;
    const name = value.slice(0, eq);
    const seconds = Number(value.slice(eq + 1));
    if (Number.isFinite(seconds)) durations.set(name, seconds);
  }
  return durations;
}

export function buildReport(
  baseline: BaselineFile,
  baselinePath: string,
  durations: Map<string, number>,
  measure: boolean,
): BaselineReport {
  const policy = {
    block_on_max: baseline.alert_policy?.block_on_max ?? false,
    warn_on_warn: baseline.alert_policy?.warn_on_warn ?? false,
  };
  const results: CheckResult[] = [];
  const entries = baseline.baselines ?? {};
  for (const [name, entry] of Object.entries(entries)) {
    let measured = durations.get(name) ?? null;
    if (measured === null && measure) {
      const cmd = HOOK_COMMANDS[name];
      if (cmd) measured = measureCommand(cmd[0], cmd.slice(1));
    }
    results.push(evaluate(name, entry, measured, policy.block_on_max));
  }
  const hasFail = results.some((r) => r.status === 'fail');
  const hasWarn = results.some((r) => r.status === 'warn');
  const ok = !hasFail && !(hasWarn && policy.warn_on_warn);

  return {
    ok,
    timestamp: new Date().toISOString(),
    baseline_file: baselinePath,
    policy,
    results,
  };
}

function renderHuman(report: BaselineReport): void {
  console.log(`[PERF-BASELINE] ${report.baseline_file}`);
  console.log(
    `[PERF-BASELINE] policy: block_on_max=${report.policy.block_on_max} warn_on_warn=${report.policy.warn_on_warn}`,
  );
  for (const r of report.results) {
    const label = r.status.toUpperCase().padEnd(8);
    const measured = r.measured_seconds === null ? 'n/a' : `${r.measured_seconds.toFixed(2)}s`;
    console.log(
      `[PERF-BASELINE] ${label} ${r.name.padEnd(24)} measured=${measured} warn=${r.warn_seconds}s max=${r.max_seconds}s`,
    );
  }
  console.log(`[PERF-BASELINE] ${report.ok ? 'PASS' : 'FAIL'}`);
}

// ─── CLI Entry ─────────────────────────────────────────────────────────────────

export function perfBaselineCheck(args: string[]): number {
  if (args.includes('--skip')) {
    console.log('[PERF-BASELINE] SKIP requested via --skip');
    return 0;
  }

  const baselineArg = args.find((a) => a.startsWith('--baseline='));
  const baselinePath = baselineArg
    ? resolve(process.cwd(), baselineArg.slice('--baseline='.length))
    : DEFAULT_BASELINE;

  const baseline = loadBaseline(baselinePath);
  if (!baseline) {
    console.log(`[PERF-BASELINE] SKIP: baseline file not found at ${baselinePath}`);
    return 0;
  }

  const durations = parseDurations(args);
  const measure = args.includes('--measure') || durations.size === 0;
  const report = buildReport(baseline, baselinePath, durations, measure);

  if (args.includes('--report')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    renderHuman(report);
  }

  return report.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(perfBaselineCheck(process.argv.slice(2)));
}
