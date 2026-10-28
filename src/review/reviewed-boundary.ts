#!/usr/bin/env node
/**
 * Reviewed Boundary — absorción Gentle-AI v4.3.1 (PR #5654 + #5635)
 *
 * RDD-lite: permite revisar trabajos a profundidad sin repetir trabajo ya
 * revisado. Mantiene el SHA del último commit con review aceptada
 * ("acknowledged"); la PRÓXIMA revisión parte de ese boundary (delta-based,
 * no full-range). Sin boundary, la base derivada es el merge-base contra el
 * upstream de la rama (comportamiento upstream-first de #5635).
 *
 * Estado: .session/reviewed-boundary.json (gitignored, local-first, derivable:
 * se reconstruye con `ack` o con el fallback upstream — no son datos
 * irrecuperables, ver GB-2026-10-28 S6).
 *
 * Uso:
 *   npx tsx src/review/reviewed-boundary.ts status [--json] [--quiet]
 *   npx tsx src/review/reviewed-boundary.ts ack [sha] [--note <texto>]
 *   npx tsx src/review/reviewed-boundary.ts clear
 *   npx tsx src/review/reviewed-boundary.ts base
 *
 * Feature-doc: docs/features/GB-2026-10-28-reviewed-boundary-absorption.md
 *   (S4,S5,S8)
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runSync } from '../core/run-command.js';

export const STATE_RELATIVE_PATH = join('.session', 'reviewed-boundary.json');

export interface BoundaryState {
  sha: string;
  acknowledgedAt: string;
  note?: string;
}

export interface BoundaryOptions {
  /** Repo root; default process.cwd() */
  root?: string;
  /** Explicit state file override (tests); default <root>/.session/reviewed-boundary.json */
  stateFile?: string;
}

export interface DeltaBase {
  base: string | null;
  /** boundary = acknowledged review; upstream = merge-base con upstream (#5635) */
  source: 'boundary' | 'upstream' | 'none';
}

export interface BoundaryStatus extends DeltaBase {
  head: string | null;
  deltaCount: number | null;
  recentCommits: string[];
}

// ─── State helpers ──────────────────────────────────────────────────

function statePath(opts: BoundaryOptions = {}): string {
  const root = resolve(opts.root ?? process.cwd());
  return opts.stateFile ? resolve(opts.stateFile) : join(root, STATE_RELATIVE_PATH);
}

export function readBoundary(opts: BoundaryOptions = {}): BoundaryState | null {
  const file = statePath(opts);
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as Partial<BoundaryState>;
    if (!raw || typeof raw.sha !== 'string' || typeof raw.acknowledgedAt !== 'string') return null;
    return { sha: raw.sha, acknowledgedAt: raw.acknowledgedAt, note: raw.note };
  } catch {
    return null; // corrupto → se comporta como sin boundary (derivable)
  }
}

function git(root: string, args: string[]): { ok: boolean; out: string } {
  const r = runSync('git', args, { cwd: root, timeout: 20000 });
  return { ok: r.status === 0, out: (r.stdout || '').trim() };
}

/** Verifica que el SHA existe como commit (fail-closed: sha invalido no entra) */
export function shaExists(root: string, sha: string): boolean {
  if (!/^[0-9a-fA-F]{4,40}$/.test(sha)) return false;
  return git(root, ['cat-file', '-e', `${sha}^{commit}`]).ok;
}

export function advanceBoundary(
  sha: string,
  note?: string,
  opts: BoundaryOptions = {},
): BoundaryState {
  const root = resolve(opts.root ?? process.cwd());
  // `sha` puede ser una revisión (HEAD, nombre de rama) o un SHA corto: se
  // resuelve primero y se valida el resultado, no el texto de entrada. Antes
  // `shaExists(sha)` rechazaba 'HEAD' por el filtro hex y el ACK por defecto
  // (sin argumento) nunca funcionaba.
  const full = git(root, ['rev-parse', '--verify', `${sha}^{commit}`]);
  if (!full.ok || !shaExists(root, full.out)) {
    throw new Error(`SHA no existe en este repo (rev-parse falló): ${sha}`);
  }
  const state: BoundaryState = {
    sha: full.out,
    acknowledgedAt: new Date().toISOString(),
    ...(note ? { note } : {}),
  };
  const file = statePath({ ...opts, root });
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  return state;
}

export function clearBoundary(opts: BoundaryOptions = {}): boolean {
  const file = statePath(opts);
  if (!existsSync(file)) return false;
  rmSync(file);
  return true;
}

// ─── Delta base (#5635 upstream-first) ──────────────────────────────

/** merge-base con el upstream de la rama actual; null cuando no hay upstream */
export function deriveUpstreamBase(root: string): string | null {
  const up = git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  if (!up.ok || !up.out) return null;
  const mb = git(root, ['merge-base', 'HEAD', up.out]);
  return mb.ok ? mb.out || null : null;
}

/**
 * Base para el rango de la próxima review: boundary acknowledged primero,
 * fallback upstream merge-base (S5). Núnca asume que todo está revisado.
 */
export function getDeltaBase(opts: BoundaryOptions = {}): DeltaBase {
  const root = resolve(opts.root ?? process.cwd());
  const b = readBoundary({ ...opts, root });
  if (b) return { base: b.sha, source: 'boundary' };
  const upstream = deriveUpstreamBase(root);
  if (upstream) return { base: upstream, source: 'upstream' };
  return { base: null, source: 'none' };
}

/** Status completo: base, HEAD y commits pendientes de revisión desde la base */
export function boundaryStatus(opts: BoundaryOptions = {}): BoundaryStatus {
  const root = resolve(opts.root ?? process.cwd());
  const d = getDeltaBase(opts);
  const head = git(root, ['rev-parse', 'HEAD']);
  const headSha = head.ok ? head.out : null;
  if (!d.base || !headSha || d.base === headSha) {
    return { ...d, head: headSha, deltaCount: d.base && headSha ? 0 : null, recentCommits: [] };
  }
  const count = git(root, ['rev-list', '--count', `${d.base}..${headSha}`]);
  const recent = git(root, ['rev-list', '--oneline', '-n', '5', `${d.base}..${headSha}`]);
  const parsedCount = Number.parseInt(count.ok ? count.out : '', 10);
  return {
    ...d,
    head: headSha,
    deltaCount: Number.isFinite(parsedCount) ? parsedCount : null,
    recentCommits: recent.ok ? recent.out.split('\n').filter((l): l is string => !!l) : [],
  };
}

// ─── CLI ────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { positionals: string[]; note?: string; json: boolean; quiet: boolean } {
  const positionals: string[] = [];
  let note: string | undefined;
  let json = false;
  let quiet = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--note') {
      note = argv[++i] ?? '';
    } else if (a === '--json') {
      json = true;
    } else if (a === '--quiet') {
      quiet = true;
    } else {
      positionals.push(a);
    }
  }
  return { positionals, note, json, quiet };
}

function main(): void {
  const root = process.cwd();
  const [modeArg, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const { json, quiet, note } = args;
  const mode = modeArg || 'status';

  const emitStatus = () => {
    let s: BoundaryStatus;
    try {
      s = boundaryStatus({ root });
    } catch (e) {
      console.error(`[reviewed-boundary] error: ${e instanceof Error ? e.message : e}`);
      process.exit(1);
    }
    if (json) {
      console.log(JSON.stringify(s, null, 2));
      return;
    }
    if (quiet) return; // autostart step: ingestión silenciosa salvo error
    if (s.source === 'boundary') {
      console.log(`[reviewed-boundary] base = ${s.base?.slice(0, 8)} (acknowledged)`);
    } else if (s.source === 'upstream') {
      console.log(`[reviewed-boundary] base = ${s.base?.slice(0, 8)} (upstream merge-base)`);
    } else {
      console.log('[reviewed-boundary] sin base derivable (shallow/plain state)');
    }
    if (s.deltaCount !== null) {
      console.log(`[reviewed-boundary] pendientes de review: ${s.deltaCount}`);
      for (const c of s.recentCommits) console.log(`  ${c}`);
    }
  };

  switch (mode) {
    case 'status':
      emitStatus();
      break;
    case 'base': {
      const d = getDeltaBase({ root });
      console.log(json ? JSON.stringify(d) : d.base ?? 'none');
      break;
    }
    case 'ack': {
      const positional = args.positionals[0];
      const sha = positional || 'HEAD';
      try {
        const st = advanceBoundary(sha, note, { root });
        if (!quiet) {
          console.log(
            `[reviewed-boundary] ACK ${st.sha.slice(0, 8)} — la próxima review parte de aquí.` +
              (st.note ? ` nota: ${st.note}` : ''),
          );
        }
      } catch (e) {
        console.error(`[reviewed-boundary] ack falló: ${e instanceof Error ? e.message : e}`);
        process.exit(1);
      }
      break;
    }
    case 'clear': {
      const removed = clearBoundary({ root });
      if (!quiet) {
        console.log(removed ? '[reviewed-boundary] boundary eliminado' : '[reviewed-boundary] no había boundary');
      }
      break;
    }
    default:
      console.error(`[reviewed-boundary] modo desconocido: ${mode} (status|ack|clear|base)`);
      process.exit(1);
  }
}

const invokedDirectly = /reviewed-boundary\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirectly) main();
