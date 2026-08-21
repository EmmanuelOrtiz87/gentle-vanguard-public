#!/usr/bin/env node
/**
 * Knowledge Acquisition - Fetch and integrate external knowledge
 *
 * Fetches documentation, APIs, and resources from the web
 * Parses content and integrates into the stack's knowledge base
 *
 * Usage:
 *   npx tsx src/knowledge-acquisition.ts --fetch <url> [--source <name>]
 *   npx tsx src/knowledge-acquisition.ts --status
 *   npx tsx src/knowledge-acquisition.ts --help
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { runSync, runNpxTsxSync } from './core/run-command.js';

const ROOT = resolve(process.cwd());
const KNOWLEDGE_DIR = join(ROOT, '.session', 'knowledge-cache');

interface ParsedContent {
  title: string;
  content: string;
  url: string;
  contentType: string;
  extractedAt: string;
}

// ─── Fetching ──────────────────────────────────────────────────────────────────────

async function fetchUrl(
  url: string,
  timeout = 30000,
): Promise<{ success: boolean; content?: string; contentType?: string; error?: string }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Gentle-Vanguard/1.0 (Knowledge Acquisition)',
        Accept: 'text/html, application/json, text/plain, */*',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const contentType = response.headers.get('content-type') || 'text/plain';
    const content = await response.text();

    return { success: true, content, contentType };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return { success: false, error: 'Request timeout' };
    }
    return { success: false, error: err.message };
  }
}

function fetchUrlSync(
  url: string,
  timeout = 30000,
): { success: boolean; content?: string; contentType?: string; error?: string } {
  // For CLI usage, use curl as fallback
  try {
    const isWindows = process.platform === 'win32';
    const cmd = isWindows ? 'powershell.exe' : 'curl';
    const args = isWindows
      ? [
          '-Command',
          `Invoke-WebRequest -Uri "${url}" -TimeoutSec ${Math.floor(timeout / 1000)} -UseBasicParsing | Select-Object -ExpandProperty Content`,
        ]
      : [
          '-s',
          '-L',
          '--max-time',
          String(Math.floor(timeout / 1000)),
          '-H',
          'User-Agent: Gentle-Vanguard/1.0',
          url,
        ];

    const result = runSync(cmd, args, {
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    if (result.status !== 0) {
      return { success: false, error: result.stderr || 'Fetch failed' };
    }

    return { success: true, content: result.stdout, contentType: 'text/html' };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ─── Parsing ───────────────────────────────────────────────────────────────────────

function parseContent(raw: string, contentType: string, url: string): ParsedContent {
  let title = 'Untitled';
  let content = raw;

  if (contentType.includes('text/html')) {
    // Extract title
    const titleMatch = raw.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (titleMatch) {
      title = titleMatch[1].trim();
    }

    // Simple HTML stripping (for production, use proper HTML parser)
    content = raw
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 50000); // Limit size
  } else if (contentType.includes('application/json')) {
    try {
      const json = JSON.parse(raw);
      title = json.title || json.name || 'JSON Document';
      content = JSON.stringify(json, null, 2).slice(0, 50000);
    } catch {
      title = 'JSON (unparsed)';
    }
  } else if (contentType.includes('text/markdown')) {
    const lines = raw.split('\n');
    const firstH1 = lines.find((l) => l.startsWith('# '));
    if (firstH1) {
      title = firstH1.replace('# ', '').trim();
    }
    content = raw.slice(0, 50000);
  }

  return {
    title,
    content: content.slice(0, 10000), // Further limit for storage
    url,
    contentType,
    extractedAt: new Date().toISOString(),
  };
}

// ─── Integration ───────────────────────────────────────────────────────────────────

function sha256(input: string): string {
  // Simple hash for dedup (in production, use crypto module)
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

function integrateIntoStack(parsed: ParsedContent, source: string): void {
  if (!existsSync(KNOWLEDGE_DIR)) {
    mkdirSync(KNOWLEDGE_DIR, { recursive: true });
  }

  const contentHash = sha256(parsed.url + parsed.content);
  const filename = `${source}_${contentHash}.json`;
  const filepath = join(KNOWLEDGE_DIR, filename);

  // Check for duplicates
  if (existsSync(filepath)) {
    console.log(`⚡ Knowledge already cached: ${parsed.title}`);
    return;
  }

  const knowledgeEntry = {
    id: `know_${Date.now().toString(36)}`,
    source,
    title: parsed.title,
    url: parsed.url,
    content: parsed.content,
    sha256: contentHash,
    extractedAt: parsed.extractedAt,
    contentType: parsed.contentType,
    tags: extractTags(parsed.title, parsed.content),
  };

  writeFileSync(filepath, JSON.stringify(knowledgeEntry, null, 2));

  // Also integrate into learning engine
  integrateIntoLearningEngine(knowledgeEntry);

  console.log(`✅ Knowledge integrated: ${parsed.title}`);
  console.log(`   File: ${filename}`);
  console.log(`   Tags: ${knowledgeEntry.tags.join(', ')}`);
}

function extractTags(title: string, content: string): string[] {
  const tags: string[] = [];
  const text = `${title} ${content}`.toLowerCase();

  const tagMap: Record<string, string[]> = {
    typescript: ['typescript', 'ts', '.ts'],
    nodejs: ['node', 'nodejs', 'node.js'],
    security: ['security', 'auth', 'jwt', 'encryption'],
    testing: ['test', 'testing', 'jest', 'vitest'],
    database: ['database', 'db', 'sql', 'sqlite', 'nexus'],
    ai: ['ai', 'llm', 'learning', 'neural', 'model'],
    devops: ['docker', 'ci/cd', 'pipeline', 'deploy'],
    frontend: ['react', 'vue', 'frontend', 'ui', 'component'],
  };

  Object.entries(tagMap).forEach(([tag, keywords]) => {
    if (keywords.some((k) => text.includes(k))) {
      tags.push(tag);
    }
  });

  return tags.slice(0, 5); // Max 5 tags
}

function integrateIntoLearningEngine(entry: any): void {
  // Call learning engine to integrate
  try {
    runNpxTsxSync(
      'src/learning-engine.ts',
      [
        '--integrate',
        JSON.stringify({
          source: entry.source,
          title: entry.title,
          content: entry.content,
          url: entry.url,
        }),
      ],
      { stdio: 'ignore' },
    );
  } catch {
    // Silent fail - not critical
  }
}

function integrateWithEngram(entry: any): void {
  const isWindows = process.platform === 'win32';
  const cmd = isWindows ? 'engram.cmd' : 'engram';

  try {
    runSync(
      cmd,
      [
        'save',
        `Knowledge: ${entry.title}`,
        'learning',
        '--content',
        `**Source**: ${entry.source}\n**URL**: ${entry.url}\n**Tags**: ${entry.tags.join(', ')}\n\n${entry.content.slice(0, 500)}`,
      ],
      { stdio: 'ignore' },
    );
  } catch {
    // Silent fail
  }
}

// ─── CLI Handlers ──────────────────────────────────────────────────────────────────

function handleStatus(): void {
  if (!existsSync(KNOWLEDGE_DIR)) {
    console.log('📚 Knowledge cache: Empty');
    return;
  }

  const files = readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith('.json'));

  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║           📚 Knowledge Acquisition Status              ║');
  console.log('╠════════════════════════════════════════════════════════╣');
  console.log(`║  Cached entries:       ${files.length.toString().padStart(30)} ║`);
  console.log(`║  Cache directory:      ${KNOWLEDGE_DIR.replace(ROOT, '.').padStart(30)} ║`);
  console.log('╚════════════════════════════════════════════════════════╝');

  if (files.length > 0) {
    console.log('\nRecent entries:');
    files.slice(-5).forEach((f) => {
      try {
        const entry = JSON.parse(readFileSync(join(KNOWLEDGE_DIR, f), 'utf-8'));
        console.log(`  • ${entry.title.slice(0, 50)} (${entry.source})`);
      } catch {
        console.log(`  • ${f}`);
      }
    });
  }
}

async function handleFetch(url: string, source: string): Promise<void> {
  console.log(`🌐 Fetching: ${url}`);
  console.log(`   Source: ${source}`);

  const result = await fetchUrl(url);

  if (!result.success) {
    console.error(`❌ Failed to fetch: ${result.error}`);

    // Try sync fallback
    console.log('   Trying fallback method...');
    const syncResult = fetchUrlSync(url);

    if (!syncResult.success) {
      console.error(`❌ Fallback also failed: ${syncResult.error}`);
      process.exit(1);
    }

    result.success = true;
    result.content = syncResult.content;
    result.contentType = syncResult.contentType;
  }

  console.log('✅ Fetch successful');
  console.log(`   Content-Type: ${result.contentType}`);
  console.log(`   Length: ${result.content?.length || 0} chars`);

  const parsed = parseContent(result.content!, result.contentType || 'text/plain', url);

  console.log(`   Title: ${parsed.title}`);
  console.log(`   Extracted: ${parsed.content.length} chars`);

  integrateIntoStack(parsed, source);
  integrateWithEngram({
    ...parsed,
    source,
    tags: extractTags(parsed.title, parsed.content),
  });
}

function showHelp(): void {
  console.log('Knowledge Acquisition - Fetch and integrate external knowledge');
  console.log();
  console.log('USAGE: npx tsx src/knowledge-acquisition.ts <command> [options]');
  console.log();
  console.log('COMMANDS:');
  console.log('  --fetch <url>       Fetch and integrate knowledge from URL');
  console.log('  --source <name>     Source identifier (default: "web")');
  console.log('  --status            Show knowledge cache status');
  console.log('  --help              Show this help');
  console.log();
  console.log('EXAMPLES:');
  console.log(
    '  npx tsx src/knowledge-acquisition.ts --fetch https://example.com/docs --source docs',
  );
  console.log('  npx tsx src/knowledge-acquisition.ts --status');
  console.log();
  console.log('NOTE: Content is cached in .session/knowledge-cache/');
  console.log('      and integrated with learning engine and Engram.');
}

// ─── Main ──────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    showHelp();
    return;
  }

  if (args.includes('--status')) {
    handleStatus();
    return;
  }

  if (args.includes('--fetch')) {
    const fetchIndex = args.indexOf('--fetch');
    const url = args[fetchIndex + 1];

    if (!url) {
      console.error('❌ URL required. Use: --fetch <url>');
      process.exit(1);
    }

    const sourceIndex = args.indexOf('--source');
    const source = sourceIndex > -1 ? args[sourceIndex + 1] || 'web' : 'web';

    await handleFetch(url, source);
    return;
  }

  console.error(`Unknown command: ${args.join(' ')}`);
  showHelp();
  process.exit(1);
}

main().catch((err) => {
  console.error(`❌ Error: ${err.message}`);
  process.exit(1);
});
