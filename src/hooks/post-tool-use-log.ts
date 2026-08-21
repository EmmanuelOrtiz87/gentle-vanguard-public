#!/usr/bin/env node

import { existsSync } from 'fs';
import { join } from 'path';
import { runNpxTsxSync } from '../core/run-command.js';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

interface ToolUseArgs {
  toolName: string;
  toolArgs: string;
  inputSummary: string;
  outputSummary: string;
}

function parseArgs(): ToolUseArgs {
  const args = process.argv.slice(2);
  return {
    toolName: args[0] ?? '',
    toolArgs: args[1] ?? '',
    inputSummary: args[2] ?? '',
    outputSummary: args[3] ?? '',
  };
}

function main(): number {
  const repoRoot = join(__dirname, '..', '..');
  const { toolName, toolArgs, inputSummary, outputSummary } = parseArgs();

  // TS migration: token-usage-auto.ps1 → src/token-usage-auto.ts
  const autoScript = join(repoRoot, 'src', 'token-usage-auto.ts');

  if (!existsSync(autoScript)) {
    return 0;
  }

  const ctxChars = toolArgs ? Math.max(1, Math.floor(toolArgs.length * 1.5)) : 0;
  const turnLabel = toolName ? `tool:${toolName}` : 'auto-hook';

  // Estimate tokens from context chars (fallback when real usage not provided).
  const inputTokens = Math.max(0, Math.floor(ctxChars / 4));
  const outputTokens = 0;

  runNpxTsxSync(
    autoScript,
    [
      '-InputTokens',
      String(inputTokens),
      '-OutputTokens',
      String(outputTokens),
      '-ContextChars',
      String(ctxChars),
      '-TurnLabel',
      turnLabel,
      '-InputSummary',
      inputSummary,
      '-OutputSummary',
      outputSummary,
      '-Model',
      'auto-detected',
    ],
    { cwd: repoRoot, stdio: 'inherit' },
  );

  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}

export { main as postToolUseLog };
