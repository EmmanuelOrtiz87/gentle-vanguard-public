import {
  DISCOURSE_ADVERBS,
  GENERIC_PHRASES,
  IRREGULAR_PAST,
  PASSIVE_RE,
  PERSONAL_MARKERS,
  TRANSITION_WORDS,
} from './data.js';
import { countContractions, countMatches } from './metrics.js';

export interface PatternMatch {
  pattern: string;
  matches: string[];
  count: number;
}

export function activeVerb(pastParticiple: string): string {
  return IRREGULAR_PAST[pastParticiple.toLowerCase()] ?? pastParticiple;
}

export function objectCase(subject: string): string {
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
export const PASSIVE_BY_RE =
  // eslint-disable-next-line security/detect-unsafe-regex
  /\b((?:the|a|an|this|that|these|those|my|our|your|their|its)\s+[a-z][\w-]*|(?:it|this|that|these|those))\s+(was|were|is|are)\s+(\w+(?:ed|en|t))\s+by\s+([a-z][\w-]*(?:\s+[a-z][\w-]*)?)/gi;

export function buildPatterns(text: string): PatternMatch[] {
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
