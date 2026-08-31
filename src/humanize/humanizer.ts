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
 * CLI lives in src/humanize/humanizer-cli.ts:
 *   npx tsx src/humanize/humanizer-cli.ts analyze --text "The system ..."
 *   npx tsx src/humanize/humanizer-cli.ts transform --file ./docs/readme.md --tone professional
 *   npx tsx src/humanize/humanizer-cli.ts score --file ./content/blog-post.md
 */

export * from './humanizer/data.js';
export * from './humanizer/metrics.js';
export * from './humanizer/patterns.js';
export * from './humanizer/transform.js';
export * from './humanizer/analyze.js';
