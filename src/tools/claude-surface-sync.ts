#!/usr/bin/env node
/**
 * claude-surface-sync.ts — superficie `.claude/` (Claude Code en el workspace) sin rutas muertas.
 *
 * POR QUÉ EXISTE (2026-11-18)
 * -------------------------------------------------------------------------
 * `.claude/` es una superficie GENERADA (gitignored) que el stack nunca declaró ni
 * regeneró. Eso dejó dos promesas falsas en la superficie de un host:
 *
 *   1. `.claude/settings.json` apuntaba a rutas que ya NO existen:
 *      `docs/AGENTS.md`, `src/pre-process-input.ts`, `src/detect-tool.ts`,
 *      `src/adaptive-opencode-profile.ts`, `src/token-usage-notifier.ts`,
 *      `rules/NORMATIVAS-CODIGO.md`, `skills/SKILL_INDEX.md`,
 *      `skills/docker-devops-skill/SKILL.md`. El arranque que ese archivo describe
 *      promete comandos que no resuelven: es un guardrail de mentira (la UI afirma,
 *      el backend nunca lo comprobó).
 *
 *   2. `.claude/skills` tenía 9 junctions y 8 apuntaban a skills inexistentes
 *      (`.agents/skills/<nombre>`): enlaces rotos que el host lee como skills.
 *
 * REGLA
 * -----
 * El generador NUNCA fabrica una ruta: cada corrección apunta a algo que existe en
 * el repo en el momento de aplicarla, y lo que no se puede resolver se REPORTA como
 * pendiente en vez de inventarse. Un gris declarado es una deuda conocida; un gris
 * silencioso es un defecto.
 *
 * USO
 *   node --import tsx src/tools/claude-surface-sync.ts            # reporte
 *   node --import tsx src/tools/claude-surface-sync.ts --check    # exit 1 si hay hallazgos
 *   node --import tsx src/tools/claude-surface-sync.ts --write    # corrige y escribe
 *   node --import tsx src/tools/claude-surface-sync.ts --json
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CRITICAL_SKILLS } from '../integrations/zcode-sync.js';

export const CLAUDE_DIR = '.claude';
export const CLAUDE_SETTINGS_REL = join(CLAUDE_DIR, 'settings.json');
export const CLAUDE_SKILLS_REL = join(CLAUDE_DIR, 'skills');

/** Extensiones que convierten un token en una ruta de archivo del repo. */
const PATH_EXTENSIONS = [
  '.ts',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.yaml',
  '.yml',
  '.toml',
  '.txt',
  '.sh',
];

/**
 * Correcciones de rutas muertas → rutas vivas. Cada `to` se valida contra el repo
 * antes de aplicarse: si el destino no existe, la corrección NO se aplica y la ruta
 * queda reportada como pendiente (nunca se inventa).
 */
export const PATH_FIXES: readonly { from: string; to: string; reason: string }[] = [
  {
    from: 'docs/AGENTS.md',
    to: 'AGENTS.md',
    reason: 'el entrypoint canonico esta en la raiz del repo desde el slim de AGENTS.md',
  },
  {
    from: 'src/pre-process-input.ts',
    to: 'src/tools/pre-process-input.ts',
    reason: 'el hook de pre-proceso vive en src/tools/ desde la reorganizacion',
  },
  {
    from: 'src/detect-tool.ts',
    to: 'src/core/detect-tool.ts',
    reason: 'la deteccion de herramienta vive en src/core/',
  },
  {
    from: 'src/adaptive-opencode-profile.ts',
    to: 'src/orchestration/adaptive-opencode-profile.ts',
    reason: 'el perfil adaptativo vive en src/orchestration/',
  },
  {
    from: 'src/token-usage-notifier.ts',
    to: 'src/tokens/token-usage-notifier.ts',
    reason: 'el notificador de uso vive en src/tokens/',
  },
  {
    from: 'rules/NORMATIVAS-CODIGO.md',
    to: 'rules/NORMATIVAS-CODE-QUALITY.md',
    reason: 'la norma se renombro a NORMATIVAS-CODE-QUALITY.md',
  },
  {
    from: 'skills/SKILL_INDEX.md',
    to: 'skills/INDEX.md',
    reason: 'el indice de skills canonicas es skills/INDEX.md',
  },
  {
    from: 'skills/docker-devops-skill/SKILL.md',
    to: 'rules/NORMATIVAS-OPS-DEVOPS.md',
    reason: 'no hay skill docker-devops en el catalogo canonico; se usa la norma de ops',
  },
];

/** Correcciones de comandos: NORM-TS-001 prohibe `npx tsx` en el stack. */
export const COMMAND_FIXES: readonly { from: string; to: string; reason: string }[] = [
  {
    from: 'npx tsx ',
    to: 'node --import tsx ',
    reason: 'NORM-TS-001: los scripts del stack se ejecutan con node --import tsx',
  },
  { from: '-AsJson', to: '--json', reason: 'flag canonico del detector de herramienta' },
  { from: '-UserInput', to: '--input', reason: 'flag canonico del hook de pre-proceso' },
  {
    from: '-WorkspaceRoot',
    to: '--workspace-root',
    reason: 'flag canonico del hook de pre-proceso',
  },
];

export interface ClaudeSurfaceFinding {
  kind: 'dead-path' | 'broken-skill-link' | 'missing-skill-mirror' | 'unresolved';
  detail: string;
}

export interface ClaudeSurfaceReport {
  root: string;
  settingsExists: boolean;
  deadPaths: string[];
  brokenSkillLinks: string[];
  missingSkillMirrors: string[];
  findings: ClaudeSurfaceFinding[];
  ok: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isPathLike(token: string): boolean {
  if (!token || token.includes(' ')) return false;
  if (/^https?:\/\//i.test(token)) return false;
  if (token.startsWith('<') || token.startsWith('$')) return false;
  return PATH_EXTENSIONS.some((ext) => token.toLowerCase().endsWith(ext));
}

/** Tokens tipo ruta dentro de un string (comandos y rutas sueltas). */
export function extractPathTokens(value: string): string[] {
  const cleaned = value.replace(/["']/g, ' ');
  return cleaned
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && isPathLike(t));
}

/** Rutas referenciadas por un JSON (recorrido completo). */
export function collectPathRefs(value: unknown, acc: string[] = []): string[] {
  if (typeof value === 'string') {
    for (const token of extractPathTokens(value)) acc.push(token);
    return acc;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPathRefs(item, acc);
    return acc;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectPathRefs(v, acc);
  }
  return acc;
}

/**
 * Un token con `*` es un glob: no se resuelve como archivo, pero su prefijo estatico
 * tiene que existir (un archivo como `skills/docker-devops-skill/SKILL.md` se resuelve;
 * un glob sobre `skills/` solo exige que el directorio base exista).
 */
function globPrefixExists(root: string, token: string): boolean {
  const idx = token.indexOf('*');
  const prefix = token.slice(0, idx).replace(/[\\/]+$/, '');
  if (!prefix) return true; // glob sin base: no se puede afirmar nada
  return existsSync(resolve(root, prefix));
}

/** Rutas referenciadas que NO existen en el repo. */
export function findDeadPaths(root: string, value: unknown): string[] {
  const dead = new Set<string>();
  for (const ref of collectPathRefs(value)) {
    if (ref.includes('*')) {
      if (!globPrefixExists(root, ref)) dead.add(ref);
      continue;
    }
    if (!existsSync(resolve(root, ref))) dead.add(ref);
  }
  return [...dead];
}

/** Aplica correcciones de rutas y de comandos sobre un string. */
export function applyFixes(root: string, text: string): string {
  let out = text;
  for (const fix of PATH_FIXES) {
    if (!out.includes(fix.from)) continue;
    if (!existsSync(resolve(root, fix.to))) continue; // no inventamos destinos
    out = out.split(fix.from).join(fix.to);
  }
  for (const fix of COMMAND_FIXES) {
    if (out.includes(fix.from)) out = out.split(fix.from).join(fix.to);
  }
  return out;
}

/**
 * Aplica las correcciones a una estructura completa. Los elementos de array que son
 * rutas muertas y NO tienen correccion se eliminan (con registro): una lista de
 * includes que apunta a un archivo inexistente es ruido que rompe el arranque.
 */
export function fixStructure(root: string, value: unknown, removed: string[] = []): unknown {
  if (typeof value === 'string') return applyFixes(root, value);
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      if (
        typeof item === 'string' &&
        isPathLike(item) &&
        !item.includes('*') &&
        !existsSync(resolve(root, item))
      ) {
        const fix = PATH_FIXES.find((f) => f.from === item);
        if (fix && existsSync(resolve(root, fix.to))) {
          out.push(fix.to);
          continue;
        }
        removed.push(item);
        continue;
      }
      out.push(fixStructure(root, item, removed));
    }
    return out;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = fixStructure(root, v, removed);
    }
    return out;
  }
  return value;
}

// ─── Superficie de skills ─────────────────────────────────────────────────────

/**
 * Skills criticas que el stack replica a cada superficie (misma lista que
 * zcode-sync: si el mirror se define distinto al de los demas hosts, el gate
 * `pre-push-skills-refs` deja de ser la verdad).
 */
export function criticalSkillDirs(): string[] {
  return CRITICAL_SKILLS.map((s) => s.dir);
}

/** Origen canonico de una skill critica (stack = `skills/`, opencode = `.opencode/skills/`). */
export function criticalSkillSource(root: string, dir: string): string | null {
  const entry = CRITICAL_SKILLS.find((s) => s.dir === dir);
  if (!entry) return null;
  const base = entry.root === 'opencode' ? join(root, '.opencode', 'skills') : join(root, 'skills');
  const src = join(base, dir);
  return existsSync(join(src, 'SKILL.md')) ? src : null;
}

/** Junctions de `.claude/skills` que apuntan a targets inexistentes. */
export function brokenSkillLinks(root: string): string[] {
  const dir = resolve(root, CLAUDE_SKILLS_REL);
  if (!existsSync(dir)) return [];
  const broken: string[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  for (const name of entries) {
    const full = join(dir, name);
    try {
      if (!lstatSync(full).isSymbolicLink()) continue;
    } catch {
      continue;
    }
    // existsSync sobre un junction roto devuelve false: sirve como detector.
    if (!existsSync(full)) broken.push(join(CLAUDE_SKILLS_REL, name));
  }
  return broken;
}

/** Skills canonicas ausentes en la superficie `.claude/skills`. */
export function missingSkillMirrors(root: string, critical: string[]): string[] {
  const dir = resolve(root, CLAUDE_SKILLS_REL);
  const missing: string[] = [];
  for (const name of critical) {
    const src = criticalSkillSource(root, name);
    if (!src) continue;
    if (!existsSync(join(dir, name))) missing.push(name);
  }
  return missing;
}

// ─── Reporte ──────────────────────────────────────────────────────────────────

export function checkClaudeSurface(root: string): ClaudeSurfaceReport {
  const settingsPath = resolve(root, CLAUDE_SETTINGS_REL);
  const settingsExists = existsSync(settingsPath);
  const deadPaths: string[] = [];
  const findings: ClaudeSurfaceFinding[] = [];

  if (settingsExists) {
    try {
      const parsed = JSON.parse(readFileSync(settingsPath, 'utf-8')) as unknown;
      for (const dead of findDeadPaths(root, parsed)) {
        deadPaths.push(dead);
        findings.push({ kind: 'dead-path', detail: dead });
      }
    } catch (err) {
      findings.push({
        kind: 'unresolved',
        detail: `settings.json ilegible: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  } else {
    findings.push({
      kind: 'unresolved',
      detail: 'no existe .claude/settings.json (superficie no generada en esta maquina)',
    });
  }

  const broken = brokenSkillLinks(root);
  for (const link of broken) findings.push({ kind: 'broken-skill-link', detail: link });

  const critical = criticalSkillDirs();
  const missing = missingSkillMirrors(root, critical);
  for (const name of missing) {
    findings.push({ kind: 'missing-skill-mirror', detail: `${CLAUDE_SKILLS_REL}/${name}` });
  }

  return {
    root,
    settingsExists,
    deadPaths,
    brokenSkillLinks: broken,
    missingSkillMirrors: missing,
    findings,
    ok: findings.length === 0,
  };
}

// ─── Escritura ────────────────────────────────────────────────────────────────

export interface SyncResult {
  wrote: string[];
  removed: string[];
  moved: string[];
  unresolved: string[];
  report: ClaudeSurfaceReport;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function syncClaudeSurface(root: string): SyncResult {
  const wrote: string[] = [];
  const removed: string[] = [];
  const moved: string[] = [];
  const unresolved: string[] = [];

  // 1. settings.json: corregir rutas y comandos, sin inventar destinos.
  const settingsPath = resolve(root, CLAUDE_SETTINGS_REL);
  if (existsSync(settingsPath)) {
    try {
      const parsed = JSON.parse(readFileSync(settingsPath, 'utf-8')) as unknown;
      const dropped: string[] = [];
      const fixed = fixStructure(root, parsed, dropped);
      const dead = findDeadPaths(root, fixed);
      for (const deadPath of dead) unresolved.push(deadPath);
      const next = `${JSON.stringify(fixed, null, 2)}\n`;
      const current = readFileSync(settingsPath, 'utf-8');
      if (next !== current) {
        // Backup antes de sobrescribir: la superficie es gitignored, no hay
        // historial en el clon que la pueda restaurar.
        const backupDir = join(
          resolve(root, '.session', 'snapshots', 'claude-surface'),
          timestamp(),
        );
        mkdirSync(backupDir, { recursive: true });
        writeFileSync(join(backupDir, 'settings.json'), current, 'utf-8');
        moved.push(`settings.json -> ${relative(root, join(backupDir, 'settings.json'))}`);
        mkdirSync(join(root, CLAUDE_DIR), { recursive: true });
        writeFileSync(settingsPath, next, 'utf-8');
        wrote.push(CLAUDE_SETTINGS_REL);
      }
      removed.push(...dropped);
    } catch (err) {
      unresolved.push(
        `settings.json ilegible: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 2. skills: apartar los junctions rotos y replicar las criticas canonicas.
  //    Los rotos NO se borran: se APARTAN a un snapshot (movimiento reversible).
  //    Un junction roto no tiene contenido que perder, pero moverlo deja
  //    trazabilidad y evita una destruccion silenciosa de archivos untracked.
  const skillsDir = resolve(root, CLAUDE_SKILLS_REL);
  if (existsSync(skillsDir)) {
    const broken = brokenSkillLinks(root);
    if (broken.length > 0) {
      const quarantine = join(
        resolve(root, '.session', 'snapshots', 'claude-surface', timestamp()),
      );
      mkdirSync(quarantine, { recursive: true });
      for (const link of broken) {
        const full = resolve(root, link);
        try {
          renameSync(full, join(quarantine, basename(link)));
          moved.push(`${link} -> ${relative(root, join(quarantine, basename(link)))}`);
        } catch (err) {
          unresolved.push(
            `no se pudo apartar el junction roto ${link}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  }
  const critical = criticalSkillDirs();
  mkdirSync(skillsDir, { recursive: true });
  for (const name of critical) {
    const src = criticalSkillSource(root, name);
    if (!src) continue;
    const dst = join(skillsDir, name);
    if (existsSync(dst)) continue;
    try {
      symlinkSync(src, dst, 'junction');
      wrote.push(`${CLAUDE_SKILLS_REL}/${name}`);
    } catch (err) {
      unresolved.push(
        `no se pudo crear el junction ${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { wrote, removed, moved, unresolved, report: checkClaudeSurface(root) };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const root = resolve(process.env.GENTLE_VANGUARD_BASE_DIR ?? process.cwd());
  const json = args.includes('--json');

  if (args.includes('--write')) {
    const result = syncClaudeSurface(root);
    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const file of result.wrote) console.log(`  ✓ escrito: ${file}`);
      for (const file of result.removed) console.log(`  ✓ removido: ${file}`);
      for (const file of result.moved) console.log(`  ✓ apartado: ${file}`);
      for (const item of result.unresolved) console.log(`  ✗ sin resolver: ${item}`);
      console.log(
        `Superficie .claude: ${result.report.ok ? 'OK' : `${result.report.findings.length} hallazgo(s)`}`,
      );
    }
    process.exit(result.report.ok ? 0 : 1);
  }

  const report = checkClaudeSurface(root);
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('Superficie .claude (Claude Code) — rutas y enlaces');
    console.log('-----------------------------------------------');
    console.log(`  settings.json: ${report.settingsExists ? 'presente' : 'ausente'}`);
    console.log(`  rutas muertas:  ${report.deadPaths.length}`);
    console.log(`  enlaces rotos: ${report.brokenSkillLinks.length}`);
    console.log(`  mirrors faltantes: ${report.missingSkillMirrors.length}`);
    for (const finding of report.findings) console.log(`  ✗ [${finding.kind}] ${finding.detail}`);
    console.log(report.ok ? '  OK: sin hallazgos' : '  FAIL: hay hallazgos');
  }
  if (args.includes('--check')) process.exit(report.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
