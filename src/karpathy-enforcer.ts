#!/usr/bin/env node
/**
 * Karpathy Enforcer — enforces Karpathy guidelines (Think, Simplicity, Surgical, Goal-Driven).
 * TS migration of scripts/adaptive/karpathy-enforcer.ps1
 *
 * Triggers: session-start, pre-commit, code-review, task-complete
 */

import * as fs from 'fs';
import * as path from 'path';
import { runSync } from './core/run-command.js';
import { pathToFileURL } from 'url';

type Trigger = 'session-start' | 'pre-commit' | 'code-review' | 'task-complete';

interface FileContext {
  isLegitimatelyLarge: boolean;
  shouldBeSimple: boolean;
  expectedMaxLines: number;
  type: string;
}

interface KarpathyResult {
  exitCode: number;
  violations: string[];
}

const REPO_ROOT = resolveRepoRoot();

function resolveRepoRoot(): string {
  if (process.env.GV_BASE_DIR && fs.existsSync(process.env.GV_BASE_DIR)) {
    return process.env.GV_BASE_DIR;
  }
  let root = path.resolve(process.cwd());
  while (root && !fs.existsSync(path.join(root, 'config', 'orchestrator.json'))) {
    const parent = path.dirname(root);
    if (parent === root) break;
    root = parent;
  }
  return root;
}

function getFailureLearningDb(): string {
  return process.argv.includes('--failure-db')
    ? process.argv[process.argv.indexOf('--failure-db') + 1]
    : path.join(REPO_ROOT, 'scripts', 'adaptive', '.failure-learning.json');
}

function getTrigger(): Trigger {
  const idx = process.argv.indexOf('--trigger');
  const val = idx > 0 ? process.argv[idx + 1] : 'session-start';
  if (['session-start', 'pre-commit', 'code-review', 'task-complete'].includes(val)) {
    return val as Trigger;
  }
  return 'session-start';
}

function isVerbose(): boolean {
  return process.argv.includes('--verbose') || process.argv.includes('-VerboseOutput');
}

function log(msg: string, _color = 'Magenta'): void {
  if (isVerbose()) {
    console.log(`[KARPATHY-ENFORCER] ${msg}`);
  }
}

// ── Context-aware file classification ──

function getFileContext(filePath: string): FileContext {
  const fileName = path.basename(filePath);
  const directory = path.dirname(filePath);

  const legitimateLarge = [
    'orchestrator',
    'manager',
    'dashboard',
    'monitor',
    'generator',
    'bootstrap',
    'gv.ps1',
    'validate-gentle-vanguard',
    'judgment-day',
  ];

  const shouldBeSimple = ['policy', 'config', 'setup', 'init', 'get-', 'set-', 'test-'];

  const context: FileContext = {
    isLegitimatelyLarge: false,
    shouldBeSimple: false,
    expectedMaxLines: 300,
    type: 'unknown',
  };

  for (const pattern of legitimateLarge) {
    if (fileName.includes(pattern) || directory.includes(pattern)) {
      context.isLegitimatelyLarge = true;
      context.expectedMaxLines = 800;
      context.type = 'orchestrator';
      break;
    }
  }

  for (const pattern of shouldBeSimple) {
    if (fileName.startsWith(pattern)) {
      context.shouldBeSimple = true;
      context.expectedMaxLines = 150;
      context.type = 'simple-utility';
      break;
    }
  }

  return context;
}

// ── Detect TRUE overcomplication ──

function testRealOvercomplication(filePath: string, context: FileContext): string[] {
  const violations: string[] = [];
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return violations;
  }

  const lines = content.split('\n').length;
  const fileName = path.basename(filePath);

  if (context.isLegitimatelyLarge) {
    log(`Skipping ${fileName} (legitimately large: ${context.type})`, 'Gray');
    return violations;
  }

  const overcomplicationPatterns = [
    { pattern: /interface.*Factory|abstract.*Factory/, message: 'Factory pattern for simple task' },
    { pattern: /Singleton|Strategy|Observer/, message: 'Design pattern bloat' },
    { pattern: /class.*Manager|class.*Handler/, message: 'Unnecessary abstraction layer' },
    { pattern: /configuration.*json|appsettings/, message: 'Config file for simple script' },
    { pattern: /try.*catch.*finally.*throw/, message: 'Over-engineered error handling' },
  ];

  for (const check of overcomplicationPatterns) {
    if (check.pattern.test(content)) {
      violations.push(`File: ${fileName} - ${check.message}`);
    }
  }

  // Check for massive functions
  const funcMatches = content.match(/function\s+\w+/g);
  if (funcMatches && funcMatches.length > 10 && lines < 500) {
    violations.push(
      `File: ${fileName} - Too many functions (${funcMatches.length}) for ${lines} lines`,
    );
  }

  // Check for deep nesting
  let maxNesting = 0;
  let currentNesting = 0;
  for (const char of content) {
    if (char === '{') {
      currentNesting++;
      maxNesting = Math.max(maxNesting, currentNesting);
    }
    if (char === '}') currentNesting--;
  }
  if (maxNesting > 5) {
    violations.push(`File: ${fileName} - Deep nesting detected (depth: ${maxNesting})`);
  }

  return violations;
}

// ── Detect unstated assumptions ──

function testRealAssumptions(filePath: string): string[] {
  const violations: string[] = [];
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return violations;
  }

  const fileName = path.basename(filePath);

  if (/test|spec|\.generated\./.test(fileName)) return violations;

  const assumptionPatterns = [
    { pattern: /I assume|Assuming/, message: 'Explicit assumption not stated upfront' },
  ];

  for (const check of assumptionPatterns) {
    if (check.pattern.test(content)) {
      violations.push(`File: ${fileName} - ${check.message}`);
    }
  }

  return violations;
}

// ── Detect surgical changes ──

function testSurgicalChanges(_targetPath: string, changedFiles: string[]): string[] {
  const violations: string[] = [];

  if (!changedFiles || changedFiles.length === 0) return violations;

  const unrelatedPatterns = [/package\.json/, /package-lock\.json/, /\.css$/, /\.scss$/];

  let unrelatedCount = 0;
  for (const file of changedFiles) {
    for (const pattern of unrelatedPatterns) {
      if (pattern.test(file)) {
        unrelatedCount++;
        break;
      }
    }
  }

  if (unrelatedCount > 2) {
    violations.push(
      `Too many unrelated files changed: ${unrelatedCount} (possible drive-by edits)`,
    );
  }

  return violations;
}

// ── Detect goal-driven (tests for code changes) ──

function testGoalDriven(changedFiles: string[]): string[] {
  const violations: string[] = [];

  if (!changedFiles || changedFiles.length === 0) return violations;

  const hasCode = changedFiles.some((f) => /\.(ps1|ts|js|go|py)$/.test(f));
  const hasTests = changedFiles.some((f) => /test|spec/.test(f));

  if (hasCode && !hasTests) {
    violations.push('Code changes without corresponding tests (violates Goal-Driven principle)');
  }

  return violations;
}

// ── Get changed files from git ──

function getChangedFiles(targetPath: string): string[] {
  try {
    const output = runSync('git', ['diff', '--name-only', 'HEAD~1...HEAD'], {
      cwd: targetPath,
      timeout: 5000,
    });
    return output.stdout
      .trim()
      .split('\n')
      .filter((f: string) => f.trim().length > 0);
  } catch {
    return [];
  }
}

// ── Main enforcement ──

function invokeKarpathyEnforcement(trigger: Trigger): KarpathyResult {
  log(`Karpathy Guidelines Enforcement (Trigger: ${trigger})`);

  const allViolations: string[] = [];

  switch (trigger) {
    case 'session-start': {
      log('Scanning codebase for REAL Karpathy violations...');
      const files = walkFiles(REPO_ROOT);
      for (const file of files) {
        const context = getFileContext(file);
        allViolations.push(...testRealOvercomplication(file, context));
        allViolations.push(...testRealAssumptions(file));
      }
      break;
    }
    case 'pre-commit': {
      log('Verifying surgical changes and goal-driven execution...');
      const changedFiles = getChangedFiles(REPO_ROOT);
      allViolations.push(...testSurgicalChanges(REPO_ROOT, changedFiles));
      allViolations.push(...testGoalDriven(changedFiles));
      break;
    }
    case 'code-review': {
      log('Full Karpathy review...');
      const files = walkFiles(REPO_ROOT);
      for (const file of files) {
        const context = getFileContext(file);
        allViolations.push(...testRealOvercomplication(file, context));
        allViolations.push(...testRealAssumptions(file));
      }
      const changedFiles = getChangedFiles(REPO_ROOT);
      allViolations.push(...testSurgicalChanges(REPO_ROOT, changedFiles));
      allViolations.push(...testGoalDriven(changedFiles));
      break;
    }
    default:
      break;
  }

  if (allViolations.length === 0) {
    console.log('[KARPATHY] No Karpathy violations found');
    return { exitCode: 0, violations: [] };
  }

  if (trigger === 'session-start') {
    // Save baseline
    const baselineDir = path.join(REPO_ROOT, '.runtime', 'quality');
    if (!fs.existsSync(baselineDir)) {
      fs.mkdirSync(baselineDir, { recursive: true });
    }
    const baselinePath = path.join(baselineDir, 'karpathy-baseline.json');
    fs.writeFileSync(
      baselinePath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          trigger,
          count: allViolations.length,
          items: allViolations,
        },
        null,
        2,
      ),
      'utf-8',
    );
    console.log(`[KARPATHY] Baseline captured: ${allViolations.length} item(s)`);
    console.log(`[KARPATHY] Baseline file: ${baselinePath}`);
    return { exitCode: 0, violations: allViolations };
  }

  console.log(`[KARPATHY-WARNING] Found ${allViolations.length} REAL violation(s):`);
  for (const v of allViolations) {
    console.log(`  - ${v}`);
  }

  // Log to failure learning db
  const failureDb = getFailureLearningDb();
  try {
    if (fs.existsSync(failureDb)) {
      const data = JSON.parse(fs.readFileSync(failureDb, 'utf-8'));
      for (const v of allViolations) {
        data.failures.push({
          timestamp: new Date().toISOString(),
          type: 'karpathy-violation',
          context: v,
          resolution: 'auto-detected',
          session: process.env.SESSION_ID || '',
          autonomous: false,
          success: false,
        });
      }
      data.last_updated = new Date().toISOString();
      fs.writeFileSync(failureDb, JSON.stringify(data, null, 2), 'utf-8');
    }
  } catch {
    // ignore
  }

  return { exitCode: 1, violations: allViolations };
}

function walkFiles(root: string): string[] {
  const results: string[] = [];
  const skipDirs = new Set(['node_modules', '.git', 'build', 'dist']);
  const extensions = new Set(['.ps1', '.ts', '.js', '.go']);

  function walk(dir: string): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!skipDirs.has(entry.name)) walk(fullPath);
        } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
          results.push(fullPath);
        }
      }
    } catch {
      // permission errors
    }
  }

  walk(root);
  return results;
}

// ── Entry ──

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const trigger = getTrigger();
  const result = invokeKarpathyEnforcement(trigger);
  process.exit(result.exitCode);
}

export {
  invokeKarpathyEnforcement,
  getFileContext,
  testRealOvercomplication,
  testRealAssumptions,
  testSurgicalChanges,
  testGoalDriven,
};
