/**
 * Script-path AUTO-HEAL — self-improvement guardrail for pipeline configs.
 *
 * TS migrations moved scripts into domain folders (src/knowledge/, src/ops/, …)
 * while config files kept the legacy top-level path (src/<name>.ts). Instead of
 * surfacing a one-shot WARN every session, the pipeline resolves the real file
 * by basename and PERSISTS the corrected path back into the config (with a .bak
 * backup). A healed config never warns again on later sessions.
 *
 * Pure by design (no module-level state, all IO via explicit options) so it is
 * unit-testable in isolation; the caller (session-autostart) owns audit/WARN
 * logging and the shared basename index.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, relative, resolve } from 'path';

export interface PipelineStepLike {
  id: string;
  script: string;
  args?: string;
  required?: boolean;
  phase?: number;
  lazy?: boolean;
  enabled?: boolean;
  description?: string;
}

export interface PipelineConfigLike {
  pipeline: { steps: PipelineStepLike[] };
}

export interface HealPatch {
  id: string;
  from: string;
  to: string;
}

export interface MissingScript {
  id: string;
  script: string;
}

export interface HealResult {
  /** Steps fixed in-memory (and, when configPath is provided, persisted). */
  healed: number;
  /** Steps whose corrected path was written back to the config file. */
  persisted: number;
  patches: HealPatch[];
  /** Enabled steps whose script could not be resolved to a real file. */
  stillMissing: MissingScript[];
}

export interface HealOptions {
  /** Pre-built basename index (avoids re-walking src/ per call). */
  index?: Map<string, string>;
  /** Session-autostart config file to persist corrections into (with .bak). */
  configPath?: string;
  /** Where to write the unresolved-scripts report (JSON). */
  reportPath?: string;
}

const AUTO_HEAL_MAX_DEPTH = 8;

/**
 * Single-pass basename → relative-path index of every TS file under `dir`,
 * walking at most AUTO_HEAL_MAX_DEPTH levels. First match wins (most specific
 * top-level order) and separators are normalized to `/` for cross-platform
 * config portability.
 */
export function indexScriptPaths(root: string, dir: string): Map<string, string> {
  const index = new Map<string, string>();
  const stack = [{ dir: resolve(dir), depth: 0 }];
  while (stack.length > 0) {
    const { dir: current, depth } = stack.pop()!;
    if (depth > AUTO_HEAL_MAX_DEPTH) continue;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue; // unreadable dir → skip
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push({ dir: full, depth: depth + 1 });
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !index.has(entry.name)) {
        index.set(entry.name, relative(resolve(root), full).replace(/\\/g, '/'));
      }
    }
  }
  return index;
}

/**
 * Resolve a configured script path, falling back to a basename lookup when the
 * configured path does not exist. Returns the (possibly unchanged) script when
 * no match is found — the caller decides how to surface the failure.
 */
export function resolveScriptPath(
  root: string,
  script: string,
  index?: Map<string, string>,
): string {
  if (existsSync(join(root, script))) return script;
  const base = script.split(/[\\/]/).pop() ?? '';
  if (!base) return script;
  const real = (index ?? indexScriptPaths(root, join(root, 'src'))).get(base);
  return real ?? script;
}

/**
 * Auto-heal every enabled step whose script path is missing:
 *  1. resolve the real file by basename and patch the in-memory config (this run),
 *  2. persist the corrections into `configPath` (durable self-repair, .bak backup),
 *  3. report unresolved paths to `reportPath` for external monitoring (watchtower).
 *
 * All IO is best-effort: persistence/report failures never abort the heal.
 */
export function healStepScriptPaths(
  root: string,
  config: PipelineConfigLike,
  opts: HealOptions = {},
): HealResult {
  const candidates = config.pipeline.steps.filter(
    (s) => s.enabled === true && !!s.script,
  );
  const result: HealResult = { healed: 0, persisted: 0, patches: [], stillMissing: [] };

  if (candidates.length === 0) return result;

  const missing = candidates.filter((s) => !existsSync(join(root, s.script)));
  if (missing.length === 0) return result;

  const index = opts.index ?? indexScriptPaths(root, join(root, 'src'));
  const patches = new Map<string, string>();
  for (const step of missing) {
    const base = step.script.split(/[\\/]/).pop() ?? '';
    const real = index.get(base);
    if (real && real !== step.script) {
      const from = step.script;
      patches.set(step.id, real);
      step.script = real; // patch in-memory so the current run uses the fixed path
      result.patches.push({ id: step.id, from, to: real });
    }
  }
  result.healed = patches.size;

  // Durable self-repair: write the corrections back into the config file.
  if (patches.size > 0 && opts.configPath && existsSync(opts.configPath)) {
    try {
      const raw = JSON.parse(readFileSync(opts.configPath, 'utf-8')) as PipelineConfigLike;
      let applied = 0;
      for (const step of raw.pipeline.steps) {
        const fixed = patches.get(step.id);
        if (fixed) {
          step.script = fixed;
          applied++;
        }
      }
      if (applied > 0) {
        writeFileSync(`${opts.configPath}.bak`, readFileSync(opts.configPath, 'utf-8'), 'utf-8');
        writeFileSync(opts.configPath, JSON.stringify(raw, null, 2) + '\n', 'utf-8');
        result.persisted = applied;
      }
    } catch {
      /* best-effort — heal still applies to the current run */
    }
  }

  const stillMissing = candidates.filter((s) => !existsSync(join(root, s.script)));
  result.stillMissing = stillMissing.map((s) => ({ id: s.id, script: s.script }));

  if (result.stillMissing.length > 0 && opts.reportPath) {
    try {
      mkdirSync(join(root, '.runtime'), { recursive: true });
      writeFileSync(
        opts.reportPath,
        JSON.stringify(
          { generatedAt: new Date().toISOString(), missing: result.stillMissing },
          null,
          2,
        ) + '\n',
        'utf-8',
      );
    } catch {
      /* best-effort */
    }
  }

  return result;
}