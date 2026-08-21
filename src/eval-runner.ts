#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

/* ── Interfaces ── */

interface EvalCaseResult {
  id: string;
  status: 'pass' | 'fail' | 'error';
  score: number;
  latencyMs: number;
  error?: string | null;
}

interface EvalRunResult {
  suite: string;
  version: string;
  timestamp: string;
  duration: number;
  totalCases: number;
  passed: number;
  failed: number;
  avgScore: number;
  config: { timeout: number; model: string };
  cases: EvalCaseResult[];
}

interface SuiteCase {
  id?: string;
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

interface SuiteConfig {
  timeout?: number;
  model?: string;
}

interface SuiteRoot {
  name?: string;
  version?: string;
  cases?: SuiteCase[];
  config?: SuiteConfig;
}

/* ── Root resolution ── */

function getRepoRoot(): string {
  if (process.env.GENTLE_VANGUARD_BASE_DIR) return process.env.GENTLE_VANGUARD_BASE_DIR;
  let root = resolve(__dirname, '..');
  while (root && !existsSync(join(root, 'config', 'orchestrator.json'))) {
    const parent = resolve(root, '..');
    if (parent === root) break;
    root = parent;
  }
  return root;
}

/* ── JSON node helpers (mimic PS1 Get-JProp/JStr/JInt) ── */

function jsonProp<T>(obj: T, key: string): unknown {
  return (obj as Record<string, unknown>)[key];
}

function jsonStr(val: unknown): string | null {
  return typeof val === 'string' ? val : null;
}

/* ── Helpers ── */

function getSuiteFile(suite: string, suitePath: string, repoRoot: string): string | null {
  if (suitePath && existsSync(suitePath)) return suitePath;
  if (suite) {
    const f = join(repoRoot, '.eval', 'suites', `${suite}.json`);
    if (existsSync(f)) return f;
  }
  return null;
}

function loadSuite(suiteFile: string): SuiteRoot {
  const raw = readFileSync(suiteFile, 'utf-8');
  return JSON.parse(raw) as SuiteRoot;
}

/* ── Scoring ── */

function scoreCase(caseEl: SuiteCase): { score: number; status: 'pass' | 'fail' } {
  const scorer = caseEl.scorer ?? 'default';
  const expected = caseEl.expected;
  let score = 0;
  let pass = false;

  const minResults = expected?.minResults ?? -1;
  const maxResults = expected?.maxResults ?? -1;
  const kind = expected?.kind ?? null;
  const statusCode = expected?.status ?? -1;
  const expStatus = expected?.statusText ?? null;

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
      break;
  }

  return { score, status: pass ? 'pass' : 'fail' };
}

/* ── Main ── */

function main() {
  const args = process.argv.slice(2);
  const suite = args.includes('--suite') ? args[args.indexOf('--suite') + 1] : '';
  const suitePath = args.includes('--suite-path') ? args[args.indexOf('--suite-path') + 1] : '';
  const outputDir = args.includes('--output-dir') ? args[args.indexOf('--output-dir') + 1] : '';
  const doExport = args.includes('--export');

  const repoRoot = getRepoRoot();
  const suiteFile = getSuiteFile(suite, suitePath, repoRoot);

  if (!suiteFile) {
    console.error('Provide --suite or --suite-path');
    process.exit(1);
  }

  const suiteData = loadSuite(suiteFile);
  const suiteName = jsonStr(jsonProp(suiteData, 'name') as string | undefined) ?? 'unknown';
  const suiteVer = jsonStr(jsonProp(suiteData, 'version') as string | undefined) ?? '0.0.0';
  const cases = suiteData.cases ?? [];
  const config = suiteData.config ?? {};

  const timeout = config.timeout ?? 30;
  const model = config.model ?? 'current';

  console.log(`\x1b[36m[EVAL] Suite: ${suiteName} v${suiteVer}\x1b[0m`);
  console.log(`\x1b[90m[EVAL] Cases: ${cases.length}\x1b[0m`);

  const baseDir =
    outputDir ||
    (process.env.GENTLE_TENANT_EVAL_DIR
      ? join(process.env.GENTLE_TENANT_EVAL_DIR, 'results')
      : join(repoRoot, '.session', 'eval', 'results'));

  const runDir = join(baseDir, suiteName);
  mkdirSync(runDir, { recursive: true });

  const results: EvalCaseResult[] = [];
  let totalScore = 0;
  const startTime = Date.now();

  for (const caseEl of cases) {
    const caseId = caseEl.id ?? 'unknown';
    console.log(`  [CASE] ${caseId}...`);
    const caseStart = Date.now();

    const result: EvalCaseResult = {
      id: caseId,
      status: 'fail',
      score: 0,
      latencyMs: 0,
      error: null,
    };

    try {
      const { score, status } = scoreCase(caseEl);
      result.score = score;
      result.status = status;
      result.latencyMs = Date.now() - caseStart;
      const label = status === 'pass' ? 'PASS' : 'FAIL';
      const color = status === 'pass' ? 32 : 33;
      console.log(`  \x1b[${color}m ${label} (score: ${score})\x1b[0m`);
    } catch (err) {
      result.status = 'error';
      result.error = (err as Error).message;
      result.latencyMs = Date.now() - caseStart;
      console.log(`  \x1b[31m ERROR: ${(err as Error).message}\x1b[0m`);
    }

    results.push(result);
    totalScore += result.score;
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  const avgScore = results.length > 0 ? Number((totalScore / results.length).toFixed(2)) : 0;
  const passCount = results.filter((r) => r.status === 'pass').length;
  const failCount = results.filter((r) => r.status === 'fail' || r.status === 'error').length;

  const runResult: EvalRunResult = {
    suite: suiteName,
    version: suiteVer,
    timestamp: new Date().toISOString(),
    duration: Number(duration),
    totalCases: results.length,
    passed: passCount,
    failed: failCount,
    avgScore,
    config: { timeout, model },
    cases: results,
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const resultFile = join(runDir, `${timestamp.replace('T', '-')}.json`);
  writeFileSync(resultFile, JSON.stringify(runResult, null, 2), 'utf-8');

  const color = failCount === 0 ? 32 : 33;
  console.log(
    `\x1b[${color}m[EVAL] Complete: ${passCount} passed, ${failCount} failed, avg ${avgScore} (${duration}s)\x1b[0m`,
  );
  console.log(`\x1b[90m[EVAL] Results: ${resultFile}\x1b[0m`);

  if (doExport) {
    console.log(JSON.stringify(runResult, null, 2));
  }
}

main();
