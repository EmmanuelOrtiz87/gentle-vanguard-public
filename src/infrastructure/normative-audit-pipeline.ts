#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

interface CliArgs {
  mode: 'pre-commit' | 'ci' | 'session';
  reportPath: string;
  fix: boolean;
}

interface CheckResult {
  check: string;
  status: 'pass' | 'fail';
  details: string;
  autoFix: boolean;
}

interface Violation {
  rule: string;
  file: string;
  severity: 'warn' | 'info';
  message: string;
  timestamp: string;
}

interface Summary {
  passed: number;
  failed: number;
  fixed: number;
  total: number;
}

interface Report {
  timestamp: string;
  mode: string;
  fix: boolean;
  checks: CheckResult[];
  violations: Violation[];
  summary: Summary;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = { mode: 'pre-commit', reportPath: '', fix: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode' || args[i] === '-Mode') {
      const val = args[++i] || 'pre-commit';
      if (val === 'pre-commit' || val === 'ci' || val === 'session') {
        result.mode = val;
      }
    } else if (args[i] === '--report-path' || args[i] === '-ReportPath') {
      result.reportPath = args[++i] || '';
    } else if (args[i] === '--fix' || args[i] === '-Fix') {
      result.fix = true;
    }
  }
  return result;
}

function findRoot(): string {
  if (process.env.GENTLE_VANGUARD_BASE_DIR) {
    const envRoot = process.env.GENTLE_VANGUARD_BASE_DIR;
    if (fs.existsSync(path.join(envRoot, 'config', 'orchestrator.json'))) {
      return envRoot;
    }
  }
  let d = path.resolve(process.cwd());
  while (d && !fs.existsSync(path.join(d, 'config', 'orchestrator.json'))) {
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
  if (fs.existsSync(path.join(d, 'config', 'orchestrator.json'))) return d;
  const scriptDir = path.dirname(pathToFileURL(process.argv[1]).pathname);
  return path.resolve(scriptDir, '..');
}

function now(): string {
  const d = new Date();
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0') +
    'T' +
    String(d.getHours()).padStart(2, '0') +
    ':' +
    String(d.getMinutes()).padStart(2, '0') +
    ':' +
    String(d.getSeconds()).padStart(2, '0')
  );
}

function isoNow(): string {
  return new Date().toISOString();
}

function walkFiles(dir: string, filter: string, excludeSelf?: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, filter, excludeSelf));
    } else if (entry.name.endsWith(filter)) {
      if (excludeSelf && full === excludeSelf) continue;
      results.push(full);
    }
  }
  return results;
}

function readFileContent(fp: string): string {
  try {
    return fs.readFileSync(fp, 'utf-8');
  } catch {
    return '';
  }
}

function checkCodeStandards(root: string, violations: Violation[]): CheckResult {
  const patterns: Record<string, { msg: string; dirs: string[]; exts: string[] }> = {
    'Write-Host': {
      msg: 'Use Write-Output or Write-Verbose instead of Write-Host in library modules',
      dirs: [path.join(root, 'scripts', 'common'), path.join(root, 'scripts', 'functions')],
      exts: ['.psm1'],
    },
    'Select-String': {
      msg: 'Select-String is prohibited in automation — use -match operator',
      dirs: [
        path.join(root, 'scripts', 'core'),
        path.join(root, '.github', 'workflows'),
        path.join(root, 'scripts', 'hooks'),
      ],
      exts: ['.ps1', '.yml', '.yaml'],
    },
  };
  let count = 0;
  for (const [pattern, cfg] of Object.entries(patterns)) {
    for (const dir of cfg.dirs) {
      if (!fs.existsSync(dir)) continue;
      const files = walkFiles(dir, '', undefined).filter((f) =>
        cfg.exts.some((ext) => f.endsWith(ext)),
      );
      for (const file of files) {
        const content = readFileContent(file);
        if (content && content.includes(pattern)) {
          violations.push({
            rule: 'NORMATIVAS-CODIGO.md §4.3',
            file,
            severity: 'warn',
            message: cfg.msg,
            timestamp: isoNow(),
          });
          count++;
        }
      }
    }
  }
  if (count === 0) {
    return {
      check: 'code-standards-write-host',
      status: 'pass',
      details: 'No Write-Host in libs or Select-String in automation violations found',
      autoFix: false,
    };
  }
  return {
    check: 'code-standards-write-host',
    status: 'fail',
    details: `${count} violation(s) found`,
    autoFix: false,
  };
}

function checkPerformancePatterns(root: string, violations: Violation[]): CheckResult {
  const scriptDirs = [path.join(root, 'scripts')];
  let count = 0;
  for (const dir of scriptDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = walkFiles(dir, '.ps1', process.argv[1]);
    for (const file of files) {
      const lines = readFileContent(file).split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/\| Out-Null/.test(line) && /\b(foreach|while|for)\b/.test(line)) {
          violations.push({
            rule: 'NORMATIVAS-PERFORMANCE.md §3.1',
            file,
            severity: 'warn',
            message: `Out-Null in loop — use [void] instead (line ${i + 1})`,
            timestamp: isoNow(),
          });
          count++;
        }
        if (/Get-ChildItem.*-Include/.test(line) && /\*\.\*/.test(line)) {
          violations.push({
            rule: 'NORMATIVAS-PERFORMANCE.md §3.1',
            file,
            severity: 'warn',
            message: `Get-ChildItem -Include with wildcard — use -Filter for performance (line ${i + 1})`,
            timestamp: isoNow(),
          });
          count++;
        }
      }
    }
  }
  if (count === 0) {
    return {
      check: 'performance-patterns',
      status: 'pass',
      details: 'No performance anti-patterns found',
      autoFix: false,
    };
  }
  return {
    check: 'performance-patterns',
    status: 'fail',
    details: `${count} anti-pattern(s) found`,
    autoFix: false,
  };
}

function checkCrossPlatform(root: string, violations: Violation[]): CheckResult {
  const scriptDirs = [path.join(root, 'scripts')];
  let count = 0;
  for (const dir of scriptDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = walkFiles(dir, '.ps1', undefined);
    for (const file of files) {
      const lines = readFileContent(file).split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (
          /C:\\[A-Za-z]/.test(line) &&
          !/^\s*#/.test(line) &&
          !/C:\\Windows/.test(line) &&
          !/C:\\Program/.test(line)
        ) {
          violations.push({
            rule: 'NORMATIVAS-CROSS-PLATFORM.md',
            file,
            severity: 'warn',
            message: `Hardcoded path at line ${i + 1}: ${line.trim()}`,
            timestamp: isoNow(),
          });
          count++;
        }
      }
    }
  }
  if (count === 0) {
    return {
      check: 'cross-platform-paths',
      status: 'pass',
      details: 'No hardcoded absolute paths found',
      autoFix: false,
    };
  }
  return {
    check: 'cross-platform-paths',
    status: 'fail',
    details: `${count} hardcoded path(s) found`,
    autoFix: false,
  };
}

function checkLearnedNorms(root: string, violations: Violation[]): CheckResult {
  const normsFile = path.join(root, 'rules', 'adaptive', 'LEARNED-NORMS.md');
  if (!fs.existsSync(normsFile)) {
    violations.push({
      rule: 'NORMATIVAS-ENFORCEMENT.md §3',
      file: normsFile,
      severity: 'warn',
      message: 'LEARNED-NORMS.md does not exist',
      timestamp: isoNow(),
    });
    return {
      check: 'learned-norms',
      status: 'fail',
      details: 'LEARNED-NORMS.md not found',
      autoFix: false,
    };
  }
  const content = readFileContent(normsFile);
  if (!content.trim() || content.trim().length < 50) {
    violations.push({
      rule: 'NORMATIVAS-ENFORCEMENT.md §3',
      file: normsFile,
      severity: 'warn',
      message: 'LEARNED-NORMS.md is empty — auto-norm-learner not producing output',
      timestamp: isoNow(),
    });
    return {
      check: 'learned-norms',
      status: 'fail',
      details: 'LEARNED-NORMS.md is empty',
      autoFix: false,
    };
  }
  return {
    check: 'learned-norms',
    status: 'pass',
    details: `LEARNED-NORMS.md has content (${content.length} chars)`,
    autoFix: false,
  };
}

function checkFileStructure(root: string, violations: Violation[]): CheckResult {
  const expectedRootFiles = new Set([
    '.gitignore',
    '.editorconfig',
    '.node-version',
    '.nvmrc',
    'CHANGELOG.md',
    'LICENSE',
    'README.md',
    'README-PUBLIC.md',
    'VERSION',
    'package.json',
    'pnpm-lock.yaml',
    'tsconfig.json',
    'opencode.json',
    'renovate.json',
    'pyproject.toml',
    'docker-compose.test.yml',
    'gentle-vanguard.ps1',
    'gentle-vanguard-presentation.html',
    '.prettierrc',
    '.prettierignore',
    '.eslintrc.json',
    '.markdownlint.json',
    '.secretlintrc.json',
    '.secretlintignore',
    '.trivyignore',
    '.gitleaks.toml',
    '.lefthook.yml',
    '.npmrc',
    '.clineignore',
    '.orchestrator-active',
    'skills-lock.json',
    '.env.example',
    '.env.local.example',
    '.gitattributes',
    'CONTRIBUTING.md',
  ]);
  const skipPrefixes = new Set(['.', 'SECURITY.md']);
  const count = 0;
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (expectedRootFiles.has(entry.name)) continue;
      if (skipPrefixes.has(entry.name) || entry.name.startsWith('.')) continue;
      violations.push({
        rule: 'NORMATIVAS-MULTI-REPO.md §2',
        file: entry.name,
        severity: 'info',
        message: 'Unexpected root-level file',
        timestamp: isoNow(),
      });
    }
  } catch {
    /* ignore */
  }
  if (count === 0 && violations.length === 0) {
    return {
      check: 'file-structure-root',
      status: 'pass',
      details: 'No orphan root files',
      autoFix: false,
    };
  }
  return {
    check: 'file-structure-root',
    status: 'fail',
    details: `Unexpected root file(s) found`,
    autoFix: false,
  };
}

function checkDocumentationDrift(root: string, violations: Violation[]): CheckResult {
  const versionFile = path.join(root, 'VERSION');
  const currentVersion = fs.existsSync(versionFile)
    ? readFileContent(versionFile).trim()
    : 'unknown';
  let count = 0;

  const readmePath = path.join(root, 'README.md');
  if (fs.existsSync(readmePath)) {
    const readme = readFileContent(readmePath);
    if (!readme.includes(currentVersion)) {
      violations.push({
        rule: 'NORMATIVAS-DOCS.md §1',
        file: 'README.md',
        severity: 'warn',
        message: `Version mismatch: VERSION=${currentVersion} not found in README`,
        timestamp: isoNow(),
      });
      count++;
    }
  }

  const publicReadmePath = path.join(root, 'README-PUBLIC.md');
  if (fs.existsSync(publicReadmePath)) {
    const publicReadme = readFileContent(publicReadmePath);
    if (!publicReadme.includes(currentVersion)) {
      violations.push({
        rule: 'NORMATIVAS-DOCS.md §1',
        file: 'README-PUBLIC.md',
        severity: 'warn',
        message: `Version mismatch: VERSION=${currentVersion} not found in README-PUBLIC`,
        timestamp: isoNow(),
      });
      count++;
    }
  }

  if (count === 0) {
    return {
      check: 'documentation-version-drift',
      status: 'pass',
      details: 'Documentation versions match VERSION file',
      autoFix: false,
    };
  }
  return {
    check: 'documentation-version-drift',
    status: 'fail',
    details: `${count} drift(s) found`,
    autoFix: false,
  };
}

function main(): void {
  const { mode, fix: fixFlag, reportPath: reportPathArg } = parseArgs();
  const root = findRoot();

  console.log(`=== Normative Audit Pipeline (${mode} mode) ===`);
  console.log(`Root: ${root}\n`);

  const violations: Violation[] = [];
  const checks: CheckResult[] = [];

  checks.push(checkCodeStandards(root, violations));
  checks.push(checkPerformancePatterns(root, violations));
  checks.push(checkCrossPlatform(root, violations));

  if (mode === 'ci' || mode === 'session') {
    checks.push(checkLearnedNorms(root, violations));
    checks.push(checkFileStructure(root, violations));
    checks.push(checkDocumentationDrift(root, violations));
  }

  const summary: Summary = {
    passed: checks.filter((c) => c.status === 'pass').length,
    failed: checks.filter((c) => c.status === 'fail').length,
    fixed: 0,
    total: checks.length,
  };

  const report: Report = {
    timestamp: now(),
    mode,
    fix: fixFlag,
    checks,
    violations,
    summary,
  };

  console.table(summary);

  const sessionDir = path.join(root, '.session');
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }
  const reportPath = reportPathArg || path.join(sessionDir, 'compliance-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`Report saved: ${reportPath}`);

  if (violations.length > 0) {
    console.log(`\nViolations found: ${violations.length}`);
    for (const v of violations) {
      console.log(`  [${v.severity}] ${v.rule}: ${v.file} - ${v.message}`);
    }
  }

  if (summary.failed > 0) {
    console.log(`\nFAILED: ${summary.failed} check(s) failed. See report for details.`);
    process.exit(1);
  }

  console.log('PASS: All checks passed.');
  process.exit(0);
}

main();
