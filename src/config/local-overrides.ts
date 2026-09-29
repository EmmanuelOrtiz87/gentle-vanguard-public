#!/usr/bin/env node
/**
 * config/local-overrides.ts — Runtime precedence for the 3-tier governance model.
 *
 * Reads config/local/<name>.json (user-local layer, gitignored) and merges it
 * OVER config/<name>.json (canon). Precedence: local wins (docs/GOVERNANCE-USERS.md).
 *
 * Pure core (resolveConfig) is unit-testable; I/O is injected via loaders.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type MergeStrategy = 'shallow' | 'deep';

/**
 * Pure merge: local values win. Objects merge shallowly per top-level key
 * (arrays and scalars are replaced wholesale — predictable and safe).
 */
export function resolveConfig(
  canon: Record<string, unknown> | null,
  local: Record<string, unknown> | null,
): Record<string, unknown> {
  const base = canon ?? {};
  const overlay = local ?? {};
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const baseVal = out[key];
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      baseVal !== null &&
      typeof baseVal === 'object' &&
      !Array.isArray(baseVal)
    ) {
      out[key] = { ...(baseVal as Record<string, unknown>), ...(value as Record<string, unknown>) };
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** I/O adapter: load a config by name with local>canon precedence. */
export function loadConfig(root: string, name: string): Record<string, unknown> {
  const canonPath = join(root, 'config', `${name}.json`);
  const localPath = join(root, 'config', 'local', `${name}.json`);
  const read = (p: string): Record<string, unknown> | null => {
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  return resolveConfig(read(canonPath), read(localPath));
}

const invoked = process.argv[1] ?? '';
if (invoked.endsWith('local-overrides.ts')) {
  // CLI: print the effective config for a name (debug helper)
  const name = process.argv[2];
  if (!name) {
    console.error('Usage: tsx src/config/local-overrides.ts <config-name>');
    process.exit(2);
  }
  const effective = loadConfig(resolve(process.cwd()), name);
  console.log(JSON.stringify(effective, null, 2));
}
