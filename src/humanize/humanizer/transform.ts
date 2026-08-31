import {
  CONTRACTION_MAP,
  FILLER_REPLACEMENTS,
  SENTENCE_INITIAL_ADVERBS,
  TONE_CONTRACTION_PHRASES,
  TRANSITION_VARIETY,
  type Tone,
} from './data.js';
import { clamp, maskCode, restoreCode, splitSentences, wordCount } from './metrics.js';
import { activeVerb, objectCase, PASSIVE_BY_RE } from './patterns.js';

export interface HumanizeOptions {
  /** Target register. Defaults to 'conversational'. */
  tone?: Tone;
  /** 0..1 — how aggressively to apply transformations. Default 0.6. */
  intensity?: number;
  /** Protect fenced code blocks and inline code from rewriting. Default true. */
  preserveCode?: boolean;
}

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
