#!/usr/bin/env node
/**
 * Self-Mutation Guard — M7 containment for auto-mutating components.
 *
 * Guards critical configs against unvalidated self-modification by agents,
 * reflection loops, or automation. Before any write to a protected config,
 * run this guard to verify the current file is well-formed JSON and has the
 * expected top-level keys. If the file is corrupted or missing required
 * schema keys, the guard FAILS and blocks the mutation.
 *
 * Usage:
 *   npx tsx src/self-mutation-guard.ts --check              # check all protected configs
 *   npx tsx src/self-mutation-guard.ts --check agents.json  # check one config
 *   npx tsx src/self-mutation-guard.ts --approve <file>     # stamp an approval (pre-write)
 *
 * Import:
 *   import { assertConfigIntegrity } from './self-mutation-guard.js';
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

const ROOT = resolve(process.cwd());

/**
 * Protected configs with their required top-level keys (schema-lite).
 * Add new configs here to extend protection.
 */
const PROTECTED: Array<{ file: string; requiredKeys: string[] }> = [
  {
    file: 'config/session-autostart.config.json',
    requiredKeys: ['version', 'name', 'pipeline'],
  },
  {
    file: 'config/agents.json',
    requiredKeys: ['version', 'agents'],
  },
  {
    file: 'config/model-router.json',
    requiredKeys: ['version', 'defaults', 'profiles'],
  },
  {
    file: 'config/adaptive-router.json',
    requiredKeys: ['version', 'minDataPoints', 'sources'],
  },
  {
    file: 'opencode.json',
    requiredKeys: ['$schema', 'agent'],
  },
];

interface GuardResult {
  file: string;
  ok: boolean;
  issues: string[];
  approvedAt?: string;
}

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/**
 * Validate a single protected config. Returns ok=false with issues if the
 * file is missing, invalid JSON, or lacks required top-level keys.
 */
export function checkConfigIntegrity(file: string): GuardResult {
  const spec = PROTECTED.find((p) => p.file === file);
  const issues: string[] = [];

  if (!spec) {
    return { file, ok: true, issues: ['Not in protected list — skipped'] };
  }

  const fullPath = join(ROOT, file);
  if (!existsSync(fullPath)) {
    return { file, ok: false, issues: [`File missing: ${file}`] };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = loadJson(fullPath) as Record<string, unknown>;
  } catch (e) {
    return {
      file,
      ok: false,
      issues: [`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`],
    };
  }

  for (const key of spec.requiredKeys) {
    if (!(key in parsed)) {
      issues.push(`Missing required key: ${key}`);
    }
  }

  return { file, ok: issues.length === 0, issues };
}

/**
 * Assert integrity of a protected config before mutation.
 * Throws on failure so callers can abort the write.
 */
export function assertConfigIntegrity(file: string): void {
  const result = checkConfigIntegrity(file);
  if (!result.ok) {
    throw new Error(`Self-mutation guard BLOCKED write to ${file}: ${result.issues.join('; ')}`);
  }
}

/**
 * Stamp an approval marker (used by the guard CLI to record pre-write validation).
 */
export function approveWrite(file: string): GuardResult {
  const result = checkConfigIntegrity(file);
  if (result.ok) {
    const marker = join(ROOT, '.runtime', 'guard-approved.log');
    const line = JSON.stringify({
      file,
      approvedAt: new Date().toISOString(),
      via: 'self-mutation-guard',
    });
    try {
      const dir = join(ROOT, '.runtime');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      // Append (not overwrite) — keep approval trail
      writeFileSync(marker, line + '\n', { flag: 'a' });
    } catch {
      // non-blocking
    }
  }
  return result;
}

function parseArgs(argv: string[]): { mode: 'check' | 'approve'; file?: string; all: boolean } {
  const args: { mode: 'check' | 'approve'; file?: string; all: boolean } = {
    mode: 'check',
    file: undefined,
    all: true,
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--check') args.mode = 'check';
    else if (argv[i] === '--approve') args.mode = 'approve';
    else if (argv[i] === '--file' && argv[i + 1]) {
      args.file = argv[++i];
      args.all = false;
    }
  }
  return args;
}

function main(): void {
  const { mode, file, all } = parseArgs(process.argv);

  const targets = all ? PROTECTED.map((p) => p.file) : [file as string];

  let failures = 0;
  for (const t of targets) {
    const result = mode === 'approve' ? approveWrite(t) : checkConfigIntegrity(t);
    const status = result.ok ? 'OK' : 'FAIL';
    if (!result.ok) failures++;
    console.log(`[${status}] ${result.file}`);
    for (const issue of result.issues) {
      if (issue !== 'Not in protected list — skipped') console.log(`       ${issue}`);
    }
    if (result.approvedAt) console.log(`       approved ${result.approvedAt}`);
  }

  console.log(
    `\n${failures === 0 ? 'All protected configs valid.' : `${failures} config(s) FAILED integrity.`}`,
  );
  if (failures > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export type { GuardResult };
