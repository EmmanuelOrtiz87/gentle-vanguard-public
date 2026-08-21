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
 *   npx tsx src/retrieval-grader.ts --query "..." --chunks '["...","..."]'
 *   npx tsx src/retrieval-grader.ts --query "..." --file chunks.json
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

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

// ─── BM25 lexical scorer (shared with structural-compression) ─────────────────

const BM25_K1 = 1.5;
const BM25_B = 0.75;
const BM25_IDF = Math.log(2);

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const re = /[A-Za-z0-9_]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) tokens.push(m[0].toLowerCase());
  return tokens;
}

function bm25Score(query: string, doc: string): number {
  if (!query || !doc) return 0;
  const qTokens = tokenize(query);
  const dTokens = tokenize(doc);
  if (qTokens.length === 0 || dTokens.length === 0) return 0;
  const docLen = dTokens.length;
  const avgDocLen = Math.max(docLen, 1);
  const freq = new Map<string, number>();
  for (const t of dTokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  let score = 0;
  for (const qt of qTokens) {
    const tf = freq.get(qt) ?? 0;
    if (tf === 0) continue;
    const denom = tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLen / avgDocLen));
    score += (tf / denom) * BM25_IDF;
  }
  return score;
}

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
      'Usage: npx tsx src/retrieval-grader.ts --query "..." --chunks \'["...","..."]\' [--file path]',
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
