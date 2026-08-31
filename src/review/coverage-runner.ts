#!/usr/bin/env node

/**
 * Coverage Runner — TypeScript code coverage with threshold enforcement.
 *
 * Runs the full test suite under c8 (V8 coverage), enforces the thresholds
 * declared in `tests/coverage-config.json`, and produces text/lcov/html
 * reports. Replaces the old `npm run coverage` that only covered 2 JS files.
 *
 * Usage:
 *   npx tsx src/review/coverage-runner.ts                 # full suite + thresholds
 *   npx tsx src/review/coverage-runner.ts --quick         # core suites only
 *   npx tsx src/review/coverage-runner.ts --no-enforce    # report without failing
 *   npx tsx src/review/coverage-runner.ts --json          # JSON summary to stdout
 */

import { spawnSync } from 'child_process';
import { existsSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { loadConfigFile } from '../core/config-loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

interface Thresholds {
  lines: number;
  functions: number;
  branches: number;
  statements: number;
}

interface CoverageTarget {
  name: string;
  threshold: number;
  tests: string[];
  source: string[];
}

interface CoverageConfig {
  minimumCoverage: number;
  thresholds: Thresholds;
  coverageTargets: CoverageTarget[];
  include: string[];
  exclude: string[];
  outputDir: string;
  reportFormats: string[];
}

const DEFAULT_CONFIG: CoverageConfig = {
  minimumCoverage: 30,
  thresholds: { lines: 30, functions: 30, branches: 25, statements: 30 },
  coverageTargets: [],
  include: ['src/**/*.ts'],
  exclude: ['**/*.test.ts', '**/*.d.ts', '**/node_modules/**'],
  outputDir: 'coverage',
  reportFormats: ['text', 'lcov', 'html'],
};

/** Core suites — fast, always run. Mirrors test-runner-optimized.ts CORE_SUITES. */
const CORE_GLOBS = ['tests/config/*.test.ts', 'tests/workflows/*.test.ts'];

/** Extended suites — full coverage. */
const EXTENDED_GLOBS = [
  'tests/unit/*.test.ts',
  'tests/security/*.test.ts',
  'tests/integration/*.test.ts',
  'tests/skills/*.test.ts',
  'tests/e2e/*.test.ts',
];

interface ParseOptions {
  quick: boolean;
  enforce: boolean;
  json: boolean;
  noWrite: boolean;
}

function parseArgs(args?: string[]): ParseOptions {
  const argv = args ?? process.argv.slice(2);
  return {
    quick: argv.includes('--quick'),
    enforce: !argv.includes('--no-enforce'),
    json: argv.includes('--json'),
    noWrite: argv.includes('--no-write'),
  };
}

function loadConfig(): CoverageConfig {
  const result = loadConfigFile<Partial<CoverageConfig>>('coverage-config', {
    dir: resolve(ROOT, 'tests'),
    defaults: DEFAULT_CONFIG,
    validate: false,
  });
  const raw = result.data;
  if (result.warnings.length > 0) console.warn(result.warnings[0]);
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    thresholds: { ...DEFAULT_CONFIG.thresholds, ...(raw.thresholds ?? {}) },
    coverageTargets: raw.coverageTargets ?? [],
    include: raw.include ?? DEFAULT_CONFIG.include,
    exclude: [...(raw.exclude ?? DEFAULT_CONFIG.exclude), '**/*.test.ts', '**/*.d.ts'],
    outputDir: raw.outputDir ?? 'coverage',
    reportFormats: raw.reportFormats ?? ['text', 'lcov', 'html'],
  };
}

interface FileCoverage {
  path: string;
  all: boolean;
  statementMap: Record<string, { start: { line: number }; end: { line: number } }>;
  s: Record<string, number>;
  branchMap: Record<string, { loc?: { line: number }; locations: { line: number }[] }>;
  b: Record<string, number[]>;
  fnMap: Record<string, { loc: { line: number }; name: string }>;
  f: Record<string, number>;
}

function pct(covered: number, found: number): number {
  return found === 0 ? 100 : (covered / found) * 100;
}

/** Normalize raw V8 coverage (c8 coverage-final.json) into per-file %. */
function parseCoverage(
  file: string,
): Record<string, { lines: number; functions: number; branches: number; statements: number }> {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, FileCoverage>;
  const out: Record<
    string,
    { lines: number; functions: number; branches: number; statements: number }
  > = {};
  for (const [absPath, fc] of Object.entries(raw)) {
    const stmtTotal = Object.keys(fc.s).length;
    const stmtCovered = Object.values(fc.s).filter((v) => v > 0).length;
    const fnTotal = Object.keys(fc.f).length;
    const fnCovered = Object.values(fc.f).filter((v) => v > 0).length;
    // Branch coverage: count each location as a branch
    let branchTotal = 0;
    let branchCovered = 0;
    for (const [id, hits] of Object.entries(fc.b)) {
      const locations = fc.branchMap[id]?.locations?.length ?? 1;
      for (let i = 0; i < locations; i++) {
        branchTotal++;
        if ((hits[i] ?? 0) > 0) branchCovered++;
      }
    }
    // Line coverage: unique lines touched by executed statements
    const lineSet = new Set<number>();
    const lineCovered = new Set<number>();
    for (const [sid, hits] of Object.entries(fc.s)) {
      const line = fc.statementMap[sid]?.start?.line;
      if (line === undefined) continue;
      lineSet.add(line);
      if (hits > 0) lineCovered.add(line);
    }
    out[absPath] = {
      lines: pct(lineCovered.size, lineSet.size),
      functions: pct(fnCovered, fnTotal),
      branches: pct(branchCovered, branchTotal),
      statements: pct(stmtCovered, stmtTotal),
    };
  }
  return out;
}

interface SuiteResult {
  name: string;
  passed: boolean;
  stmts: number;
  lines: number;
  funcs: number;
  branches: number;
  path: string;
}

function main(): void {
  const options = parseArgs();
  const config = loadConfig();

  const globs = options.quick ? CORE_GLOBS : [...CORE_GLOBS, ...EXTENDED_GLOBS];

  // Sanitize globs to only existing test dirs to avoid c8/tsx errors
  const existing: string[] = [];
  for (const g of globs) {
    const dir = g.split('*')[0];
    if (existsSync(resolve(ROOT, dir))) existing.push(g);
  }

  // Expand globs to concrete files BEFORE handing them to c8/node --test.
  // Rationale: spawning c8 with shell:true on POSIX lets bash expand unquoted
  // glob patterns (include/exclude/test globs). The expanded file list then
  // corrupts c8's argv parsing — the first expanded file is treated as the
  // command to wrap and the rest as its arguments, producing EACCES on CI
  // (Linux) while working on Windows (cmd.exe does not expand wildcards).
  const testFiles: string[] = [];
  for (const g of existing) {
    const starIdx = g.indexOf('*');
    if (starIdx === -1) {
      testFiles.push(g);
      continue;
    }
    const dir = g.slice(0, starIdx);
    const suffix = g.slice(starIdx + 1); // e.g. '.test.ts' from 'dir/*.test.ts'
    const entries = readdirSync(resolve(ROOT, dir))
      .filter((f) => f.endsWith(suffix))
      .sort();
    for (const entry of entries) testFiles.push(`${dir}${entry}`);
  }

  const outDir = resolve(ROOT, config.outputDir);
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const reporterArgs = config.reportFormats.flatMap((r) => ['--reporter', r]);
  const includeArgs = config.include.flatMap((inc) => ['--include', inc]);
  const excludeArgs = config.exclude.flatMap((exc) => ['--exclude', exc]);

  // Native c8 aggregate threshold enforcement (exits 1 when below).
  // Quick mode is informational (config/workflow tests only — src is barely loaded),
  // so aggregate enforcement is skipped there; per-target still reported.
  const enforceAggregate = options.enforce && !options.quick;
  const checkArgs = enforceAggregate
    ? [
        ...['--check-coverage'],
        ...['--lines', String(config.thresholds.lines)],
        ...['--functions', String(config.thresholds.functions)],
        ...['--branches', String(config.thresholds.branches)],
        ...['--statements', String(config.thresholds.statements)],
      ]
    : [];

  const c8Args = [
    ...reporterArgs,
    ...['--reporter', 'json'],
    ...['--output-dir', outDir],
    ...includeArgs,
    ...excludeArgs,
    ...checkArgs,
    process.execPath,
    '--import',
    'tsx',
    '--test',
    ...testFiles,
  ];

  // Run c8 via its JS entry with NO shell: prevents POSIX glob expansion of
  // include/exclude patterns and Windows cmd quoting issues. Absolute paths
  // for node/tsx remove any PATH or .cmd-shim dependency.
  const c8Entry = resolve(ROOT, 'node_modules', 'c8', 'bin', 'c8.js');

  process.stdout.write(`\n┌────────────────────────────────────────────────┐\n`);
  process.stdout.write(`│  COVERAGE RUNNER — TypeScript coverage          │\n`);
  process.stdout.write(
    `│  ${String(testFiles.length).padStart(2)} test files | ${options.quick ? 'QUICK' : 'FULL'} mode                │\n`,
  );
  process.stdout.write(`└────────────────────────────────────────────────┘\n\n`);

  const startTime = Date.now();
  const result = spawnSync(process.execPath, [c8Entry, ...c8Args], {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: true,
  });
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  const coverageFile = resolve(outDir, 'coverage-final.json');
  const hasCoverage = existsSync(coverageFile);

  const suites: SuiteResult[] = [];
  const testsPassed = result.status === 0;
  let enforceFailed = false;

  if (hasCoverage) {
    const fileCoverage = parseCoverage(coverageFile);

    // Aggregate per top-level dir (src/) and per file for reporting
    const srcPrefix = resolve(ROOT, 'src');
    const agg = {
      lines: [0, 0] as [number, number],
      funcs: [0, 0] as [number, number],
      branches: [0, 0] as [number, number],
      stmts: [0, 0] as [number, number],
    };

    const raw = JSON.parse(readFileSync(coverageFile, 'utf8')) as Record<string, FileCoverage>;
    for (const [absPath, fc] of Object.entries(raw)) {
      if (!absPath.replace(/\\/g, '/').startsWith(srcPrefix.replace(/\\/g, '/'))) continue;
      agg.stmts[0] += Object.values(fc.s).filter((v) => v > 0).length;
      agg.stmts[1] += Object.keys(fc.s).length;
      const lineSet = new Set<number>();
      const lineCovered = new Set<number>();
      for (const [sid, hits] of Object.entries(fc.s)) {
        const line = fc.statementMap[sid]?.start?.line;
        if (line === undefined) continue;
        lineSet.add(line);
        if (hits > 0) lineCovered.add(line);
      }
      agg.lines[0] += lineCovered.size;
      agg.lines[1] += lineSet.size;
      agg.funcs[0] += Object.values(fc.f).filter((v) => v > 0).length;
      agg.funcs[1] += Object.keys(fc.f).length;
      for (const [id, hits] of Object.entries(fc.b)) {
        const locations = fc.branchMap[id]?.locations?.length ?? 1;
        for (let i = 0; i < locations; i++) {
          agg.branches[1]++;
          if ((hits[i] ?? 0) > 0) agg.branches[0]++;
        }
      }
    }

    const totals = {
      stmts: pct(agg.stmts[0], agg.stmts[1]),
      lines: pct(agg.lines[0], agg.lines[1]),
      funcs: pct(agg.funcs[0], agg.funcs[1]),
      branches: pct(agg.branches[0], agg.branches[1]),
    };

    suites.push({
      name: 'src/ (aggregate)',
      passed:
        totals.lines >= config.thresholds.lines &&
        totals.funcs >= config.thresholds.functions &&
        totals.branches >= config.thresholds.branches &&
        totals.stmts >= config.thresholds.statements,
      stmts: totals.stmts,
      lines: totals.lines,
      funcs: totals.funcs,
      branches: totals.branches,
      path: 'src',
    });

    // Per-target enforcement
    for (const target of config.coverageTargets) {
      const srcAbs = resolve(ROOT, target.source[0]);
      const fc = fileCoverage[srcAbs];
      if (!fc) {
        suites.push({
          name: `${target.name} (not loaded)`,
          passed: true,
          stmts: 0,
          lines: 0,
          funcs: 0,
          branches: 0,
          path: target.source[0],
        });
        if (options.enforce) {
          process.stdout.write(
            `⚠ Target "${target.name}": source not loaded by tests (${target.source[0]}) — add a module-level import to measure it\n`,
          );
        }
        continue;
      }
      const ok = fc.statements >= target.threshold;
      suites.push({
        name: target.name,
        passed: ok,
        stmts: fc.statements,
        lines: fc.lines,
        funcs: fc.functions,
        branches: fc.branches,
        path: target.source[0],
      });
      if (!ok && options.enforce) {
        enforceFailed = true;
        process.stdout.write(
          `⚠ Target "${target.name}": ${fc.statements.toFixed(1)}% < ${target.threshold}% required (${target.source[0]})\n`,
        );
      }
    }

    // Manual aggregate check only in full mode (quick mode is informational —
    // config/workflow tests barely load src, so the aggregate is not representative).
    if (options.enforce && !options.quick && !suites[0]?.passed) {
      enforceFailed = true;
      process.stdout.write(
        `⚠ Aggregate coverage below threshold: lines ${totals.lines.toFixed(1)}% (req ${config.thresholds.lines}%), ` +
          `functions ${totals.funcs.toFixed(1)}% (req ${config.thresholds.functions}%), ` +
          `branches ${totals.branches.toFixed(1)}% (req ${config.thresholds.branches}%), ` +
          `statements ${totals.stmts.toFixed(1)}% (req ${config.thresholds.statements}%)\n`,
      );
    }
  } else {
    process.stdout.write(`⚠ No coverage data produced (c8 exited with status ${result.status})\n`);
    if (options.enforce) enforceFailed = true;
  }

  // Summary table
  process.stdout.write(`\n┌────────────────────────────────────────────────────────┐\n`);
  process.stdout.write(`│  COVERAGE SUMMARY (${duration}s)                            │\n`);
  process.stdout.write(`├────────────────────────────────────────────────────────┤\n`);
  process.stdout.write(`│  Target                     Stmts   Lines   Funcs  Branch │\n`);
  process.stdout.write(`├────────────────────────────────────────────────────────┤\n`);
  for (const s of suites) {
    process.stdout.write(
      `│  ${s.name.padEnd(26)} ${s.stmts.toFixed(1).padStart(5)}% ${s.lines.toFixed(1).padStart(6)}% ${s.funcs.toFixed(1).padStart(6)}% ${s.branches.toFixed(1).padStart(6)}%  ${s.passed ? '✓' : '✗'}\n`,
    );
  }
  process.stdout.write(`└────────────────────────────────────────────────────────┘\n`);

  // JSON summary
  const summary = {
    duration,
    testsPassed,
    coverageProduced: hasCoverage,
    thresholds: config.thresholds,
    targets: suites.map((s) => ({
      name: s.name,
      statements: +s.stmts.toFixed(1),
      lines: +s.lines.toFixed(1),
      functions: +s.funcs.toFixed(1),
      branches: +s.branches.toFixed(1),
      passed: s.passed,
    })),
    reportDir: config.outputDir,
  };

  if (options.json) {
    process.stdout.write(`\n${JSON.stringify(summary, null, 2)}\n`);
  } else if (!options.noWrite) {
    const reportPath = resolve(ROOT, 'reports', 'coverage-summary.json');
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(summary, null, 2));
    process.stdout.write(`\nSummary written to ${relative(ROOT, reportPath)}\n`);
  } else {
    process.stdout.write(`\nSummary validated (--no-write, file untouched)\n`);
  }

  const exitCode = options.enforce && (enforceFailed || !testsPassed) ? 1 : 0;
  process.exit(exitCode);
}

// Guard: only run main when invoked directly (not when imported by tests)
const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main();
}

// Exports for unit testing
export { pct, parseCoverage, loadConfig, parseArgs, DEFAULT_CONFIG };
