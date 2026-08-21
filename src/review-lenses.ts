#!/usr/bin/env node
/**
 * Review Lenses — 4 specific review lenses for structured code review.
 *
 * Implementa las 4 lentes específicas del libro Gentleman Programming:
 *   security     — vulnerabilidades, secretos, injection, auth
 *   maintainability — deuda técnica, complejidad, naming, modularidad
 *   reliability  — error handling, edge cases, timeouts, fallos
 *   resilience   — graceful degradation, circuit breakers, retry logic
 *
 * Cada lente produce findings que se guardan en Findings Ledger.
 * La selección de lentes se hace por risk signal del contexto.
 *
 * Flags:
 *   --lens <name>     Run specific lens (security|maintainability|reliability|resilience|all)
 *   --target <path>   File or directory to review
 *   --risk <level>    Risk signal (low|medium|high|critical) — auto-selects lenses
 *   --output <fmt>    Output format (json|text)
 *   --quiet           Minimal output (pipeline mode)
 *   --dry-run         Preview without saving
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve, extname } from 'path';
import { pathToFileURL } from 'url';

// ─── Types ────────────────────────────────────────────────────────────

type LensName = 'security' | 'maintainability' | 'reliability' | 'resilience';
type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
type FindingSeverity = 'info' | 'warning' | 'critical' | 'blocker';

interface LensFinding {
  lens: LensName;
  severity: FindingSeverity;
  title: string;
  description: string;
  line?: number;
  snippet?: string;
  recommendation: string;
}

interface LensReview {
  lens: LensName;
  findings: LensFinding[];
  summary: { total: number; blocker: number; critical: number; warning: number; info: number };
  risk: RiskLevel;
}

interface LensesConfig {
  version: string;
  outputDir: string;
  reviewableExts: string[];
  maxFileSizeBytes: number;
  maxFindingsPerFile: number;
}

interface RiskProfile {
  securityWeight: number;
  maintainabilityWeight: number;
  reliabilityWeight: number;
  resilienceWeight: number;
}

// ─── Constants ─────────────────────────────────────────────────────────

const ROOT = resolve(process.cwd());
const CONFIG_PATH = join(ROOT, 'config', 'review-lenses.json');

const DEFAULT_CONFIG: LensesConfig = {
  version: '1.0.0',
  outputDir: '.session/reviews',
  reviewableExts: [
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.ps1',
    '.psm1',
    '.py',
    '.go',
    '.rs',
    '.json',
    '.yaml',
    '.yml',
    '.md',
  ],
  maxFileSizeBytes: 1024 * 1024,
  maxFindingsPerFile: 20,
};

const RISK_LENS_MAP: Record<RiskLevel, LensName[]> = {
  low: ['maintainability'],
  medium: ['maintainability', 'reliability'],
  high: ['security', 'reliability', 'resilience'],
  critical: ['security', 'reliability', 'resilience', 'maintainability'],
};

const RISK_PROFILES: Record<RiskLevel, RiskProfile> = {
  low: {
    securityWeight: 0.1,
    maintainabilityWeight: 0.5,
    reliabilityWeight: 0.2,
    resilienceWeight: 0.2,
  },
  medium: {
    securityWeight: 0.2,
    maintainabilityWeight: 0.3,
    reliabilityWeight: 0.3,
    resilienceWeight: 0.2,
  },
  high: {
    securityWeight: 0.4,
    maintainabilityWeight: 0.15,
    reliabilityWeight: 0.25,
    resilienceWeight: 0.2,
  },
  critical: {
    securityWeight: 0.5,
    maintainabilityWeight: 0.1,
    reliabilityWeight: 0.2,
    resilienceWeight: 0.2,
  },
};

// ─── Helpers ───────────────────────────────────────────────────────────

function loadConfig(): LensesConfig {
  if (!existsSync(CONFIG_PATH)) return DEFAULT_CONFIG;
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function isReviewable(filePath: string, config: LensesConfig): boolean {
  const ext = extname(filePath).toLowerCase();
  if (!config.reviewableExts.includes(ext)) return false;
  try {
    return statSync(filePath).size <= config.maxFileSizeBytes;
  } catch {
    return false;
  }
}

function collectFiles(target: string, config: LensesConfig): string[] {
  const fullPath = join(ROOT, target);
  if (!existsSync(fullPath)) return [];
  if (statSync(fullPath).isFile()) return isReviewable(fullPath, config) ? [fullPath] : [];
  return readdirSync(fullPath)
    .map((e) => join(fullPath, e))
    .filter((f) => statSync(f).isFile() && isReviewable(f, config));
}

// ─── Lens Implementations ─────────────────────────────────────────────

function securityLens(content: string, filePath: string): LensFinding[] {
  const findings: LensFinding[] = [];
  const lines = content.split('\n');
  const relPath = relative(ROOT, filePath);

  // Hardcoded secrets
  const secretPattern =
    /(password|secret|api_key|apikey|token|credential|auth_token)\s*[:=]\s*["']{0,1}[^"',;\s]{8,}/i;
  for (let i = 0; i < lines.length; i++) {
    if (secretPattern.test(lines[i])) {
      findings.push({
        lens: 'security',
        severity: 'critical',
        title: 'Possible hardcoded secret',
        description: `Line ${i + 1}: potential secret/credential hardcoded in ${relPath}`,
        line: i + 1,
        snippet: lines[i].trim().slice(0, 100),
        recommendation: 'Use environment variables, secret manager, or vault service',
      });
    }
  }

  // Command injection
  const injectPattern = /(Invoke-Expression|iex|eval\s*\(|exec\s*\()/;
  for (let i = 0; i < lines.length; i++) {
    if (injectPattern.test(lines[i])) {
      findings.push({
        lens: 'security',
        severity: 'warning',
        title: 'Potential code injection',
        description: `Line ${i + 1}: use of eval/Invoke-Expression in ${relPath}`,
        line: i + 1,
        snippet: lines[i].trim().slice(0, 100),
        recommendation: 'Avoid dynamic code execution. Use safe parsers or sandboxed environments',
      });
    }
  }

  // SQL injection
  const sqlPattern = /SELECT.*FROM.*WHERE.*\+/;
  for (let i = 0; i < lines.length; i++) {
    if (sqlPattern.test(lines[i])) {
      findings.push({
        lens: 'security',
        severity: 'blocker',
        title: 'Possible SQL injection',
        description: `Line ${i + 1}: string concatenation in SQL query in ${relPath}`,
        line: i + 1,
        snippet: lines[i].trim().slice(0, 100),
        recommendation: 'Use parameterized queries or prepared statements',
      });
    }
  }

  // Path traversal
  const pathPattern = /readFileSync\s*\(\s*join\s*\([^)]*\+\s*[^)]/;
  for (let i = 0; i < lines.length; i++) {
    if (pathPattern.test(lines[i])) {
      findings.push({
        lens: 'security',
        severity: 'warning',
        title: 'Possible path traversal',
        description: `Line ${i + 1}: user input in file path construction in ${relPath}`,
        line: i + 1,
        snippet: lines[i].trim().slice(0, 100),
        recommendation: 'Validate and sanitize user input before using in file paths',
      });
    }
  }

  return findings;
}

function maintainabilityLens(content: string, filePath: string): LensFinding[] {
  const findings: LensFinding[] = [];
  const lines = content.split('\n');
  const relPath = relative(ROOT, filePath);

  // Long functions/files
  if (lines.length > 300) {
    findings.push({
      lens: 'maintainability',
      severity: 'warning',
      title: 'Large file',
      description: `${relPath} has ${lines.length} lines`,
      recommendation: 'Consider splitting into smaller modules (< 300 lines)',
    });
  }

  // Long lines
  let longLines = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > 120) longLines++;
  }
  if (longLines > 10) {
    findings.push({
      lens: 'maintainability',
      severity: 'info',
      title: 'Long lines detected',
      description: `${relPath}: ${longLines} lines exceed 120 chars`,
      recommendation: 'Break long lines for better readability',
    });
  }

  // Missing error handling
  let tryCount = 0,
    catchCount = 0;
  for (const line of lines) {
    if (/\btry\s*\{/.test(line)) tryCount++;
    if (/\bcatch\s*\(/.test(line)) catchCount++;
  }
  if (tryCount > catchCount + 2) {
    findings.push({
      lens: 'maintainability',
      severity: 'warning',
      title: 'Try without catch',
      description: `${relPath}: ${tryCount - catchCount} try blocks missing catch`,
      recommendation: 'Add error handling for all try blocks',
    });
  }

  // TODO/FIXME count
  const todoCount = lines.filter((l) => /TODO|FIXME|HACK|XXX/.test(l)).length;
  if (todoCount > 3) {
    findings.push({
      lens: 'maintainability',
      severity: 'info',
      title: 'Technical debt markers',
      description: `${relPath}: ${todoCount} TODO/FIXME markers found`,
      recommendation: 'Address technical debt items systematically',
    });
  }

  // Deeply nested code
  let maxDepth = 0;
  let currentDepth = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.endsWith('{') || trimmed.endsWith('(')) currentDepth++;
    if (trimmed === '}' || trimmed === ')') currentDepth--;
    maxDepth = Math.max(maxDepth, currentDepth);
  }
  if (maxDepth > 6) {
    findings.push({
      lens: 'maintainability',
      severity: 'warning',
      title: 'Deep nesting',
      description: `${relPath}: max nesting depth ${maxDepth}`,
      recommendation: 'Extract nested logic into separate functions (max 4 levels recommended)',
    });
  }

  return findings;
}

function reliabilityLens(content: string, filePath: string): LensFinding[] {
  const findings: LensFinding[] = [];
  const lines = content.split('\n');
  const relPath = relative(ROOT, filePath);

  // Missing timeout on async operations
  for (let i = 0; i < lines.length; i++) {
    if (
      /(fetch|axios\.get|http\.request|spawn|exec)\s*\(/.test(lines[i]) &&
      !lines[i].includes('timeout') &&
      !lines[i].includes('signal')
    ) {
      findings.push({
        lens: 'reliability',
        severity: 'warning',
        title: 'Async operation without timeout',
        description: `Line ${i + 1}: ${relPath}`,
        line: i + 1,
        snippet: lines[i].trim().slice(0, 100),
        recommendation: 'Add timeout or AbortSignal to prevent hanging operations',
      });
    }
  }

  // Bare catch blocks
  for (let i = 0; i < lines.length; i++) {
    if (/\bcatch\s*\(.*\)\s*\{/.test(lines[i]) || /\bcatch\s*\{/.test(lines[i])) {
      // Check if next non-empty line is empty or just logging
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      if (j < lines.length && /^\s*(\/\/|console\.|log\()/.test(lines[j])) {
        // Continue checking - does it have meaningful error handling?
        let hasMeaningful = false;
        for (let k = i; k < Math.min(i + 6, lines.length); k++) {
          if (/\bthrow\b|reject|retry|fallback|recovery/.test(lines[k])) hasMeaningful = true;
        }
        if (!hasMeaningful) {
          findings.push({
            lens: 'reliability',
            severity: 'warning',
            title: 'Bare catch block',
            description: `Line ${i + 1}: catch block without recovery in ${relPath}`,
            line: i + 1,
            snippet: lines[i].trim().slice(0, 100),
            recommendation: 'Add recovery logic or re-throw after logging',
          });
        }
      }
    }
  }

  // Missing null/undefined checks
  for (let i = 0; i < lines.length; i++) {
    if (
      /\.(map|filter|forEach|find)\s*\(/.test(lines[i]) &&
      !lines[i].includes('?.') &&
      !lines[i].includes('if')
    ) {
      // Check if the array might be null
      const match = lines[i].match(/(\w+)\.(map|filter|forEach|find)\s*\(/);
      if (
        match &&
        !content.includes(`if (!${match[1]})`) &&
        !content.includes(`if (${match[1]} === null`)
      ) {
        findings.push({
          lens: 'reliability',
          severity: 'info',
          title: 'Possible null reference',
          description: `Line ${i + 1}: ${relPath} — array method without null guard`,
          line: i + 1,
          snippet: lines[i].trim().slice(0, 100),
          recommendation: 'Use optional chaining or null check before array operations',
        });
      }
    }
  }

  // Process.exit in library code
  for (let i = 0; i < lines.length; i++) {
    if (/process\.exit\s*\(/.test(lines[i])) {
      findings.push({
        lens: 'reliability',
        severity: 'critical',
        title: 'Unexpected process exit',
        description: `Line ${i + 1}: process.exit() in ${relPath}`,
        line: i + 1,
        snippet: lines[i].trim().slice(0, 100),
        recommendation: 'Throw an error instead of killing the process',
      });
    }
  }

  return findings;
}

function resilienceLens(content: string, filePath: string): LensFinding[] {
  const findings: LensFinding[] = [];
  const lines = content.split('\n');
  const relPath = relative(ROOT, filePath);

  // Missing retry logic
  const hasRetry = /retry|backoff|retryAsync|withRetry/.test(content);
  const hasNetworkCall = /fetch|axios|https\.|http\.|spawn|exec|request/.test(content);
  if (hasNetworkCall && !hasRetry) {
    findings.push({
      lens: 'resilience',
      severity: 'warning',
      title: 'Network call without retry',
      description: `${relPath} has network operations but no retry logic`,
      recommendation: 'Add exponential backoff retry for transient failures',
    });
  }

  // Missing circuit breaker
  const hasCircuitBreaker = /circuit.?breaker|breaker|half.?open|fallback/.test(content);
  const hasExternalCall = /fetch|axios|spawn|request|query|database/.test(content);
  if (hasExternalCall && !hasCircuitBreaker && lines.length > 50) {
    findings.push({
      lens: 'resilience',
      severity: 'info',
      title: 'External calls without circuit breaker',
      description: `${relPath} makes external calls without circuit breaker pattern`,
      recommendation: 'Add circuit breaker to prevent cascade failures',
    });
  }

  // Missing graceful degradation
  for (let i = 0; i < lines.length; i++) {
    if (/\bcatch\s*\(/.test(lines[i])) {
      let j = i + 1;
      let hasDegradation = false;
      // Check a few lines after catch
      while (j < Math.min(i + 5, lines.length)) {
        if (
          /fallback|default|return\s+\[\]|return\s+\{\}|return\s+null|alternative|cache/.test(
            lines[j],
          )
        ) {
          hasDegradation = true;
        }
        j++;
      }
      if (!hasDegradation) {
        findings.push({
          lens: 'resilience',
          severity: 'info',
          title: 'Catch without graceful degradation',
          description: `Line ${i + 1}: ${relPath} — catch block may need fallback`,
          line: i + 1,
          snippet: lines[i].trim().slice(0, 100),
          recommendation: 'Return cached data, default value, or partial result on failure',
        });
      }
    }
  }

  // Timeout configurations
  for (let i = 0; i < lines.length; i++) {
    if (/timeout/.test(lines[i])) {
      const match = lines[i].match(/timeout[:\s]*(\d+)/i);
      if (match) {
        const timeoutMs = parseInt(match[1], 10);
        if (timeoutMs > 30000) {
          findings.push({
            lens: 'resilience',
            severity: 'warning',
            title: 'Excessive timeout',
            description: `Line ${i + 1}: ${timeoutMs}ms timeout in ${relPath}`,
            line: i + 1,
            snippet: lines[i].trim().slice(0, 100),
            recommendation: 'Reduce timeout or implement streaming for long operations',
          });
        }
      }
    }
  }

  return findings;
}

// ─── Core API ──────────────────────────────────────────────────────────

export function selectLenses(risk: RiskLevel): LensName[] {
  return RISK_LENS_MAP[risk] ?? ['maintainability'];
}

export function getRiskProfile(risk: RiskLevel): RiskProfile {
  return RISK_PROFILES[risk] ?? RISK_PROFILES.low;
}

export function reviewWithLens(filePath: string, lens: LensName): LensFinding[] {
  if (!existsSync(filePath)) return [];
  try {
    const content = readFileSync(filePath, 'utf-8');
    switch (lens) {
      case 'security':
        return securityLens(content, filePath);
      case 'maintainability':
        return maintainabilityLens(content, filePath);
      case 'reliability':
        return reliabilityLens(content, filePath);
      case 'resilience':
        return resilienceLens(content, filePath);
    }
  } catch {
    return [];
  }
}

export function reviewTarget(
  target: string,
  lenses: LensName[],
  risk: RiskLevel = 'medium',
): LensReview[] {
  const config = loadConfig();
  const files = collectFiles(target, config);
  const reviews: LensReview[] = [];

  for (const lens of lenses) {
    const findings: LensFinding[] = [];
    let findingCount = 0;
    for (const file of files) {
      if (findingCount >= config.maxFindingsPerFile * files.length) break;
      const fileFindings = reviewWithLens(file, lens);
      for (const f of fileFindings) {
        if (findingCount >= config.maxFindingsPerFile * files.length) break;
        findings.push(f);
        findingCount++;
      }
    }
    const summary = {
      total: findings.length,
      blocker: findings.filter((f) => f.severity === 'blocker').length,
      critical: findings.filter((f) => f.severity === 'critical').length,
      warning: findings.filter((f) => f.severity === 'warning').length,
      info: findings.filter((f) => f.severity === 'info').length,
    };
    reviews.push({ lens, findings, summary, risk });
  }

  return reviews;
}

// ─── CLI Handler ───────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  let lensName: LensName | 'all' = 'all';
  let target = '.';
  let risk: RiskLevel = 'medium';
  let quiet = false;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--lens':
        lensName = (args[++i] ?? 'all') as LensName | 'all';
        break;
      case '--target':
        target = args[++i] ?? '.';
        break;
      case '--risk':
        risk = (args[++i] ?? 'medium') as RiskLevel;
        break;
      case '--quiet':
        quiet = true;
        break;
      case '--dry-run':
        dryRun = true;
        break;
    }
  }

  if (dryRun) {
    const lenses = lensName === 'all' ? selectLenses(risk) : [lensName];
    console.log(`[DRY-RUN] Would review target=${target} risk=${risk} lenses=${lenses.join(',')}`);
    process.exit(0);
  }

  const lenses = lensName === 'all' ? selectLenses(risk) : [lensName];
  const reviews = reviewTarget(target, lenses, risk);

  if (!quiet) {
    console.log('\n=== REVIEW LENSES RESULTS ===');
    let totalFindings = 0;
    for (const review of reviews) {
      console.log(`\n--- ${review.lens.toUpperCase()} LENS (risk: ${review.risk}) ---`);
      console.log(
        `  Findings: ${review.summary.total} (blocker: ${review.summary.blocker}, critical: ${review.summary.critical}, warning: ${review.summary.warning}, info: ${review.summary.info})`,
      );
      for (const f of review.findings.slice(0, 10)) {
        console.log(`  [${f.severity}] ${f.title}`);
        if (f.line) console.log(`    Line ${f.line}: ${(f.snippet ?? '').slice(0, 80)}`);
        console.log(`    → ${f.recommendation}`);
      }
      if (review.findings.length > 10)
        console.log(`  ... and ${review.findings.length - 10} more findings`);
      totalFindings += review.summary.total;
    }
    console.log(`\nTotal: ${totalFindings} findings across ${reviews.length} lenses`);
  } else {
    console.log(JSON.stringify(reviews, null, 2));
  }
}
