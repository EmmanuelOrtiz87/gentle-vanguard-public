#!/usr/bin/env node
/**
 * fact-checker.ts — Fact-Checking + Source Verification Layer
 *
 * Native module covering OWASP Agentic AI Top 10 LLM09:2025 (Misinformation).
 * Provides a deterministic fact-checking and source-verification layer for
 * generated claims, reducing the risk of the agent presenting false or
 * misleading information as fact.
 *
 * Design principles:
 *   - Deterministic: lexical claim-source matching, no LLM.
 *   - Fail closed: unverifiable claims are flagged for review.
 *   - Layered: combines claim extraction, source matching, and confidence
 *     scoring.
 *
 * Usage:
 *   npx tsx src/security/fact-checker.ts check --claim "<claim>" --sources '["...","..."]'
 *   npx tsx src/security/fact-checker.ts verify --text "<generated text>" --sources '["...","..."]'
 */

import { pathToFileURL } from 'url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClaimCheckResult {
  claim: string;
  /** True if the claim is supported by the provided sources. */
  supported: boolean;
  /** Confidence score 0..1. */
  confidence: number;
  /** Matching source indices. */
  matchedSources: number[];
  /** Reason for the verdict. */
  reason: string;
}

export interface FactCheckResult {
  text: string;
  /** Overall verdict: 'verified' | 'unverified' | 'mixed'. */
  verdict: 'verified' | 'unverified' | 'mixed';
  /** Per-claim results. */
  claims: ClaimCheckResult[];
  /** Fraction of claims that are supported. */
  supportRatio: number;
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/** Tokenize text into lowercase word tokens for lexical matching. */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

/** Compute lexical overlap (Jaccard) between two texts. */
function jaccard(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const w of ta) if (tb.has(w)) intersection++;
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Check whether a single claim is supported by any of the provided sources.
 * Uses lexical overlap (Jaccard) with a configurable threshold.
 */
export function checkClaim(
  claim: string,
  sources: string[],
  threshold = 0.25,
): ClaimCheckResult {
  const scores = sources.map((s) => jaccard(claim, s));
  const maxScore = Math.max(...scores, 0);
  const bestIndex = scores.indexOf(maxScore);
  const supported = maxScore >= threshold;

  return {
    claim,
    supported,
    confidence: maxScore,
    matchedSources: supported ? [bestIndex] : [],
    reason: supported
      ? `supported by source ${bestIndex} (overlap ${maxScore.toFixed(2)})`
      : `no source supports this claim (best overlap ${maxScore.toFixed(2)})`,
  };
}

/**
 * Fact-check a generated text by extracting claims (sentences) and checking
 * each against the provided sources.
 */
export function factCheckText(
  text: string,
  sources: string[],
  threshold = 0.25,
): FactCheckResult {
  // Split into sentences as claims.
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const claims = sentences.map((s) => checkClaim(s, sources, threshold));
  const supportedCount = claims.filter((c) => c.supported).length;
  const supportRatio = claims.length > 0 ? supportedCount / claims.length : 0;

  const verdict: 'verified' | 'unverified' | 'mixed' =
    claims.length === 0 ? 'unverified' : supportRatio >= 0.8 ? 'verified' : supportRatio > 0 ? 'mixed' : 'unverified';

  return { text, verdict, claims, supportRatio };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd === 'check') {
    let claim = '';
    let sourcesRaw = '';
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--claim') claim = args[++i] ?? '';
      else if (args[i] === '--sources') sourcesRaw = args[++i] ?? '';
    }
    if (!claim || !sourcesRaw) {
      console.error('Usage: fact-checker.ts check --claim "<claim>" --sources \'["...","..."]\'');
      process.exit(1);
    }
    let sources: string[];
    try {
      sources = JSON.parse(sourcesRaw);
    } catch {
      sources = sourcesRaw.split('\n').filter((l) => l.trim());
    }
    const result = checkClaim(claim, sources);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.supported ? 0 : 1);
  }

  if (cmd === 'verify') {
    let text = '';
    let sourcesRaw = '';
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--text') text = args[++i] ?? '';
      else if (args[i] === '--sources') sourcesRaw = args[++i] ?? '';
    }
    if (!text || !sourcesRaw) {
      console.error('Usage: fact-checker.ts verify --text "<generated text>" --sources \'["...","..."]\'');
      process.exit(1);
    }
    let sources: string[];
    try {
      sources = JSON.parse(sourcesRaw);
    } catch {
      sources = sourcesRaw.split('\n').filter((l) => l.trim());
    }
    const result = factCheckText(text, sources);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.verdict === 'verified' ? 0 : 1);
  }

  console.error(`Fact Checker
Usage:
  fact-checker check --claim "<claim>" --sources '["...","..."]'
  fact-checker verify --text "<generated text>" --sources '["...","..."]'
`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}