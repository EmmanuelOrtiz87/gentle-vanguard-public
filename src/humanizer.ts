#!/usr/bin/env node
/**
 * Humanizer — AI-writing detection + natural-language transformation engine.
 *
 * Absorbed as native TS from the "Humanizer" skill concept. Detects the
 * statistical and stylistic markers that make prose read as machine-generated
 * (uniform sentence length, formal transition padding, discourse-adverb
 * overuse, filler phrases, perfect grammar, missing personal voice) and
 * rewrites it to sound like a person wrote it.
 *
 * Detection is heuristic (regex + statistics, no ML):
 *   - Burstiness (sentence-length coefficient of variation) — low = AI
 *   - Generic AI filler phrases ("In conclusion", "it's important to note")
 *   - Discourse-adverb density ("additionally", "crucially", "moreover")
 *   - Passive-voice frequency
 *   - Contraction rate (humans contract; AI rarely does)
 *   - Personal-voice markers ("I", "we", "you", "my") and natural hedges
 *   - Transition-word variety (AI repeats the same formal connectors)
 *   - Em-dash / semicolon overuse
 *   - Type-token ratio (vocabulary diversity)
 *
 * Transformation is deterministic and meaning-preserving. Code blocks and
 * inline code are masked out and never rewritten, so technical accuracy is
 * retained. Tone controls how aggressively informal markers and contractions
 * are applied.
 *
 * CLI lives in src/humanizer-cli.ts:
 *   npx tsx src/humanizer-cli.ts analyze --text "The system ..."
 *   npx tsx src/humanizer-cli.ts transform --file ./docs/readme.md --tone professional
 *   npx tsx src/humanizer-cli.ts score --file ./content/blog-post.md
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type Tone = 'professional' | 'neutral' | 'conversational' | 'casual';

export interface HumanizeOptions {
  /** Target register. Defaults to 'conversational'. */
  tone?: Tone;
  /** 0..1 — how aggressively to apply transformations. Default 0.6. */
  intensity?: number;
  /** Protect fenced code blocks and inline code from rewriting. Default true. */
  preserveCode?: boolean;
}

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

export interface PatternMatch {
  pattern: string;
  matches: string[];
  count: number;
}

export interface AnalysisResult {
  aiScore: number;
  naturalness: number;
  variety: number;
  voice: Tone;
  patterns: PatternMatch[];
  metrics: TextMetrics;
}

export interface HumanizationScore {
  aiScore: number;
  naturalness: number;
  variety: number;
  voice: Tone;
  suggestions: string[];
  transformations: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const clamp = (n: number, min: number, max: number): number => Math.min(Math.max(n, min), max);

const round = (n: number, digits = 3): number => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  const variance = mean(values.map((v) => (v - m) ** 2));
  return Math.sqrt(variance);
}

// ─── Detection vocabularies ───────────────────────────────────────────────────

/** Generic, low-information AI filler phrases (multi-word). */
const GENERIC_PHRASES = [
  'in conclusion',
  'to conclude',
  'in summary',
  'to sum up',
  "it's important to note",
  'it is important to note',
  "it's worth noting",
  'it is worth noting',
  "in today's fast-paced world",
  'in the ever-evolving',
  'in the world of',
  'in the realm of',
  'when it comes to',
  'as we all know',
  'plays a crucial role',
  'plays a vital role',
  'plays an important role',
  'plays a key role',
  'delve into',
  'at the end of the day',
  'in this article',
  'in this blog post',
  'in this guide',
  'by the same token',
  'it goes without saying',
  'needless to say',
  'it is essential to',
  "it's essential to",
  'it is crucial to',
  "it's crucial to",
  'it is imperative to',
  'in order to',
  'in order for',
  'a wide range of',
  'unlock the full potential',
  'game changer',
  'seamless experience',
  'holistic approach',
  'navigate the complex',
  'state-of-the-art',
  'cutting-edge',
  'delve',
  'tapestry',
  'landscape',
  'elevate',
  'leverage',
  'streamline',
  'revolutionize',
] as const;

/** Discourse adverbs — the flavour of text that over-uses them reads as AI. */
const DISCOURSE_ADVERBS = [
  'additionally',
  'importantly',
  'crucially',
  'significantly',
  'essentially',
  'fundamentally',
  'ultimately',
  'interestingly',
  'notably',
  'particularly',
  'remarkably',
  'undoubtedly',
  'similarly',
  'conversely',
  'moreover',
  'furthermore',
  'consequently',
  'subsequently',
  'meanwhile',
  'hence',
  'therefore',
  'thus',
  'accordingly',
  'surprisingly',
  'unexpectedly',
  'increasingly',
  'inevitably',
  'inherently',
  'necessarily',
  'arguably',
  'theoretically',
  'virtually',
  'literally',
  'seamlessly',
  'effectively',
] as const;

// NOTE: ALL_ADVERBS unused - kept for future expanded adverb detection
// const ALL_ADVERBS = [
//   ...DISCOURSE_ADVERBS,
//   'extremely', ... additional adverbs
// ] as const;

/** Formal connectors that AI overuses at sentence starts. */
const FORMAL_TRANSITIONS = [
  'furthermore',
  'moreover',
  'additionally',
  'consequently',
  'subsequently',
  'nevertheless',
  'nonetheless',
  'therefore',
  'thus',
  'accordingly',
  'in addition',
  'in conclusion',
  'in summary',
  'meanwhile',
  'prior to',
  'subsequent to',
  'in order to',
] as const;

/** Natural transitions (formal + plain) used to measure variety. */
const TRANSITION_WORDS = [
  ...FORMAL_TRANSITIONS,
  'and',
  'but',
  'so',
  'then',
  'yet',
  'while',
  'although',
  'though',
  'because',
  'since',
  'despite',
  'however',
  'besides',
  'plus',
  'as a result',
  'even so',
  'for example',
  'for instance',
  'afterward',
  'later',
] as const;

/** Natural human hedging — its absence is an AI tell. */
const HEDGES = [
  'i think',
  'i believe',
  'in my experience',
  'to be honest',
  'honestly',
  'probably',
  'sort of',
  'kind of',
  'pretty much',
  'seems like',
  'seems to',
  'i guess',
  'i suppose',
  'maybe',
  'perhaps',
  'somewhat',
  'a bit',
  'a little',
  'as far as i know',
  'from my perspective',
  'if you ask me',
  "i'd say",
  'i would say',
  'frankly',
  'to my mind',
] as const;

/** First/second-person markers that signal a human voice. */
const PERSONAL_MARKERS = [
  /\bi\b/g,
  /\bwe\b/g,
  /\bmy\b/g,
  /\bour\b/g,
  /\bme\b/g,
  /\bus\b/g,
  /\byou\b/g,
  /\byour\b/g,
] as const;

/** Contractions — keyed by the phrase they expand, grouped by register tier. */
const CONTRACTION_MAP: Record<string, string> = {
  'do not': "don't",
  'does not': "doesn't",
  'did not': "didn't",
  'is not': "isn't",
  'are not': "aren't",
  'was not': "wasn't",
  'were not': "weren't",
  'will not': "won't",
  cannot: "can't",
  'can not': "can't",
  'could not': "couldn't",
  'should not': "shouldn't",
  'would not': "wouldn't",
  'must not': "mustn't",
  'have not': "haven't",
  'has not': "hasn't",
  'had not': "hadn't",
  'it is': "it's",
  'that is': "that's",
  'there is': "there's",
  'we are': "we're",
  'you are': "you're",
  'they are': "they're",
  'I am': "I'm",
  'I have': "I've",
  'we have': "we've",
  'they have': "they've",
  'you have': "you've",
  'let us': "let's",
  'I will': "I'll",
  'we will': "we'll",
  'you will': "you'll",
  'they will': "they'll",
  'it will': "it'll",
  'that will': "that'll",
  'would have': "would've",
  'should have': "should've",
  'could have': "could've",
  'might have': "might've",
} as const;

/** Which contractions each register allows. */
const TONE_CONTRACTION_PHRASES: Record<Tone, string[]> = {
  professional: ['it is', 'that is', 'do not', 'will not', 'cannot'],
  neutral: [
    'it is',
    'that is',
    'there is',
    'do not',
    'does not',
    'did not',
    'is not',
    'are not',
    'was not',
    'were not',
    'will not',
    'cannot',
    'have not',
    'has not',
    'I am',
    'we are',
    'you are',
    'they are',
    'let us',
  ],
  conversational: Object.keys(CONTRACTION_MAP),
  casual: Object.keys(CONTRACTION_MAP),
};

/** Low-information filler phrases with register-appropriate replacements. */
const FILLER_REPLACEMENTS: Record<string, readonly [string, string, string, string]> = {
  'it is important to note that': ['Note that', 'Note that', 'Worth noting:', 'Heads up:'],
  "it's important to note that": ['Note that', 'Note that', 'Worth noting:', 'Heads up:'],
  'it is worth noting that': ['Note that', 'Worth noting:', 'Worth noting:', 'By the way,'],
  'in conclusion': ['Finally', 'To sum up', 'To wrap up', 'So, long story short'],
  'to conclude': ['Finally', 'To wrap up', 'Alright', 'Alright,'],
  'in summary': ['In short', 'In short', 'Long story short', 'Long story short'],
  "in today's fast-paced world": ['Today', 'These days', 'These days', 'These days'],
  'in the world of': ['in', 'in', 'in', 'in'],
  'in the realm of': ['in', 'in', 'in', 'in'],
  'when it comes to': ['for', 'for', 'for', 'for'],
  'as we all know': ['Of course', 'You know', 'You know', 'We all know'],
  'plays a crucial role in': ['is key to', 'is key to', 'matters a lot in', 'really matters in'],
  'plays a vital role in': ['is key to', 'is key to', 'matters a lot in', 'matters in'],
  'plays an important role in': ['is important in', 'is key to', 'matters in', 'matters in'],
  'plays a key role in': ['is key to', 'is key to', 'matters in', 'matters in'],
  'delve into': ['dig into', 'dig into', 'dig into', 'dig into'],
  'in this article': ['Here', 'Here', 'Here', 'Here'],
  'in this blog post': ['Here', 'Here', 'Here', 'Here'],
  'in this guide': ['Here', 'Here', 'Here', 'Here'],
  'it goes without saying that': ['Clearly', 'Clearly', 'Obviously', 'Obviously'],
  'needless to say': ['Of course', 'Of course', 'You guessed it', 'You guessed it'],
  'it is essential to': ['You need to', 'You need to', 'You should', 'You gotta'],
  "it's essential to": ['You need to', 'You need to', 'You should', 'You gotta'],
  'it is crucial to': ['You need to', 'You need to', 'You should', 'You should'],
  'in order to': ['to', 'to', 'to', 'to'],
  'in order for': ['for', 'for', 'for', 'for'],
  'a wide range of': ['a range of', 'plenty of', 'plenty of', 'loads of'],
  utilize: ['use', 'use', 'use', 'use'],
  commence: ['start', 'start', 'start', 'start'],
  terminate: ['end', 'end', 'end', 'end'],
  approximately: ['about', 'about', 'about', 'about'],
  facilitate: ['help with', 'help with', 'help with', 'help with'],
  'subsequent to': ['after', 'after', 'after', 'after'],
  'prior to': ['before', 'before', 'before', 'before'],
  aforementioned: ['earlier', 'earlier', 'earlier', 'earlier'],
} as const;

/** Register-appropriate alternatives used to avoid transition repetition. */
const TRANSITION_VARIETY: Record<string, readonly [string[], string[], string[], string[]]> = {
  furthermore: [
    ['moreover', 'additionally', 'in addition'],
    ['also', 'additionally', 'besides'],
    ['also', 'plus', 'and'],
    ['plus', 'and', 'and'],
  ],
  moreover: [
    ['furthermore', 'additionally', 'in addition'],
    ['also', 'besides', 'plus'],
    ['plus', 'and', 'and'],
    ['plus', 'and', 'and'],
  ],
  additionally: [
    ['moreover', 'furthermore', 'also'],
    ['also', 'besides', 'plus'],
    ['plus', 'also', 'and'],
    ['plus', 'and', 'and'],
  ],
  consequently: [
    ['therefore', 'thus', 'as a result'],
    ['as a result', 'so', 'therefore'],
    ['so', 'as a result', 'then'],
    ['so', 'then', 'so'],
  ],
  subsequently: [
    ['later', 'then', 'afterward'],
    ['later', 'then', 'afterward'],
    ['then', 'afterward', 'later'],
    ['then', 'later', 'after'],
  ],
  nevertheless: [
    ['nonetheless', 'however', 'still'],
    ['even so', 'still', 'however'],
    ['still', 'even so', 'but'],
    ['still', 'but', 'even so'],
  ],
  nonetheless: [
    ['nevertheless', 'however', 'still'],
    ['even so', 'still', 'but'],
    ['still', 'but', 'even so'],
    ['still', 'but', 'even so'],
  ],
  therefore: [
    ['thus', 'consequently', 'hence'],
    ['so', 'as a result', 'thus'],
    ['so', 'then', 'as a result'],
    ['so', 'so', 'then'],
  ],
  thus: [
    ['therefore', 'consequently', 'hence'],
    ['so', 'as a result', 'therefore'],
    ['so', 'then', 'so'],
    ['so', 'then', 'so'],
  ],
  accordingly: [
    ['therefore', 'consequently', 'thus'],
    ['so', 'as a result', 'thus'],
    ['so', 'then', 'so'],
    ['so', 'then', 'so'],
  ],
  'in addition': [
    ['moreover', 'furthermore', 'also'],
    ['also', 'besides', 'plus'],
    ['plus', 'also', 'and'],
    ['plus', 'and', 'and'],
  ],
  meanwhile: [
    ['in the meantime', 'at the same time', 'while'],
    ['in the meantime', 'while', 'at the same time'],
    ['while', 'in the meantime', 'so'],
    ['while', 'in the meantime', 'so'],
  ],
  'in conclusion': [
    ['finally', 'to conclude', 'ultimately'],
    ['finally', 'to wrap up', 'in the end'],
    ['to wrap up', 'finally', 'in the end'],
    ['so, long story short', 'to wrap up', 'anyway'],
  ],
} as const;

/** Sentence-initial discourse adverbs → human conversational openers. */
const SENTENCE_INITIAL_ADVERBS: Record<string, readonly [string, string]> = {
  additionally: ['Also', 'Plus'],
  moreover: ['Also', 'Plus'],
  furthermore: ['Also', 'And'],
  however: ['That said', 'But'],
  therefore: ['So', 'So'],
  thus: ['So', 'So'],
  consequently: ['So', 'So'],
  nevertheless: ['Even so', 'Still'],
  nonetheless: ['Still', 'Still'],
  importantly: ['Worth noting', 'Worth noting'],
  notably: ['Worth noting', 'Worth noting'],
  interestingly: ['Funny enough', 'Funny enough'],
  ultimately: ['In the end', 'In the end'],
  meanwhile: ['In the meantime', 'In the meantime'],
  surprisingly: ['Believe it or not', 'Believe it or not'],
  'in addition': ['Also', 'Plus'],
} as const;

// ─── Code masking ─────────────────────────────────────────────────────────────

interface MaskedText {
  masked: string;
  segments: Map<string, string>;
}

function maskCode(text: string): MaskedText {
  const segments = new Map<string, string>();
  let index = 0;
  const masked = text.replace(/```[\s\S]*?```|`[^`\n]+`/g, (match) => {
    const token = `«GV_CODE_${index++}»`;
    segments.set(token, match);
    return token;
  });
  return { masked, segments };
}

function restoreCode(masked: MaskedText): string {
  let out = masked.masked;
  for (const [token, original] of masked.segments) {
    out = out.split(token).join(original);
  }
  return out;
}

// ─── Sentence helpers ─────────────────────────────────────────────────────────

function splitSentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?])(?=\s+["'([{]?[A-Z0-9])/g);
  return parts
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => (s.endsWith('.') || s.endsWith('!') || s.endsWith('?') ? s : `${s}.`));
}

function wordCount(text: string): number {
  const matches = text.match(/[\w'-]+/g);
  return matches ? matches.length : 0;
}

function countMatches(text: string, re: RegExp): number {
  const matches = text.match(re);
  return matches ? matches.length : 0;
}

// ─── Passive-voice helpers ────────────────────────────────────────────────────

const PASSIVE_RE =
  /\b(was|were|is|are|will be|has been|have been|had been|being|be)\s+[a-z]+(?:ed|en|t)\b/gi;

const IRREGULAR_PAST: Record<string, string> = {
  written: 'wrote',
  made: 'made',
  built: 'built',
  given: 'gave',
  taken: 'took',
  done: 'did',
  seen: 'saw',
  told: 'told',
  shown: 'showed',
  kept: 'kept',
  held: 'held',
  found: 'found',
  brought: 'brought',
  bought: 'bought',
  sent: 'sent',
  sold: 'sold',
  set: 'set',
  put: 'put',
  run: 'ran',
  begun: 'begun',
  chosen: 'chose',
  spoken: 'spoke',
  broken: 'broke',
  driven: 'drove',
  known: 'knew',
  thrown: 'threw',
  grown: 'grew',
  become: 'became',
  come: 'came',
  fallen: 'fell',
  felt: 'felt',
  forgotten: 'forgot',
  gotten: 'got',
  heard: 'heard',
  left: 'left',
  lost: 'lost',
  met: 'met',
  paid: 'paid',
  read: 'read',
  said: 'said',
};

function activeVerb(pastParticiple: string): string {
  return IRREGULAR_PAST[pastParticiple.toLowerCase()] ?? pastParticiple;
}

function objectCase(subject: string): string {
  const trimmed = subject.trim();
  const lower = trimmed[0]?.toLowerCase() ?? '';
  if (/^(The|A|An)\s/.test(trimmed)) {
    return trimmed
      .replace(/^The\s/i, 'the ')
      .replace(/^A\s/i, 'a ')
      .replace(/^An\s/i, 'an ');
  }
  if (/^(It|This|That|These|Those)\b/i.test(trimmed)) return lower + trimmed.slice(1);
  return trimmed;
}

// Safer passive detection - avoid complex nested quantifiers
const PASSIVE_BY_RE =
  // eslint-disable-next-line security/detect-unsafe-regex
  /\b((?:the|a|an|this|that|these|those|my|our|your|their|its)\s+[a-z][\w-]*|(?:it|this|that|these|those))\s+(was|were|is|are)\s+(\w+(?:ed|en|t))\s+by\s+([a-z][\w-]*(?:\s+[a-z][\w-]*)?)/gi;

// ─── Analysis ─────────────────────────────────────────────────────────────────

function buildPatterns(text: string): PatternMatch[] {
  const patterns: PatternMatch[] = [];

  const genericMatches: string[] = [];
  for (const phrase of GENERIC_PHRASES) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = text.match(new RegExp(`\\b${escaped}\\b`, 'gi'));
    if (matches && matches.length > 0) genericMatches.push(...matches);
  }
  if (genericMatches.length > 0) {
    patterns.push({
      pattern: 'generic-phrases',
      matches: genericMatches,
      count: genericMatches.length,
    });
  }

  const adverbMatches = text.match(/[\w']+ly\b/g);
  if (adverbMatches) {
    const discourse = adverbMatches.filter((a) =>
      (DISCOURSE_ADVERBS as readonly string[]).includes(a.toLowerCase()),
    );
    patterns.push({
      pattern: 'adverb-usage',
      matches: adverbMatches,
      count: adverbMatches.length,
    });
    if (discourse.length > 0) {
      patterns.push({ pattern: 'discourse-adverbs', matches: discourse, count: discourse.length });
    }
  }

  const passiveMatches = text.match(PASSIVE_RE);
  if (passiveMatches) {
    patterns.push({
      pattern: 'passive-voice',
      matches: passiveMatches,
      count: passiveMatches.length,
    });
  }

  const contractionCount = countContractions(text);

  const transitionCounts = new Map<string, number>();
  for (const transition of TRANSITION_WORDS) {
    const escaped = transition.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = text.match(new RegExp(`\\b${escaped}\\b`, 'gi'));
    if (matches && matches.length > 0)
      transitionCounts.set(transition.toLowerCase(), matches.length);
  }
  if (transitionCounts.size > 0) {
    const total = [...transitionCounts.values()].reduce((a, b) => a + b, 0);
    if (total > 3) {
      patterns.push({
        pattern: 'transition-repetition',
        matches: [...transitionCounts.entries()].filter(([, c]) => c > 1).map(([t]) => t),
        count: total,
      });
    }
  }

  if (contractionCount < 2) {
    patterns.push({ pattern: 'missing-contractions', matches: [], count: contractionCount });
  }

  const personalCount = PERSONAL_MARKERS.reduce((acc, re) => acc + countMatches(text, re), 0);
  if (personalCount < 2) {
    patterns.push({ pattern: 'missing-personal-voice', matches: [], count: personalCount });
  }

  const emDashCount = countMatches(text, /—|–/g);
  if (emDashCount >= 3) {
    patterns.push({ pattern: 'em-dash-overuse', matches: [], count: emDashCount });
  }

  return patterns;
}

function countContractions(text: string): number {
  let count = 0;
  for (const contraction of Object.values(CONTRACTION_MAP)) {
    const escaped = contraction.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = text.match(new RegExp(`\\b${escaped}\\b`, 'gi'));
    if (matches) count += matches.length;
  }
  return count;
}

function computeMetrics(text: string): TextMetrics {
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

function computeAiScore(m: TextMetrics): number {
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

function computeVariety(m: TextMetrics): number {
  if (m.wordCount === 0) return 0;
  const burstinessNorm = clamp(m.sentenceLengthCv / 0.8, 0, 1);
  const lengthSpread = clamp(m.sentenceLengthStdDev / 12, 0, 1);
  const variety = burstinessNorm * 0.5 + m.transitionVariety * 0.3 + lengthSpread * 0.2;
  return clamp(variety, 0, 1);
}

function detectVoice(m: TextMetrics): Tone {
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

export function analyzeText(text: string): AnalysisResult {
  const masked = maskCode(text).masked;
  const metrics = computeMetrics(masked);
  const patterns = buildPatterns(masked);
  const aiScore = computeAiScore(metrics);
  return {
    aiScore,
    naturalness: 1 - aiScore,
    variety: computeVariety(metrics),
    voice: detectVoice(metrics),
    patterns,
    metrics,
  };
}

// ─── Transformation ───────────────────────────────────────────────────────────

const TONE_INDEX: Record<Tone, number> = {
  professional: 0,
  neutral: 1,
  conversational: 2,
  casual: 3,
};

function replacePhrases(
  text: string,
  map: Record<string, readonly [string, string, string, string]>,
  tone: Tone,
): string {
  const toneIndex = TONE_INDEX[tone];
  let out = text;
  for (const [phrase, alternatives] of Object.entries(map)) {
    const replacement = alternatives[toneIndex];
    if (replacement === phrase) continue;
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), () => replacement);
  }
  return out;
}

function varyTransitions(text: string, tone: Tone): string {
  const toneIndex = TONE_INDEX[tone];
  let out = text;
  for (const [transition, pools] of Object.entries(TRANSITION_VARIETY)) {
    const escaped = transition.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'gi');
    const matches = text.match(re);
    if (!matches || matches.length <= 1) continue;
    const pool = pools[toneIndex];
    const replaced = text.replace(re, (match, offset: number) => {
      const preceding = text.slice(0, offset);
      const occurrence = (preceding.match(re) ?? []).length;
      if (occurrence === 0) return match;
      return pool[(occurrence - 1) % pool.length];
    });
    out = replaced;
    text = replaced;
  }
  return out;
}

function convertPassiveToActive(text: string, intensity: number): string {
  if (intensity <= 0) return text;
  return text.replace(
    PASSIVE_BY_RE,
    (fullMatch, subject: string, _aux: string, participle: string, agent: string) => {
      const agentFirst = agent.trim().split(/\s+/)[0] ?? '';
      const hasDeterminer = /^(the|a|an|this|that|these|those|my|our|your|their|its)$/i.test(
        agentFirst,
      );
      const properNoun = agentFirst.length > 0 && agentFirst[0] === agentFirst[0].toUpperCase();
      // Skip "by design", "by default", etc. where the "by" phrase is adverbial.
      if (!hasDeterminer && !properNoun) return fullMatch;
      const verb = activeVerb(participle);
      const agentCapitalized = agent.charAt(0).toUpperCase() + agent.slice(1);
      return `${agentCapitalized} ${verb} ${objectCase(subject)}`;
    },
  );
}

function applyContractions(text: string, tone: Tone): string {
  const allowed = TONE_CONTRACTION_PHRASES[tone];
  let out = text;
  for (const phrase of allowed) {
    const contraction = CONTRACTION_MAP[phrase];
    if (!contraction) continue;
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), (match) => {
      const firstChar = match.charAt(0);
      if (firstChar !== firstChar.toLowerCase()) {
        return contraction.charAt(0).toUpperCase() + contraction.slice(1);
      }
      return contraction;
    });
  }
  return out;
}

function humanizeSentenceInitialAdverbs(text: string, tone: Tone): string {
  const toneIndex = TONE_INDEX[tone];
  if (toneIndex < 2) return text; // professional/neutral keep formal openers
  let out = text;
  for (const [adverb, openers] of Object.entries(SENTENCE_INITIAL_ADVERBS)) {
    const escaped = adverb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const opener = openers[toneIndex - 2];
    const re = new RegExp(`(^|[.!?]\\s+)${escaped}(\\s*,)`, 'gi');
    out = out.replace(re, `$1${opener}$2`);
  }
  return out;
}

function splitLongSentences(text: string, intensity: number): string {
  const threshold = Math.round(45 - 20 * intensity);
  const sentences = splitSentences(text);
  const rebuilt = sentences
    .map((sentence) => {
      if (wordCount(sentence) < threshold) return sentence;
      const candidates: number[] = [];
      const re = /, (?:and|but|so|yet)\s+|; | — /g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(sentence)) !== null) candidates.push(m.index);
      if (candidates.length === 0) return sentence;
      const splitIndex = candidates[Math.floor(candidates.length / 2)];
      const before = sentence.slice(0, splitIndex);
      const after = sentence.slice(splitIndex);
      if (wordCount(before) < 5 || wordCount(after) < 4) return sentence;
      const trimmedAfter = after
        .replace(/^, (?:and|but|so|yet)\s+/i, '')
        .replace(/^; /, '')
        .replace(/^ — /, '');
      const capitalizedAfter = trimmedAfter.charAt(0).toUpperCase() + trimmedAfter.slice(1);
      return `${before}. ${capitalizedAfter}`;
    })
    .join(' ');
  return rebuilt;
}

export function humanizeText(text: string, options: HumanizeOptions = {}): string {
  const tone = options.tone ?? 'conversational';
  const intensity = clamp(options.intensity ?? 0.6, 0, 1);
  const preserveCode = options.preserveCode ?? true;

  const working = preserveCode
    ? maskCode(text)
    : { masked: text, segments: new Map<string, string>() };
  let out = working.masked;

  out = replacePhrases(out, FILLER_REPLACEMENTS, tone);
  out = varyTransitions(out, tone);
  out = convertPassiveToActive(out, intensity);
  out = applyContractions(out, tone);
  out = humanizeSentenceInitialAdverbs(out, tone);
  out = splitLongSentences(out, intensity);

  return preserveCode ? restoreCode({ masked: out, segments: working.segments }) : out;
}

// ─── Suggestions ──────────────────────────────────────────────────────────────

function buildSuggestions(analysis: AnalysisResult): string[] {
  const suggestions: string[] = [];
  const m = analysis.metrics;

  if (m.wordCount === 0) {
    suggestions.push('Add some actual content before expecting a natural read.');
    return suggestions;
  }

  if (analysis.aiScore > 0.6) {
    suggestions.push(
      'This reads as likely AI-generated. Rework it with a real opinion and a varied rhythm.',
    );
  }

  if (m.genericPhraseCount > 0) {
    suggestions.push(
      `Cut filler phrases (${m.genericPhraseCount} found): replace them with plain, concrete language.`,
    );
  }

  if (m.adverbPerSentence > 0.8) {
    suggestions.push(
      `You lean on adverbs (${m.adverbCount} total). Most are doing work the verb should do — trim them.`,
    );
  }

  if (m.discourseAdverbCount >= 2) {
    suggestions.push(
      'Sentence-openers like "Additionally" / "Moreover" stack up. Vary them or drop them.',
    );
  }

  if (m.passiveCount >= 2) {
    suggestions.push(
      `Convert passive voice to active (${m.passiveCount} instances) so the doer is the subject.`,
    );
  }

  if (m.sentenceLengthCv < 0.35) {
    suggestions.push(
      'Your sentences are uniformly long. Mix in a few short, punchy ones to create rhythm.',
    );
  }

  if (m.contractionPer100 < 2) {
    suggestions.push(
      'No contractions anywhere. Real people say "it\'s" and "don\'t" — relax the register.',
    );
  }

  if (m.transitionTotal > 3 && m.transitionVariety < 0.6) {
    suggestions.push(
      'You repeat the same transitions. Swap some for "but", "so", "then", or drop them outright.',
    );
  }

  if (m.personalMarkerCount / Math.max(m.sentenceCount, 1) < 0.3) {
    suggestions.push(
      'There is no personal voice here. Add "I", "we", "you", an opinion, or a short example.',
    );
  }

  if (m.hedgingCount === 0) {
    suggestions.push(
      'Nothing is ever hedged. A natural "I think" or "probably" makes claims feel human.',
    );
  }

  if (m.emDashCount >= 3) {
    suggestions.push(
      `Em-dashes (${m.emDashCount}) are an AI signature. Replace most with commas or periods.`,
    );
  }

  if (m.questionCount === 0) {
    suggestions.push('No rhetorical questions. One makes the reader feel spoken to.');
  }

  if (m.interjectionCount === 0) {
    suggestions.push(
      'Consider one light interjection ("well", "honestly", "actually") to loosen the tone.',
    );
  }

  return suggestions;
}

// ─── Public scoring API ───────────────────────────────────────────────────────

export function scoreHumanization(text: string, options: HumanizeOptions = {}): HumanizationScore {
  const analysis = analyzeText(text);
  return {
    aiScore: round(analysis.aiScore),
    naturalness: round(analysis.naturalness),
    variety: round(analysis.variety),
    voice: analysis.voice,
    suggestions: buildSuggestions(analysis),
    transformations: humanizeText(text, options),
  };
}
