#!/usr/bin/env node

/**
 * installer/payload.ts — Stages the installer payload from the repository.
 *
 * The payload is the executable public distribution: source, configuration,
 * docs and lockfile. It never contains secrets, encryption keys, runtime
 * state or node_modules (policy: config/installer-manifest.json
 * `installerPolicy.neverBundlesSecrets`).
 */

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface PayloadResult {
  stagedDir: string;
  copiedEntries: string[];
  skippedSecretPaths: string[];
}

/** Paths that must never enter an installer payload (defense in depth). */
const SECRET_PATH_PATTERNS: RegExp[] = [
  /(^|[/\\])keys([/\\]|$)/i,
  /\.key$/i,
  /\.pem$/i,
  /master\.key/i,
  /(^|[/\\])\.env$/i,
  /(^|[/\\])\.runtime([/\\]|$)/i,
  /(^|[/\\])\.session([/\\]|$)/i,
  /(^|[/\\])\.telemetry([/\\]|$)/i,
  /(^|[/\\])node_modules([/\\]|$)/i,
  /(^|[/\\])dist([/\\]|$)/i,
];

/** Top-level entries copied into the payload (mirrors the public distribution contract). */
export const PAYLOAD_ENTRIES: Array<{ path: string; required: boolean }> = [
  { path: 'src', required: true },
  { path: 'apps/web-dashboard', required: true },
  { path: 'config', required: true },
  { path: 'docs', required: true },
  { path: 'tests/smoke', required: true },
  { path: 'scripts/database', required: true },
  { path: 'scripts/recovery', required: true },
  { path: 'package.json', required: true },
  { path: 'pnpm-lock.yaml', required: true },
  { path: 'pnpm-workspace.yaml', required: true },
  { path: 'tsconfig.json', required: true },
  { path: '.lefthook.yml', required: true },
  { path: 'opencode.json', required: true },
  { path: 'README-PUBLIC.md', required: true },
  { path: 'VERSION', required: false },
  { path: 'LICENSE', required: false },
];

/** True when a relative path matches any secret/state exclusion pattern. */
export function isExcludedPath(relativePath: string): boolean {
  return SECRET_PATH_PATTERNS.some((pattern) => pattern.test(relativePath));
}

/**
 * Copy the payload entries from `repoRoot` into `stagedDir`.
 * Secret paths are refused even if they appear in the entry list.
 */
export function stagePayload(repoRoot: string, stagedDir: string): PayloadResult {
  const root = resolve(repoRoot);
  const target = resolve(stagedDir);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });

  const copiedEntries: string[] = [];
  const skippedSecretPaths: string[] = [];

  for (const entry of PAYLOAD_ENTRIES) {
    if (isExcludedPath(entry.path)) {
      skippedSecretPaths.push(entry.path);
      continue;
    }
    const source = join(root, entry.path);
    if (!existsSync(source)) {
      if (entry.required) throw new Error(`Required payload entry missing: ${entry.path}`);
      continue;
    }
    cpSync(source, join(target, entry.path), {
      recursive: true,
      filter: (src) => {
        const rel = src.slice(root.length + 1);
        return !isExcludedPath(rel);
      },
    });
    copiedEntries.push(entry.path);
  }

  return { stagedDir: target, copiedEntries, skippedSecretPaths };
}
