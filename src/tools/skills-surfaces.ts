#!/usr/bin/env node
/**
 * Reports which skills each tool surface actually sees (read-only).
 *
 * The stack ships 255 canonical skills (`skills/<name>/SKILL.md`) but only the 29
 * CRITICAL ones are copied to each tool mirror: a host that falls behind serves a
 * partial catalog with no visible error, and the audit could not tell "tool has
 * 29 skills" apart from "tool mirror went stale". This report measures every
 * surface instead of assuming the sync ran.
 *
 * Workspace mirrors (.opencode, .github, .antigravity, .kimi-code, .qoder) are
 * stack-generated and fail under --check when critical skills are missing. Host
 * directories (~/.zcode, ~/.codex, ~/.minimax) are host-owned: reported only,
 * never written here.
 *
 * Usage:
 *   node --import tsx src/tools/skills-surfaces.ts            # table
 *   node --import tsx src/tools/skills-surfaces.ts --json     # machine-readable
 *   node --import tsx src/tools/skills-surfaces.ts --check    # exit 1 on workspace gaps
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CRITICAL_SKILLS } from '../integrations/zcode-sync.js';

export interface Surface {
  tool: string;
  path: string;
  kind: 'workspace' | 'host';
}

export interface SurfaceReport extends Surface {
  present: boolean;
  skills: number;
  criticalPresent: number;
  criticalMissing: string[];
  /** Directories present in the mirror that are not CRITICAL skills (local drift). */
  extras: string[];
}

export interface SurfacesReport {
  canonical: number;
  critical: number;
  surfaces: SurfaceReport[];
  ok: boolean;
}

export function defaultSurfaces(root = process.cwd()): Surface[] {
  return [
    { tool: 'opencode', path: join(root, '.opencode', 'skills'), kind: 'workspace' },
    { tool: 'copilot', path: join(root, '.github', 'skills'), kind: 'workspace' },
    { tool: 'antigravity', path: join(root, '.antigravity', 'skills'), kind: 'workspace' },
    { tool: 'kimi', path: join(root, '.kimi-code', 'skills'), kind: 'workspace' },
    { tool: 'qoder', path: join(root, '.qoder', 'skills'), kind: 'workspace' },
    { tool: 'zcode', path: join(homedir(), '.zcode', 'skills'), kind: 'host' },
    { tool: 'codex', path: join(homedir(), '.codex', 'skills'), kind: 'host' },
    {
      tool: 'minimax',
      path: join(homedir(), '.minimax', 'agents', 'mavis', 'skills'),
      kind: 'host',
    },
  ];
}

function skillDirs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => {
      if (entry.isDirectory()) return true;
      // `.opencode/skills/impeccable` is a symlink to the canonical skill.
      if (!entry.isSymbolicLink()) return false;
      try {
        return statSync(join(dir, entry.name)).isDirectory();
      } catch {
        return false;
      }
    })
    .filter((entry) => existsSync(join(dir, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

export function auditSurfaces(
  surfaces: Surface[],
  root = process.cwd(),
  critical: string[] = CRITICAL_SKILLS.map((skill) => skill.dir),
): SurfacesReport {
  const canonical = skillDirs(join(root, 'skills')).length;
  const criticalSet = new Set(critical);
  const reports = surfaces.map((surface): SurfaceReport => {
    if (!existsSync(surface.path)) {
      return {
        ...surface,
        present: false,
        skills: 0,
        criticalPresent: 0,
        criticalMissing: [...critical].sort(),
        extras: [],
      };
    }
    const dirs = skillDirs(surface.path);
    const presentSet = new Set(dirs);
    return {
      ...surface,
      present: true,
      skills: dirs.length,
      criticalPresent: critical.filter((name) => presentSet.has(name)).length,
      criticalMissing: critical.filter((name) => !presentSet.has(name)).sort(),
      extras: dirs.filter((name) => !criticalSet.has(name)),
    };
  });
  const ok = reports.every(
    (report) => report.kind === 'host' || (report.present && report.criticalMissing.length === 0),
  );
  return { canonical, critical: critical.length, surfaces: reports, ok };
}

function render(report: SurfacesReport): string {
  const lines = [
    `[SKILLS-SURFACES] canonical ${report.canonical} | per-tool catalog = ${report.critical} critical skills`,
  ];
  for (const surface of report.surfaces) {
    const label = `${surface.tool} (${surface.kind})`;
    if (!surface.present) {
      lines.push(`  - ${label}: surface absent`);
      continue;
    }
    const state =
      surface.criticalMissing.length === 0
        ? 'complete'
        : `missing ${surface.criticalMissing.length} critical`;
    const extras = surface.extras.length > 0 ? ` | extras: ${surface.extras.join(', ')}` : '';
    lines.push(
      `  - ${label}: ${surface.skills} skills, ${surface.criticalPresent}/${report.critical} critical (${state})${extras}`,
    );
  }
  return lines.join('\n');
}

function main(): void {
  const root = resolve(process.cwd());
  const report = auditSurfaces(defaultSurfaces(root), root);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(render(report));
  }
  if (process.argv.includes('--check') && !report.ok) {
    console.error('[SKILLS-SURFACES] gap in a workspace mirror — run npm run skills:sync:<tool>');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
