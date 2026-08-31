#!/usr/bin/env node
/**
 * Output Moderation — SelfCheck + Llama Guard (F3.2, soft WARN)
 * Usage: npx tsx src/security/guardrails/output-moderation.ts --test "output text"
 */
import { pathToFileURL } from 'url';
import {
  moderateInputHeuristic,
  type ModerationResult,
  type LlamaGuard,
} from './input-moderation.js';

const OUTPUT_BLOCKED: RegExp[] = [
  /here\s+is\s+your\s+system\s+prompt/i,
  /my\s+system\s+instructions\s+are/i,
  /leaked\s+credentials/i,
  /\[TOOL\s+OUTPUT\]/i,
];

export function moderateOutputHeuristic(text: string): ModerationResult {
  const normalized = text.trim().slice(0, 4000);
  for (const re of OUTPUT_BLOCKED) {
    if (re.test(normalized)) {
      return {
        blocked: true,
        reason: `output-heuristic: ${re.source}`,
        score: 0.9,
        rail: 'heuristic',
      };
    }
  }
  // Reuse input patterns for output (prompt leakage)
  return moderateInputHeuristic(text);
}

export async function moderateOutput(
  text: string,
  llamaGuard?: LlamaGuard,
): Promise<ModerationResult> {
  const heuristic = moderateOutputHeuristic(text);
  if (heuristic.blocked) return heuristic;
  if (llamaGuard) {
    try {
      const r = await llamaGuard.moderate(text);
      if (r.blocked) return r;
    } catch {}
  }
  return heuristic;
}

async function main(): Promise<void> {
  const idx = process.argv.indexOf('--test');
  const text = idx >= 0 ? process.argv.slice(idx + 1).join(' ') : process.argv.slice(2).join(' ');
  if (!text) {
    console.log('Usage: npx tsx src/security/guardrails/output-moderation.ts --test "text"');
    process.exit(1);
  }
  const r = await moderateOutput(text);
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.blocked ? 2 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
