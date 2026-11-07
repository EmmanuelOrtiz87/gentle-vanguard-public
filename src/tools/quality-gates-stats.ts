#!/usr/bin/env node

/**
 * Recalculate the derived `stats` block of config/quality-gates.json.
 *
 * The `gates[]` array is the source of truth. The `stats` block is a summary of
 * it, and it drifted: the file described 30 gates while `stats` still said 29,
 * with an enforced/not-enforced split that no longer matched any gate.
 *
 * Usage:
 *   npm run gates:stats            # rewrite the stats block
 *   npm run gates:stats -- --check # exit 1 if the block is stale (CI gate)
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

interface Gate {
  id: string;
  stage?: string;
  enforced?: boolean;
}

interface QualityGatesFile {
  gates?: Gate[];
  stats?: Record<string, unknown>;
  [key: string]: unknown;
}

const LEFTHOOK_STAGES = new Set(['pre-commit', 'commit-msg', 'post-commit', 'pre-push']);

function repoRoot(): string {
  const fromEnv = process.env.GV_REPO_ROOT;
  if (fromEnv) return fromEnv;
  const cwd = process.cwd();
  // The tool lives at <root>/src/tools/; walk up until config/quality-gates.json exists.
  let dir = cwd;
  for (let i = 0; i < 6; i += 1) {
    if (readFileSyncSafe(join(dir, 'config', 'quality-gates.json'))) return dir;
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return cwd;
}

function readFileSyncSafe(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function lefthookVersion(root: string): string {
  const raw = readFileSyncSafe(join(root, 'package.json'));
  if (!raw) return 'unknown';
  try {
    const pkg = JSON.parse(raw) as { devDependencies?: Record<string, string>; dependencies?: Record<string, string> };
    const spec = pkg.devDependencies?.lefthook ?? pkg.dependencies?.lefthook;
    return spec ? spec.replace(/^[\^~>=<\s]+/, '') : 'unknown';
  } catch {
    return 'unknown';
  }
}

export function computeStats(gates: Gate[], lefthook: string, today: string) {
  const enforced = gates.filter((g) => g.enforced === true);
  return {
    note:
      'Derivado del array gates[] de este archivo: el array es la fuente de verdad y estos numeros se recalculan con npm run gates:stats. Si un gate cambia de stage o de enforced, este bloque cambia con el.',
    totalGates: gates.length,
    enforcedInLefthook: enforced.filter((g) => LEFTHOOK_STAGES.has(g.stage ?? '')).length,
    enforcedInCI: enforced.filter((g) => g.stage === 'ci').length,
    enforcedInRuntime: enforced.filter((g) => g.stage === 'runtime').length,
    notEnforced: gates.filter((g) => g.enforced !== true).length,
    lefthookVersion: lefthook,
    lastVerified: today,
  };
}

function main(): void {
  const check = process.argv.includes('--check');
  const root = repoRoot();
  const file = join(root, 'config', 'quality-gates.json');
  const raw = readFileSyncSafe(file);
  if (!raw) {
    console.error(`gates:stats -> no se encontro ${file}`);
    process.exit(2);
  }

  const parsed = JSON.parse(raw) as QualityGatesFile;
  const gates = parsed.gates ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const next = computeStats(gates, lefthookVersion(root), today);
  const current = parsed.stats ?? {};

  const stale = Object.keys(next).some((key) => {
    const a = JSON.stringify(current[key]);
    const b = JSON.stringify((next as Record<string, unknown>)[key]);
    return a !== b;
  });

  if (check) {
    if (stale) {
      console.error('gates:stats -> el bloque stats esta desactualizado. Corre: npm run gates:stats');
      console.error(`  actual:  ${JSON.stringify(current)}`);
      console.error(`  esperado:${JSON.stringify(next)}`);
      process.exit(1);
    }
    const enforcedTotal =
      next.enforcedInLefthook + next.enforcedInCI + next.enforcedInRuntime;
    console.log(
      `gates:stats -> al dia (${next.totalGates} gates, ${enforcedTotal} enforced)`
    );
    return;
  }

  parsed.stats = next;
  writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  console.log(
    `gates:stats -> ${next.totalGates} gates | lefthook ${next.enforcedInLefthook} | ci ${next.enforcedInCI} | runtime ${next.enforcedInRuntime} | sin enforce ${next.notEnforced}`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
