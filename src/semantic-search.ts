#!/usr/bin/env node
/**
 * Semantic Search — natural-language code search using CodeGraph MCP or fallback to grep/glob.
 * TS migration of codegraph-semantic-search.ps1 concept.
 *
 * Usage:
 *   npx tsx src/semantic-search.ts "authentication middleware"
 *   npx tsx src/semantic-search.ts "database connection" --json
 *   npx tsx src/semantic-search.ts "error handling" --max-results 15 --format detailed
 */

import { runSync } from './core/run-command.js';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

interface SearchResult {
  file: string;
  line: number;
  content: string;
  relevance: number;
  context?: string;
}

interface SearchResponse {
  query: string;
  totalResults: number;
  results: SearchResult[];
  source: 'codegraph' | 'grep-fallback' | 'error';
  processingTimeMs: number;
}

function parseArgs(): { query: string; maxResults: number; format: string; json: boolean } {
  const raw = process.argv.slice(2);
  const queryParts: string[] = [];
  let maxResults = 10;
  let format = 'compact';
  let json = false;

  for (let i = 0; i < raw.length; i++) {
    switch (raw[i]) {
      case '--max-results':
        maxResults = parseInt(raw[++i], 10) || 10;
        break;
      case '--format':
        format = raw[++i] || 'compact';
        break;
      case '--json':
        json = true;
        break;
      default:
        if (!raw[i].startsWith('--')) queryParts.push(raw[i]);
    }
  }

  return { query: queryParts.join(' '), maxResults, format, json };
}

function grepSearch(query: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];
  const srcDir = resolve(process.cwd(), 'src');

  // Break query into meaningful search terms
  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .filter(
      (w) =>
        ![
          'the',
          'for',
          'and',
          'with',
          'that',
          'this',
          'from',
          'what',
          'how',
          'can',
          'you',
        ].includes(w),
    );

  // Search via ripgrep for code patterns
  const searchPatterns = [
    ...keywords,
    // Common code patterns derived from NL query
    query.includes('database') || query.includes('db')
      ? '(createConnection|connect|query|sql|knex|prisma)'
      : '',
    query.includes('auth') || query.includes('login')
      ? '(authenticate|login|token|jwt|session|middleware)'
      : '',
    query.includes('error') || query.includes('handle')
      ? '(try|catch|error|throw|Error|handleError)'
      : '',
    query.includes('config') ? '(config|setting|option|env|environment)' : '',
    query.includes('route') || query.includes('api') || query.includes('endpoint')
      ? '(router|route|app\\.(get|post|put|delete)|endpoint)'
      : '',
    query.includes('test') ? '(describe|it|test|expect|assert)' : '',
    query.includes('type') || query.includes('interface')
      ? '(interface|type|extends|implements)'
      : '',
  ].filter(Boolean);

  const seen = new Set<string>();

  for (const pattern of searchPatterns) {
    if (seen.size >= maxResults) break;
    try {
      // Array form: patterns may contain spaces — shell quoting is unreliable.
      const output = runSync('rg', ['-n', '--no-heading', '-m', '3', pattern, '--type', 'ts', srcDir], {
        maxBuffer: 1024 * 1024,
        stdio: ['pipe', 'pipe', 'ignore'],
      }).stdout;

      for (const line of output.trim().split('\n')) {
        if (seen.size >= maxResults) break;
        if (!line.trim()) continue;

        const match = line.match(/^(.+?):(\d+):(.+)$/);
        if (match) {
          const file = match[1].replace(srcDir + '\\', '').replace(srcDir + '/', '');
          const key = `${file}:${match[2]}`;
          if (!seen.has(key)) {
            seen.add(key);
            const content = match[3].trim();
            const score = keywords.some((k) => content.toLowerCase().includes(k)) ? 2 : 1;
            results.push({
              file,
              line: parseInt(match[2], 10),
              content: content.substring(0, 150),
              relevance: score,
            });
          }
        }
      }
    } catch {
      // rg not available or empty results
    }
  }

  // Sort by relevance
  results.sort((a, b) => b.relevance - a.relevance);
  return results.slice(0, maxResults);
}

function tryCodeGraphSearch(query: string, maxResults: number): SearchResult[] | null {
  try {
    // CodeGraph MCP may be available; try calling it
    // This is an optional enhancement — skip if not available
    const codegraphIndex = resolve(process.cwd(), 'graphify-out', 'graph.json');
    if (!existsSync(codegraphIndex)) return null;

    // Simple graphify query as extra source (native read — no shell, no quoting issues)
    try {
      const g = JSON.parse(readFileSync(codegraphIndex, 'utf8')) as { nodes?: unknown[] };
      const nodes = Array.isArray(g.nodes) ? g.nodes : [];
      const q = query.toLowerCase();
      const matches = nodes
        .filter((n: any) => n && typeof n.label === 'string' && n.label.toLowerCase().includes(q))
        .slice(0, maxResults)
        .map((n: any) => ({ file: n.id || '', line: 0, content: n.label || '', relevance: 3 }));
      if (matches.length > 0) {
        return matches as SearchResult[];
      }
    } catch {
      // codegraph query failed, fallback to grep
    }
  } catch {
    // codegraph not available
  }

  return null;
}

function main(): void {
  const args = parseArgs();
  const startTime = Date.now();

  if (!args.query) {
    console.error(
      '[SEMANTIC-SEARCH] Usage: npx tsx src/semantic-search.ts "<query>" [--max-results N] [--json]',
    );
    process.exit(1);
  }

  console.error(`[SEMANTIC-SEARCH] Query: "${args.query}"`);

  // Try CodeGraph first (higher relevance)
  let results: SearchResult[] = [];
  let source: SearchResponse['source'] = 'grep-fallback';

  const codegraphResults = tryCodeGraphSearch(args.query, args.maxResults);
  if (codegraphResults && codegraphResults.length > 0) {
    results = codegraphResults;
    source = 'codegraph';
    console.error(`[SEMANTIC-SEARCH] Using CodeGraph index`);
  }

  // Always complement with grep for freshness
  const grepResults = grepSearch(args.query, args.maxResults);
  const existingFiles = new Set(results.map((r) => r.file));

  for (const gr of grepResults) {
    if (!existingFiles.has(gr.file)) {
      results.push(gr);
    }
  }

  // Limit
  results = results.slice(0, args.maxResults);

  const response: SearchResponse = {
    query: args.query,
    totalResults: results.length,
    results,
    source,
    processingTimeMs: Date.now() - startTime,
  };

  if (args.json) {
    console.log(JSON.stringify(response, null, 2));
    process.exit(results.length === 0 ? 1 : 0);
  }

  if (results.length === 0) {
    console.error(`[SEMANTIC-SEARCH] No results found for: "${args.query}"`);
    console.log(`Try: grep -ri "${args.query.split(' ').join('|')}" --include="*.ts" src/`);
    process.exit(1);
  }

  console.log(
    `\n${results.length} result(s) for "${args.query}" (${response.processingTimeMs}ms, source: ${source}):\n`,
  );

  for (const r of results) {
    console.log(`  ${r.file}:${r.line}${r.relevance > 2 ? ' ★' : ''}`);
    if (args.format === 'detailed') {
      console.log(`    ${r.content}`);
    } else {
      console.log(`    ${r.content.substring(0, 100)}`);
    }
    console.log();
  }
}

main();
