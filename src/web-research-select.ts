#!/usr/bin/env node
/**
 * Web Research Select — M5: selective web acquisition.
 *
 * End-to-end selective web research: search (Firecrawl fallback to Jina+Bing)
 * → BM25 relevance grading (CRAG-style, from retrieval-grader) → filter only
 * relevant results → persist to .session/web-research/<slug>.json.
 *
 * Modes:
 *   default (snippet) — grade on title+description only (fast, zero extra fetches).
 *   --deep            — scrape the top-N candidates and grade on FULL page
 *                       markdown (BM25 over real content beats short snippets
 *                       for long/multi-intent queries).
 *
 * This closes the "web selectiva" gap: instead of dumping every search hit,
 * only results that actually match the query's intent survive the grade.
 *
 * Usage:
 *   npx tsx src/web-research-select.ts --query "typescript strict mode best practices" --limit 5
 *   npx tsx src/web-research-select.ts --query "gdpr breach notification" --limit 10 --threshold 0.5
 *   npx tsx src/web-research-select.ts --query "customer retention playbook" --deep --deep-limit 3
 *
 * Output (JSON):
 *   { query, mode, searchCount, gradedCount, relevantCount, verdict,
 *     averageScore, results[{url,title,description,score,relevant,deepScore?}],
 *     persistedTo }
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { createWebCrawler } from './web-crawler.js';
import { gradeRetrieval } from './retrieval-grader.js';

const ROOT = resolve(process.cwd());
const OUTPUT_DIR = join(ROOT, '.session', 'web-research');

interface SelectArgs {
  query: string;
  limit: number;
  threshold: number;
  deep: boolean;
  deepLimit: number;
}

interface SelectedResult {
  url: string;
  title: string;
  description: string;
  score: number;
  relevant: boolean;
  /** Deep mode: BM25 score over scraped markdown (0..1). */
  deepScore?: number;
  /** Deep mode: scrape failed (page blocked / timeout). */
  scrapeError?: string;
}

interface SelectOutput {
  query: string;
  mode: 'snippet' | 'deep';
  searchCount: number;
  gradedCount: number;
  relevantCount: number;
  verdict: string;
  averageScore?: number;
  results: SelectedResult[];
  persistedTo?: string;
}

function parseArgs(argv: string[]): SelectArgs {
  const args: SelectArgs = { query: '', limit: 5, threshold: 0.4, deep: false, deepLimit: 3 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--query' && argv[i + 1]) args.query = argv[++i];
    else if (argv[i] === '--limit' && argv[i + 1]) args.limit = Number(argv[++i]);
    else if (argv[i] === '--threshold' && argv[i + 1]) args.threshold = Number(argv[++i]);
    else if (argv[i] === '--deep') args.deep = true;
    else if (argv[i] === '--deep-limit' && argv[i + 1]) args.deepLimit = Number(argv[++i]);
  }
  return args;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

async function main(): Promise<void> {
  const { query, limit, threshold, deep, deepLimit } = parseArgs(process.argv);

  if (!query) {
    console.error(
      'Usage: --query "search terms" [--limit N] [--threshold 0..1] [--deep] [--deep-limit N]',
    );
    process.exit(1);
  }

  // 1. Search (Firecrawl → DDG HTML → Bing RSS fallback, zero-config)
  const crawler = createWebCrawler();
  const results = await crawler.search(query, limit);
  const texts = results.map((r) => `${r.title}\n${r.description}`);

  // 2. Grade relevance on snippets (fast pass)
  const graded = gradeRetrieval(query, texts, { threshold });

  // 3. Build scored list
  const scored: SelectedResult[] = results.map((r, i) => ({
    url: r.url,
    title: r.title,
    description: r.description ?? '',
    score: graded.chunks[i]?.score ?? 0,
    relevant: graded.chunks[i]?.relevant ?? false,
  }));

  // 4. Deep pass: scrape top candidates, grade on FULL markdown content.
  //    Deep score REPLACES the snippet score for scraped pages — content-based
  //    BM25 is far more reliable than title+snippet for real intent.
  if (deep) {
    const candidates = [...scored].sort((a, b) => b.score - a.score).slice(0, deepLimit);
    for (const cand of candidates) {
      try {
        const scraped = await crawler.scrape(cand.url);
        const md = (scraped.markdown ?? '').slice(0, 20000); // cap token cost
        if (md.trim().length > 100) {
          const deepGraded = gradeRetrieval(query, [md], { threshold });
          cand.deepScore = deepGraded.chunks[0]?.score ?? 0;
          cand.score = cand.deepScore; // deep wins over snippet
          cand.relevant = cand.score >= threshold;
        } else {
          cand.scrapeError = 'empty markdown';
        }
      } catch (e) {
        cand.scrapeError = e instanceof Error ? e.message.slice(0, 120) : 'scrape failed';
      }
    }
    // Re-sort after deep grading
    scored.sort((a, b) => Number(b.relevant) - Number(a.relevant) || b.score - a.score);
  } else {
    // Sort by score desc, relevant first (snippet mode)
    scored.sort((a, b) => Number(b.relevant) - Number(a.relevant) || b.score - a.score);
  }

  const selected = scored.filter((r) => r.relevant);

  const output: SelectOutput = {
    query,
    mode: deep ? 'deep' : 'snippet',
    searchCount: results.length,
    gradedCount: graded.totalCount,
    relevantCount: selected.length,
    verdict: graded.verdict,
    results: scored,
    averageScore: graded.averageScore,
  };

  // 5. Persist for the knowledge base / future sessions
  try {
    if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
    const file = join(OUTPUT_DIR, `${slugify(query)}.json`);
    writeFileSync(file, JSON.stringify(output, null, 2), 'utf-8');
    output.persistedTo = file;
  } catch {
    // non-blocking
  }

  console.log(JSON.stringify(output, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}

export { slugify };
