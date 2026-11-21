#!/usr/bin/env node
/**
 * engram-dedupe.ts — soft-delete de observaciones DUPLICADAS en el store de Engram.
 *
 * POR QUÉ (2026-11-18)
 * -------------------------------------------------------------------------
 * El store tiene el mecanismo nativo para esto (`normalized_hash` + `duplicate_count`):
 * cuando una observacion se vuelve a guardar, el store cuenta el duplicado. Pero
 * cada guardado repetido dejo una FILA nueva: el store sabe que son la misma cosa
 * y aun asi las conserva. Medido sobre el store real:
 *
 *   - 8.549 observaciones vivas
 *   - 189 grupos con contenido identico (hash compartido)
 *   - 4.062 observaciones dentro de esos grupos -> 3.873 sobrantes (45% del store)
 *
 * El origen historico ya esta corregido (audit P0-2: el "compact" hacia
 * export+import sobre el MISMO proyecto y se auto-logueaba con "Auto-compact run";
 * 420 filas de ese ruido seguian vivas). Este script limpia el residuo.
 *
 * QUE HACE Y QUE NO HACE
 *   - Soft-delete (deleted_at) + `superseded_by_sync_id` apuntando al keeper: la
 *     fila queda en el store, es reversible y el indice FTS lo sacan los triggers
 *     del propio store (obs_fts_update / obs_fts_update_insert).
 *   - NO borra en hard, NO toca relaciones, NO toca prompts ni sesiones.
 *   - El keeper es el MAS ANTIGUO del grupo (el original): el mas reciente suele
 *     ser la copia. Las filas pineadas nunca se borran.
 *
 * USO
 *   node --import tsx src/ops/engram-dedupe.ts             # dry-run (default)
 *   node --import tsx src/ops/engram-dedupe.ts --apply     # aplica + recibo
 *   node --import tsx src/ops/engram-dedupe.ts --json
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface DuplicateGroup {
  hash: string;
  keeperId: number;
  keeperSyncId: string;
  removedIds: number[];
  removedCount: number;
  pinnedIds: number[];
}

export interface DedupeReport {
  dbPath: string;
  liveBefore: number;
  liveAfter: number;
  groups: number;
  removed: number;
  duplicateCountMerged: number;
  removedIds: number[];
  keptPinned: number;
}

const DB_PATH = resolve(process.env.ENGRAM_DB_PATH ?? 'C:/Users/emman/.engram/engram.db');

function normalize(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

interface Row {
  id: number;
  sync_id: string;
  title: string;
  content: string;
  normalized_hash: string | null;
  duplicate_count: number;
  created_at: string;
  pinned: number;
}

/** Analiza el store (solo lectura) y devuelve los grupos de duplicados. */
export function analyzeDuplicates(dbPath = DB_PATH): {
  live: number;
  groups: DuplicateGroup[];
  duplicateCountMerged: number;
} {
  if (!existsSync(dbPath)) return { live: 0, groups: [], duplicateCountMerged: 0 };
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .prepare(
        `SELECT id, sync_id, title, content, normalized_hash, duplicate_count, created_at, pinned
         FROM observations
         WHERE deleted_at IS NULL`,
      )
      .all() as Row[];

    const buckets = new Map<string, Row[]>();
    for (const row of rows) {
      const hash = row.normalized_hash?.trim()
        ? row.normalized_hash.trim()
        : `fallback:${normalize(row.title)}|${normalize(row.content)}`;
      const list = buckets.get(hash) ?? [];
      list.push(row);
      buckets.set(hash, list);
    }

    const groups: DuplicateGroup[] = [];
    let duplicateCountMerged = 0;
    for (const [hash, list] of buckets) {
      if (list.length < 2) continue;
      const pinned = list.filter((r) => r.pinned === 1);
      const candidates = pinned.length ? list : list;
      const sorted = [...candidates].sort(
        (a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id,
      );
      const keeper = sorted[0];
      const removed = sorted.slice(1).filter((r) => r.pinned !== 1);
      if (removed.length === 0) continue;
      duplicateCountMerged += removed.reduce((acc, r) => acc + (r.duplicate_count ?? 0), 0);
      groups.push({
        hash,
        keeperId: keeper.id,
        keeperSyncId: keeper.sync_id,
        removedIds: removed.map((r) => r.id),
        removedCount: removed.length,
        pinnedIds: pinned.map((r) => r.id),
      });
    }
    groups.sort((a, b) => b.removedCount - a.removedCount);
    return { live: rows.length, groups, duplicateCountMerged };
  } finally {
    db.close();
  }
}

/**
 * Aplica el soft-delete en UNA transaccion. El store tiene triggers que sacan la
 * fila del indice FTS cuando deleted_at pasa de NULL a un valor.
 */
export function applyDedupe(
  groups: DuplicateGroup[],
  dbPath = DB_PATH,
): { removed: number; duplicateCountMerged: number } {
  const db = new Database(dbPath);
  try {
    db.pragma('busy_timeout = 15000');
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const softDelete = db.prepare(
      `UPDATE observations
       SET deleted_at = ?, superseded_by_sync_id = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
    );
    const mergeCount = db.prepare(
      `UPDATE observations SET duplicate_count = duplicate_count + ?, updated_at = ? WHERE id = ?`,
    );
    let removed = 0;
    let duplicateCountMerged = 0;
    const run = db.transaction(() => {
      for (const group of groups) {
        const rows = db
          .prepare(
            `SELECT id, duplicate_count FROM observations WHERE id IN (${group.removedIds
              .map(() => '?')
              .join(',')})`,
          )
          .all(...group.removedIds) as Array<{ id: number; duplicate_count: number }>;
        const sum = rows.reduce((acc, r) => acc + (r.duplicate_count ?? 0), 0);
        for (const id of group.removedIds) {
          const info = softDelete.run(now, group.keeperSyncId, now, id);
          removed += info.changes;
        }
        if (sum > 0) {
          mergeCount.run(sum, now, group.keeperId);
          duplicateCountMerged += sum;
        }
      }
    });
    run();
    return { removed, duplicateCountMerged };
  } finally {
    db.close();
  }
}

/**
 * Cierra relaciones `pending` que quedaron sin objeto: si una de las dos
 * observaciones fue soft-deleted, el par ya no se puede juzgar (no hay memoria
 * viva que relacionar). Se marcan como `not_conflict` con el motivo: no es un
 * juicio semantico, es la consecuencia mecanica del dedupe.
 */
export function closeObsoletePendingRelations(dbPath = DB_PATH): {
  closed: number;
  remaining: number;
} {
  const db = new Database(dbPath);
  try {
    db.pragma('busy_timeout = 15000');
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const close = db.prepare(
      `UPDATE memory_relations
       SET judgment_status = 'judged', relation = 'not_conflict',
           reason = ?, evidence = NULL, confidence = 1.0,
           marked_by_actor = 'gentle-vanguard:engram-dedupe',
           marked_by_kind = 'mechanical', updated_at = ?
       WHERE judgment_status = 'pending'
         AND (
           EXISTS (SELECT 1 FROM observations o WHERE o.sync_id = memory_relations.source_id AND o.deleted_at IS NOT NULL)
           OR EXISTS (SELECT 1 FROM observations o WHERE o.sync_id = memory_relations.target_id AND o.deleted_at IS NOT NULL)
         )`,
    );
    const info = close.run('observation soft-deleted as duplicate', now);
    const remaining = (
      db
        .prepare(`SELECT COUNT(*) c FROM memory_relations WHERE judgment_status = 'pending'`)
        .get() as { c: number }
    ).c;
    return { closed: info.changes, remaining };
  } finally {
    db.close();
  }
}

function writeReceipt(report: DedupeReport): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = resolve('.session', 'snapshots', 'engram-dedupe', stamp);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'receipt.json');
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  return file;
}

function main(): void {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const json = args.includes('--json');
  const analysis = analyzeDuplicates();
  const removedTotal = analysis.groups.reduce((acc, g) => acc + g.removedCount, 0);

  if (!apply) {
    if (json) {
      console.log(
        JSON.stringify(
          {
            dbPath: DB_PATH,
            liveBefore: analysis.live,
            groups: analysis.groups.length,
            removable: removedTotal,
            top: analysis.groups.slice(0, 10).map((g) => ({
              hash: g.hash.slice(0, 12),
              keeperId: g.keeperId,
              removed: g.removedCount,
            })),
          },
          null,
          2,
        ),
      );
    } else {
      console.log('Engram dedupe — dry-run (nada escrito)');
      console.log(`  observaciones vivas: ${analysis.live}`);
      console.log(`  grupos duplicados:   ${analysis.groups.length}`);
      console.log(`  filas a soft-delete: ${removedTotal}`);
      console.log(`  duplicate_count a consolidar: ${analysis.duplicateCountMerged}`);
      for (const g of analysis.groups.slice(0, 10)) {
        console.log(`   x${g.removedCount}\thash=${g.hash.slice(0, 12)}\tkeeper=${g.keeperId}`);
      }
      console.log('  aplicar con: --apply');
    }
    return;
  }

  const applied = applyDedupe(analysis.groups);
  const relations = closeObsoletePendingRelations();
  const after = analyzeDuplicates();
  const report: DedupeReport = {
    dbPath: DB_PATH,
    liveBefore: analysis.live,
    liveAfter: after.live,
    groups: analysis.groups.length,
    removed: applied.removed,
    duplicateCountMerged: applied.duplicateCountMerged,
    removedIds: analysis.groups.flatMap((g) => g.removedIds),
    keptPinned: analysis.groups.reduce((acc, g) => acc + g.pinnedIds.length, 0),
  };
  const receipt = writeReceipt(report);
  console.log(
    `Engram dedupe — aplicado: ${applied.removed} soft-delete(s) | ` +
      `vivas ${report.liveBefore} -> ${report.liveAfter} | grupos restantes ${after.groups.length}`,
  );
  console.log(
    `  relaciones pending sin objeto cerradas: ${relations.closed} | pendientes reales: ${relations.remaining}`,
  );
  console.log(`  recibo: ${receipt}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
