#!/usr/bin/env node
/**
 * RDD Risk Classifier — Evidence-based risk classification for Receipt-Driven Development.
 *
 * Classifies code changes into risk tiers based on evidence, NOT file count or line count.
 * This is a native Gentle-Vanguard implementation, no dependency on gentle-ai CLI.
 *
 * Philosophy: Risk is determined by the nature of the change, not its size.
 *
 * Risk Tiers:
 *   - low:      No reviewer needed (Tier 0)
 *   - standard: 1 focused reviewer (Tier 1)
 *   - high:     4R review required (Tier 2)
 *
 * Evidence factors:
 *   - Change category (auth, security, core-biz-logic, docs, etc.)
 *   - Scope boundaries crossed (security, external API, database)
 *   - Semantic impact (breaking changes, backward compat)
 *   - Historical fragility (files with frequent bugs)
 */

import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { runSync, runSyncShell } from '../core/run-command.js';
import { pathToFileURL } from 'url';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type RiskTier = 'low' | 'standard' | 'high';

export interface RiskFactor {
  name: string;
  category: 'security' | 'api' | 'data' | 'config' | 'logic' | 'ui' | 'docs';
  severity: 1 | 2 | 3 | 4 | 5; // 1=low, 5=critical
  evidence: string;
  files: string[];
}

export interface RiskClassification {
  tier: RiskTier;
  score: number; // 0-100
  factors: RiskFactor[];
  rationale: string;
  recommendation: string;
  reviewLenses: number; // 0, 1, or 4
}

export interface ChangeAnalysis {
  files: string[];
  changeType: 'staged' | 'unstaged' | 'committed';
  insertions: number;
  deletions: number;
  fileCategories: Map<string, FileCategory>;
}

type FileCategory =
  | 'auth'
  | 'security'
  | 'core-logic'
  | 'external-api'
  | 'database'
  | 'config'
  | 'ui'
  | 'test'
  | 'docs'
  | 'build'
  | 'other';

// ─── Config ────────────────────────────────────────────────────────────────────

const ROOT = resolve(process.cwd());

// Risk rules: category -> base risk score
const CATEGORY_RISK: Record<FileCategory, number> = {
  auth: 90,
  security: 85,
  'core-logic': 70,
  'external-api': 60,
  database: 55,
  config: 40,
  ui: 30,
  test: 20,
  docs: 10,
  build: 25,
  other: 35,
};

// Evidence patterns for detection
const PATTERNS: Record<FileCategory, RegExp[]> = {
  auth: [
    /password/i,
    /auth/i,
    /login/i,
    /logout/i,
    /session/i,
    /token/i,
    /credential/i,
    /jwt/i,
    /oauth/i,
    /permission/i,
    /role/i,
  ],
  security: [
    /encrypt/i,
    /hash/i,
    /crypto/i,
    /ssl/i,
    /tls/i,
    /xss/i,
    /csrf/i,
    /injection/i,
    /sanitize/i,
    /escape/i,
    /cors/i,
    /security/i,
  ],
  'core-logic': [
    /business.*logic/i,
    /domain/i,
    /entity/i,
    /model/i,
    /service/i,
    /repository/i,
    /controller/i,
    /usecase/i,
    /workflow/i,
  ],
  'external-api': [
    /api/i,
    /http/i,
    /fetch/i,
    /axios/i,
    /request/i,
    /client/i,
    /sdk/i,
    /integration/i,
    /webhook/i,
    /callback/i,
  ],
  database: [
    /database/i,
    /db/i,
    /sql/i,
    /query/i,
    /migration/i,
    /schema/i,
    /table/i,
    /index/i,
    /transaction/i,
    /connection/i,
    /pool/i,
    /prisma/i,
    /knex/i,
    /typeorm/i,
  ],
  config: [
    /config/i,
    /setting/i,
    /env/i,
    /(\u005c).env/i,
    /secret/i,
    /key/i,
    /credential/i,
    /(\u005c).json$/i,
    /(\u005c).yaml$/i,
    /(\u005c).toml$/i,
    /config(\u005c)./i,
  ],
  ui: [
    /component/i,
    /page/i,
    /view/i,
    /template/i,
    /css/i,
    /scss/i,
    /style/i,
    /jsx/i,
    /tsx/i,
    /vue/i,
    /svelte/i,
    /react/i,
    /angular/i,
    /(\u005c).html$/i,
    /(\u005c).css$/i,
  ],
  test: [
    /test/i,
    /spec/i,
    /(\u005c).test(\u005c)./i,
    /(\u005c).spec(\u005c)./i,
    /__tests__/i,
    /e2e/i,
    /integration.*test/i,
    /unit.*test/i,
    /jest/i,
    /vitest/i,
    /mocha/i,
    /cypress/i,
    /playwright/i,
  ],
  docs: [
    /doc/i,
    /readme/i,
    /changelog/i,
    /(\u005c).md$/i,
    /(\u005c).rst$/i,
    /(\u005c).txt$/i,
    /guide/i,
    /tutorial/i,
    /manual/i,
    /wiki/i,
  ],
  build: [
    /build/i,
    /webpack/i,
    /vite/i,
    /rollup/i,
    /esbuild/i,
    /parcel/i,
    /gulp/i,
    /grunt/i,
    /makefile/i,
    /docker/i,
    /ci/i,
    /(\u005c).github/i,
    /script/i,
    /package(\u005c).json$/i,
    /tsconfig/i,
    /eslint/i,
    /prettier/i,
  ],
  other: [],
};

// Breaking change indicators
const BREAKING_INDICATORS = [
  /breaking/i,
  /BREAKING/i,
  /deprecated/i,
  /deprecate/i,
  /remove/i,
  /delete/i,
  /rename/i,
  /restructure/i,
  /refactor.*api/i,
  /change.*signature/i,
];

// ─── Logger ───────────────────────────────────────────────────────────────────

function log(message: string, level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS' = 'INFO'): void {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const colors: Record<string, string> = {
    INFO: '\u001b[36m',
    WARN: '\u001b[33m',
    ERROR: '\u001b[31m',
    SUCCESS: '\u001b[32m',
  };
  console.log(`${colors[level]}[${timestamp}] [RISK-CLASSIFIER] [${level}] ${message}\u001b[0m`);
}

// ─── Git Operations ───────────────────────────────────────────────────────────

function _getChangedFiles(stagedOnly = false): {
  files: string[];
  lines: { insertions: number; deletions: number };
} {
  try {
    const diffCommand = stagedOnly ? 'git diff --cached --numstat' : 'git diff --numstat';
    const diff = runSyncShell(diffCommand, { cwd: ROOT }).stdout;

    let insertions = 0;
    let deletions = 0;
    const files: string[] = [];

    for (const line of diff.split('\n')) {
      const match = line.match(/^(\d+)\u005cs+(\d+)\u005cs+(.+)$/);
      if (match) {
        const adds = parseInt(match[1], 10);
        const dels = parseInt(match[2], 10);
        const _file = match[3];

        // Handle renamed files (format: "old\u005ctnew")
        const actualFile = _file.includes('\u005ct') ? _file.split('\u005ct')[1] : _file;

        insertions += adds;
        deletions += dels;
        files.push(actualFile);
      }
    }

    return { files, lines: { insertions, deletions } };
  } catch (err) {
    log(
      `Failed to get changed files: ${err instanceof Error ? err.message : String(err)}`,
      'ERROR',
    );
    return { files: [], lines: { insertions: 0, deletions: 0 } };
  }
}

function getCommitMessage(): string {
  try {
    return runSync('git', ['log', '-1', '--format=%s%n%b'], { cwd: ROOT }).stdout.trim();
  } catch {
    return '';
  }
}

// ─── File Analysis ─────────────────────────────────────────────────────────────

function categorizeFile(filePath: string): FileCategory {
  const content = readFileSafe(filePath);
  const fullPath = filePath.toLowerCase();

  for (const [category, patterns] of Object.entries(PATTERNS)) {
    // Check filename patterns
    for (const pattern of patterns) {
      if (pattern.test(fullPath) || pattern.test(filePath)) {
        return category as FileCategory;
      }
    }

    // Check content patterns
    if (content) {
      for (const pattern of patterns) {
        if (pattern.test(content)) {
          return category as FileCategory;
        }
      }
    }
  }

  return 'other';
}

function readFileSafe(filePath: string): string | null {
  try {
    const fullPath = join(ROOT, filePath);
    if (!existsSync(fullPath)) return null;
    // Only read first 1000 chars for pattern matching
    return readFileSync(fullPath, 'utf-8').slice(0, 1000);
  } catch {
    return null;
  }
}

function hasBreakingChanges(commitMessage: string, _files: string[]): boolean {
  const message = commitMessage.toLowerCase();

  // Check commit message
  for (const pattern of BREAKING_INDICATORS) {
    if (pattern.test(message)) {
      return true;
    }
  }

  // Check file deletion (potential breaking change)
  // This would need git status to detect deletions
  // For now, simplified

  return false;
}

function analyzeChangeScope(files: string[]): {
  crossesSecurityBoundary: boolean;
  crossesDatabaseBoundary: boolean;
  crossesApiBoundary: boolean;
  categories: FileCategory[];
} {
  const categories: FileCategory[] = [];
  let crossesSecurityBoundary = false;
  let crossesDatabaseBoundary = false;
  let crossesApiBoundary = false;

  for (const file of files) {
    const category = categorizeFile(file);
    categories.push(category);

    if (category === 'auth' || category === 'security') {
      crossesSecurityBoundary = true;
    }
    if (category === 'database') {
      crossesDatabaseBoundary = true;
    }
    if (category === 'external-api') {
      crossesApiBoundary = true;
    }
  }

  return { crossesSecurityBoundary, crossesDatabaseBoundary, crossesApiBoundary, categories };
}

// ─── Risk Calculation ─────────────────────────────────────────────────────────

function calculateRisk(analysis: ChangeAnalysis): RiskClassification {
  const factors: RiskFactor[] = [];
  let baseScore = 0;

  // Factor 1: Category-based risk
  const categoryScores: Record<string, number> = {};
  for (const category of analysis.fileCategories.values()) {
    if (!categoryScores[category]) categoryScores[category] = 0;
    categoryScores[category] += CATEGORY_RISK[category];
  }

  // Take max category risk (not sum - it's about the highest risk present)
  const maxCategory = Object.entries(categoryScores).sort((a, b) => b[1] - a[1])[0];
  if (maxCategory) {
    const [cat, score] = maxCategory;
    factors.push({
      name: `High-risk category: ${cat}`,
      category: getCategoryType(cat as FileCategory),
      severity: score >= 70 ? 4 : score >= 50 ? 3 : 2,
      evidence: `Files contain ${cat} code (base risk ${score}/100)`,
      files: Array.from(analysis.fileCategories.entries())
        .filter(([_, c]) => c === cat)
        .map(([f]) => f),
    });
    baseScore = Math.max(baseScore, score);
  }

  // Factor 2: Cross-boundary changes
  const scope = analyzeChangeScope(analysis.files);

  if (scope.crossesSecurityBoundary) {
    factors.push({
      name: 'Crosses security boundary',
      category: 'security',
      severity: 5,
      evidence: 'Changes touch authentication or security-sensitive code',
      files: analysis.files.filter((f) => {
        const cat = categorizeFile(f);
        return cat === 'auth' || cat === 'security';
      }),
    });
    baseScore = Math.max(baseScore, 90);
  }

  if (scope.crossesDatabaseBoundary) {
    factors.push({
      name: 'Crosses database boundary',
      category: 'data',
      severity: 4,
      evidence: 'Changes touch database schema or migrations',
      files: analysis.files.filter((f) => categorizeFile(f) === 'database'),
    });
    baseScore = Math.max(baseScore, 75);
  }

  if (scope.crossesApiBoundary) {
    factors.push({
      name: 'Crosses external API boundary',
      category: 'api',
      severity: 3,
      evidence: 'Changes affect external API integration',
      files: analysis.files.filter((f) => categorizeFile(f) === 'external-api'),
    });
    baseScore = Math.max(baseScore, 65);
  }

  // Factor 3: Breaking changes
  const commitMessage = getCommitMessage();
  if (hasBreakingChanges(commitMessage, analysis.files)) {
    factors.push({
      name: 'Potential breaking changes',
      category: 'api',
      severity: 4,
      evidence: `Commit message indicates breaking changes: "${commitMessage.slice(0, 50)}..."`,
      files: analysis.files.slice(0, 3), // Limit evidence
    });
    baseScore = Math.max(baseScore, 70);
  }

  // Determine tier based on score
  let tier: RiskTier;
  let recommendation: string;
  let reviewLenses: number;

  if (baseScore >= 70) {
    tier = 'high';
    recommendation =
      'HIGH RISK: Full 4R review required (Risk, Readability, Reliability, Resilience). Cannot self-approve.';
    reviewLenses = 4;
  } else if (baseScore >= 40) {
    tier = 'standard';
    recommendation = 'STANDARD RISK: 1 focused reviewer required. Risk-specific lens recommended.';
    reviewLenses = 1;
  } else {
    tier = 'low';
    recommendation =
      'LOW RISK: Structural readback sufficient. Silent validation or optional review.';
    reviewLenses = 0;
  }

  return {
    tier,
    score: baseScore,
    factors,
    rationale: generateRationale(factors, baseScore),
    recommendation,
    reviewLenses,
  };
}

function getCategoryType(category: FileCategory): RiskFactor['category'] {
  if (category === 'auth' || category === 'security') return 'security';
  if (category === 'database') return 'data';
  if (category === 'external-api') return 'api';
  if (category === 'config') return 'config';
  if (category === 'ui') return 'ui';
  return 'logic';
}

function generateRationale(factors: RiskFactor[], score: number): string {
  if (factors.length === 0) {
    return 'Low-risk change: documentation or simple configuration updates only.';
  }

  const topFactors = factors.sort((a, b) => b.severity - a.severity).slice(0, 3);

  return `Risk score ${score}/100 based on: ${topFactors.map((f) => f.name).join('; ')}.`;
}

// ─── Main API ───────────────────────────────────────────────────────────────────

export function classifyRisk(stagedOnly = false): RiskClassification {
  const { files, lines } = _getChangedFiles(stagedOnly);

  if (files.length === 0) {
    return {
      tier: 'low',
      score: 0,
      factors: [],
      rationale: 'No changes to classify.',
      recommendation: 'No review needed.',
      reviewLenses: 0,
    };
  }

  const fileCategories = new Map<string, FileCategory>();
  for (const file of files) {
    fileCategories.set(file, categorizeFile(file));
  }

  const analysis: ChangeAnalysis = {
    files,
    changeType: stagedOnly ? 'staged' : 'committed',
    insertions: lines.insertions,
    deletions: lines.deletions,
    fileCategories,
  };

  const classification = calculateRisk(analysis);

  log(
    `Classified ${files.length} files as ${classification.tier.toUpperCase()} risk (score: ${classification.score})`,
    'SUCCESS',
  );

  return classification;
}

export function explainRisk(classification: RiskClassification): string {
  const lines: string[] = [];
  lines.push('═'.repeat(70));
  lines.push('RISK CLASSIFICATION RESULT');
  lines.push('═'.repeat(70));
  lines.push('');
  lines.push(`TIER: ${classification.tier.toUpperCase()}`);
  lines.push(`SCORE: ${classification.score}/100`);
  lines.push(`LENSES REQUIRED: ${classification.reviewLenses}`);
  lines.push('');
  lines.push('RATIONALE:');
  lines.push(`  ${classification.rationale}`);
  lines.push('');

  if (classification.factors.length > 0) {
    lines.push('RISK FACTORS:');
    for (const factor of classification.factors) {
      lines.push(
        `  [${factor.category.toUpperCase()}] ${factor.name} (severity: ${factor.severity}/5)`,
      );
      lines.push(`    Evidence: ${factor.evidence}`);
      if (factor.files.length > 0) {
        lines.push(
          `    Files: ${factor.files.slice(0, 3).join(', ')}${factor.files.length > 3 ? '...' : ''}`,
        );
      }
      lines.push('');
    }
  }

  lines.push('RECOMMENDATION:');
  lines.push(`  ${classification.recommendation}`);
  lines.push('');
  lines.push('─'.repeat(70));

  return lines.join('\n');
}

// ─── CLI Entry ─────────────────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void (async () => {
    const args = process.argv.slice(2);
    const action = args[0] ?? 'classify';

    try {
      switch (action) {
        case 'classify': {
          const staged = args.includes('--staged');
          const classification = classifyRisk(staged);

          if (args.includes('--json')) {
            console.log(JSON.stringify(classification, null, 2));
          } else {
            console.log(explainRisk(classification));
          }

          // Exit code: 0=low, 1=standard, 2=high
          process.exit(
            classification.tier === 'high' ? 2 : classification.tier === 'standard' ? 1 : 0,
          );
        }

        case 'explain': {
          // Read from stdin or file
          let classification: RiskClassification;
          const file = args.find((a) => a.startsWith('--file='))?.split('=')[1];

          if (file) {
            const content = readFileSafe(file);
            if (!content) {
              log(`File not found: ${file}`, 'ERROR');
              process.exit(1);
            }
            classification = JSON.parse(content);
          } else {
            classification = classifyRisk(false);
          }

          console.log(explainRisk(classification));
          break;
        }

        case 'factors': {
          const staged = args.includes('--staged');
          const { files } = _getChangedFiles(staged);

          console.log('File-by-file classification:');
          console.log('');

          for (const file of files) {
            const category = categorizeFile(file);
            const risk = CATEGORY_RISK[category];
            console.log(`${file.padEnd(50)} → ${category.padEnd(15)} (risk: ${risk})`);
          }
          break;
        }

        default:
          console.log('Usage: risk-classifier.ts <action> [options]');
          console.log('');
          console.log('Actions:');
          console.log('  classify   Classify current changes (default)');
          console.log('  explain    Explain risk classification in detail');
          console.log('  factors    List file-by-file risk factors');
          console.log('');
          console.log('Options:');
          console.log('  --staged   Only classify staged changes');
          console.log('  --json     Output as JSON');
          console.log('  --file     Read classification from file');
          console.log('');
          console.log('Exit codes:');
          console.log('  0 = low risk (no review)');
          console.log('  1 = standard risk (1 reviewer)');
          console.log('  2 = high risk (4R review)');
          process.exit(1);
      }
    } catch (err) {
      log(`Error: ${err instanceof Error ? err.message : String(err)}`, 'ERROR');
      process.exit(1);
    }
  })();
}
