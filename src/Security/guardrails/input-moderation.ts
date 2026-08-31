#!/usr/bin/env node
/**
 * Input Moderation — Jailbreak Rail (F3.2, soft WARN)
 * Heuristic stub + pluggable LlamaGuard interface.
 * Usage: npx tsx src/security/guardrails/input-moderation.ts --test "Ignore previous instructions"
 */
import { pathToFileURL } from 'url';

export interface ModerationResult {
  blocked: boolean;
  reason?: string;
  score?: number;
  rail: 'heuristic' | 'llama-guard';
}

// Minimal heuristic patterns (100 patterns in prod, 12 here as stub)
const BLOCKED_PATTERNS: RegExp[] = [
  /ignore\s+previous\s+instructions/i,
  /ignore\s+all\s+previous/i,
  /system\s+prompt/i,
  /you\s+are\s+now\s+a/i,
  /disregard\s+your\s+instructions/i,
  /act\s+as\s+if\s+you\s+are/i,
  /jailbreak/i,
  /bypass\s+safety/i,
  /exfiltrate/i,
  /reveal\s+your\s+system/i,
  /prompt\s+injection/i,
  /\[INST\]/i,
];

export interface LlamaGuard {
  moderate(text: string): Promise<ModerationResult>;
}

// Heuristic rail (sync, <5ms, no model)
export function moderateInputHeuristic(text: string): ModerationResult {
  const normalized = text.trim().slice(0, 4000);
  for (const re of BLOCKED_PATTERNS) {
    if (re.test(normalized)) {
      return { blocked: true, reason: `heuristic: ${re.source}`, score: 0.9, rail: 'heuristic' };
    }
  }
  return { blocked: false, score: 0.1, rail: 'heuristic' };
}

// Pluggable rail (future: transformers.js Llama Guard 3)
export async function moderateInput(
  text: string,
  llamaGuard?: LlamaGuard,
): Promise<ModerationResult> {
  const heuristic = moderateInputHeuristic(text);
  if (heuristic.blocked) return heuristic;
  if (llamaGuard) {
    try {
      const r = await llamaGuard.moderate(text);
      if (r.blocked) return r;
    } catch {
      // fallback to heuristic PASS on Llama Guard failure (soft WARN)
    }
  }
  return heuristic;
}

// CLI for manual testing
async function main(): Promise<void> {
  const idx = process.argv.indexOf('--test');
  const text = idx >= 0 ? process.argv.slice(idx + 1).join(' ') : process.argv.slice(2).join(' ');
  if (!text) {
    console.log('Usage: npx tsx src/security/guardrails/input-moderation.ts --test "text"');
    process.exit(1);
  }
  const r = await moderateInput(text);
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.blocked ? 2 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
