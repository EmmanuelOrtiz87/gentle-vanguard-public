/**
 * Worktree hygiene (BL-2026-11-16 — patrón recurrente GitHub Copilot).
 *
 * Cada vez que Copilot (u otra herramienta) opera en un worktree quedan:
 *  - candidatos sin commit que nadie homologa,
 *  - regenerables medidos en el entorno del worktree (facts-drift 40 vs 45),
 *  - espejos de herramientas sin clasificar (~1300 archivos),
 *  - worktrees stale que nadie cierra.
 *
 * Este reporte es el paso OBLIGATORIO de homologación: clasifica cada
 * worktree no-primario y dice qué falta para poder eliminarlo. NUNCA borra
 * sin --clean + worktree totalmente homologado (rama fusionada + limpio):
 * el guardrail de destrucción del stack manda (norma 2026-09-19).
 *
 * Uso:
 *   npx tsx src/ops/worktree-hygiene.ts                 # reporte
 *   npx tsx src/ops/worktree-hygiene.ts --clean <path>  # elimina SOLO si homologado
 */
import { runSync } from '../core/run-command.js';
import { resolve } from 'node:path';

export type WorktreeClass =
  'primary' | 'homologado' | 'candidato-pendiente' | 'stale' | 'desconocido';

export interface WorktreeEntry {
  path: string;
  head: string;
  branch: string | null; // null = detached HEAD
  primary: boolean;
  /** La rama (o head) está completamente contenida en main. */
  merged: boolean;
  /** Entradas de git status --porcelain en el worktree (tracked+untracked). */
  dirtyCount: number;
  clazz: WorktreeClass;
}

export function parseWorktrees(
  porcelain: string,
): Array<{ path: string; head: string; branch: string | null }> {
  const out: Array<{ path: string; head: string; branch: string | null }> = [];
  let current: { path: string; head: string; branch: string | null } = {
    path: '',
    head: '',
    branch: null,
  };
  for (const line of porcelain.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      if (current.path) out.push(current);
      current = { path: line.slice('worktree '.length), head: '', branch: null };
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length);
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length);
    } else if (line === 'detached') {
      current.branch = null;
    }
  }
  if (current.path) out.push(current);
  return out;
}

export function classify(entry: {
  path: string;
  head: string;
  branch: string | null;
  primary: boolean;
  merged: boolean;
  dirtyCount: number;
}): WorktreeClass {
  if (entry.primary) return 'primary';
  // -1 = git status falló (worktree inaccesible): no se afirma limpio. Un
  // worktree ilegible clasificado como homologado desbloquea --clean sobre
  // trabajo que quizá existe.
  if (entry.dirtyCount < 0) return 'desconocido';
  if (entry.dirtyCount > 0) return 'candidato-pendiente';
  if (!entry.branch) return entry.merged ? 'stale' : 'desconocido';
  return entry.merged ? 'homologado' : 'candidato-pendiente';
}

function git(args: string[], cwd?: string): string {
  const r = runSync('git', cwd ? ['-C', cwd, ...args] : args, { timeout: 30000 });
  return (r.stdout || '').toString().trim();
}

export function collectWorktrees(): WorktreeEntry[] {
  const porcelain = git(['worktree', 'list', '--porcelain']);
  const entries = parseWorktrees(porcelain);
  const primaryPath = entries[0]?.path ?? resolve(process.cwd());
  // Referencia de fusión: la rama del worktree primario (no hardcodear main —
  // repos con default branch distinto darían merged=false para todo).
  const primaryBranch = (entries[0]?.branch ?? 'refs/heads/main').replace(/^refs\/heads\//, '');
  const mainSha = git(['rev-parse', primaryBranch]);
  return entries.map((e) => {
    let merged = false;
    if (mainSha) {
      const target = e.branch ?? e.head;
      if (target) {
        const r = runSync('git', ['merge-base', '--is-ancestor', target, mainSha], {
          timeout: 15000,
        });
        merged = r.status === 0;
      }
    }
    let dirtyCount = 0;
    try {
      dirtyCount = git(['status', '--porcelain', '--untracked-files=normal'], e.path)
        .split('\n')
        .filter(Boolean).length;
    } catch {
      dirtyCount = -1; // worktree inaccesible
    }
    const base = { ...e, primary: e.path === primaryPath, merged, dirtyCount };
    return { ...base, clazz: classify(base) };
  });
}

export function report(entries: WorktreeEntry[]): string {
  const lines: string[] = [];
  const counts = new Map<WorktreeClass, number>();
  for (const e of entries) {
    counts.set(e.clazz, (counts.get(e.clazz) ?? 0) + 1);
    const flag =
      e.clazz === 'homologado'
        ? '✓ puede eliminarse (--clean)'
        : e.clazz === 'candidato-pendiente'
          ? `✗ homologar antes: ${e.dirtyCount} entrada(s) sin commit`
          : e.clazz === 'stale'
            ? '✓ stale (detached, fusionado) — eliminable'
            : e.clazz === 'desconocido'
              ? '✗ detached SIN fusionar — revisar antes de tocar'
              : 'workspace principal';
    lines.push(`[${e.clazz}] ${e.path}${e.branch ? ` (${e.branch})` : ' (detached)'} — ${flag}`);
  }
  const summary = [...counts.entries()].map(([k, v]) => `${k}=${v}`).join(', ');
  return `worktree-hygiene: ${entries.length} worktree(s) — ${summary}\n${lines.join('\n')}`;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const entries = collectWorktrees();
  console.log(report(entries));

  const cleanIdx = argv.indexOf('--clean');
  if (cleanIdx === -1) return 0;

  const target = resolve(argv[cleanIdx + 1] ?? '');
  const entry = entries.find((e) => resolve(e.path) === target);
  if (!entry || entry.primary) {
    console.error(
      `worktree-hygiene: --clean rechazado: '${target}' no es un worktree registrado no-primario`,
    );
    return 1;
  }
  if (entry.clazz !== 'homologado' && entry.clazz !== 'stale') {
    console.error(
      `worktree-hygiene: --clean rechazado: '${target}' está '${entry.clazz}'. Homologá (commit/merge o descarte con decisión del owner) antes de eliminar.`,
    );
    return 1;
  }
  // Guardrail de destrucción: snapshot antes de cualquier eliminación.
  const snap = runSync('node', ['--import', 'tsx', 'src/ops/untracked-snapshot.ts'], {
    timeout: 120000,
  });
  if (snap.status !== 0) {
    console.error('worktree-hygiene: guard:snapshot falló — no se elimina nada');
    return 1;
  }
  const rm = runSync('git', ['worktree', 'remove', '--force', entry.path], { timeout: 120000 });
  if (rm.status !== 0) {
    console.error(
      `worktree-hygiene: git worktree remove falló: ${(rm.stderr || '').toString().trim()}`,
    );
    return 1;
  }
  console.log(
    `worktree-hygiene: '${entry.path}' eliminado (snapshot previo en .session/snapshots/untracked/)`,
  );
  return 0;
}

// CLI Guard pattern (normalizado para rutas Windows)
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename ?? process.argv[1])
) {
  main()
    .then((code) => process.exit(code))
    .catch(() => process.exit(1));
}
