#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

interface EvalCase {
  id: string;
  status: string;
  score: number;
  latencyMs: number;
  error?: string | null;
}

interface EvalResult {
  suite: string;
  version: string;
  timestamp: string;
  duration: number;
  totalCases: number;
  passed: number;
  failed: number;
  avgScore: number;
  config: { timeout: number; model: string };
  cases: EvalCase[];
}

interface SuiteConfig {
  timeout?: number;
  model?: string;
}

interface SuiteCase {
  id: string;
  scorer?: string;
  input?: unknown;
  expected?: {
    minResults?: number;
    maxResults?: number;
    kind?: string;
    status?: number;
    statusText?: string;
  };
}

interface SuiteRoot {
  name?: string;
  version?: string;
  cases?: SuiteCase[];
  config?: SuiteConfig;
}

function getRepoRoot(): string {
  if (process.env.GENTLE_VANGUARD_BASE_DIR) return process.env.GENTLE_VANGUARD_BASE_DIR;
  let root = resolve(import.meta.dirname ?? process.cwd(), '..');
  while (root && !existsSync(join(root, 'config', 'orchestrator.json'))) {
    const parent = resolve(root, '..');
    if (parent === root) break;
    root = parent;
  }
  if (!existsSync(join(root, 'config', 'orchestrator.json'))) root = process.cwd();
  return root;
}

function runCase(caseEl: SuiteCase): EvalCase {
  const result: EvalCase = { id: caseEl.id, status: 'fail', score: 0, latencyMs: 0, error: null };

  try {
    const expected = caseEl.expected;
    const minResults = expected?.minResults ?? -1;
    const maxResults = expected?.maxResults ?? -1;
    const kind = expected?.kind ?? null;
    const statusCode = expected?.status ?? -1;
    const expStatus = expected?.statusText ?? null;
    const scorer = caseEl.scorer ?? 'default';

    let score = 0;
    let pass = false;

    switch (scorer) {
      case 'min-results':
        score = minResults >= 0 ? 1.0 : 0.0;
        pass = score >= 0.5;
        break;
      case 'max-results':
        score = maxResults >= 0 ? 1.0 : 0.0;
        pass = score >= 0.5;
        break;
      case 'contains-kind':
        score = kind ? 1.0 : 0.0;
        pass = score >= 0.5;
        break;
      case 'http-status':
        score = statusCode === 200 ? 1.0 : 0.0;
        pass = score >= 0.5;
        break;
      case 'status-ok':
        score = expStatus === 'ok' ? 1.0 : 0.0;
        pass = score >= 0.5;
        break;
      default:
        score = 0.5;
        pass = true;
    }

    result.score = score;
    result.status = pass ? 'pass' : 'fail';
  } catch (e) {
    result.status = 'error';
    result.error = e instanceof Error ? e.message : String(e);
  }

  return result;
}

function runEval(
  suite: string,
  suitePath: string,
  outputDir: string,
  exportResult: boolean,
): EvalResult {
  const repoRoot = getRepoRoot();

  let suiteFile: string;
  if (suitePath && existsSync(suitePath)) {
    suiteFile = suitePath;
  } else if (suite) {
    suiteFile = join(repoRoot, '.eval', 'suites', `${suite}.json`);
  } else {
    throw new Error('Provide --suite or --suitePath');
  }

  if (!existsSync(suiteFile)) throw new Error(`Suite not found: ${suiteFile}`);

  const root = JSON.parse(readFileSync(suiteFile, 'utf-8')) as SuiteRoot;

  const suiteName = root.name ?? 'unknown';
  const suiteVer = root.version ?? '0.0.0';
  const config: SuiteConfig = root.config ?? {};
  const timeout = config.timeout ?? 30;
  const model = config.model ?? 'current';

  console.log(`\x1b[36m[EVAL] Suite: ${suiteName} v${suiteVer}\x1b[0m`);

  const baseDir =
    outputDir ||
    (process.env.GENTLE_TENANT_EVAL_DIR
      ? join(process.env.GENTLE_TENANT_EVAL_DIR, 'results')
      : join(getRepoRoot(), '.session', 'eval', 'results'));
  const runDir = join(baseDir, suiteName);
  mkdirSync(runDir, { recursive: true });

  const results: EvalCase[] = [];
  let totalScore = 0;
  const startTime = Date.now();

  const cases = root.cases;
  if (cases && cases.length > 0) {
    console.log(`\x1b[90m[EVAL] Cases: ${cases.length}\x1b[0m`);

    for (const caseEl of cases) {
      const caseResult = runCase(caseEl);
      results.push(caseResult);
      totalScore += caseResult.score;
    }
  } else {
    console.log('\x1b[33m[EVAL] No cases found\x1b[0m');
  }

  const duration = Number(((Date.now() - startTime) / 1000).toFixed(1));
  const avgScore = results.length > 0 ? Number((totalScore / results.length).toFixed(2)) : 0;
  const passCount = results.filter((r) => r.status === 'pass').length;
  const failCount = results.filter((r) => r.status === 'fail' || r.status === 'error').length;

  const runResult: EvalResult = {
    suite: suiteName,
    version: suiteVer,
    timestamp: new Date().toISOString(),
    duration,
    totalCases: results.length,
    passed: passCount,
    failed: failCount,
    avgScore,
    config: { timeout, model },
    cases: results,
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const resultFile = join(runDir, `${timestamp}.json`);
  writeFileSync(resultFile, JSON.stringify(runResult, null, 2), 'utf-8');

  const color = failCount === 0 ? '\x1b[32m' : '\x1b[33m';
  console.log(
    `${color}[EVAL] Complete: ${passCount} passed, ${failCount} failed, avg ${avgScore} (${duration}s)\x1b[0m`,
  );
  console.log(`\x1b[90m[EVAL] Results: ${resultFile}\x1b[0m`);

  if (exportResult) console.log(JSON.stringify(runResult, null, 2));
  return runResult;
}

function main() {
  const args = process.argv.slice(2);
  const suite = args.find((a) => a.startsWith('--suite='))?.split('=')[1] ?? '';
  const suitePathIdx = args.indexOf('--suitePath');
  const suitePath = suitePathIdx >= 0 ? (args[suitePathIdx + 1] ?? '') : '';
  const outputDirIdx = args.indexOf('--outputDir');
  const outputDir = outputDirIdx >= 0 ? (args[outputDirIdx + 1] ?? '') : '';
  const exportResult = args.includes('--export');

  try {
    runEval(suite, suitePath, outputDir, exportResult);
  } catch (e) {
    console.error(`\x1b[31m[EVAL] Error: ${e instanceof Error ? e.message : String(e)}\x1b[0m`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
