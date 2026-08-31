/**
 * ZCode SessionStart hook — arranca la pipeline de sesión del stack Gentle-Vanguard.
 *
 * Guard: solo actúa si el cwd del evento (stdin JSON, campo `cwd`) está dentro de este
 * repositorio; en cualquier otro workspace sale silenciosamente con exit 0 (nunca bloquea).
 *
 * Registrado en ~/.zcode/cli/config.json → hooks.events.SessionStart.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isWithinRoot } from '../core/path-identity.js';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function readStdin(): Promise<string> {
  return new Promise((res) => {
    let data = '';
    if (process.stdin.isTTY) return res('');
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => res(data));
    setTimeout(() => res(data), 2000);
  });
}

async function main(): Promise<void> {
  const raw = await readStdin();
  let cwd = '';
  try {
    const parsed = JSON.parse(raw.trim().split('\n')[0] || '{}');
    cwd = parsed.cwd || process.cwd();
  } catch {
    cwd = process.cwd();
  }
  const normalized = resolve(cwd);
  if (!isWithinRoot(normalized, REPO_ROOT) || !existsSync(resolve(REPO_ROOT, 'package.json'))) {
    process.exit(0);
  }

  // Fire-and-forget: equivalente a `npm run session:autostart:detached`, invocando node
  // directamente (spawn de npm.cmd sin shell falla con EINVAL en Node >= 18).
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', resolve(REPO_ROOT, 'src', 'session-autostart-detached.ts')],
    { cwd: REPO_ROOT, detached: true, stdio: 'ignore', windowsHide: true },
  );
  child.on('error', () => {
    /* nunca bloquear la sesión por un fallo del hook */
  });
  child.unref();
  process.exit(0);
}

void main();
