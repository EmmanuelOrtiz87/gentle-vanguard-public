#!/usr/bin/env node
/**
 * embedding-guard.ts — Embedding Space Injection Detection + Vector Store Access Control
 *
 * Native module covering OWASP Agentic AI Top 10 LLM08:2025 (Vector and
 * Embedding Weaknesses). Detects embedding-space injection attempts and
 * enforces access control on vector store operations.
 *
 * Design principles:
 *   - Deterministic: heuristic + lexical detection, no LLM.
 *   - Fail closed: any suspicious embedding operation is rejected.
 *   - Layered: combines injection heuristics, allowlist-based access control,
 *     and operation gating.
 *
 * Usage:
 *   npx tsx src/security/embedding-guard.ts check --text "<query or document>"
 *   npx tsx src/security/embedding-guard.ts gate --operation upsert --collection <name>
 */

import { pathToFileURL } from 'url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmbeddingCheckResult {
  text: string;
  /** True if the text is safe to embed. */
  safe: boolean;
  /** Detected injection signals. */
  signals: string[];
  /** Risk level: 'low' | 'medium' | 'high'. */
  risk: 'low' | 'medium' | 'high';
}

export interface VectorGateResult {
  operation: string;
  collection: string;
  /** True if the operation is permitted. */
  allowed: boolean;
  /** Reason for denial (if not allowed). */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Allowed vector store operations. */
const ALLOWED_OPERATIONS = new Set(['query', 'upsert', 'delete', 'list']);

/** Collections that are read-only (no upsert/delete). */
const READ_ONLY_COLLECTIONS = new Set(['system', 'config', 'provenance']);

/** Injection heuristics for embedding-space attacks. */
const INJECTION_SIGNALS: Array<{ pattern: RegExp; label: string; weight: number }> = [
  { pattern: /(?:ignore|override|disregard) (?:all )?(?:previous|prior|earlier) (?:instructions?|context)/gi, label: 'instruction-override', weight: 3 },
  { pattern: /(?:you are|act as|your role is)[^\n.]{0,80}/gi, label: 'role-injection', weight: 2 },
  { pattern: /(?:system prompt|system message|hidden instructions?)[^\n.]{0,80}/gi, label: 'prompt-reference', weight: 2 },
  { pattern: /(?:retrieve|return|output|print) (?:the|your) (?:system|hidden|secret)/gi, label: 'secret-exfiltration', weight: 3 },
  { pattern: /(?:<|\[)(?:system|user|assistant)(?:>|\])/gi, label: 'role-tag-spoofing', weight: 1 },
  { pattern: /(?:do not|never) (?:reveal|disclose|mention) (?:your|the) (?:instructions?|prompt)/gi, label: 'reveal-instruction', weight: 2 },
];

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Check a text (query or document) for embedding-space injection signals.
 * Returns a risk assessment and whether it is safe to embed.
 */
export function checkEmbedding(text: string): EmbeddingCheckResult {
  const signals: string[] = [];
  let riskScore = 0;

  for (const { pattern, label, weight } of INJECTION_SIGNALS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      signals.push(label);
      riskScore += weight;
    }
  }

  const risk: 'low' | 'medium' | 'high' = riskScore >= 5 ? 'high' : riskScore >= 2 ? 'medium' : 'low';
  return {
    text,
    safe: risk !== 'high',
    signals,
    risk,
  };
}

/**
 * Gate a vector store operation against the access control policy.
 * Fail closed: unknown operations or read-only collection writes are denied.
 */
export function gateVectorOperation(
  operation: string,
  collection: string,
): VectorGateResult {
  const op = operation.toLowerCase();

  if (!ALLOWED_OPERATIONS.has(op)) {
    return { operation, collection, allowed: false, reason: `operation '${op}' not allowed` };
  }

  if (READ_ONLY_COLLECTIONS.has(collection.toLowerCase()) && (op === 'upsert' || op === 'delete')) {
    return {
      operation,
      collection,
      allowed: false,
      reason: `collection '${collection}' is read-only`,
    };
  }

  return { operation, collection, allowed: true };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd === 'check') {
    let text = '';
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--text') text = args[++i] ?? '';
    }
    if (!text) {
      console.error('Usage: embedding-guard.ts check --text "<query or document>"');
      process.exit(1);
    }
    const result = checkEmbedding(text);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.safe ? 0 : 1);
  }

  if (cmd === 'gate') {
    let operation = '';
    let collection = '';
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--operation') operation = args[++i] ?? '';
      else if (args[i] === '--collection') collection = args[++i] ?? '';
    }
    if (!operation || !collection) {
      console.error('Usage: embedding-guard.ts gate --operation <op> --collection <name>');
      process.exit(1);
    }
    const result = gateVectorOperation(operation, collection);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.allowed ? 0 : 1);
  }

  console.error(`Embedding Guard
Usage:
  embedding-guard check --text "<query or document>"
  embedding-guard gate --operation <op> --collection <name>
`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}