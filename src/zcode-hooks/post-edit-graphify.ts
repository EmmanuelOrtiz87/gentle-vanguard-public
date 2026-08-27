/**
 * ZCode PostToolUse hook (Write|Edit) — valida el snapshot de graphify tras modificar código.
 *
 * Guard: solo actúa si el archivo editado (tool_input.file_path) está dentro de este repo y
 * tiene extensión de código (.ts/.js/.tsx/.jsx/.mjs/.cjs). Nunca bloquea (exit 0 siempre).
 * Si no existe graphify-out/graph.json, no hace nada (build manual la primera vez).
 */
import { spawnSync } from 'node:child_process';
import { resolve, extname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function readStdin(): string {
  try {
    // hook stdin es una sola línea JSON; lectura síncrona best-effort
    const fs = require('node:fs') as typeof import('node:fs');
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main(): void {
  let filePath = '';
  try {
    const parsed = JSON.parse(readStdin().trim().split('\n')[0] || '{}');
    filePath = parsed.tool_input?.file_path || '';
  } catch {
    /* sin stdin útil → salir */
  }
  if (!filePath) process.exit(0);
  if (!CODE_EXTS.has(extname(filePath).toLowerCase())) process.exit(0);
  const normalized = resolve(filePath).toLowerCase();
  if (!normalized.startsWith(REPO_ROOT.toLowerCase())) process.exit(0);
  if (!existsSync(resolve(REPO_ROOT, 'graphify-out', 'graph.json'))) process.exit(0);

  const result = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', 'graphify', '--', 'update', '.'],
    { cwd: REPO_ROOT, encoding: 'utf8', timeout: 120000 },
  );
  // Output no-JSON es solo diagnóstico para el log; nunca bloquear.
  if (result.status !== 0) {
    console.error(`graphify update exit ${result.status}`);
  }
  process.exit(0);
}

main();
