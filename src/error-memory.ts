#!/usr/bin/env node
/**
 * Error Memory Pattern — Persistent error tracking with semantic recall.
 *
 * Pattern: bug → root cause → fix, read before proposing changes.
 * Prevents repeated debugging of the same issue across sessions.
 *
 * Usage:
 *   npx tsx src/error-memory.ts save --bug "FTS5 crash on special chars" --fix "Wrapped terms in quotes"
 *   npx tsx src/error-memory.ts search --query "fts5 crash"
 *   npx tsx src/error-memory.ts recent
 *   npx tsx src/error-memory.ts match-file --file "src/skills/skill-router.ts"
 */

import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import type { DatabaseManager } from '../apps/web-dashboard/server/database/manager.js';

// ---- Types ----

interface ErrorEntry {
  id?: number;
  bug: string;
  root_cause: string;
  fix: string;
  file?: string;
  pattern?: string;
  severity?: string;
  session_id?: string;
  created_at?: string;
  updated_at?: string;
}

interface ErrorMatch {
  entry: ErrorEntry;
  score: number;
  matchField: 'keyword' | 'file' | 'pattern' | 'semantic';
}

// ---- DB Helper (lazy singleton) ----

let _db: DatabaseManager | null = null;

function getDb(): DatabaseManager | null {
  if (!_db) {
    try {
      const { DatabaseManager } = require(
        join(resolve(process.cwd()), 'apps/web-dashboard/server/database/manager.ts'),
      ) as { DatabaseManager: { getInstance(): DatabaseManager } };
      _db = DatabaseManager.getInstance();
    } catch {
      // Fallback: try the compiled version
      try {
        const { DatabaseManager } = require(
          join(resolve(process.cwd()), 'dist/apps/web-dashboard/server/database/manager.js'),
        ) as { DatabaseManager: { getInstance(): DatabaseManager } };
        _db = DatabaseManager.getInstance();
      } catch {
        return null;
      }
    }
  }
  return _db;
}

// ---- Tokenizer (matches skill-router.ts) ----

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'and',
  'or',
  'is',
  'it',
  'as',
  'be',
  'by',
  'with',
  'from',
  'that',
  'this',
  'are',
  'was',
  'were',
  'been',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'can',
  'could',
  'should',
  'may',
  'might',
  'shall',
  'not',
  'no',
  'but',
  'if',
  'so',
  'up',
  'out',
  'about',
  'into',
  'over',
  'after',
  'before',
  'between',
  'under',
  'again',
  'further',
  'then',
  'once',
  'also',
  'very',
  'just',
  'each',
  'any',
  'all',
  'both',
  'more',
  'most',
  'some',
  'such',
  'only',
  'own',
  'same',
  'than',
  'too',
  'el',
  'la',
  'los',
  'las',
  'de',
  'del',
  'en',
  'un',
  'una',
  'que',
  'es',
  'se',
  'por',
  'para',
  'con',
  'una',
  'lo',
  'como',
  'mas',
  'pero',
  'sus',
  'le',
  'ya',
  'este',
  'entre',
  'porque',
  'todo',
  'esta',
  'sin',
  'son',
]);

function tokenize(text: string): string[] {
  if (!text) return [];
  const cleaned = text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ');
  return cleaned
    .split(/[\s-]+/)
    .filter((t) => t.length >= 2 && t.length <= 40 && !STOP_WORDS.has(t));
}

// ---- Core Functions ----

/**
 * Save a bug → root cause → fix to persistent error memory.
 * Must be called after every bug fix to build the knowledge base.
 */
function saveError(
  bug: string,
  rootCause: string,
  fix: string,
  options?: {
    file?: string;
    pattern?: string;
    severity?: 'low' | 'medium' | 'high' | 'critical';
    sessionId?: string;
  },
): number | null {
  const db = getDb();
  if (!db) {
    console.error('[ERROR-MEMORY] Database not available');
    return null;
  }

  try {
    return db.saveErrorMemory({
      bug,
      rootCause,
      fix,
      file: options?.file,
      pattern: options?.pattern,
      severity: options?.severity ?? 'medium',
      sessionId: options?.sessionId,
    });
  } catch (err) {
    console.error('[ERROR-MEMORY] Failed to save:', err);
    return null;
  }
}

/**
 * Find errors relevant to a given context (query).
 * Searches by keyword, file, pattern, and semantic similarity.
 * Returns matches sorted by relevance score.
 */
function findRelevantErrors(context: {
  query?: string;
  file?: string;
  pattern?: string;
  limit?: number;
}): ErrorMatch[] {
  const db = getDb();
  if (!db) return [];

  const limit = context.limit ?? 5;
  const matches: ErrorMatch[] = [];
  const seen = new Set<number>();

  try {
    // 1. File match (highest priority)
    if (context.file) {
      const byFile = db.findErrorsByFile(context.file) as unknown as ErrorEntry[];
      for (const e of byFile) {
        if (!seen.has(e.id!)) {
          seen.add(e.id!);
          matches.push({ entry: e, score: 1.0, matchField: 'file' });
        }
      }
    }

    // 2. Pattern match
    if (context.pattern) {
      const byPattern = db.findErrorsByPattern(context.pattern) as unknown as ErrorEntry[];
      for (const e of byPattern) {
        if (!seen.has(e.id!)) {
          seen.add(e.id!);
          matches.push({ entry: e, score: 0.9, matchField: 'pattern' });
        }
      }
    }

    // 3. Keyword search
    if (context.query) {
      const keywords = tokenize(context.query);
      for (const kw of keywords) {
        if (kw.length < 3) continue;
        const byKeyword = db.searchErrors(kw, limit) as unknown as ErrorEntry[];
        for (const e of byKeyword) {
          if (!seen.has(e.id!)) {
            seen.add(e.id!);
            // Score based on token overlap
            const bugTokens = tokenize(
              (e.bug ?? '') + ' ' + (e.root_cause ?? '') + ' ' + (e.fix ?? ''),
            );
            const overlap = keywords.filter((k) => bugTokens.includes(k)).length;
            const score = Math.min(0.8, 0.3 + (overlap / Math.max(keywords.length, 1)) * 0.5);
            matches.push({ entry: e, score, matchField: 'keyword' });
          }
        }
      }
    }

    // 4. If still no matches and we have a query, show recent errors as fallback
    if (matches.length === 0 && context.query) {
      const recent = db.getRecentErrors(limit) as unknown as ErrorEntry[];
      // Use classic for loop to avoid floating promise false positive
      for (let i = 0; i < recent.length; i++) {
        const e = recent[i];
        if (!seen.has(e.id!)) {
          seen.add(e.id!);
          matches.push({ entry: e, score: 0.1, matchField: 'keyword' });
        }
      }
    }
  } catch (err) {
    console.error('[ERROR-MEMORY] Search failed:', err);
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, limit);
}

/**
 * Get recent errors for session context.
 */
function getRecentErrors(limit: number = 10): ErrorEntry[] {
  const db = getDb();
  if (!db) return [];
  try {
    return db.getRecentErrors(limit) as unknown as ErrorEntry[];
  } catch {
    return [];
  }
}

/**
 * Generate a pre-commit prompt with relevant error memories.
 * Call this before implementing changes to avoid repeating past bugs.
 */
function generateErrorContext(context: { query: string; file?: string; pattern?: string }): string {
  const matches = findRelevantErrors({
    query: context.query,
    file: context.file,
    pattern: context.pattern,
    limit: 5,
  });

  if (matches.length === 0) return '';

  const lines: string[] = ['⚠️  Error Memory — previous bugs relevant to this context:', ''];

  for (const m of matches) {
    const e = m.entry;
    const severityIcon =
      e.severity === 'critical'
        ? '🔴'
        : e.severity === 'high'
          ? '🟠'
          : e.severity === 'medium'
            ? '🟡'
            : '🟢';
    lines.push(`${severityIcon} **${e.bug}** (confidence: ${(m.score * 100).toFixed(0)}%)`);
    if (e.root_cause) lines.push(`   Root cause: ${e.root_cause}`);
    if (e.fix) lines.push(`   Fix: ${e.fix}`);
    if (e.file) lines.push(`   File: \`${e.file}\``);
    if (e.pattern) lines.push(`   Pattern: \`${e.pattern}\``);
    lines.push('');
  }

  return lines.join('\n');
}

// ---- CLI ----

function printHelp(): void {
  console.log(`
Error Memory — Persistent bug tracking with semantic recall

Usage:
  npx tsx src/error-memory.ts save --bug "<description>" --cause "<root cause>" --fix "<fix>" [options]
  npx tsx src/error-memory.ts search --query "<search terms>"
  npx tsx src/error-memory.ts recent [--limit N]
  npx tsx src/error-memory.ts match-file --file "<path>"
  npx tsx src/error-memory.ts context [--query "<terms>"] [--file "<path>"]

Options:
  --bug         Bug/error description
  --cause       Root cause analysis
  --fix         How it was fixed
  --file        File where the bug occurred
  --pattern     Error pattern/category
  --severity    low|medium|high|critical (default: medium)
  --session     Session ID
  --query       Search terms
  --limit       Max results (default: 10)
`);
}

function main(): void {
  const args = process.argv.slice(2);
  const action = args[0];

  function getVal(flag: string): string | undefined {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
  }

  switch (action) {
    case 'save': {
      const bug = getVal('--bug');
      const cause = getVal('--cause');
      const fix = getVal('--fix');
      if (!bug || !cause || !fix) {
        console.error('ERROR: --bug, --cause, and --fix are required');
        printHelp();
        process.exit(1);
      }
      const id = saveError(bug, cause, fix, {
        file: getVal('--file'),
        pattern: getVal('--pattern'),
        severity:
          (getVal('--severity') as 'low' | 'medium' | 'high' | 'critical' | undefined) ?? 'medium',
        sessionId: getVal('--session'),
      });
      if (id) {
        console.log(`[OK] Error saved with id=${id}`);
        process.exit(0);
      } else {
        process.exit(1);
      }
      break;
    }

    case 'search': {
      const query = getVal('--query');
      const limit = parseInt(getVal('--limit') ?? '10', 10);
      if (!query) {
        console.error('ERROR: --query is required');
        process.exit(1);
      }
      const results = findRelevantErrors({ query, limit });
      if (results.length === 0) {
        console.log('No matching errors found.');
        process.exit(0);
      }
      console.log(`Found ${results.length} matching error(s):\n`);
      for (const r of results) {
        console.log(`[${(r.score * 100).toFixed(0)}%] ${r.entry.bug}`);
        if (r.entry.root_cause) console.log(`  Cause: ${r.entry.root_cause}`);
        if (r.entry.fix) console.log(`  Fix: ${r.entry.fix}`);
        console.log('');
      }
      break;
    }

    case 'recent': {
      const limit = parseInt(getVal('--limit') ?? '10', 10);
      const errors = getRecentErrors(limit);
      if (errors.length === 0) {
        console.log('No errors recorded yet.');
        process.exit(0);
      }
      console.log(`Recent errors (${errors.length}):\n`);
      for (const e of errors) {
        const sev = e.severity ?? 'medium';
        console.log(`[${sev}] ${e.bug}`);
        if (e.root_cause) console.log(`  Cause: ${e.root_cause}`);
        if (e.fix) console.log(`  Fix: ${e.fix}`);
        if (e.file) console.log(`  File: ${e.file}`);
        console.log('');
      }
      break;
    }

    case 'match-file': {
      const file = getVal('--file');
      if (!file) {
        console.error('ERROR: --file is required');
        process.exit(1);
      }
      const results = findRelevantErrors({ file, limit: 5 });
      if (results.length === 0) {
        console.log(`No errors found for file: ${file}`);
        process.exit(0);
      }
      console.log(`Errors for ${file}:\n`);
      for (const r of results) {
        console.log(`[${(r.score * 100).toFixed(0)}%] ${r.entry.bug}`);
        if (r.entry.fix) console.log(`  Fix: ${r.entry.fix}`);
        console.log('');
      }
      break;
    }

    case 'context': {
      const query = getVal('--query') ?? '';
      const file = getVal('--file');
      const context = generateErrorContext({ query, file });
      if (context) {
        console.log(context);
      } else {
        console.log('No relevant error context found.');
      }
      break;
    }

    default:
      printHelp();
      process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

// Export for programmatic use
export { saveError, findRelevantErrors, getRecentErrors, generateErrorContext, tokenize };
