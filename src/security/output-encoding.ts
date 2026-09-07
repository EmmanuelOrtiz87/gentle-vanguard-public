#!/usr/bin/env node
/**
 * output-encoding.ts — Output Encoding / Sanitization for Unsafe Contexts
 *
 * Addresses OWASP Agentic AI Top 10 LLM05:2025 (Improper Output Handling).
 *
 * LLM output used in unsafe downstream contexts (SQL, shell, HTML, URL, JSON)
 * must be encoded/sanitized to prevent injection. This module provides
 * context-aware encoding functions that neutralize dangerous characters before
 * the output reaches a sink.
 *
 * Contexts supported:
 *   - sql      — escape single quotes / backslashes for SQL string literals
 *   - shell    — quote/escape for POSIX shell single-quoted strings
 *   - html     — HTML-entity encode for text nodes
 *   - htmlAttr — HTML-entity encode for attribute values
 *   - url      — encodeURIComponent for URL query/path segments
 *   - json     — JSON.stringify (safe string escaping)
 *
 * Design principles:
 *   - Fail closed: unknown contexts return a fully-escaped safe default.
 *   - Deterministic: pure functions, no side effects, no LLM calls.
 *   - Testable: every context has a unit test.
 */

import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OutputContext = 'sql' | 'shell' | 'html' | 'htmlAttr' | 'url' | 'json';

export interface OutputEncodingResult {
  context: OutputContext;
  original: string;
  encoded: string;
  /** True if the output was modified (dangerous chars present). */
  modified: boolean;
  /** Human-readable note on what was neutralized. */
  note: string;
}

// ---------------------------------------------------------------------------
// Encoders
// ---------------------------------------------------------------------------

function encodeSql(value: string): string {
  // Escape single quotes and backslashes for SQL string literals.
  return value.replace(/'/g, "''").replace(/\\/g, '\\\\');
}

function encodeShell(value: string): string {
  // POSIX shell single-quoted string: escape single quotes by closing/reopening.
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function encodeHtml(value: string): string {
  // HTML text node encoding.
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function encodeHtmlAttr(value: string): string {
  // HTML attribute value encoding (also handles quotes).
  return encodeHtml(value)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function encodeUrl(value: string): string {
  return encodeURIComponent(value);
}

function encodeJson(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

const ENCODERS: Record<OutputContext, (v: string) => string> = {
  sql: encodeSql,
  shell: encodeShell,
  html: encodeHtml,
  htmlAttr: encodeHtmlAttr,
  url: encodeUrl,
  json: encodeJson,
};

/**
 * Encode a string for a given unsafe downstream context.
 * Fail closed: unknown contexts fall back to HTML-entity encoding (safe default).
 */
export function encodeOutput(value: string, context: OutputContext): OutputEncodingResult {
  const encoder = ENCODERS[context] ?? encodeHtml;
  const encoded = encoder(value);
  return {
    context,
    original: value,
    encoded,
    modified: encoded !== value,
    note: modifiedNote(context, encoded !== value),
  };
}

function modifiedNote(context: OutputContext, modified: boolean): string {
  if (!modified) return 'No dangerous characters detected';
  switch (context) {
    case 'sql':
      return 'Single quotes/backslashes escaped for SQL string literal';
    case 'shell':
      return 'Wrapped in single quotes for POSIX shell';
    case 'html':
      return 'HTML-entity encoded (&, <, >)';
    case 'htmlAttr':
      return 'HTML-entity encoded including quotes';
    case 'url':
      return 'URL-encoded via encodeURIComponent';
    case 'json':
      return 'JSON string escaping applied';
    default:
      return 'Safe default encoding applied';
  }
}

/**
 * Convenience: encode for a context and return just the encoded string.
 */
export function encode(value: string, context: OutputContext): string {
  return encodeOutput(value, context).encoded;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const ctxIdx = args.indexOf('--context');
  const context = (ctxIdx >= 0 ? args[ctxIdx + 1] : 'html') as OutputContext;
  const textIdx = args.indexOf('--text');
  const text = textIdx >= 0 ? args.slice(textIdx + 1).join(' ') : '';

  if (!text) {
    console.error(
      'Usage: output-encoding.ts --context <sql|shell|html|htmlAttr|url|json> --text "<output>"',
    );
    process.exit(1);
  }

  const result = encodeOutput(text, context);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.modified ? 0 : 0);
}

// Only run CLI when executed directly (not imported)
if (
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith('output-encoding.ts'))
) {
  main();
}