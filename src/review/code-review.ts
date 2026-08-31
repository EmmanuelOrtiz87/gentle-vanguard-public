#!/usr/bin/env node

import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, resolve, dirname, basename } from 'path';
import { runSync } from '../core/run-command.js';
import { pathToFileURL } from 'url';

interface CodeIssue {
  Id: number;
  File: string;
  Line: number;
  Title: string;
  Severity: string;
  Category: string;
  Description: string;
  Impact: string;
  Recommendation: string;
  Fix: string;
  Status: string;
}

interface QualityPattern {
  Name: string;
  Pattern: string;
  Severity: string;
  Category?: string;
  Description: string;
  Impact?: string;
  Recommendation: string;
  Fix?: string;
}

const issues: CodeIssue[] = [];
let criticalCount = 0;
let highCount = 0;
let mediumCount = 0;
let lowCount = 0;
let skillDir: string;
const reviewStart = new Date();

function writeReviewHeader(text: string, color = '\x1b[36m'): void {
  console.log(`\n ${color}[REVIEW] ${text}\x1b[0m`);
}

function writeReviewProgress(percent: number, message = ''): void {
  const filled = Math.floor(percent / 5);
  const empty = 20 - filled;
  const bar = '='.repeat(filled) + '-'.repeat(empty);
  process.stdout.write(`\r\x1b[36m[${bar}] ${percent}% ${message}\x1b[0m`);
  if (percent === 100) console.log('');
}

function addIssue(opts: {
  File: string;
  Line?: number;
  Title: string;
  Severity?: string;
  Category?: string;
  Description?: string;
  Impact?: string;
  Recommendation?: string;
  Fix?: string;
}): void {
  const severity = opts.Severity || 'MEDIUM';
  const color =
    severity === 'CRITICAL'
      ? '\x1b[31m'
      : severity === 'HIGH'
        ? '\x1b[35m'
        : severity === 'MEDIUM'
          ? '\x1b[33m'
          : '\x1b[90m';

  const issue: CodeIssue = {
    Id: issues.length + 1,
    File: opts.File,
    Line: opts.Line || 0,
    Title: opts.Title,
    Severity: severity,
    Category: opts.Category || '',
    Description: opts.Description || '',
    Impact: opts.Impact || '',
    Recommendation: opts.Recommendation || '',
    Fix: opts.Fix || '',
    Status: 'open',
  };

  issues.push(issue);

  switch (severity) {
    case 'CRITICAL':
      criticalCount++;
      break;
    case 'HIGH':
      highCount++;
      break;
    case 'MEDIUM':
      mediumCount++;
      break;
    case 'LOW':
      lowCount++;
      break;
  }

  const location = issue.Line > 0 ? `${issue.File}:${issue.Line}` : issue.File;
  console.log(`  ${color}[${severity}] [${issue.Category}] ${location} - ${issue.Title}\x1b[0m`);
}

function findFiles(root: string, extensions: string[], excludePatterns: RegExp[]): string[] {
  const results: string[] = [];
  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (excludePatterns.some((r) => r.test(full))) continue;
        walk(full);
      } else if (extensions.some((ext) => e.endsWith(ext))) {
        results.push(full);
      }
    }
  }
  walk(root);
  return results;
}

function readFileContent(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function invokeSecurityReview(path: string): void {
  writeReviewHeader('Security Review (security-expert-skill)');

  // Use the native TS security scanner (migrated from security-scan.ps1).
  // The PS1 no longer exists; the TS replacement is the source of truth.
  const securityScript = join(skillDir, 'security-scan.ts');
  if (existsSync(securityScript)) {
    runSync('npx', ['tsx', securityScript, '--path', path], { stdio: 'pipe' });
  }

  writeReviewHeader('Scanning for code quality issues...');

  const qualityPatterns: QualityPattern[] = [
    {
      Name: 'Console.log in production',
      Pattern: 'console\\.(log|debug|info)\\(',
      Severity: 'LOW',
      Category: 'Quality',
      Description: 'Console logging found in code',
      Impact: 'May expose sensitive data in production logs',
      Recommendation: 'Use structured logging library',
      Fix: "import logger from './logger';\nlogger.info('message', { data });",
    },
    {
      Name: 'TODO without tracking',
      Pattern: '(?i)(TODO|FIXME|HACK):',
      Severity: 'LOW',
      Category: 'Quality',
      Description: 'TODO comment found',
      Impact: 'May indicate incomplete implementation',
      Recommendation: 'Create issue/ticket for tracking',
    },
    {
      Name: 'Empty catch block',
      Pattern: 'catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}',
      Severity: 'MEDIUM',
      Category: 'Quality',
      Description: 'Empty catch block suppresses errors',
      Impact: 'Errors may go unnoticed',
      Recommendation: 'Log or handle the error appropriately',
      Fix: "catch (err) {\n  logger.error('Error occurred', { error: err });\n}",
    },
    {
      Name: 'Hardcoded array size',
      Pattern: '\\[[0-9]+\\]',
      Severity: 'LOW',
      Category: 'Quality',
      Description: 'Magic number used for array access',
      Recommendation: 'Use named constant',
    },
    {
      Name: 'Synchronous file in async',
      Pattern: 'async\\s+function.*\\{[^}]*readFileSync',
      Severity: 'HIGH',
      Category: 'Quality',
      Description: 'Synchronous file operation in async function',
      Impact: 'Blocks event loop',
      Recommendation: 'Use async file operations',
    },
    {
      Name: 'Nested callbacks',
      Pattern: '\\.then\\([^)]*\\{[^}]*\\.\\(',
      Severity: 'MEDIUM',
      Category: 'Quality',
      Description: 'Deeply nested promises detected',
      Recommendation: 'Use async/await for better readability',
    },
    {
      Name: 'Long function',
      Pattern: 'function\\s+\\w+[^{]*\\{[^}]{500,}',
      Severity: 'MEDIUM',
      Category: 'Quality',
      Description: 'Function exceeds recommended length',
      Recommendation: 'Break into smaller functions',
    },
  ];

  const codeExtensions = ['.ps1', '.js', '.ts', '.tsx', '.jsx', '.py', '.go', '.cs', '.java'];
  const excludePatterns = [/node_modules/, /\.git/, /dist/, /build/, /coverage/, /vendor/];

  const files = findFiles(path, codeExtensions, excludePatterns);
  for (const file of files) {
    const content = readFileContent(file);
    if (!content) continue;

    for (const pattern of qualityPatterns) {
      const regex = new RegExp(pattern.Pattern, 'g');
      if (regex.test(content)) {
        addIssue({
          File: file,
          Line: 0,
          Title: pattern.Name,
          Severity: pattern.Severity,
          Category: pattern.Category || 'Quality',
          Description: pattern.Description,
          Impact: pattern.Impact,
          Recommendation: pattern.Recommendation,
          Fix: pattern.Fix,
        });
      }
    }
  }
}

function invokeQualityReview(path: string): void {
  writeReviewHeader('Quality Review');

  const complexityPatterns: QualityPattern[] = [
    {
      Name: 'Deeply nested code',
      Pattern: '(if|for|while)\\s*\\([^)]*\\)\\s*\\{[^}]{50,}\\1\\s*\\(',
      Severity: 'MEDIUM',
      Category: 'Quality',
      Description: 'Deeply nested code structure detected',
      Recommendation: 'Refactor to improve readability',
    },
    {
      Name: 'Long line detected',
      Pattern: '^.{150,}$',
      Severity: 'LOW',
      Category: 'Quality',
      Description: 'Line exceeds 150 characters',
      Recommendation: 'Split long lines for readability',
    },
  ];

  const codeExtensions = ['.ps1', '.js', '.ts', '.tsx', '.jsx', '.py', '.go', '.cs', '.java'];
  const excludePatterns = [/node_modules/, /\.git/, /dist/, /build/, /coverage/, /vendor/];

  const files = findFiles(path, codeExtensions, excludePatterns);
  for (const file of files) {
    const content = readFileContent(file);
    if (!content) continue;

    for (const pattern of complexityPatterns) {
      const regex = new RegExp(pattern.Pattern, 'gm');
      if (regex.test(content)) {
        addIssue({
          File: file,
          Line: 0,
          Title: pattern.Name,
          Severity: pattern.Severity,
          Category: 'Quality',
          Description: pattern.Description,
          Recommendation: pattern.Recommendation,
        });
      }
    }
  }
}

function invokeArchitectureReview(path: string): void {
  writeReviewHeader('Architecture Review (architecture-governance)');

  const srcDir = join(path, 'src');
  const libDir = join(path, 'lib');
  const internalDir = join(path, 'internal');

  if (!existsSync(srcDir) && !existsSync(libDir) && !existsSync(internalDir)) {
    addIssue({
      File: path,
      Title: 'Missing source directory structure',
      Severity: 'MEDIUM',
      Category: 'Architecture',
      Description: 'No standard source directory found (src/, lib/, internal/)',
      Recommendation: 'Organize code in standard directory structure',
    });
  }

  const entryExtensions = ['.ts', '.tsx', '.js', '.jsx'];
  const excludePatterns = [/node_modules/, /\.git/, /dist/, /build/];
  const entryFiles = findFiles(path, entryExtensions, excludePatterns).filter((f) => {
    const base = basename(f);
    return /^(index|main|app)\..*/.test(base);
  });

  if (entryFiles.length > 10) {
    addIssue({
      File: path,
      Title: `Too many root-level entry files`,
      Severity: 'LOW',
      Category: 'Architecture',
      Description: `Found ${entryFiles.length} entry files in root`,
      Recommendation: 'Consider organizing in src/ directory',
    });
  }

  const largeExtensions = ['.ts', '.tsx', '.js', '.jsx'];
  const bigFiles = findFiles(path, largeExtensions, excludePatterns).filter((f) => {
    try {
      return statSync(f).size > 100 * 1024;
    } catch {
      return false;
    }
  });

  for (const bigFile of bigFiles) {
    const sizeKB = Math.round(statSync(bigFile).size / 1024);
    addIssue({
      File: bigFile,
      Title: `Large file detected (${sizeKB}KB)`,
      Severity: 'MEDIUM',
      Category: 'Architecture',
      Description: 'File exceeds 100KB',
      Recommendation: 'Consider splitting into smaller modules',
    });
  }
}

function invokeTestingReview(path: string): void {
  writeReviewHeader('Testing Review (testing-skill)');

  const testPatterns = [
    '*.spec.ts',
    '*.test.ts',
    '*_test.go',
    '*_test.py',
    '*.spec.js',
    '*.test.js',
  ];

  let hasTests = false;
  for (const pattern of testPatterns) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\./g, '\\.') + '$');
    const allFiles = findAllFiles(path);
    if (allFiles.some((f) => regex.test(basename(f)))) {
      hasTests = true;
      break;
    }
  }

  if (!hasTests) {
    addIssue({
      File: path,
      Title: 'No tests found',
      Severity: 'HIGH',
      Category: 'Testing',
      Description: 'No test files detected in project',
      Impact: 'Code changes may break functionality undetected',
      Recommendation: 'Add unit and integration tests',
    });
  }

  const srcExtensions = ['.ts', '.tsx', '.js', '.jsx'];
  const excludePatterns = [/node_modules/, /\.git/, /dist/, /build/, /tests?/, /__tests?__/];
  const srcFiles = findFiles(path, srcExtensions, excludePatterns).filter(
    (f) => !/\.(spec|test)\.[^.]+$/.test(f),
  );

  const testExtensions = ['.spec.ts', '.test.ts', '.spec.js', '.test.js'];
  const testFiles = findFiles(path, testExtensions, [/node_modules/, /\.git/]);

  if (srcFiles.length > 0 && testFiles.length > 0) {
    const coverage = Math.round((testFiles.length / srcFiles.length) * 100);
    if (coverage < 50) {
      addIssue({
        File: path,
        Title: `Low test coverage (${coverage}%)`,
        Severity: 'HIGH',
        Category: 'Testing',
        Description: 'Test coverage is below 50%',
        Impact: 'High risk of undetected bugs',
        Recommendation: 'Aim for at least 70% test coverage',
      });
    }
  }
}

function findAllFiles(dir: string): string[] {
  const result: string[] = [];
  function walk(d: string): void {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(d, e);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        if (/node_modules|\.git/.test(full)) continue;
        walk(full);
      } else {
        result.push(full);
      }
    }
  }
  walk(dir);
  return result;
}

function invokeDocumentationReview(path: string): void {
  writeReviewHeader('Documentation Review (documentation-governance)');

  const docs: Record<string, boolean> = {
    'README.md': existsSync(join(path, 'README.md')),
    'docs/': existsSync(join(path, 'docs')),
  };

  for (const [key, val] of Object.entries(docs)) {
    if (!val) {
      const sev = key === 'README.md' ? 'HIGH' : 'MEDIUM';
      addIssue({
        File: join(path, key),
        Title: `Missing ${key}`,
        Severity: sev,
        Category: 'Documentation',
        Description: `${key} not found`,
        Recommendation: `Create ${key} with project documentation`,
      });
    }
  }

  const readmeContent = readFileContent(join(path, 'README.md'));
  if (readmeContent) {
    const required = ['Installation', 'Usage', 'License'];
    for (const req of required) {
      const re = new RegExp(req, 'i');
      if (!re.test(readmeContent)) {
        addIssue({
          File: 'README.md',
          Title: `README missing '${req}' section`,
          Severity: 'LOW',
          Category: 'Documentation',
          Recommendation: `Add '${req}' section to README`,
        });
      }
    }
  }
}

function invokeAPIReview(path: string): void {
  writeReviewHeader('API Design Review (api-design-skill)');

  const apiExtensions = ['.ts', '.js'];
  const excludePatterns = [/node_modules/, /\.git/];
  const apiFiles = findFiles(path, apiExtensions, excludePatterns).filter((f) =>
    /(route|controller|handler|api|endpoint)/i.test(basename(f)),
  );

  for (const apiFile of apiFiles) {
    const content = readFileContent(apiFile);
    if (!content) continue;

    const hasRoute = /(app\.(get|post|put|delete|patch)|router\.(get|post|put|delete|patch))/i.test(
      content,
    );
    if (hasRoute) {
      if (!/(error|throw|reject)/i.test(content) && /(async\s+function|await)/i.test(content)) {
        addIssue({
          File: apiFile,
          Title: 'Missing error handling in API endpoint',
          Severity: 'MEDIUM',
          Category: 'API Design',
          Description: 'API endpoint may not handle errors properly',
          Recommendation: 'Add try-catch and error response handling',
        });
      }

      if (
        /(req\.(params|query|body))/i.test(content) &&
        !/(validate|sanitize|parse)/i.test(content)
      ) {
        addIssue({
          File: apiFile,
          Title: 'Missing input validation in API endpoint',
          Severity: 'HIGH',
          Category: 'API Design',
          Description: 'User input not validated before processing',
          Impact: 'Potential injection attacks',
          Recommendation: 'Add input validation using Zod, Joi, or similar',
        });
      }
    }
  }
}

function invokeGitWorkflowReview(path: string): void {
  writeReviewHeader('Git Workflow Review (git-workflow-skill)');

  const gitDir = join(path, '.git');
  if (!existsSync(gitDir)) {
    addIssue({
      File: path,
      Title: 'Not a Git repository',
      Severity: 'HIGH',
      Category: 'Git Workflow',
      Description: '.git directory not found',
      Recommendation: 'Initialize Git repository',
    });
    return;
  }

  const hooksDir = join(path, '.git', 'hooks');
  const requiredHooks = ['pre-commit', 'pre-push'];

  for (const hook of requiredHooks) {
    const hookPath = join(hooksDir, hook);
    if (!existsSync(hookPath)) {
      addIssue({
        File: `.git/hooks/${hook}`,
        Title: `Missing ${hook} hook`,
        Severity: 'MEDIUM',
        Category: 'Git Workflow',
        Recommendation: 'Install Git hooks for code quality',
      });
    }
  }

  const packageJsonPath = join(path, 'package.json');
  if (existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      if (pkg.scripts && pkg.scripts.commit && !/cz|commitizen/i.test(pkg.scripts.commit)) {
        addIssue({
          File: 'package.json',
          Title: 'Consider using conventional commits',
          Severity: 'LOW',
          Category: 'Git Workflow',
          Recommendation: 'Use commitizen or similar for standardized commit messages',
        });
      }
    } catch {
      /* */
    }
  }
}

function getReportHeader(_title: string, scope: string, date: Date): string {
  const dateStr = date.toISOString().slice(0, 16).replace('T', ' ');
  const total = criticalCount + highCount + mediumCount + lowCount;

  const categoryCounts: Record<string, Record<string, number>> = {};
  for (const iss of issues) {
    if (!categoryCounts[iss.Category]) {
      categoryCounts[iss.Category] = { Total: 0, CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    }
    categoryCounts[iss.Category].Total++;
    categoryCounts[iss.Category][iss.Severity]++;
  }

  const categoryRows = Object.entries(categoryCounts)
    .map(
      ([cat, counts]) =>
        `| ${cat} | ${counts.Total} | ${counts.CRITICAL} | ${counts.HIGH} | ${counts.MEDIUM} | ${counts.LOW} |`,
    )
    .join('\n');

  return `# Code Review Report

**Date:** ${dateStr}  
**Scope:** ${scope}  
**Total Issues:** ${total} (${criticalCount} critical, ${highCount} high, ${mediumCount} medium, ${lowCount} low)

## Summary

### Issues by Severity

| Severity | Count | Action Required |
|----------|-------|----------------|
| CRITICAL | ${criticalCount} | Block deployment |
| HIGH | ${highCount} | Fix before merge |
| MEDIUM | ${mediumCount} | Review and fix |
| LOW | ${lowCount} | Consider fixing |

### Issues by Category

| Category | Total | Critical | High | Medium | Low |
|----------|-------|----------|------|--------|-----|
${categoryRows}
`;
}

function getReportBody(): string {
  let body = '';
  const severityOrder = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
  const sectionNames: Record<string, string> = {
    CRITICAL: 'Critical Issues (Action Required)',
    HIGH: 'High Priority Issues',
    MEDIUM: 'Medium Priority Issues',
    LOW: 'Low Priority Issues',
  };

  for (const sev of severityOrder) {
    const sevIssues = issues.filter((i) => i.Severity === sev);
    if (sevIssues.length === 0) continue;

    body += `\n## ${sectionNames[sev]}\n\n`;

    for (const iss of sevIssues) {
      const file = basename(iss.File);
      const line = iss.Line > 0 ? `:${iss.Line}` : '';

      body += `### ${iss.Id}. [${iss.Severity}] ${iss.Title}\n\n`;
      body += `**File:** \`${file}\`${line}\n`;
      body += `**Category:** ${iss.Category}\n\n`;
      if (iss.Description) body += `**Issue:** ${iss.Description}\n\n`;
      if (iss.Impact) body += `**Impact:** ${iss.Impact}\n\n`;
      if (iss.Recommendation) body += `**Recommendation:** ${iss.Recommendation}\n\n`;
      if (iss.Fix) body += `**Suggested Fix:**\n\`\`\`\n${iss.Fix}\n\`\`\`\n\n`;
      body += '---\n\n';
    }
  }

  return body;
}

function getReportFooter(path: string): string {
  const actionItems = issues.map((i) => `- [ ] [${i.Severity}] ${i.Title} - ${i.File}`).join('\n');
  const criticalItems = issues
    .filter((i) => i.Severity === 'CRITICAL')
    .map((i) => `1. ${i.Title}`)
    .join('\n');
  const highItems = issues
    .filter((i) => i.Severity === 'HIGH')
    .slice(0, 5)
    .map((i) => `1. ${i.Title}`)
    .join('\n');
  const mediumItems = issues
    .filter((i) => i.Severity === 'MEDIUM')
    .slice(0, 3)
    .map((i) => `1. ${i.Title}`)
    .join('\n');

  const codeExtensions = ['.ps1', '.js', '.ts', '.py', '.go', '.cs'];
  const excludePatterns = [/node_modules/, /\.git/, /dist/];
  const filesScanned = findFiles(path, codeExtensions, excludePatterns).length;
  const totalIssues = criticalCount + highCount + mediumCount + lowCount;
  const duration = Math.round((new Date().getTime() - reviewStart.getTime()) / 1000);

  return `## Action Items

${actionItems}

## Recommendations

### Immediate (Before Next Release)
${criticalItems}

### Short Term (This Sprint)
${highItems}

### Long Term (Tech Debt)
${mediumItems}

## Statistics

- Review Duration: ${duration} seconds
- Files Scanned: ${filesScanned}
- Issues Found: ${totalIssues}

---
*Review generated by Gentle-Vanguard Code Review Orchestrator*
`;
}

function main(): void {
  const args = process.argv.slice(2);
  let scope = 'all';
  let path = '.';
  let report = false;
  let interactive = false;
  let outputPath = 'docs/code-reviews';
  let target = '';

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--scope':
        scope = args[++i];
        break;
      case '--path':
        path = resolve(args[++i]);
        break;
      case '--report':
        report = true;
        break;
      case '--interactive':
        interactive = true;
        break;
      case '--output':
        outputPath = args[++i];
        break;
      case '--target':
        target = args[++i];
        break;
    }
  }

  if (!path) path = '.';
  skillDir = resolve(dirname(process.argv[1] || '.'));

  writeReviewHeader('Code Review Orchestrator');
  console.log(` Scope: ${scope}`);
  console.log(` Path: ${path}\n`);

  writeReviewProgress(0, 'Starting review...');

  if (scope === 'all' || scope === 'full') {
    invokeSecurityReview(path);
    writeReviewProgress(30, 'Security reviewed');
    invokeQualityReview(path);
    writeReviewProgress(40, 'Quality reviewed');
    invokeArchitectureReview(path);
    writeReviewProgress(55, 'Architecture reviewed');
    invokeTestingReview(path);
    writeReviewProgress(70, 'Testing reviewed');
    invokeDocumentationReview(path);
    writeReviewProgress(80, 'Documentation reviewed');
    invokeAPIReview(path);
    writeReviewProgress(90, 'API reviewed');
    invokeGitWorkflowReview(path);
    writeReviewProgress(100, 'Complete');
  } else if (scope === 'security') invokeSecurityReview(path);
  else if (scope === 'quality') {
    invokeSecurityReview(path);
    invokeQualityReview(path);
  } else if (scope === 'architecture') invokeArchitectureReview(path);
  else if (scope === 'testing') invokeTestingReview(path);
  else if (scope === 'docs') invokeDocumentationReview(path);
  else if (scope === 'api') invokeAPIReview(path);
  else if (scope === 'git') invokeGitWorkflowReview(path);
  else if (scope === 'quick') {
    invokeSecurityReview(path);
    invokeQualityReview(path);
  }

  console.log('');
  writeReviewHeader('Review Complete');
  const total = criticalCount + highCount + mediumCount + lowCount;
  console.log(`  Found: ${total} issues`);
  console.log(`    - ${criticalCount} critical`);
  console.log(`    - ${highCount} high`);
  console.log(`    - ${mediumCount} medium`);
  console.log(`    - ${lowCount} low`);

  if (report || outputPath) {
    writeReviewHeader('Generating Report...');

    const reportDir = join(path, outputPath);
    if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });

    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const reportFile = join(reportDir, `${dateStr}-${scope}-review.md`);

    const headerOutput = getReportHeader('Code Review', scope, reviewStart);
    const bodyOutput = getReportBody();
    const footerOutput = getReportFooter(path);
    const fullReport = headerOutput + bodyOutput + footerOutput;

    writeFileSync(reportFile, fullReport, 'utf-8');
    console.log(`  Report saved to: ${reportFile}`);

    if (target) {
      const csvFile = join(reportDir, `${dateStr}-issues.csv`);
      const csvLines = ['Id,Severity,Category,Title,File,Line,Status'];
      for (const iss of issues) {
        csvLines.push(
          `${iss.Id},${iss.Severity},${iss.Category},"${iss.Title}",${iss.File},${iss.Line},${iss.Status}`,
        );
      }
      writeFileSync(csvFile, csvLines.join('\n'), 'utf-8');
      console.log(`  Issues exported to: ${csvFile}`);
    }
  }

  if (interactive) {
    console.log('\n\x1b[33m Interactive Mode:\x1b[0m');
    console.log('  1) View all issues');
    console.log('  2) View by category');
    console.log('  3) Get fix suggestion');
    console.log('  4) Export to CSV');
    console.log('  5) Exit');
  }

  if (criticalCount > 0) {
    console.log(
      '\n\x1b[31m[ACTION REQUIRED] Critical issues found. Review report and fix before proceeding.\x1b[0m',
    );
    process.exit(1);
  }

  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
