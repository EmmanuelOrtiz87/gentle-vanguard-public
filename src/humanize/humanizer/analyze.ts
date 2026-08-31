import type { Tone } from './data.js';
import {
  computeAiScore,
  computeMetrics,
  computeVariety,
  detectVoice,
  maskCode,
  round,
  type TextMetrics,
} from './metrics.js';
import { buildPatterns, type PatternMatch } from './patterns.js';
import { humanizeText, type HumanizeOptions } from './transform.js';

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
