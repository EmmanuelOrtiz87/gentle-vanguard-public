import {
  CONTRACTION_MAP,
  DISCOURSE_ADVERBS,
  GENERIC_PHRASES,
  HEDGES,
  PASSIVE_RE,
  PERSONAL_MARKERS,
  TRANSITION_WORDS,
  type Tone,
} from './data.js';

export interface TextMetrics {
  wordCount: number;
  sentenceCount: number;
  avgSentenceLength: number;
  sentenceLengthStdDev: number;
  sentenceLengthCv: number;
  adverbCount: number;
  adverbPerSentence: number;
  discourseAdverbCount: number;
  passiveCount: number;
  contractionCount: number;
  contractionPer100: number;
  genericPhraseCount: number;
  transitionTotal: number;
  uniqueTransitions: number;
  transitionVariety: number;
  personalMarkerCount: number;
  hedgingCount: number;
  emDashCount: number;
  semicolonCount: number;
  questionCount: number;
  typeTokenRatio: number;
  interjectionCount: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const clamp = (n: number, min: number, max: number): number =>
  Math.min(Math.max(n, min), max);

export const round = (n: number, digits = 3): number => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

export const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

export function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  const variance = mean(values.map((v) => (v - m) ** 2));
  return Math.sqrt(variance);
}

// ─── Code masking ─────────────────────────────────────────────────────────────

export interface MaskedText {
  masked: string;
  segments: Map<string, string>;
}

export function maskCode(text: string): MaskedText {
  const segments = new Map<string, string>();
  let index = 0;
  const masked = text.replace(/```[\s\S]*?```|`[^`\n]+`/g, (match) => {
    const token = `«GV_CODE_${index++}»`;
    segments.set(token, match);
    return token;
  });
  return { masked, segments };
}

export function restoreCode(masked: MaskedText): string {
  let out = masked.masked;
  for (const [token, original] of masked.segments) {
    out = out.split(token).join(original);
  }
  return out;
}

// ─── Sentence helpers ─────────────────────────────────────────────────────────

export function splitSentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?])(?=\s+["'([{]?[A-Z0-9])/g);
  return parts
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => (s.endsWith('.') || s.endsWith('!') || s.endsWith('?') ? s : `${s}.`));
}

export function wordCount(text: string): number {
  const matches = text.match(/[\w'-]+/g);
  return matches ? matches.length : 0;
}

export function countMatches(text: string, re: RegExp): number {
  const matches = text.match(re);
  return matches ? matches.length : 0;
}

export function countContractions(text: string): number {
  let count = 0;
  for (const contraction of Object.values(CONTRACTION_MAP)) {
    const escaped = contraction.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = text.match(new RegExp(`\\b${escaped}\\b`, 'gi'));
    if (matches) count += matches.length;
  }
  return count;
}

export function computeMetrics(text: string): TextMetrics {
  const sentences = splitSentences(text);
  const lengths = sentences.map((s) => wordCount(s));
  const sentenceCount = sentences.length;
  const totalWords = wordCount(text);
  const avgSentenceLength = sentenceCount > 0 ? totalWords / sentenceCount : 0;
  const sentenceLengthStdDev = stdDev(lengths);
  const sentenceLengthCv = avgSentenceLength > 0 ? sentenceLengthStdDev / avgSentenceLength : 0;

  const adverbMatches = text.match(/[\w']+ly\b/g);
  const adverbCount = adverbMatches ? adverbMatches.length : 0;
  const discourseAdverbCount = adverbMatches
    ? adverbMatches.filter((a) =>
        (DISCOURSE_ADVERBS as readonly string[]).includes(a.toLowerCase()),
      ).length
    : 0;

  const passiveCount = countMatches(text, PASSIVE_RE);
  const contractionCount = countContractions(text);
  const contractionPer100 = totalWords > 0 ? (contractionCount / totalWords) * 100 : 0;

  const genericPhraseCount = GENERIC_PHRASES.reduce((acc, phrase) => {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return acc + countMatches(text, new RegExp(`\\b${escaped}\\b`, 'gi'));
  }, 0);

  const transitionCounts = new Map<string, number>();
  for (const transition of TRANSITION_WORDS) {
    const escaped = transition.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const n = countMatches(text, new RegExp(`\\b${escaped}\\b`, 'gi'));
    if (n > 0) transitionCounts.set(transition.toLowerCase(), n);
  }
  const transitionTotal = [...transitionCounts.values()].reduce((a, b) => a + b, 0);
  const uniqueTransitions = transitionCounts.size;
  const transitionVariety =
    transitionTotal > 3 ? uniqueTransitions / transitionTotal : uniqueTransitions > 0 ? 0.7 : 0;

  const personalMarkerCount = PERSONAL_MARKERS.reduce((acc, re) => acc + countMatches(text, re), 0);

  const hedgingCount = HEDGES.reduce((acc, hedge) => {
    const escaped = hedge.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return acc + countMatches(text, new RegExp(`\\b${escaped}\\b`, 'gi'));
  }, 0);

  const emDashCount = countMatches(text, /—|–/g);
  const semicolonCount = countMatches(text, /;/g);
  const questionCount = countMatches(text, /\?/g);

  const tokens = text.toLowerCase().match(/[\w'-]+/g) ?? [];
  const uniqueTokens = new Set(tokens);
  const typeTokenRatio = tokens.length > 0 ? uniqueTokens.size / tokens.length : 0;

  const interjectionCount = countMatches(
    text,
    /\b(well|hey|okay|right|honestly|actually|basically)\b/gi,
  );

  return {
    wordCount: totalWords,
    sentenceCount,
    avgSentenceLength,
    sentenceLengthStdDev,
    sentenceLengthCv,
    adverbCount,
    adverbPerSentence: sentenceCount > 0 ? adverbCount / sentenceCount : 0,
    discourseAdverbCount,
    passiveCount,
    contractionCount,
    contractionPer100,
    genericPhraseCount,
    transitionTotal,
    uniqueTransitions,
    transitionVariety,
    personalMarkerCount,
    hedgingCount,
    emDashCount,
    semicolonCount,
    questionCount,
    typeTokenRatio,
    interjectionCount,
  };
}

export function computeAiScore(m: TextMetrics): number {
  if (m.wordCount === 0) return 0;

  const burstinessScore = clamp(1 - m.sentenceLengthCv / 0.8, 0, 1);
  const genericScore = clamp(m.genericPhraseCount / 3, 0, 1);
  const adverbScore = clamp(m.adverbPerSentence / 1.5, 0, 1);
  const passiveScore = clamp(m.passiveCount / Math.max(m.sentenceCount * 0.8, 1), 0, 1);
  const transitionScore = clamp(m.transitionTotal / Math.max(m.sentenceCount * 0.5, 1), 0, 1);
  const contractionScore = clamp(1 - m.contractionPer100 / 8, 0, 1);
  const personalScore = clamp(1 - m.personalMarkerCount / Math.max(m.sentenceCount * 0.8, 1), 0, 1);
  const hedgeScore = clamp(1 - m.hedgingCount / Math.max(m.sentenceCount * 0.3, 1), 0, 1);
  const emDashScore = clamp(m.emDashCount / Math.max(m.sentenceCount * 0.6, 1), 0, 1);

  const score =
    burstinessScore * 0.22 +
    genericScore * 0.18 +
    contractionScore * 0.12 +
    transitionScore * 0.1 +
    adverbScore * 0.1 +
    personalScore * 0.1 +
    passiveScore * 0.08 +
    hedgeScore * 0.05 +
    emDashScore * 0.05;

  return clamp(score, 0, 1);
}

export function computeVariety(m: TextMetrics): number {
  if (m.wordCount === 0) return 0;
  const burstinessNorm = clamp(m.sentenceLengthCv / 0.8, 0, 1);
  const lengthSpread = clamp(m.sentenceLengthStdDev / 12, 0, 1);
  const variety = burstinessNorm * 0.5 + m.transitionVariety * 0.3 + lengthSpread * 0.2;
  return clamp(variety, 0, 1);
}

export function detectVoice(m: TextMetrics): Tone {
  if (m.wordCount === 0) return 'neutral';
  const formality =
    (m.transitionTotal / Math.max(m.sentenceCount, 1)) * 2 +
    (m.contractionPer100 < 2 ? 1 : 0) +
    (m.hedgingCount < 1 ? 0.5 : 0);
  const personal =
    m.personalMarkerCount / Math.max(m.sentenceCount, 1) +
    m.contractionPer100 / 10 +
    m.hedgingCount / Math.max(m.sentenceCount, 1);

  if (formality >= 1.2 && personal < 0.8) return 'professional';
  if (personal >= 1.2 && formality < 0.8) return 'conversational';
  if (m.hedgingCount / Math.max(m.sentenceCount, 1) >= 0.2 && m.contractionPer100 >= 4)
    return 'casual';
  if (formality > personal) return 'professional';
  return 'neutral';
}
