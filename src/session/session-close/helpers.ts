import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { runSync, runNpxTsxSync } from '../../core/run-command.js';
import { log as createLogger } from '../../utils/logger.js';

export const ROOT = resolve(process.cwd());
export const SESSION_DIR = join(ROOT, '.session');
export const RUNTIME_DIR = join(ROOT, '.runtime');

export type PhaseResult = { phase: string; status: 'PASS' | 'FAIL' | 'SKIP'; detail: string };

// ─── Helpers ────────────────────────────────────────────────────────────────────

export const LOG = createLogger('CLOSE');

export function log(msg: string) {
  LOG.info(msg);
}
export function ok(msg: string) {
  LOG.info(`✅ ${msg}`);
}
export function warn(msg: string) {
  LOG.warn(msg);
}

export function getSessionFile(): string {
  return join(SESSION_DIR, 'session-current.json');
}

export function readSessionData(): Record<string, unknown> {
  const fp = getSessionFile();
  if (!existsSync(fp)) return {};
  try {
    return JSON.parse(readFileSync(fp, 'utf-8'));
  } catch {
    return {};
  }
}

export function writeSessionData(data: Record<string, unknown>): void {
  mkdirSync(SESSION_DIR, { recursive: true });
  writeFileSync(getSessionFile(), JSON.stringify(data, null, 2));
  // Also create dated copy
  const dateStr = new Date().toISOString().slice(0, 10);
  const datedFile = join(SESSION_DIR, `session-${dateStr}-01.json`);
  writeFileSync(datedFile, JSON.stringify(data, null, 2));
}

export function runScript(
  script: string,
  args: string[],
  timeout = 60000,
): { status: number; stdout: string } {
  const fullPath = join(ROOT, script);
  if (!existsSync(fullPath)) return { status: -1, stdout: '' };
  try {
    const r = runNpxTsxSync(fullPath, args, {
      cwd: ROOT,
      stdio: 'pipe',
      timeout,
      maxBuffer: 1024 * 1024,
    });
    return { status: r.status ?? -1, stdout: r.stdout };
  } catch {
    return { status: -1, stdout: '' };
  }
}

export function runCmd(
  cmd: string,
  args: string[],
  timeout = 30000,
): { status: number; stdout: string } {
  try {
    const r = runSync(cmd, args, { cwd: ROOT, stdio: 'pipe', timeout, maxBuffer: 1024 * 1024 });
    return { status: r.status ?? -1, stdout: r.stdout };
  } catch {
    return { status: -1, stdout: '' };
  }
}

export function getAllFiles(dir: string, ext: string): string[] {
  const result: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          result.push(...getAllFiles(full, ext));
        }
      } else if (entry.name.endsWith(ext)) {
        result.push(full);
      }
    }
  } catch {
    /* skip unreadable */
  }
  return result;
}

export function getChangedFiles(): Set<string> {
  try {
    const r = runSync('git', ['diff', '--name-only', 'HEAD'], {
      cwd: ROOT,
      stdio: 'pipe',
      timeout: 10000,
    });
    if (r.status === 0) {
      return new Set(
        r.stdout
          .split('\n')
          .filter((l) => l.trim())
          .map((l) => l.trim()),
      );
    }
  } catch {
    /* fallback */
  }
  return new Set();
}
