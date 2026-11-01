/**
 * ZCode PostToolUse hook (all tools) — registra el uso de tokens por turno.
 *
 * Puente entre el protocolo de hooks de ZCode (JSON en stdin) y el tracker
 * existente src/hooks/post-tool-use-log.ts. Nunca bloquea (exit 0 siempre).
 * Los resúmenes se truncan para no inflar el propio hook (el output del tool
 * ya está contado en el contexto real; aquí se registra una muestra).
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const MAX_SUMMARY = 240;

function readStdin(): string {
  try {
    const fs = require('node:fs') as typeof import('node:fs');
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function clip(value: unknown): string {
  const text = typeof value === 'string' ? value : value ? JSON.stringify(value) : '';
  return text.slice(0, MAX_SUMMARY);
}

function main(): void {
  let toolName = '';
  let toolArgs = '';
  let inputSummary = '';
  let outputSummary = '';
  try {
    const parsed = JSON.parse(readStdin().trim().split('\n')[0] || '{}') as {
      tool_name?: string;
      tool_input?: unknown;
      tool_response?: unknown;
    };
    toolName = parsed.tool_name ?? '';
    toolArgs = clip(parsed.tool_input);
    inputSummary = clip(parsed.tool_input);
    outputSummary = clip(parsed.tool_response);
  } catch {
    process.exit(0);
  }
  if (!toolName) process.exit(0);

  // GOLDEN RULE (procesos-ocultos): node directo con --import tsx, nunca shims npx.
  spawnSync(
    process.execPath,
    ['--import', 'tsx', resolve(REPO_ROOT, 'src', 'hooks', 'post-tool-use-log.ts'),
     toolName, toolArgs, inputSummary, outputSummary],
    { cwd: REPO_ROOT, stdio: 'ignore', timeout: 20_000, windowsHide: true },
  );
  process.exit(0);
}

main();
