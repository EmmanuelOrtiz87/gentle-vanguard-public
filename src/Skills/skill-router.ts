#!/usr/bin/env node
/**
 * Semantic Skill Router — TF-IDF cosine similarity against .atl/skill-embeddings.json.
 * Replaces hardcoded SKILL_KEYWORDS with dynamic semantic search across 419 skills.
 *
 * Usage:
 *   npx tsx src/skills/skill-router.ts --query "docker deployment kubernetes"
 *   npx tsx src/skills/skill-router.ts --query "react component design" --top-k 10
 */

import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

// ---- Types ----

interface EmbeddingsIndex {
  version: string;
  generated: string;
  metadata: { totalSkills: number; vocabularySize: number; ngramSize: number };
  vocabulary: string[];
  idf: Record<string, number>;
  skills: Array<{
    name: string;
    agent: string;
    triggers: string[];
    vector: Record<string, number>;
    charNgrams: string[];
  }>;
}

interface MatchResult {
  skill: string;
  agent: string;
  confidence: number;
  triggers: string[];
}

// ---- Stop Words (matches skill-embedder.ts) ----

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

// ---- Tokenizer (identical to skill-embedder.ts) ----

function tokenize(text: string): string[] {
  if (!text) return [];
  const cleaned = text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ');
  const parts = cleaned.split(/[\s-]+/).filter((t) => t.length >= 2 && t.length <= 40);
  return parts.filter((t) => !STOP_WORDS.has(t));
}

// ---- Embeddings loader (lazy singleton) ----

let _embeddings: EmbeddingsIndex | null = null;

function getEmbeddings(): EmbeddingsIndex {
  if (!_embeddings) {
    const embPath = join(
      resolve(process.env.GENTLE_VANGUARD_BASE_DIR ?? process.cwd()),
      '.atl',
      'skill-embeddings.json',
    );
    if (!existsSync(embPath)) {
      throw new Error(
        `Embeddings not found at ${embPath}. Run 'npx tsx src/skills/skill-embedder.ts' first.`,
      );
    }
    _embeddings = JSON.parse(readFileSync(embPath, 'utf-8')) as EmbeddingsIndex;
  }
  return _embeddings;
}

// ---- Query vector computation ----

function computeQueryVector(
  tokens: string[],
  vocab: string[],
  idf: Record<string, number>,
): Record<string, number> {
  const tf: Record<string, number> = {};
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;

  const totalTerms = tokens.length || 1;
  const vec: Record<string, number> = {};

  for (const [term, count] of Object.entries(tf)) {
    const idx = vocab.indexOf(term);
    if (idx === -1) continue; // term not in vocabulary
    const tfVal = Math.log10(1 + (count / totalTerms) * 100);
    const idfVal = idf[term] !== undefined ? idf[term] : 1.0;
    vec[term] = tfVal * idfVal;
  }

  // L2 normalize
  let norm = 0;
  for (const v of Object.values(vec)) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (const t of Object.keys(vec)) vec[t] /= norm;
  }

  return vec;
}

// ---- Cosine similarity (dot product of L2-normalized vectors) ----

function cosineSimilarity(
  queryVec: Record<string, number>,
  skillVec: Record<string, number>,
): number {
  let dot = 0;
  // Iterate over the smaller vector (usually queryVec)
  for (const [term, qv] of Object.entries(queryVec)) {
    const sv = skillVec[term];
    if (sv !== undefined) dot += qv * sv;
  }
  return dot;
}

// ---- Fallback: fuzzy keyword matching ----

const FUZZY_KEYWORDS: Record<string, string[]> = {
  angular: ['angular-core', 'angular-spa', 'angular-architecture'],
  react: ['react-19', 'react-19-skill'],
  go: ['golang-api', 'go-api', 'go-testing'],
  docker: ['docker-devops'],
  git: ['git-workflow'],
  security: ['security-skill'],
  test: ['testing-skill', 'testing-strategy'],
  typescript: ['typescript', 'typescript-skill'],
  zod: ['zod-4', 'zod-4-skill'],
  tailwind: ['tailwind-4', 'tailwind-4-skill'],
  zustand: ['zustand-5', 'zustand-5-skill'],
  next: ['nextjs-15', 'nextjs-15-skill'],
  ai: ['ai-sdk-5', 'ai-sdk-5-skill'],
  mcp: ['mcp-skill'],
  nexus: ['nexus-database'],
};

function fuzzyFallback(query: string): string[] {
  const q = query.toLowerCase();
  const matched = new Set<string>();
  for (const [keyword, skills] of Object.entries(FUZZY_KEYWORDS)) {
    if (q.includes(keyword)) {
      for (const s of skills) matched.add(s);
    }
  }
  // Second pass: partial match
  if (matched.size === 0) {
    for (const [keyword, skills] of Object.entries(FUZZY_KEYWORDS)) {
      if (keyword.includes(q) || q.includes(keyword)) {
        for (const s of skills) matched.add(s);
      }
    }
  }
  return [...matched];
}

// ---- Main search function ----

function findRelevantSkills(query: string, topK: number = 5): MatchResult[] {
  const emb = getEmbeddings();
  const tokens = tokenize(query);

  if (tokens.length === 0) {
    // No meaningful tokens — try fuzzy fallback
    const fuzzy = fuzzyFallback(query);
    return fuzzy.map((s) => ({
      skill: s,
      agent: 'unknown',
      confidence: 0.1,
      triggers: [],
    }));
  }

  const queryVec = computeQueryVector(tokens, emb.vocabulary, emb.idf);

  // Score all skills
  const scored: MatchResult[] = [];
  for (const skill of emb.skills) {
    const sim = cosineSimilarity(queryVec, skill.vector);
    if (sim > 0) {
      scored.push({
        skill: skill.name,
        agent: skill.agent,
        confidence: Math.round(sim * 1000) / 1000,
        triggers: skill.triggers,
      });
    }
  }

  // Sort by descending confidence
  scored.sort((a, b) => b.confidence - a.confidence);

  const topResults = scored.slice(0, topK);

  // If top result has very low confidence, supplement with fuzzy fallback
  if (topResults.length === 0 || topResults[0].confidence < 0.05) {
    const fuzzy = fuzzyFallback(query);
    const known = new Set(topResults.map((r) => r.skill));
    for (const f of fuzzy) {
      if (!known.has(f)) {
        topResults.push({ skill: f, agent: 'unknown', confidence: 0.05, triggers: [] });
      }
    }
  }

  return topResults;
}

// ---- CLI entry point ----

function main(): void {
  const args = process.argv.slice(2);
  const queryIdx =
    args.indexOf('--query') !== -1
      ? args.indexOf('--query') + 1
      : args.indexOf('-Query') !== -1
        ? args.indexOf('-Query') + 1
        : -1;
  const query = queryIdx >= 0 ? args[queryIdx] : '';
  const topKIdx = args.indexOf('--top-k');
  const topK = topKIdx >= 0 ? parseInt(args[topKIdx + 1] ?? '5', 10) : 5;
  const jsonFlag = args.includes('--json') || args.includes('-Json');

  if (!query) {
    console.error('SKILL-ROUTER: --query is required');
    process.exit(1);
  }

  try {
    const results = findRelevantSkills(query, topK);

    if (jsonFlag) {
      console.log(
        JSON.stringify(
          {
            Status: results.length > 0 ? 'Routed' : 'NoMatch',
            Skills: results.map((r) => r.skill),
            Agents: [...new Set(results.map((r) => r.agent))],
            Query: query,
            Matches: results,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (results.length > 0) {
      console.log(`SKILL-ROUTER: Found ${results.length} matching skill(s) for "${query}"`);
      for (const r of results) {
        const bar = confidenceBar(r.confidence);
        console.log(
          `  ${bar} ${r.skill} (agent: ${r.agent}, confidence: ${(r.confidence * 100).toFixed(1)}%)`,
        );
      }
      console.log(
        JSON.stringify({
          Status: 'Routed',
          Skills: results.map((r) => r.skill),
          Query: query,
        }),
      );
    } else {
      console.log(`SKILL-ROUTER: No skills matched for "${query}"`);
      console.log(JSON.stringify({ Status: 'NoMatch', Skills: [], Query: query }));
    }
  } catch (err) {
    // Fallback to fuzzy if embeddings not available
    console.error(
      `SKILL-ROUTER: Embeddings unavailable (${err instanceof Error ? err.message : String(err)}), using fuzzy fallback`,
    );
    const fuzzy = fuzzyFallback(query);
    if (fuzzy.length > 0) {
      console.log(`SKILL-ROUTER: Found ${fuzzy.length} matching skill(s) via fuzzy fallback`);
      for (const s of fuzzy) console.log(`  - ${s}`);
      console.log(JSON.stringify({ Status: 'Routed', Skills: fuzzy, Query: query }));
    } else {
      console.log('SKILL-ROUTER: No skills matched');
      console.log(JSON.stringify({ Status: 'NoMatch', Skills: [], Query: query }));
    }
  }
}

function confidenceBar(confidence: number): string {
  const bars = Math.round(confidence * 10);
  return '█'.repeat(Math.min(bars, 10)) + '░'.repeat(Math.max(10 - bars, 0));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

// Export for programmatic use
export { findRelevantSkills, tokenize, computeQueryVector, cosineSimilarity, fuzzyFallback };
