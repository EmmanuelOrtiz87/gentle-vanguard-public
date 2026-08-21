#!/usr/bin/env node
/**
 * Session Close Validator
 *
 * Validador profundo de integridad al cierre de sesión (Capa 2).
 * Ejecuta chequeos deterministas sobre el estado del stack y reporta
 * hallazgos, warnings y errores que deben resolverse antes del cierre.
 *
 * 3 modos:
 *   quick — Cross-references, temp files, errores/warnings de la sesión
 *   deep  — quick + archivos no usados, completitud de la sesión
 *   full  — deep + deuda técnica completa, dependencias estancadas
 *
 * Uso:
 *   npx tsx src/session-close-validator.ts --mode quick
 *   npx tsx src/session-close-validator.ts --mode deep --dry-run
 *   npx tsx src/session-close-validator.ts --mode full --auto-fix --report
 *   npx tsx src/session-close-validator.ts --verify (alias para --mode quick)
 */

/* The import regex below is safe - it only parses TypeScript import statements, not user input */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, resolve, relative } from 'path';
import { runSync } from './core/run-command.js';
import { pathToFileURL } from 'url';
import {
  loadRegistry,
  findUnregisteredTempFiles,
  cleanUnregisteredTemps,
  listEntries,
  pruneRegistry,
} from './temp-file-registry.js';

import { extractRealImports, type ImportInfo } from './ast-import-parser.js';

const ROOT = resolve(process.cwd());
const SESSION_DIR = join(ROOT, '.session');

// ─── Types ──────────────────────────────────────────────────────────────────

export type ValidationMode = 'quick' | 'deep' | 'full';

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  category: string;
  message: string;
  file?: string;
  line?: number;
  autoFixable: boolean;
}

export interface ValidationReport {
  timestamp: string;
  mode: ValidationMode;
  dryRun: boolean;
  issues: ValidationIssue[];
  summary: {
    total: number;
    errors: number;
    warnings: number;
    info: number;
    autoFixed: number;
  };
  score: number; // 0-100, 100 = perfect
  details: {
    crossReferences: { total: number; broken: number; fixed: number };
    tempFiles: {
      registered: number;
      unregistered: number;
      cleaned: number;
      authorizedPending: number;
    };
    errorsAndWarnings: {
      todoCount: number;
      fixmeCount: number;
      tsIgnoreCount: number;
      hackCount: number;
    };
    unusedFiles: string[];
    completeness: { goal: string | null; accomplished: number; pending: number };
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

import { log as createLogger } from './utils/logger.js';

const LOG = createLogger('VALIDATOR');

function log(msg: string) {
  LOG.info(msg);
}
function ok(msg: string) {
  LOG.info(`✅ ${msg}`);
}
function warn(msg: string) {
  LOG.warn(msg);
}
function fail(msg: string) {
  LOG.error(msg);
}

function getAllFiles(dir: string, ext: string): string[] {
  const result: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          result.push(...getAllFiles(full, ext));
        }
      } else if (entry.name.endsWith(ext)) {
        result.push(full);
      }
    }
  } catch {
    /* skip unreadable */
  }
  return result;
}

function getSessionData(): Record<string, unknown> {
  const fp = join(SESSION_DIR, 'session-current.json');
  if (!existsSync(fp)) return {};
  try {
    return JSON.parse(readFileSync(fp, 'utf-8'));
  } catch {
    return {};
  }
}

function getChangedFiles(): Set<string> {
  try {
    const r = runSync('git', ['diff', '--name-only', 'HEAD'], {
      cwd: ROOT,
      stdio: 'pipe',
      timeout: 15000,
    });
    if (r.status === 0) {
      return new Set(
        r.stdout
          .toString()
          .split('\n')
          .filter((l) => l.trim())
          .map((l) => l.trim()),
      );
    }
  } catch {
    /* fallback */
  }
  return new Set();
}

// ─── Category: Cross-Reference Validation ───────────────────────────────────

interface CrossRefResult {
  total: number;
  broken: number;
  fixed: number;
  issues: ValidationIssue[];
}

function validateCrossReferences(_mode: ValidationMode, _autoFix: boolean): CrossRefResult {
  log('--- Cross-Reference Validation ---');
  const issues: ValidationIssue[] = [];
  let broken = 0;
  const fixed = 0;

  // Get all TS files in src/
  const srcFiles = getAllFiles(join(ROOT, 'src'), '.ts');
  const total = srcFiles.length;

  // Build a set of all available TS module paths (without extension)
  const availableModules = new Set<string>();
  for (const f of srcFiles) {
    const rel = relative(ROOT, f).replace(/\\/g, '/').replace(/\.ts$/, '');
    availableModules.add(rel);
    // Also add without 'src/' prefix for direct imports
    if (rel.startsWith('src/')) {
      availableModules.add(rel.slice(4));
    }
  }

  // Scan each file for import statements using AST (not regex)
  // This avoids false positives from strings containing "import" text
  for (const file of srcFiles) {
    const content = readFileSync(file, 'utf-8');
    const relPath = relative(ROOT, file).replace(/\\/g, '/');

    // Use AST-based extraction (much more accurate than regex)
    // This correctly ignores strings like: target.includes(`import './${sourceName}'`)
    const imports: ImportInfo[] = extractRealImports(content, file);

    for (const imp of imports) {
      const importPath = imp.path;

      // Skip node_modules, built-in modules, and external packages
      if (!importPath.startsWith('.') && !importPath.startsWith('/')) continue;
      if (importPath.length < 2 || importPath === '...') continue;

      // Relative or absolute import — resolve it
      const dir = file.substring(0, Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')));
      let resolved: string;

      if (importPath.startsWith('.')) {
        // Relative: resolve from file's directory
        resolved = join(dir, importPath);
      } else {
        // Absolute (from root)
        resolved = join(ROOT, importPath.slice(1));
      }

      // Normalize
      resolved = resolve(resolved).replace(/\\/g, '/');

      // Determine which extensions to check
      const extensionsToCheck: string[] = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json'];
      const basePath = resolved.replace(/\.(js|mjs)$/, ''); // Strip .js/.mjs for TS convention

      const canExist = [
        resolved,
        ...extensionsToCheck.map((ext) => resolved + ext),
        ...extensionsToCheck.map((ext) => basePath + ext), // Also try without .js
        join(resolved, 'index.ts'),
        join(resolved, 'index.tsx'),
        join(resolved, 'index.js'),
        join(basePath, 'index.ts'), // ./dir → ./dir/index.ts
        join(basePath, 'index.tsx'),
        join(basePath, 'index.js'),
      ];

      const found = canExist.some((p) => existsSync(p));

      if (!found) {
        // Use line number from AST (accurate)
        broken++;

        const issue: ValidationIssue = {
          severity: 'error',
          category: 'cross-reference',
          message: `Broken import: "${importPath}" in ${relPath} — file not found`,
          file: relPath,
          line: imp.line,
          autoFixable: false,
        };
        issues.push(issue);
        fail(issue.message);
      }
    }
  }

  log(`Cross-references: ${total} files scanned, ${broken} broken`);
  return { total, broken, fixed, issues };
}

// ─── Category: Temp File Validation ─────────────────────────────────────────

interface TempFileResult {
  registered: number;
  unregistered: number;
  cleaned: number;
  authorizedPending: number;
  issues: ValidationIssue[];
}

function validateTempFiles(
  mode: ValidationMode,
  dryRun: boolean,
  autoFix: boolean,
): TempFileResult {
  log('--- Temp File Validation ---');
  const issues: ValidationIssue[] = [];

  const registry = loadRegistry();
  const registered = registry.entries.length;

  // Find authorized-pending files
  const authorizedPending = listEntries('authorized-pending');
  for (const entry of authorizedPending) {
    const daysSinceAuth = entry.authorized_at
      ? Math.floor((Date.now() - new Date(entry.authorized_at).getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    const issue: ValidationIssue = {
      severity: daysSinceAuth > 7 ? 'warning' : 'info',
      category: 'temp-file',
      message:
        `Authorized-pending temp file "${entry.path}" ` +
        (daysSinceAuth > 7
          ? `has been pending for ${daysSinceAuth} days — consider integrating or archiving`
          : `awaiting integration since ${entry.authorized_at || entry.created}`),
      file: entry.path,
      autoFixable: false,
    };
    issues.push(issue);
  }

  // Find unregistered temp files
  const unregistered = findUnregisteredTempFiles();
  for (const f of unregistered) {
    const issue: ValidationIssue = {
      severity: 'info',
      category: 'temp-file',
      message: `Unregistered temp file: ${f}`,
      file: f,
      autoFixable: true,
    };
    issues.push(issue);
  }

  // Clean if auto-fix
  let cleaned = 0;
  if (autoFix && !dryRun && unregistered.length > 0) {
    const result = cleanUnregisteredTemps(false);
    cleaned = result.deleted;
  }

  // Prune stale registry entries if deep or full
  if (mode === 'deep' || mode === 'full') {
    if (!dryRun) {
      pruneRegistry(30, false);
    }
  }

  log(
    `Temp files: ${registered} registered, ${unregistered.length} unregistered, ${authorizedPending.length} pending`,
  );
  return {
    registered,
    unregistered: unregistered.length,
    cleaned,
    authorizedPending: authorizedPending.length,
    issues,
  };
}

// ─── Category: Error & Warning Scan ─────────────────────────────────────────

interface ErrorWarningResult {
  todoCount: number;
  fixmeCount: number;
  tsIgnoreCount: number;
  hackCount: number;
  issues: ValidationIssue[];
}

function scanErrorsAndWarnings(mode: ValidationMode): ErrorWarningResult {
  log('--- Error/Warning Scan ---');
  const issues: ValidationIssue[] = [];

  let todoCount = 0;
  let fixmeCount = 0;
  let tsIgnoreCount = 0;
  let hackCount = 0;

  const changedFiles = getChangedFiles();
  const scopeFiles =
    mode === 'full'
      ? getAllFiles(join(ROOT, 'src'), '.ts')
      : Array.from(changedFiles)
          .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
          .map((f) => join(ROOT, f));

  for (const file of scopeFiles) {
    if (!existsSync(file)) continue;
    const content = readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    const relPath = relative(ROOT, file).replace(/\\/g, '/');

    lines.forEach((line, idx) => {
      const lineNum = idx + 1;

      // 🛡️ False positive guard: skip lines that are themselves detection/pattern code
      if (line.includes('line.includes(')) return;
      if (/\.includes\(['"](FIXME|HACK|TODO|@ts-expect-error|@ts-ignore)['"]\)/.test(line)) return;
      if (/`(FIXME|HACK|TODO|@ts-expect-error|@ts-ignore) in \$\{/.test(line)) return;

      if (line.includes('TODO') && !line.includes('// TODO') && !line.includes('/* TODO')) return;
      if (line.includes('TODO:')) {
        todoCount++;
        issues.push({
          severity: 'info',
          category: 'todo',
          message: `TODO in ${relPath}:${lineNum} — ${line.trim()}`,
          file: relPath,
          line: lineNum,
          autoFixable: false,
        });
      }

      if (line.includes('FIXME') || line.includes('FIX ME')) {
        // 🛡️ Skip if it's a descriptive comment heading (e.g. "// TODO/FIXME count"), not a real marker
        if (/\/\/\s*(TODO|FIXME|HACK).*(FIXME|HACK)/.test(line)) return;
        fixmeCount++;
        issues.push({
          severity: 'warning',
          category: 'fixme',
          message: `FIXME in ${relPath}:${lineNum} — ${line.trim()}`,
          file: relPath,
          line: lineNum,
          autoFixable: false,
        });
      }

      if (line.includes('@ts-expect-error') || line.includes('@ts-ignore')) {
        tsIgnoreCount++;
        issues.push({
          severity: 'warning',
          category: 'ts-ignore',
          message: `${line.includes('@ts-expect-error') ? '@ts-expect-error' : '@ts-ignore'} in ${relPath}:${lineNum}`,
          file: relPath,
          line: lineNum,
          autoFixable: false,
        });
      }

      if (line.includes('HACK') || line.includes('HACK:')) {
        hackCount++;
        issues.push({
          severity: 'warning',
          category: 'hack',
          message: `HACK in ${relPath}:${lineNum} — ${line.trim()}`,
          file: relPath,
          line: lineNum,
          autoFixable: false,
        });
      }
    });
  }

  log(
    `Found: ${todoCount} TODO, ${fixmeCount} FIXME, ${tsIgnoreCount} @ts-ignore, ${hackCount} HACK`,
  );
  return { todoCount, fixmeCount, tsIgnoreCount, hackCount, issues };
}

// ─── Category: Unused Files (deep/full only) ───────────────────────────────

function findUnusedFiles(mode: ValidationMode): { files: string[]; issues: ValidationIssue[] } {
  log('--- Unused File Detection ---');
  const issues: ValidationIssue[] = [];

  if (mode === 'quick') {
    log('Skipped in quick mode');
    return { files: [], issues: [] };
  }

  // Get all .ts files that are NOT entry points or configs
  const allTs = getAllFiles(join(ROOT, 'src'), '.ts');
  const entryPoints = new Set([
    'src/session-autostart.ts',
    'src/session-close-orchestrator.ts',
    'src/session-close-validator.ts',
    'src/temp-file-registry.ts',
  ]);

  // Build an import map: for each file, what does it import
  const importedBy = new Map<string, Set<string>>();

  for (const file of allTs) {
    const relPath = relative(ROOT, file).replace(/\\/g, '/');
    const content = readFileSync(file, 'utf-8');

    // Extract all relative imports
    const importRegex = /from\s+['"](\.[^'"]+)['"]/g;
    let match: RegExpExecArray | null;

    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1];
      const dir = file.substring(0, Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')));
      const resolved = resolve(join(dir, importPath)).replace(/\\/g, '/');
      const relResolved = relative(ROOT, resolved);

      // Strip extension if present
      const withoutExt = relResolved.replace(/\.(ts|tsx|js|mjs)$/, '');
      if (!importedBy.has(withoutExt)) importedBy.set(withoutExt, new Set());
      importedBy.get(withoutExt)!.add(relPath);
    }
  }

  // Find files that are never imported
  const unused: string[] = [];
  for (const file of allTs) {
    const relPath = relative(ROOT, file).replace(/\\/g, '/');
    const withoutExt = relPath.replace(/\.(ts|tsx)$/, '');

    // Skip entry points
    if (entryPoints.has(relPath)) continue;

    const importers = importedBy.get(withoutExt);
    if (!importers || importers.size === 0) {
      // Check if it exports anything
      const content = readFileSync(file, 'utf-8');
      if (content.includes('export ') || content.includes('export default')) {
        unused.push(relPath);
        issues.push({
          severity: 'info',
          category: 'unused-file',
          message: `Exports but is never imported: ${relPath}`,
          file: relPath,
          autoFixable: false,
        });
      }
    }
  }

  log(`Found ${unused.length} potentially unused files (export but no importers)`);
  return { files: unused, issues };
}

// ─── Category: Completeness (deep/full only) ────────────────────────────────

interface CompletenessResult {
  goal: string | null;
  accomplished: number;
  pending: number;
  issues: ValidationIssue[];
}

function checkCompleteness(mode: ValidationMode): CompletenessResult {
  log('--- Completeness Check ---');
  const issues: ValidationIssue[] = [];

  if (mode === 'quick') {
    log('Skipped in quick mode');
    return { goal: null, accomplished: 0, pending: 0, issues: [] };
  }

  const sessionData = getSessionData();
  const goal = sessionData.goal ? String(sessionData.goal) : null;
  const accomplished = sessionData.accomplished
    ? Array.isArray(sessionData.accomplished)
      ? sessionData.accomplished.length
      : 1
    : 0;
  const nextSteps = sessionData.nextSteps
    ? Array.isArray(sessionData.nextSteps)
      ? sessionData.nextSteps
      : [sessionData.nextSteps]
    : [];

  // Check if there are pending/next steps
  if (Array.isArray(nextSteps) && nextSteps.length > 0) {
    for (const step of nextSteps) {
      issues.push({
        severity: 'info',
        category: 'completeness',
        message: `Pending next step: ${String(step)}`,
        autoFixable: false,
      });
    }
  }

  // Check if session has unresolved corrections
  const corrections = sessionData.corrections;
  if (Array.isArray(corrections)) {
    const unresolved = corrections.filter((c: Record<string, unknown>) => c.resolved === false);
    for (const c of unresolved) {
      issues.push({
        severity: 'warning',
        category: 'completeness',
        message: `Unresolved correction: ${String(c.detail || c.message || 'unknown')}`,
        autoFixable: false,
      });
    }
  }

  log(
    `Goal: ${goal ? 'defined' : 'not defined'}, Accomplished: ${accomplished}, Pending: ${nextSteps.length}`,
  );
  return { goal, accomplished, pending: nextSteps.length, issues };
}

// ─── Category: Technical Debt (full only) ───────────────────────────────────

function scanTechnicalDebt(): ValidationIssue[] {
  log('--- Technical Debt Scan ---');
  const issues: ValidationIssue[] = [];

  // Check for deprecated patterns
  const deprecatedPatterns = [
    { pattern: /any\s*\)\s*:\s*any/g, label: 'any → any return type' },
    { pattern: /console\.(log|warn|error)/g, label: 'console.log/warn/error (non-production)' },
    { pattern: /eslint-disable/g, label: 'eslint-disable' },
  ];

  const allTs = getAllFiles(join(ROOT, 'src'), '.ts');
  for (const file of allTs) {
    const content = readFileSync(file, 'utf-8');
    const relPath = relative(ROOT, file).replace(/\\/g, '/');

    // 🛡️ Skip scripts/ directory — CLI scripts use console.log as intended stdout
    if (relPath.startsWith('src/scripts/')) continue;
    // 🛡️ Skip CLI entry points and dashboard utilities — they use console.log as intended stdout
    if (relPath.startsWith('src/cli/')) continue;
    if (relPath === 'src/timeout-monitor.ts') continue;
    if (relPath.startsWith('src/dashboard-') || relPath === 'src/dashboard-common.ts') continue;
    if (relPath.startsWith('src/hooks/')) continue;
    // 🛡️ Skip security/mcp CLI tools — they use console.log as intended stdout
    if (relPath === 'src/mcp/mcp-gateway.ts' || relPath === 'src/check-security.ts') continue;

    for (const dp of deprecatedPatterns) {
      dp.pattern.lastIndex = 0;
      // 🛡️ For "any → any" pattern, skip DB query casts (.all(), .get())
      if (dp.label.startsWith('any') && /\.(all|get)\(\s*(\)|$)/.test(content)) continue;
      if (dp.pattern.test(content)) {
        issues.push({
          severity: 'info',
          category: 'technical-debt',
          message: `Deprecated pattern "${dp.label}" found in ${relPath}`,
          file: relPath,
          autoFixable: false,
        });
      }
    }
  }

  // Large file detection (>500 lines), excluding orchestration files
  const EXCLUDED_LARGE_FILES = [
    /(?:orchestrator|orchestrate)/i, // orchestrators are intentionally large
    /maintenance-watchtower/, // watchtower orchestrator
    /token-optimization/, // complex optimization engine
    /knowledge-synthesizer/, // processing pipeline
    /session-close/, // our own close ecosystem
    /mcp-(lsp|gateway|bridge|manager)/, // MCP servers are complex by design
    /adaptive-router/, // routing engine
    /predictive-governor/, // governor engine
    /self-reflection-loop/, // ML loop
    /code-review/, // review engine
    /sia-orchestrator/, // SIA orchestrator
    /chat-level-enforcer/, // enforcer
    /response-cache/, // cache engine
    /output-compression/, // compression engine
    /gentle-ai-monitor/, // monitor
    /timeout-config/, // config with examples
    /skill-evolution-engine/, // ML engine
  ];

  for (const file of allTs) {
    const content = readFileSync(file, 'utf-8');
    const lines = content.split('\n').length;
    if (lines > 500) {
      const relPath = relative(ROOT, file).replace(/\\/g, '/');
      // Skip intentionally large files
      if (EXCLUDED_LARGE_FILES.some((p) => p.test(relPath))) continue;
      issues.push({
        severity: 'info',
        category: 'technical-debt',
        message: `Large file (${lines} lines): ${relPath}`,
        file: relPath,
        autoFixable: false,
      });
    }
  }

  log(`Technical debt scan complete: ${issues.length} issues found`);
  return issues;
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

export async function runValidation(
  mode: ValidationMode = 'quick',
  dryRun = false,
  autoFix = false,
): Promise<ValidationReport> {
  log('═══════════════════════════════════════════');
  log('  SESSION CLOSE VALIDATOR v1.0');
  log(`  Mode: ${mode}${dryRun ? ' (DRY RUN)' : ''}${autoFix ? ' (AUTO-FIX)' : ''}`);
  log('═══════════════════════════════════════════');

  const allIssues: ValidationIssue[] = [];
  let autoFixed = 0;

  // 1. Cross-Reference Validation (all modes)
  const crossRef = validateCrossReferences(mode, autoFix);
  allIssues.push(...crossRef.issues);
  autoFixed += crossRef.fixed;

  // 2. Temp File Validation (all modes)
  const tempFiles = validateTempFiles(mode, dryRun, autoFix);
  allIssues.push(...tempFiles.issues);
  autoFixed += tempFiles.cleaned;

  // 3. Error & Warning Scan (all modes)
  const errorsWarnings = scanErrorsAndWarnings(mode);
  allIssues.push(...errorsWarnings.issues);

  // 4. Unused Files (deep/full only)
  const unused = findUnusedFiles(mode);
  allIssues.push(...unused.issues);

  // 5. Completeness Check (deep/full only)
  const completeness = checkCompleteness(mode);
  allIssues.push(...completeness.issues);

  // 6. Technical Debt (full only)
  if (mode === 'full') {
    const debtIssues = scanTechnicalDebt();
    allIssues.push(...debtIssues);
  }

  // Summarize
  const errors = allIssues.filter((i) => i.severity === 'error').length;
  const warnings = allIssues.filter((i) => i.severity === 'warning').length;
  const info = allIssues.filter((i) => i.severity === 'info').length;

  // Score: 100 - (errors * 10) - (warnings * 3), minimum 0. INFO does not penalize.
  const score = Math.max(0, 100 - errors * 10 - warnings * 3);

  const report: ValidationReport = {
    timestamp: new Date().toISOString(),
    mode,
    dryRun,
    issues: allIssues,
    summary: {
      total: allIssues.length,
      errors,
      warnings,
      info,
      autoFixed,
    },
    score,
    details: {
      crossReferences: { total: crossRef.total, broken: crossRef.broken, fixed: crossRef.fixed },
      tempFiles: {
        registered: tempFiles.registered,
        unregistered: tempFiles.unregistered,
        cleaned: tempFiles.cleaned,
        authorizedPending: tempFiles.authorizedPending,
      },
      errorsAndWarnings: {
        todoCount: errorsWarnings.todoCount,
        fixmeCount: errorsWarnings.fixmeCount,
        tsIgnoreCount: errorsWarnings.tsIgnoreCount,
        hackCount: errorsWarnings.hackCount,
      },
      unusedFiles: unused.files,
      completeness: {
        goal: completeness.goal,
        accomplished: completeness.accomplished,
        pending: completeness.pending,
      },
    },
  };

  // Print summary
  log('═══════════════════════════════════════════');
  log(`  SCORE: ${score}/100`);
  log(`  ${errors} ERRORS / ${warnings} WARNINGS / ${info} INFO`);
  log(`  Auto-fixed: ${autoFixed}`);
  log('═══════════════════════════════════════════');

  if (errors > 0) {
    fail('Validation found ERRORS that must be resolved:');
    for (const issue of allIssues.filter((i) => i.severity === 'error')) {
      fail(`  ${issue.category}: ${issue.message}`);
    }
  }

  if (warnings > 0) {
    warn('Validation found warnings:');
    for (const issue of allIssues.filter((i) => i.severity === 'warning')) {
      warn(`  ${issue.category}: ${issue.message}`);
    }
  }

  return report;
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    console.log(`
Usage: npx tsx src/session-close-validator.ts --mode <mode> [options]

Modes:
  quick   Cross-references, temp files, errors/warnings (rápido, siempre)
  deep    Quick + unused files, completeness check
  full    Deep + technical debt scan

Options:
  --mode <mode>        Validation mode (default: quick)
  --dry-run            Preview without making changes
  --auto-fix           Auto-correct what's possible (clean temp files)
  --report             Write report to .session/close-validation-report.json
  --verify             Alias for --mode quick
  --help               Show this help
`);
    return;
  }

  if (args.includes('--verify')) {
    void runValidation('quick', args.includes('--dry-run'), args.includes('--auto-fix'));
    return;
  }

  const modeIdx = args.indexOf('--mode');
  const mode: ValidationMode =
    modeIdx >= 0 && modeIdx + 1 < args.length ? (args[modeIdx + 1] as ValidationMode) : 'quick';

  if (!['quick', 'deep', 'full'].includes(mode)) {
    console.error(`ERROR: Invalid mode "${mode}". Use quick, deep, or full.`);
    process.exit(1);
  }

  const dryRun = args.includes('--dry-run');
  const autoFix = args.includes('--auto-fix');
  const writeReport = args.includes('--report') || args.includes('-r');

  runValidation(mode, dryRun, autoFix)
    .then((report) => {
      if (writeReport) {
        const reportDir = join(SESSION_DIR, 'validation');
        mkdirSync(reportDir, { recursive: true });
        const reportFile = join(reportDir, `close-validation-report.json`);
        writeFileSync(reportFile, JSON.stringify(report, null, 2));
        ok(`Validation report written to ${reportFile}`);
      }

      process.exit(report.summary.errors > 0 ? 1 : 0);
    })
    .catch((e) => {
      console.error('[VALIDATOR] ❌ FATAL:', e instanceof Error ? e.message : 'Unknown error');
      process.exit(1);
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
