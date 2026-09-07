#!/usr/bin/env node
/**
 * system-prompt-redaction.ts — System Prompt Redaction Layer
 *
 * Native module covering OWASP Agentic AI Top 10 LLM07:2025 (System Prompt
 * Leakage). Provides a redaction layer that strips system prompts, routing
 * logic, and embedded secrets from model responses before they reach
 * untrusted consumers.
 *
 * Design principles:
 *   - Deterministic: pattern-based redaction, no LLM.
 *   - Fail closed: any detected system-prompt fragment is redacted.
 *   - Layered: combines known system-prompt markers, secret patterns, and
 *     configurable custom patterns.
 *
 * Usage:
 *   npx tsx src/security/system-prompt-redaction.ts redact --text "<model response>"
 *   npx tsx src/security/system-prompt-redaction.ts scan --text "<model response>"
 */

import { pathToFileURL } from 'url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RedactionResult {
  original: string;
  redacted: string;
  /** Number of redactions applied. */
  redactions: number;
  /** True if any system-prompt content was detected and redacted. */
  modified: boolean;
  /** Details of what was redacted. */
  findings: RedactionFinding[];
}

export interface RedactionFinding {
  type: string;
  label: string;
  /** Number of occurrences redacted. */
  count: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Known system-prompt markers that indicate leaked prompt content. */
const SYSTEM_PROMPT_MARKERS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(?:you are|your role is|act as|as an? (?:ai|assistant|agent))[^\n.]{0,120}/gi, label: 'system-role-declaration' },
  { pattern: /(?:system prompt|system message|instructions? for the (?:ai|assistant|agent))[^\n.]{0,120}/gi, label: 'system-prompt-reference' },
  { pattern: /(?:do not|never|always|must|should) (?:reveal|disclose|share|expose|mention) (?:your|the) (?:system|instructions?|prompt)/gi, label: 'prompt-reveal-instruction' },
  { pattern: /(?:ignore|override|disregard) (?:all )?(?:previous|prior|earlier) instructions?/gi, label: 'instruction-override' },
];

/** Common secret patterns to redact from responses. */
const SECRET_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(?:api[_-]?key|secret|token|password|bearer)\s*[:=]\s*["']?[A-Za-z0-9_\-./+]{8,}["']?/gi, label: 'embedded-secret' },
  { pattern: /sk-[A-Za-z0-9]{20,}/g, label: 'openai-api-key' },
  { pattern: /ghp_[A-Za-z0-9]{20,}/g, label: 'github-token' },
  { pattern: /AKIA[0-9A-Z]{16}/g, label: 'aws-access-key' },
];

// ---------------------------------------------------------------------------
// Core redaction
// ---------------------------------------------------------------------------

/**
 * Redact system-prompt content and secrets from a model response.
 * Returns the redacted text plus metadata about what was removed.
 */
export function redactSystemPrompt(text: string): RedactionResult {
  let redacted = text;
  const findings: RedactionFinding[] = [];
  let totalRedactions = 0;

  const applyPatterns = (patterns: Array<{ pattern: RegExp; label: string }>) => {
    for (const { pattern, label } of patterns) {
      const matches = redacted.match(pattern);
      const count = matches ? matches.length : 0;
      if (count > 0) {
        redacted = redacted.replace(pattern, (match) => '[REDACTED]'.repeat(match.length > 0 ? 1 : 0));
        findings.push({ type: label, label, count });
        totalRedactions += count;
      }
    }
  };

  applyPatterns(SYSTEM_PROMPT_MARKERS);
  applyPatterns(SECRET_PATTERNS);

  return {
    original: text,
    redacted,
    redactions: totalRedactions,
    modified: totalRedactions > 0,
    findings,
  };
}

/** Scan a response for system-prompt leakage without modifying it. */
export function scanSystemPrompt(text: string): RedactionResult {
  const result = redactSystemPrompt(text);
  return { ...result, redacted: text };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd === 'redact' || cmd === 'scan') {
    let text = '';
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--text') text = args[++i] ?? '';
    }
    if (!text) {
      console.error(`Usage: system-prompt-redaction.ts ${cmd} --text "<model response>"`);
      process.exit(1);
    }
    const result = cmd === 'redact' ? redactSystemPrompt(text) : scanSystemPrompt(text);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.modified ? 0 : 1);
  }

  console.error(`System Prompt Redaction
Usage:
  system-prompt-redaction redact --text "<model response>"
  system-prompt-redaction scan --text "<model response>"
`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}