#!/usr/bin/env node
/**
 * engram-maintenance.ts — higiene operativa de la memoria (Engram v3).
 *
 * El store acumula dos clases de ruido medibles:
 *  - WAL sobredimensionado: con un lector long-lived (MCP) el autocheckpoint de
 *    SQLite no avanza; medido 61.6 MB de WAL sobre 92 MB de DB (2026-11-19).
 *  - Auto-logs de mantenimiento ("Auto-compact run", "Duplicate cleanup check",
 *    "Context efficiency optimization run", "--title"): son trazas de ejecucion,
 *    no memoria; su lugar es Nexus, no el plano de memoria.
 *
 * Uso:
 *   node --import tsx src/tools/engram-maintenance.ts                 # reporte
 *   node --import tsx src/tools/engram-maintenance.ts --checkpoint    # checkpoint WAL si supera umbral
 *   node --import tsx src/tools/engram-maintenance.ts --prune-noise   # dry-run de poda
 *   node --import tsx src/tools/engram-maintenance.ts --prune-noise --apply
 *   node --import tsx src/tools/engram-maintenance.ts --backup        # VACUUM INTO en ~/.engram/backups
 *   --json para salida estructurada.
 *
 * La poda es soft-delete (deleted_at), el mismo estado que `engram delete`;
 * `engram doctor`/`sync` la tratan como tombstone. Nunca borra contenido duro.
 */

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const DATA_DIR = process.env.ENGRAM_DATA_DIR?.trim()
  ? process.env.ENGRAM_DATA_DIR.trim()
  : join(homedir(), '.engram');
const DB_PATH = join(DATA_DIR, 'engram.db');

/** Titulos de trazas de ejecucion, no de memoria. */
export const NOISE_TITLES = [
  'Auto-compact run',
  'Duplicate cleanup check',
  'Context efficiency optimization run',
  '--title',
] as const;

/** Ratio WAL/DB a partir del cual un checkpoint deja de ser cosmetico. */
export const WAL_RATIO_THRESHOLD = 0.2;

export interface EngramReport {
  dbPath: string;
  dbBytes: number;
  walBytes: number;
  walRatio: number;
  live: number;
  softDeleted: number;
  noiseByTitle: { title: string; count: number }[];
  sessionSummaryTitles: { title: string; count: number }[];
}

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function open(readonly: boolean): Database.Database {
  return new Database(DB_PATH, { readonly, timeout: 5000 });
}

export function buildReport(db: Database.Database): EngramReport {
  const dbBytes = existsSync(DB_PATH) ? statSync(DB_PATH).size : 0;
  const walPath = `${DB_PATH}-wal`;
  const walBytes = existsSync(walPath) ? statSync(walPath).size : 0;
  const live = (
    db.prepare('SELECT COUNT(*) c FROM observations WHERE deleted_at IS NULL').get() as {
      c: number;
    }
  ).c;
  const softDeleted = (
    db.prepare('SELECT COUNT(*) c FROM observations WHERE deleted_at IS NOT NULL').get() as {
      c: number;
    }
  ).c;
  const noiseByTitle = db
    .prepare(
      `SELECT title, COUNT(*) count FROM observations
        WHERE deleted_at IS NULL AND title IN (${NOISE_TITLES.map(() => '?').join(',')})
        GROUP BY title ORDER BY count DESC`,
    )
    .all(...NOISE_TITLES) as { title: string; count: number }[];
  const sessionSummaryTitles = db
    .prepare(
      `SELECT title, COUNT(*) count FROM observations
        WHERE deleted_at IS NULL AND title LIKE 'Session summary:%'
        GROUP BY title ORDER BY count DESC LIMIT 8`,
    )
    .all() as { title: string; count: number }[];
  return {
    dbPath: DB_PATH,
    dbBytes,
    walBytes,
    walRatio: dbBytes > 0 ? walBytes / dbBytes : 0,
    live,
    softDeleted,
    noiseByTitle,
    sessionSummaryTitles,
  };
}

/**
 * Checkpoint WAL. TRUNCATE deja el archivo en cero; si otro lector lo impide,
 * PASSIVE avanza lo posible sin bloquear ni fallar el pipeline.
 */
export function checkpointWal(db: Database.Database): {
  mode: 'truncate' | 'passive';
  busy: number;
  log: number;
  checkpointed: number;
} {
  const run = (mode: 'TRUNCATE' | 'PASSIVE') => {
    const r = db.pragma(`wal_checkpoint(${mode})`) as Array<{
      busy: number;
      log: number;
      checkpointed: number;
    }>;
    return r[0] ?? { busy: -1, log: -1, checkpointed: -1 };
  };
  const trunc = run('TRUNCATE');
  if (trunc.busy === 0) return { mode: 'truncate', ...trunc };
  const passive = run('PASSIVE');
  return { mode: 'passive', ...passive };
}

export function pruneNoise(
  db: Database.Database,
  options: { apply: boolean; keepPerTitle?: number },
): { title: string; candidates: number; deleted: number }[] {
  const keep = options.keepPerTitle ?? 0;
  const results: { title: string; candidates: number; deleted: number }[] = [];
  for (const title of NOISE_TITLES) {
    const ids = (
      db
        .prepare(
          `SELECT id FROM observations WHERE deleted_at IS NULL AND title = ?
            ORDER BY created_at DESC`,
        )
        .all(title) as { id: number }[]
    ).map((row) => row.id);
    const doomed = ids.slice(keep);
    if (options.apply && doomed.length > 0) {
      const stmt = db.prepare(`UPDATE observations SET deleted_at = datetime('now') WHERE id = ?`);
      const tx = db.transaction((list: number[]) => {
        for (const id of list) stmt.run(id);
      });
      tx(doomed);
    }
    results.push({ title, candidates: doomed.length, deleted: options.apply ? doomed.length : 0 });
  }
  return results;
}

function backup(db: Database.Database): string {
  const dir = join(DATA_DIR, 'backups');
  mkdirSync(dir, { recursive: true });
  const target = join(dir, `engram-pre-maint-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  return target;
}

function main(): void {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const apply = argv.includes('--apply');

  if (!existsSync(DB_PATH)) {
    console.error(`engram-maintenance: no existe ${DB_PATH}`);
    process.exit(1);
  }

  const writable = apply || argv.includes('--checkpoint') || argv.includes('--backup');
  const db = open(!writable);

  try {
    const report = buildReport(db);
    const out: Record<string, unknown> = {
      report: { ...report, dbSize: mb(report.dbBytes), walSize: mb(report.walBytes) },
    };

    if (argv.includes('--backup')) out.backup = backup(db);
    if (argv.includes('--prune-noise')) {
      out.prune = pruneNoise(db, { apply });
    }
    if (argv.includes('--checkpoint')) {
      const before = existsSync(`${DB_PATH}-wal`) ? statSync(`${DB_PATH}-wal`).size : 0;
      out.checkpoint = checkpointWal(db);
      const after = existsSync(`${DB_PATH}-wal`) ? statSync(`${DB_PATH}-wal`).size : 0;
      out.checkpoint = { ...(out.checkpoint as object), before: mb(before), after: mb(after) };
    }

    if (json) {
      console.log(JSON.stringify(out, null, 2));
      return;
    }

    console.log(
      `engram -> ${mb(report.dbBytes)} DB + ${mb(report.walBytes)} WAL ` +
        `(ratio ${(report.walRatio * 100).toFixed(0)}%), ${report.live} vivas, ${report.softDeleted} soft-deleted`,
    );
    if (report.noiseByTitle.length > 0) {
      console.log('  ruido de auto-log:');
      for (const row of report.noiseByTitle) console.log(`    ${row.count}x ${row.title}`);
    }
    if (out.backup) console.log(`  backup: ${out.backup}`);
    if (out.prune) {
      const pruned = out.prune as { title: string; candidates: number; deleted: number }[];
      const total = pruned.reduce((acc, row) => acc + row.candidates, 0);
      console.log(
        `  poda de ruido: ${total} candidatas ${apply ? 'soft-deleted' : '(dry-run, usar --apply)'}`,
      );
    }
    const checkpoint = out.checkpoint as
      { mode: string; before: string; after: string } | undefined;
    if (checkpoint) {
      console.log(
        `  checkpoint WAL (${checkpoint.mode}): ${checkpoint.before} -> ${checkpoint.after}`,
      );
    }
  } finally {
    db.close();
  }
}

if (
  process.argv[1]?.endsWith('engram-maintenance.ts') ||
  process.argv[1]?.endsWith('engram-maintenance.js')
) {
  main();
}
