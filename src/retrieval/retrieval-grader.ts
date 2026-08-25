#!/usr/bin/env node
/**
 * Retrieval Grader (CRAG) — Corrective RAG relevance grading + fallback.
 *
 * Absorbed from awesome-llm-apps (corrective_rag pattern) as native TS.
 *
 * Grades the relevance of retrieved chunks against a query. If the overall
 * relevance is below threshold, it triggers a corrective action (keyword
 * fallback) instead of answering with poor context. This prevents
 * hallucination from irrelevant retrieval.
 *
 * Grading uses lexical BM25 overlap (no ML/embeddings required), so it works
 * in any RAG pipeline. It can be combined with an embedding scorer when one
 * is available.
 *
 * Usage:
 *   npx tsx src/retrieval/retrieval-grader.ts --query "..." --chunks '["...","..."]'
 *   npx tsx src/retrieval/retrieval-grader.ts --query "..." --file chunks.json
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { bm25Score } from '@gentle-vanguard/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GradedChunk {
  index: number;
  text: string;
  score: number;
  relevant: boolean;
}

export interface GradeResult {
  query: string;
  chunks: GradedChunk[];
  averageScore: number;
  relevantCount: number;
  totalCount: number;
  verdict: 'relevant' | 'corrective';
  correctiveAction: 'none' | 'keyword-fallback';
  threshold: number;
}

export interface GraderOptions {
  /** Relevance threshold 0..1. Below this, corrective action triggers. */
  threshold?: number;
  /** Minimum fraction of chunks that must be relevant to avoid correction. */
  minRelevantRatio?: number;
}

// ─── BM25 lexical scorer: canonical implementation in @gentle-vanguard/shared ─

// ─── Normalize a raw BM25 score to 0..1 ───────────────────────────────────────

function normalizeScore(raw: number, maxRaw: number): number {
  if (maxRaw <= 0) return 0;
  return Math.min(raw / maxRaw, 1);
}

// ─── Core grader ──────────────────────────────────────────────────────────────

export function gradeRetrieval(
  query: string,
  chunks: string[],
  options: GraderOptions = {},
): GradeResult {
  const threshold = options.threshold ?? 0.4;
  const minRelevantRatio = options.minRelevantRatio ?? 0.5;

  const rawScores = chunks.map((c) => bm25Score(query, c));
  const maxRaw = Math.max(...rawScores, 0);

  const graded: GradedChunk[] = chunks.map((text, i) => {
    const score = normalizeScore(rawScores[i], maxRaw);
    return { index: i, text, score, relevant: score >= threshold };
  });

  const relevantCount = graded.filter((g) => g.relevant).length;
  const averageScore =
    graded.length > 0 ? graded.reduce((a, g) => a + g.score, 0) / graded.length : 0;
  const relevantRatio = graded.length > 0 ? relevantCount / graded.length : 0;

  const needsCorrection = relevantRatio < minRelevantRatio || averageScore < threshold;
  const verdict: 'relevant' | 'corrective' = needsCorrection ? 'corrective' : 'relevant';

  return {
    query,
    chunks: graded,
    averageScore,
    relevantCount,
    totalCount: chunks.length,
    verdict,
    correctiveAction: needsCorrection ? 'keyword-fallback' : 'none',
    threshold,
  };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

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
    const p = join(process.cwd(), file);
    if (existsSync(p)) chunksRaw = readFileSync(p, 'utf-8');
  }

  if (!query || !chunksRaw) {
    console.error(
      'Usage: npx tsx src/retrieval/retrieval-grader.ts --query "..." --chunks \'["...","..."]\' [--file path]',
    );
    process.exit(1);
  }

  let chunks: string[];
  try {
    chunks = JSON.parse(chunksRaw);
  } catch {
    chunks = chunksRaw.split('\n').filter((l) => l.trim());
  }

  const result = gradeRetrieval(query, chunks);
  console.log(
    JSON.stringify(
      {
        verdict: result.verdict,
        averageScore: result.averageScore.toFixed(3),
        relevantCount: result.relevantCount,
        totalCount: result.totalCount,
        correctiveAction: result.correctiveAction,
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
