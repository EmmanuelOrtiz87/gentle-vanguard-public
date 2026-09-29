/**
 * BM25 lexical scorer — THE canonical implementation for the stack.
 *
 * Reconciles the two drifted copies that previously lived in
 * src/retrieval-grader.ts and src/structural-compression.ts:
 *   - base algorithm identical in both: k1=1.5, b=0.75, idf=ln(2),
 *     avgDocLen pinned to docLen (single-doc scoring).
 *   - structural-compression added a +0.3 long-token bonus and a score cap
 *     of 10 (ported from headroom bm25.rs) — preserved here as options so
 *     each caller keeps its historical behavior while sharing one code path.
 */

export interface Bm25Options {
  /** Bonus added per matching query token with >= this many chars. 0 disables. */
  longTokenBonus?: number;
  /** Minimum query-token length (in chars) eligible for the bonus. Default 8. */
  longTokenMinLength?: number;
  /** Cap on the final score. Default: uncapped. */
  maxScore?: number;
}

export const BM25_DEFAULTS: Required<Bm25Options> = {
  longTokenBonus: 0,
  longTokenMinLength: 8,
  maxScore: Number.POSITIVE_INFINITY,
};

const K1 = 1.5;
const B = 0.75;
const IDF = Math.log(2);

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const re = /[A-Za-z0-9_]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) tokens.push(m[0].toLowerCase());
  return tokens;
}

export function bm25Score(query: string, doc: string, options: Bm25Options = {}): number {
  const { longTokenBonus, longTokenMinLength, maxScore } = { ...BM25_DEFAULTS, ...options };
  if (!query || !doc) return 0;
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return 0;
  const dTokens = tokenize(doc);
  if (dTokens.length === 0) return 0;

  const docLen = dTokens.length;
  const avgDocLen = Math.max(docLen, 1);
  const freq = new Map<string, number>();
  for (const t of dTokens) freq.set(t, (freq.get(t) ?? 0) + 1);

  let score = 0;
  for (const qt of qTokens) {
    const tf = freq.get(qt) ?? 0;
    if (tf === 0) continue;
    const denom = tf + K1 * (1 - B + B * (docLen / avgDocLen));
    let s = (tf / denom) * IDF;
    if (longTokenBonus > 0 && qt.length >= longTokenMinLength) s += longTokenBonus;
    score += s;
  }
  return Math.min(score, maxScore);
}
