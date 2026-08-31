import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { db as getDbSingleton } from '../../database/db';

// ─── Semantic Search Helpers (reused from skill-router) ──────────────────────

const SEM_STOP_WORDS = new Set([
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

export function semTokenize(text: string): string[] {
  if (!text) return [];
  const cleaned = text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ');
  return cleaned
    .split(/[\s-]+/)
    .filter((t) => t.length >= 2 && t.length <= 40 && !SEM_STOP_WORDS.has(t));
}

export function computeTfIdfVector(
  tokens: string[],
  vocab: string[],
  idf: Record<string, number>,
): Record<string, number> {
  const tf: Record<string, number> = {};
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
  const totalTerms = tokens.length || 1;
  const vec: Record<string, number> = {};
  for (const [term, count] of Object.entries(tf)) {
    if (vocab.indexOf(term) === -1) continue;
    const tfVal = Math.log10(1 + (count / totalTerms) * 100);
    const idfVal = idf[term] !== undefined ? idf[term] : 1.0;
    vec[term] = tfVal * idfVal;
  }
  let norm = 0;
  for (const v of Object.values(vec)) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) for (const t of Object.keys(vec)) vec[t] /= norm;
  return vec;
}

function cosineSim(a: Record<string, number>, b: Record<string, number>): number {
  let dot = 0;
  for (const [term, val] of Object.entries(a)) {
    if (b[term] !== undefined) dot += val * b[term];
  }
  return dot;
}

// Lazy-loaded embeddings index
let _semEmbeddings: { vocabulary: string[]; idf: Record<string, number> } | null = null;

export function getSemEmbeddings(): { vocabulary: string[]; idf: Record<string, number> } | null {
  if (!_semEmbeddings) {
    const embPath = join(
      resolve(process.env.GENTLE_VANGUARD_BASE_DIR ?? process.cwd()),
      '.atl',
      'skill-embeddings.json',
    );
    if (!existsSync(embPath)) return null;
    try {
      const data = JSON.parse(readFileSync(embPath, 'utf-8'));
      _semEmbeddings = { vocabulary: data.vocabulary, idf: data.idf };
    } catch {
      return null;
    }
  }
  return _semEmbeddings;
}

// Semantic similarity gate for cache hits. 0.9 (not 0.85) + a minimum token
// count: TF-IDF cosine with a small vocabulary biases short inputs to ~87%
// similarity, causing false-positive semantic hits (verified 2026-08-14).
const SEMANTIC_CACHE_THRESHOLD = 0.9;
const MIN_SEMANTIC_INPUT_TOKENS = 40;

/** Try to find a semantically similar cache entry when exact match fails */
export function semanticCacheLookup(
  input: string,
): { response: string; key: string; similarity: number } | null {
  const emb = getSemEmbeddings();
  if (!emb) return null;

  const tokens = semTokenize(input);
  // Short inputs are unreliable under cosine similarity (false-positive risk).
  if (tokens.length < MIN_SEMANTIC_INPUT_TOKENS) return null;

  const queryVec = computeTfIdfVector(tokens, emb.vocabulary, emb.idf);
  if (Object.keys(queryVec).length === 0) return null;

  try {
    const db = getDbSingleton();
    if (!db) return null;

    // Get all cache entries that have embeddings
    const rows = db
      .getDb()
      .prepare(
        `SELECT key, response, input_embedding FROM response_cache
       WHERE input_embedding IS NOT NULL AND input_embedding != '{}'
       AND (expires_at IS NULL OR expires_at > datetime('now'))`,
      )
      .all() as Array<{ key: string; response: string; input_embedding: string }>;

    let bestMatch: { key: string; response: string; similarity: number } | null = null;

    for (const row of rows) {
      try {
        const storedVec = JSON.parse(row.input_embedding) as Record<string, number>;
        const sim = cosineSim(queryVec, storedVec);
        if (sim > SEMANTIC_CACHE_THRESHOLD && (!bestMatch || sim > bestMatch.similarity)) {
          bestMatch = { key: row.key, response: row.response, similarity: sim };
        }
      } catch {
        /* skip unparseable embeddings */
      }
    }

    if (bestMatch) {
      // Record hit on the matched entry
      try {
        db.getDb()
          .prepare('UPDATE response_cache SET hit_count = hit_count + 1 WHERE key = ?')
          .run(bestMatch.key);
      } catch {
        /* ignore */
      }
    }

    return bestMatch;
  } catch {
    return null;
  }
}
