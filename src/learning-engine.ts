#!/usr/bin/env node
/**
 * Learning Engine - AI-powered knowledge acquisition and improvement suggestions
 *
 * Learns from errors, patterns, and suggests improvements
 * Integrates with existing stack: error-memory, auto-norm-learner, knowledge-base
 *
 * Usage:
 *   npx tsx src/learning-engine.ts --status
 *   npx tsx src/learning-engine.ts --suggest [domain]
 *   npx tsx src/learning-engine.ts --learn <error-file>
 *   npx tsx src/learning-engine.ts --patterns
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { runSync } from './core/run-command.js';

const ROOT = resolve(process.cwd());
const LEARNING_DIR = join(ROOT, '.session', 'learning');
const PATTERNS_FILE = join(LEARNING_DIR, 'patterns.json');

interface ErrorPattern {
  id: string;
  message: string;
  code?: string;
  file?: string;
  domain: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  frequency: number;
  firstSeen: string;
  lastSeen: string;
  hash: string;
  resolved: boolean;
  lesson?: string;
}

interface KnowledgeEntry {
  id: string;
  source: string;
  content: string;
  sha256: string;
  integratedAt: string;
  domain: string;
  tags: string[];
}

interface Suggestion {
  id: string;
  type: 'new_tool' | 'workflow_optimize' | 'external_search' | 'pattern_fix';
  domain: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  rationale: string;
  createdAt: string;
  implemented: boolean;
}

interface LearningData {
  version: number;
  patterns: ErrorPattern[];
  knowledge: KnowledgeEntry[];
  suggestions: Suggestion[];
  domains: Record<string, { count: number; lastSuggestion: string }>;
}

// ─── Initialization ────────────────────────────────────────────────────────────────

function ensureLearningDir(): void {
  if (!existsSync(LEARNING_DIR)) {
    mkdirSync(LEARNING_DIR, { recursive: true });
  }

  if (!existsSync(PATTERNS_FILE)) {
    const initialData: LearningData = {
      version: 1,
      patterns: [],
      knowledge: [],
      suggestions: [],
      domains: {},
    };
    writeFileSync(PATTERNS_FILE, JSON.stringify(initialData, null, 2));
  }
}

function loadLearningData(): LearningData {
  ensureLearningDir();
  try {
    return JSON.parse(readFileSync(PATTERNS_FILE, 'utf-8'));
  } catch {
    return { version: 1, patterns: [], knowledge: [], suggestions: [], domains: {} };
  }
}

function saveLearningData(data: LearningData): void {
  ensureLearningDir();
  writeFileSync(PATTERNS_FILE, JSON.stringify(data, null, 2));
}

// ─── Pattern Learning ──────────────────────────────────────────────────────────────

function hashPattern(message: string, code?: string, file?: string): string {
  // Simple hash combining key fields
  const str = `${message}:${code || ''}:${file || ''}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).slice(0, 8);
}

export function learnFromError(
  message: string,
  context: { code?: string; file?: string; domain?: string; severity?: string },
): ErrorPattern {
  const data = loadLearningData();
  const hash = hashPattern(message, context.code, context.file);

  // Check for existing pattern
  const existingIndex = data.patterns.findIndex((p) => p.hash === hash);
  const now = new Date().toISOString();

  if (existingIndex >= 0) {
    // Update existing pattern
    const pattern = data.patterns[existingIndex];
    pattern.frequency++;
    pattern.lastSeen = now;
    if (context.severity && !pattern.resolved) {
      pattern.severity = mergeSeverity(pattern.severity, context.severity as any);
    }
    saveLearningData(data);
    updateEngram(pattern, 'updated');
    return pattern;
  }

  // Create new pattern
  const pattern: ErrorPattern = {
    id: `pat_${Date.now().toString(36)}`,
    message,
    code: context.code,
    file: context.file,
    domain: context.domain || 'general',
    severity: (context.severity as any) || 'medium',
    frequency: 1,
    firstSeen: now,
    lastSeen: now,
    hash,
    resolved: false,
    lesson: extractLesson(message, context.domain),
  };

  data.patterns.push(pattern);

  // Update domain stats
  if (!data.domains[pattern.domain]) {
    data.domains[pattern.domain] = { count: 0, lastSuggestion: '' };
  }
  data.domains[pattern.domain].count++;

  saveLearningData(data);
  updateEngram(pattern, 'created');

  // Generate suggestion automatically
  generateSuggestion(pattern);

  return pattern;
}

function mergeSeverity(current: string, incoming: string): any {
  const levels = { low: 1, medium: 2, high: 3, critical: 4 };
  return levels[incoming as keyof typeof levels] > levels[current as keyof typeof levels]
    ? incoming
    : current;
}

function extractLesson(message: string, domain?: string): string | undefined {
  // Extract lessons from common patterns
  if (message.includes('session') && message.includes('close')) {
    return 'Cierre debe pasar por session-close-orchestrator';
  }
  if (message.includes('memory') || message.includes('engram')) {
    return 'Verificar persistencia en Engram antes de operaciones críticas';
  }
  if (domain === 'security') {
    return 'Revisar normativas de seguridad antes de cambios';
  }
  return undefined;
}

function generateSuggestion(pattern: ErrorPattern): void {
  const data = loadLearningData();

  let suggestion: Suggestion | null = null;

  if (pattern.message.includes('cierre') || pattern.message.includes('close')) {
    suggestion = {
      id: `sug_${Date.now().toString(36)}`,
      type: 'new_tool',
      domain: pattern.domain,
      priority: pattern.severity === 'critical' ? 'critical' : 'high',
      description: 'Crear sistema de protección contra cierres informales',
      rationale: `Detectado ${pattern.frequency} intentos de cierre incorrecto: ${pattern.message}`,
      createdAt: new Date().toISOString(),
      implemented: false,
    };
  } else if (pattern.frequency > 3) {
    suggestion = {
      id: `sug_${Date.now().toString(36)}`,
      type: 'workflow_optimize',
      domain: pattern.domain,
      priority: getPriorityFromFrequency(pattern.frequency),
      description: `Optimizar flujo en ${pattern.domain} para evitar: ${pattern.message.slice(0, 50)}`,
      rationale: `Patrón recurrente (${pattern.frequency} ocurrencias)`,
      createdAt: new Date().toISOString(),
      implemented: false,
    };
  }

  if (suggestion) {
    // Check for duplicates
    const exists = data.suggestions.some(
      (s) => s.description === suggestion!.description && !s.implemented,
    );

    if (!exists) {
      data.suggestions.push(suggestion);
      data.domains[pattern.domain].lastSuggestion = suggestion.createdAt;
      saveLearningData(data);
    }
  }
}

function getPriorityFromFrequency(freq: number): any {
  if (freq > 10) return 'critical';
  if (freq > 5) return 'high';
  if (freq > 2) return 'medium';
  return 'low';
}

function updateEngram(pattern: ErrorPattern, action: 'created' | 'updated'): void {
  // Persist to Engram for cross-session recall
  const isWindows = process.platform === 'win32';
  const cmd = isWindows ? 'engram.cmd' : 'engram';

  const observation = {
    title: `Pattern ${action}: ${pattern.message.slice(0, 50)}`,
    type: 'pattern',
    content: `**What**: Error pattern detected\n**Domain**: ${pattern.domain}\n**Severity**: ${pattern.severity}\n**Frequency**: ${pattern.frequency}\n**Lesson**: ${pattern.lesson || 'N/A'}`,
  };

  try {
    runSync(cmd, ['save', observation.title, observation.type, '--content', observation.content], {
      stdio: 'ignore',
    });
  } catch {
    // Silent fail - Engram not critical
  }
}

// ─── Suggestions ───────────────────────────────────────────────────────────────────

export function suggestImprovement(domain?: string): Suggestion[] {
  const data = loadLearningData();

  let suggestions = data.suggestions.filter((s) => !s.implemented);

  if (domain) {
    suggestions = suggestions.filter((s) => s.domain === domain);
  }

  // Sort by priority and recency
  const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
  suggestions.sort((a, b) => {
    const pDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
    if (pDiff !== 0) return pDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return suggestions.slice(0, 5); // Top 5
}

function formatSuggestion(s: Suggestion): string {
  const icons = {
    new_tool: '🔧',
    workflow_optimize: '⚡',
    external_search: '🔍',
    pattern_fix: '🩹',
  };

  return `${icons[s.type]} [${s.priority.toUpperCase()}] ${s.description}\n   ${s.rationale}`;
}

// ─── Knowledge Integration ─────────────────────────────────────────────────────────

export function integrateKnowledge(
  source: string,
  content: string,
  options: { domain?: string; tags?: string[] } = {},
): KnowledgeEntry {
  const data = loadLearningData();

  // Generate SHA256 hash for dedup
  const hashContent = `${source}:${content}`;
  const sha256 = hashContent; // Simplified, use crypto in production

  // Check for duplicates
  const exists = data.knowledge.find((k) => k.sha256 === sha256);
  if (exists) {
    return exists;
  }

  const entry: KnowledgeEntry = {
    id: `know_${Date.now().toString(36)}`,
    source,
    content: content.slice(0, 10000), // Limit size
    sha256,
    integratedAt: new Date().toISOString(),
    domain: options.domain || 'general',
    tags: options.tags || [],
  };

  data.knowledge.push(entry);
  saveLearningData(data);

  return entry;
}

// ─── CLI Handlers ──────────────────────────────────────────────────────────────────

function handleStatus(): void {
  const data = loadLearningData();

  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║           📚 Learning Engine Status                    ║');
  console.log('╠════════════════════════════════════════════════════════╣');
  console.log(`║  Patterns learned:    ${data.patterns.length.toString().padStart(27)} ║`);
  console.log(
    `║  Active suggestions: ${data.suggestions
      .filter((s) => !s.implemented)
      .length.toString()
      .padStart(27)} ║`,
  );
  console.log(`║  Knowledge entries:  ${data.knowledge.length.toString().padStart(27)} ║`);
  console.log(
    `║  Domains tracked:   ${Object.keys(data.domains).length.toString().padStart(27)} ║`,
  );
  console.log('╚════════════════════════════════════════════════════════╝');

  if (Object.keys(data.domains).length > 0) {
    console.log('\nDomain statistics:');
    Object.entries(data.domains).forEach(([domain, stats]) => {
      console.log(
        `  ${domain.padEnd(15)} ${stats.count} patterns, last suggestion: ${stats.lastSuggestion.slice(0, 10) || 'never'}`,
      );
    });
  }
}

function handleSuggest(domain?: string): void {
  const suggestions = suggestImprovement(domain);

  if (suggestions.length === 0) {
    console.log('✨ No pending suggestions. System is optimized!');
    return;
  }

  console.log('╔════════════════════════════════════════════════════════╗');
  console.log(`║           💡 Improvement Suggestions${domain ? ` (${domain})` : ''.padEnd(16)}║`);
  console.log('╠════════════════════════════════════════════════════════╣');

  suggestions.forEach((s, i) => {
    console.log(`\n${i + 1}. ${formatSuggestion(s)}`);
  });

  console.log('\n╚════════════════════════════════════════════════════════╝');
  console.log('\nTo implement: Run "stack learning suggest --implement <id>"');
}

function handlePatterns(showAll = false): void {
  const data = loadLearningData();
  const patterns = showAll ? data.patterns : data.patterns.filter((p) => !p.resolved).slice(0, 10);

  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║           🔍 Learned Patterns                          ║');
  console.log('╠════════════════════════════════════════════════════════╣');

  if (patterns.length === 0) {
    console.log('║  No patterns recorded yet                              ║');
  } else {
    patterns.forEach((p, _i) => {
      const status = p.resolved ? '✅' : '⚠️';
      console.log(`\n${status} [${p.severity.toUpperCase()}] ${p.domain}`);
      console.log(`   ${p.message.slice(0, 60)}${p.message.length > 60 ? '...' : ''}`);
      console.log(`   Frequency: ${p.frequency} | First: ${p.firstSeen.slice(0, 10)}`);
      if (p.lesson) {
        console.log(`   Lesson: ${p.lesson}`);
      }
    });
  }

  console.log('\n╚════════════════════════════════════════════════════════╝');
}

function handleLearn(errorFile?: string): void {
  if (!errorFile) {
    console.error('Usage: --learn <error-file>');
    process.exit(1);
  }

  if (!existsSync(errorFile)) {
    console.error(`Error file not found: ${errorFile}`);
    process.exit(1);
  }

  try {
    const errorData = JSON.parse(readFileSync(errorFile, 'utf-8'));
    const pattern = learnFromError(errorData.message || errorFile, {
      code: errorData.code,
      file: errorData.file,
      domain: errorData.domain,
      severity: errorData.severity,
    });

    console.log('✅ Pattern learned:');
    console.log(`   ID: ${pattern.id}`);
    console.log(`   Domain: ${pattern.domain}`);
    console.log(`   Severity: ${pattern.severity}`);
    console.log(`   Lesson: ${pattern.lesson || 'N/A'}`);
  } catch (err: any) {
    console.error(`Failed to learn from error: ${err.message}`);
    process.exit(1);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────────

function showHelp(): void {
  console.log('Learning Engine - Knowledge acquisition and improvement suggestions');
  console.log();
  console.log('USAGE: npx tsx src/learning-engine.ts <command> [options]');
  console.log();
  console.log('COMMANDS:');
  console.log('  --status              Show learning engine status');
  console.log('  --suggest [domain]    Get improvement suggestions');
  console.log('  --patterns            Show learned patterns');
  console.log('  --learn <file>        Learn from error JSON file');
  console.log('  --help                Show this help');
  console.log();
  console.log('EXAMPLES:');
  console.log('  npx tsx src/learning-engine.ts --status');
  console.log('  npx tsx src/learning-engine.ts --suggest architecture');
  console.log('  npx tsx src/learning-engine.ts --learn error.json');
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    showHelp();
    return;
  }

  if (args.includes('--status')) {
    handleStatus();
    return;
  }

  if (args.includes('--suggest')) {
    const suggestIndex = args.indexOf('--suggest');
    const domain = args[suggestIndex + 1];
    handleSuggest(domain);
    return;
  }

  if (args.includes('--patterns')) {
    handlePatterns(true);
    return;
  }

  if (args.includes('--learn')) {
    const learnIndex = args.indexOf('--learn');
    const errorFile = args[learnIndex + 1];
    handleLearn(errorFile);
    return;
  }

  console.error(`Unknown command: ${args.join(' ')}`);
  showHelp();
  process.exit(1);
}

main();
