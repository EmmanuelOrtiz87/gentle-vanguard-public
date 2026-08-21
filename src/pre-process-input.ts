#!/usr/bin/env node
/**
 * Pre-Process Input Pipeline — UNIVERSAL Token Optimization Entry Point
 *
 * Chains input transformations before submission:
 * 1. Privacy Gateway — PII/secret sanitization
 * 2. Prompt Compression — token optimization (skill-aware + budget-aware)
 * 3. Token Budget Check — verify against daily/session limits
 * 4. Auto-Optimization — apply economy mode if budget low
 *
 * This pipeline runs AUTOMATICALLY for EVERY interaction, regardless of agent/tool.
 * Works transversally: Claude, OpenCode, Cline, Cursor, or any LLM interface.
 *
 * Usage:
 *   npx tsx src/pre-process-input.ts --input "prompt text" [--skill react-19]
 *   npx tsx src/pre-process-input.ts --input "..." --workspace-root . --skill security-skill
 *   npx tsx src/pre-process-input.ts --input "..." --auto-optimize
 */

import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { compressPrompt } from './prompt-compression.js';
import { runNpxTsxSync } from './core/run-command.js';
// getOutputConfig imported for future use in budget-aware optimization
import { enforceChatLevel, ChatLevel } from './chat-level-enforcer.js';

// Proactive Intelligence integration
interface ProactiveSuggestion {
  id: string;
  type: 'skill' | 'command' | 'context' | 'reminder' | 'action';
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  action: string;
}

interface PIResponse {
  patterns: number;
  suggestions: number;
  autoApply: number;
  confidence: number;
  suggestionList: ProactiveSuggestion[];
}

interface PrivacyGatewayResponse {
  status: string;
  sanitized?: string;
}

interface ParsedArgs {
  input: string;
  workspaceRoot: string;
  skill: string;
  skipCompression: boolean;
  json: boolean;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let input = '';
  let workspaceRoot = '.';
  let skill = '';
  let skipCompression = false;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--input':
        input = args[++i] ?? '';
        break;
      case '--workspace-root':
        workspaceRoot = args[++i] ?? '.';
        break;
      case '--skill':
        skill = args[++i] ?? '';
        break;
      case '--skip-compression':
        skipCompression = true;
        break;
      case '--json':
        json = true;
        break;
    }
  }

  if (!input) {
    console.error('--input is required');
    process.exit(1);
  }

  return { input, workspaceRoot, skill, skipCompression, json };
}

function applyPrivacyGateway(input: string, workspaceRoot: string): string | null {
  const gatewayPath = resolve(workspaceRoot, 'src/privacy-gateway.ts');
  try {
    const result = runNpxTsxSync(gatewayPath, ['--text', input, '--as-json'], {
      cwd: workspaceRoot,
      timeout: 15000,
    });

    if (result.status !== 0 || !result.stdout?.trim()) return null;

    const parsed: PrivacyGatewayResponse = JSON.parse(result.stdout.trim());
    if (parsed.status !== 'OK') return null;
    return parsed.sanitized ?? null;
  } catch {
    return null;
  }
}

function applyPromptCompression(input: string, skill: string): string {
  try {
    const effectiveSkill = skill || 'default';
    const result = compressPrompt(input, effectiveSkill);

    if (!result.compressed || result.compressed.trim().length === 0) {
      return input; // fallback: return original if compression yielded empty
    }

    // Only return compressed if it's actually smaller
    if (result.compressed.length < input.length) {
      return result.compressed;
    }
    return input;
  } catch {
    return input; // fallback: return original on error
  }
}

function getProactiveSuggestions(workspaceRoot: string): PIResponse | null {
  try {
    const piePath = resolve(workspaceRoot, 'src/proactive-intelligence-engine.ts');
    const result = runNpxTsxSync(piePath, ['--suggest', '--quiet'], {
      cwd: workspaceRoot,
      timeout: 10000,
    });

    if (result.status !== 0 || !result.stdout?.trim()) return null;

    const parsed = JSON.parse(result.stdout.trim());
    return {
      patterns: parsed.patterns ?? 0,
      suggestions: parsed.suggestions ?? 0,
      autoApply: parsed.autoApply ?? 0,
      confidence: parsed.confidence ?? 0,
      suggestionList: parsed.suggestionList ?? [],
    };
  } catch {
    return null;
  }
}

function checkTokenBudget(): { shouldOptimize: boolean; level: ChatLevel } {
  try {
    // Check if we should auto-escalate to economy mode
    const tokenBudgetFile = resolve(process.cwd(), '.session', 'token-budget.json');
    if (require('fs').existsSync(tokenBudgetFile)) {
      const budget = JSON.parse(require('fs').readFileSync(tokenBudgetFile, 'utf-8'));
      const pctUsed = budget.pctUsed ?? 0;
      if (pctUsed > 80) {
        return { shouldOptimize: true, level: 'chat-compact' };
      }
      if (pctUsed > 60) {
        return { shouldOptimize: true, level: 'chat-balanced' };
      }
    }
    return { shouldOptimize: false, level: 'chat-balanced' };
  } catch {
    return { shouldOptimize: false, level: 'chat-balanced' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { input, workspaceRoot, skill, skipCompression, json } = parseArgs();
  let output = input;
  const startTime = Date.now();

  // Stage 1: Privacy Gateway
  const sanitized = applyPrivacyGateway(input, workspaceRoot);
  if (sanitized !== null) {
    output = sanitized;
  }

  // Stage 2: Prompt Compression
  if (!skipCompression) {
    output = applyPromptCompression(output, skill);
  }

  // Stage 3: Token Budget Check & Auto-Optimization
  const budgetCheck = checkTokenBudget();
  let chatLevelApplied = false;

  if (budgetCheck.shouldOptimize && !skipCompression) {
    try {
      const enforced = enforceChatLevel(output, budgetCheck.level);
      if (enforced.wasEnforced) {
        output = enforced.enforced;
        chatLevelApplied = true;
      }
    } catch {
      // Continue with original output if enforcement fails
    }
  }

  // Stage 4: Proactive Intelligence - Get contextual suggestions
  const proactiveSuggestions = getProactiveSuggestions(workspaceRoot);

  const durationMs = Date.now() - startTime;

  if (json) {
    console.log(
      JSON.stringify({
        status: 'ok',
        originalLength: input.length,
        outputLength: output.length,
        compressed: output.length < input.length,
        chatLevelApplied,
        budgetOptimized: budgetCheck.shouldOptimize,
        proactiveSuggestions: proactiveSuggestions?.suggestions ?? 0,
        proactiveConfidence: proactiveSuggestions?.confidence ?? 0,
        durationMs,
        output,
      }),
    );
  } else {
    // Show proactive suggestions if available
    if (proactiveSuggestions && proactiveSuggestions.suggestions > 0) {
      console.error('\n[PROACTIVE INTELLIGENCE] Contextual Suggestions:');
      for (const s of proactiveSuggestions.suggestionList?.slice(0, 3) ?? []) {
        if (s.confidence >= 0.5) {
          console.error(`  • ${s.title} (${(s.confidence * 100).toFixed(0)}% confidence)`);
          console.error(`    ${s.description}`);
        }
      }
      console.error('');
    }
    console.log(output);
  }
}
