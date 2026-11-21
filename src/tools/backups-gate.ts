/**
 * backups-gate.ts — NORMATIVA-BACKUPS-DOCUMENTOS, ahora operable (GB-20261120).
 *
 * La norma era papel: "operación masiva sobre docs/clientes exige respaldo previo"
 * y el respaldo (`guard:snapshot`) era un comando MANUAL que nada obligaba a
 * correr — el incidente de origen (2026-10-06, 13 docs truncados) se recuperó
 * "por suerte, no por diseño", y esa frase seguía siendo literalmente cierta.
 *
 * Este gate AUTOMATIZA la norma en el pre-commit: si el diff staged contiene una
 * operación masiva (>= BACKUP_MASS_THRESHOLD archivos borrados/renombrados bajo
 * docs/clientes/), verifica que exista un snapshot reciente (SNAPSHOT_FRESH_MS);
 * si no lo hay, LO EJECUTA él mismo antes de dejar pasar el commit. El respaldo
 * deja de depender de la memoria del agente.
 *
 * Uso: node --import tsx src/tools/backups-gate.ts
 * (wireado en .lefthook.yml pre-commit; catálogo: pre-commit-backups-docs)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const CLIENTS_DIR = 'docs/clientes/';
export const BACKUP_MASS_THRESHOLD = 5;
export const SNAPSHOT_FRESH_MS = 4 * 60 * 60 * 1000; // 4 horas

export interface StagedChange {
  status: string; // A | M | D | R100...
  path: string;
}

/** Cambios staged (name-status). Exportado para tests. */
export function stagedChanges(gitDir = ROOT): StagedChange[] {
  const out = execFileSync('git', ['-C', gitDir, 'diff', '--cached', '--name-status'], {
    encoding: 'utf-8',
    windowsHide: true,
    timeout: 30_000,
  });
  return out
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      const [status, ...rest] = l.split('\t');
      return { status: (status ?? '').trim(), path: rest.join('\t') };
    });
}

/**
 * ¿Es una operación masiva sobre docs/clientes? Borra/renombra
 * >= BACKUP_MASS_THRESHOLD entradas bajo docs/clientes/. Exportado para tests.
 */
export function isMassClientsDeletion(changes: StagedChange[]): boolean {
  const destructive = changes.filter(
    (c) =>
      (c.path.startsWith(CLIENTS_DIR) || c.path.includes('\t' + CLIENTS_DIR)) &&
      (c.status.startsWith('D') || c.status.startsWith('R') || c.status.startsWith('M')),
  );
  return destructive.length >= BACKUP_MASS_THRESHOLD;
}

/** Snapshot más reciente y su edad. Exportado para tests. */
export function latestSnapshotAgeMs(
  snapshotsRoot = join(ROOT, '.session', 'snapshots', 'untracked'),
  now = Date.now(),
): { ageMs: number | null; dir: string | null } {
  if (!existsSync(snapshotsRoot)) return { ageMs: null, dir: null };
  const dirs = readdirSync(snapshotsRoot).filter((d) => !d.startsWith('.'));
  if (dirs.length === 0) return { ageMs: null, dir: null };
  let newest = '';
  let newestMs = 0;
  for (const d of dirs) {
    const m = statSync(join(snapshotsRoot, d)).mtimeMs;
    if (m > newestMs) {
      newestMs = m;
      newest = d;
    }
  }
  return { ageMs: now - newestMs, dir: newest };
}

function main(): void {
  const changes = stagedChanges();
  if (!isMassClientsDeletion(changes)) {
    console.log('[backups-gate] sin operación masiva sobre docs/clientes — OK');
    return;
  }
  const { ageMs, dir } = latestSnapshotAgeMs();
  if (ageMs !== null && ageMs < SNAPSHOT_FRESH_MS) {
    console.log(
      `[backups-gate] operación masiva sobre docs/clientes con snapshot fresco (${dir}, hace ${Math.round(ageMs / 60000)} min) — OK`,
    );
    return;
  }
  console.log(
    '[backups-gate] operación masiva sobre docs/clientes SIN snapshot fresco — ejecutando guard:snapshot automáticamente (NORMATIVA-BACKUPS-DOCUMENTOS, ahora operable)...',
  );
  execFileSync('node', ['--import', 'tsx', 'src/ops/untracked-snapshot.ts'], {
    encoding: 'utf-8',
    stdio: 'inherit',
    windowsHide: true,
    timeout: 120_000,
  });
  const after = latestSnapshotAgeMs();
  if (after.ageMs === null || after.ageMs > SNAPSHOT_FRESH_MS) {
    console.error('[backups-gate] FAIL: el snapshot no pudo crearse — commit bloqueado.');
    process.exitCode = 1;
    return;
  }
  console.log(`[backups-gate] snapshot creado (${after.dir}) — commit autorizado con respaldo.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
