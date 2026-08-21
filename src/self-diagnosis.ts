#!/usr/bin/env node
/**
 * Self-Diagnosis — diagnoses agent state, suggests profile adjustments.
 * Called during Break Glass scenarios. TS migration of self-diagnosis.ps1 concept.
 *
 * Usage:
 *   npx tsx src/self-diagnosis.ts --profile ultra --turn-count 5
 *   npx tsx src/self-diagnosis.ts --profile lleno --chat-level 3 --turn-count 12 --json
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';

interface DiagnosisArgs {
  profile: string;
  chatLevel: string;
  turnCount: number;
  json: boolean;
  output?: string;
}

interface DiagnosisResult {
  timestamp: string;
  profile: string;
  chatLevel: string;
  turnCount: number;
  state: 'STUCK' | 'DEGRADED' | 'HEALTHY';
  recommendations: string[];
  suggestedProfile: string;
  suggestedChatLevel: string;
  metrics: {
    turnsSinceLastCompletion: number;
    profileAlignment: string;
  };
}

const PROFILE_CONFIGS: Record<string, { maxTurnsBeforeStuck: number; description: string }> = {
  ultra: { maxTurnsBeforeStuck: 8, description: 'Maximum detail, full context' },
  lleno: { maxTurnsBeforeStuck: 12, description: 'Full context but compact responses' },
  balanced: { maxTurnsBeforeStuck: 15, description: 'Moderate detail, balanced' },
  compact: { maxTurnsBeforeStuck: 20, description: 'Minimal detail, fast responses' },
};

function parseArgs(): DiagnosisArgs {
  const raw = process.argv.slice(2);
  return {
    profile: extractArg(raw, '--profile') || 'ultra',
    chatLevel: extractArg(raw, '--chat-level') || '2',
    turnCount: parseInt(extractArg(raw, '--turn-count') || '1', 10),
    json: raw.includes('--json'),
    output: extractArg(raw, '--output'),
  };
}

function extractArg(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

function diagnose(args: DiagnosisArgs): DiagnosisResult {
  const config = PROFILE_CONFIGS[args.profile] || PROFILE_CONFIGS.ultra!;
  const maxTurns = config.maxTurnsBeforeStuck;
  const stuckRatio = args.turnCount / maxTurns;

  let state: DiagnosisResult['state'];
  const recommendations: string[] = [];

  if (stuckRatio >= 1.0) {
    state = 'STUCK';
    recommendations.push(
      `EXCEEDED max turns for "${args.profile}" (${args.turnCount}/${maxTurns}).`,
    );
    recommendations.push('Switch to "lleno" or "compact" profile for faster resolution.');
    recommendations.push('Consider delegating to subagents via task tool.');
  } else if (stuckRatio >= 0.75) {
    state = 'DEGRADED';
    recommendations.push(
      `Approaching max turns for "${args.profile}" (${args.turnCount}/${maxTurns}).`,
    );
    recommendations.push('Reduce response detail. Abbreviate more aggressively.');
    recommendations.push('Verify no loop condition — review last 3 turns for repetition.');
  } else {
    state = 'HEALTHY';
    recommendations.push(
      `Within normal range for "${args.profile}" (${args.turnCount}/${maxTurns}).`,
    );
  }

  // Determine suggested profile based on state
  let suggestedProfile = args.profile;
  let suggestedChatLevel = args.chatLevel;

  if (state === 'STUCK') {
    suggestedProfile = 'compact';
    suggestedChatLevel = '1';
    recommendations.push(`Suggested: --profile compact --chat-level 1`);
  } else if (state === 'DEGRADED') {
    suggestedProfile = 'lleno';
    suggestedChatLevel = '2';
    recommendations.push(`Suggested: --profile lleno --chat-level 2`);
  }

  return {
    timestamp: new Date().toISOString(),
    profile: args.profile,
    chatLevel: args.chatLevel,
    turnCount: args.turnCount,
    state,
    recommendations,
    suggestedProfile,
    suggestedChatLevel,
    metrics: {
      turnsSinceLastCompletion: args.turnCount,
      profileAlignment: stuckRatio < 0.5 ? 'GOOD' : stuckRatio < 0.75 ? 'FAIR' : 'POOR',
    },
  };
}

function main(): void {
  const args = parseArgs();
  const result = diagnose(args);

  if (args.output) {
    const outputPath = resolve(process.cwd(), args.output);
    writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`[SELF-DIAGNOSIS] Report written to ${outputPath}`);
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.state === 'STUCK' ? 2 : result.state === 'DEGRADED' ? 1 : 0);
  }

  const icon = result.state === 'STUCK' ? '🛑' : result.state === 'DEGRADED' ? '⚠️' : '✅';
  console.log(
    `[SELF-DIAGNOSIS] ${icon} State: ${result.state} | Profile: ${result.profile} | Turns: ${result.turnCount}/${PROFILE_CONFIGS[result.profile]?.maxTurnsBeforeStuck || '?'}`,
  );
  for (const rec of result.recommendations) {
    console.log(`  → ${rec}`);
  }
  console.log(
    `  Suggested: --profile ${result.suggestedProfile} --chat-level ${result.suggestedChatLevel}`,
  );
}

main();
