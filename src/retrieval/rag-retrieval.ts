#!/usr/bin/env node
/**
 * RAG Retrieval + CRAG Grader — integrates the Corrective RAG grader into the
 * retrieval path. Given a query and retrieved chunks, grades relevance and
 * returns the corrective action (keyword-fallback) when retrieval is poor.
 *
 * This is the integration point for the retrieval-grader in the RAG pipeline.
 * It can consume chunks from any source (engram search, vector index, CLI).
 *
 * Usage:
 *   npx tsx src/retrieval/rag-retrieval.ts --query "..." --chunks '["...","..."]'
 *   npx tsx src/retrieval/rag-retrieval.ts --query "..." --file chunks.json
 */

import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { gradeRetrieval, type GradeResult } from './retrieval-grader.js';

const ROOT = resolve(process.env.GENTLE_VANGUARD_BASE_DIR ?? process.cwd());

export interface RagRetrievalOptions {
  threshold?: number;
  minRelevantRatio?: number;
}

/**
 * Grade a set of retrieved chunks for a query and return the CRAG verdict.
 * This is the primary integration point: call this after retrieving chunks
 * and before answering, to decide whether to use the context or fall back
 * to keyword search.
 */
export function gradeRetrievedChunks(
  query: string,
  chunks: string[],
  options: RagRetrievalOptions = {},
): GradeResult {
  return gradeRetrieval(query, chunks, options);
}

/**
 * Filter a chunk list down to the relevant ones (for use when the verdict is
 * 'relevant'). When the verdict is 'corrective', returns an empty list and the
 * caller should trigger keyword-fallback.
 */
export function filterRelevantChunks(result: GradeResult): string[] {
  if (result.verdict === 'corrective') return [];
  return result.chunks.filter((c) => c.relevant).map((c) => c.text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  let query = '';
  let chunksRaw = '';
  let file = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--query') query = args[++i] ?? '';
    else if (args[i] === '--chunks') chunksRaw = args[++i] ?? '';
    else if (args[i] === '--file') file = args[++i] ?? '';
  }

  if (file) {
    const p = join(ROOT, file);
    if (existsSync(p)) chunksRaw = readFileSync(p, 'utf-8');
  }

  if (!query || !chunksRaw) {
    console.error(
      'Usage: npx tsx src/retrieval/rag-retrieval.ts --query "..." --chunks \'["...","..."]\' [--file path]',
    );
    process.exit(1);
  }

  let chunks: string[];
  try {
    chunks = JSON.parse(chunksRaw);
  } catch {
    chunks = chunksRaw.split('\n').filter((l) => l.trim());
  }

  const result = gradeRetrievedChunks(query, chunks);
  const relevant = filterRelevantChunks(result);
  console.log(
    JSON.stringify(
      {
        verdict: result.verdict,
        averageScore: result.averageScore.toFixed(3),
        relevantCount: result.relevantCount,
        totalCount: result.totalCount,
        correctiveAction: result.correctiveAction,
        relevantChunks: relevant.length,
        chunks: result.chunks.map((c) => ({
          index: c.index,
          score: c.score.toFixed(2),
          relevant: c.relevant,
        })),
      },
      null,
      2,
    ),
  );
}
