#!/usr/bin/env node
/**
 * engram-judge-deterministic.ts — cierra relaciones `pending` de Engram SIN LLM.
 *
 * POR QUE (2026-11-18)
 * -------------------------------------------------------------------------
 * El dedupe por `normalized_hash` ya limpio el store (9.955 -> 5.745 vivas,
 * 214 grupos duplicados -> 0). Lo que queda son 1.041 relaciones `pending`:
 * pares candidatos entre observaciones VIVAS que el store propone y que nadie
 * ha resuelto.
 *
 * Caracterizacion medida (muestra completa):
 *   - 0 pares con hash compartido (no es dedupe: ya no hay duplicados)
 *   - 262 pares comparten titulo EXACTO
 *     · 127 de esos tienen contenido casi identico (Jaccard de tokens >= 0.7):
 *       el MISMO hecho re-logueado con otro timestamp ("Duplicate check run at
 *       15:13:28" vs "16:16:27"). NO se contradicen: no hay conflicto.
 *     · 135 comparten titulo pero el contenido es distinto: son relaciones
 *       reales (no deterministas).
 *   - 779 pares con titulos distintos: relaciones reales, NO deterministas.
 *
 * REGLA: este script solo cierra lo que se puede PROBAR sin juicio semantico:
 * mismo titulo + contenido equivalente (Jaccard >= 0.7). Todo lo demas queda
 * `pending` (deuda declarada). Un LLM no se usa: sin un modelo con cuota ni
 * con criterio, un juicio automatico sobre los otros pares seria inventar.
 *
 * USO
 *   node --import tsx src/ops/engram-judge-deterministic.ts            # dry-run
 *   node --import tsx src/ops/engram-judge-deterministic.ts --apply
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DB_PATH = join(homedir(), '.engram', 'engram.db');
const THRESHOLD = 0.7;
const APPLY = process.argv.includes('--apply');

export interface JudgedPair {
  sourceId: string;
  targetId: string;
  title: string;
  similarity: number;
  sourceType: string;
  targetType: string;
}

export interface JudgeReport {
  pendingTotal: number;
  eligible: number;
  sameTitlePairs: number;
  skipped: string[];
  threshold: number;
  applied: boolean;
  receipt: string | null;
}

/** Tokens significativos (ignora numeros sueltos y palabras de 3 letras). */
export function tokensOf(text: string | null): Set<string> {
  return new Set(
    (text ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9ñáéíóúü]+/g, ' ')
      .split(' ')
      .filter((w) => w.length > 3),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export function selectJudgablePairs(
  pairs: Array<{
    source_id: string;
    target_id: string;
    title_a: string;
    title_b: string;
    content_a: string;
    content_b: string;
    type_a: string;
    type_b: string;
  }>,
  threshold = THRESHOLD,
): JudgedPair[] {
  const out: JudgedPair[] = [];
  for (const pair of pairs) {
    if (!pair.title_a || pair.title_a !== pair.title_b) continue;
    const similarity = jaccard(tokensOf(pair.content_a), tokensOf(pair.content_b));
    if (similarity < threshold) continue;
    out.push({
      sourceId: pair.source_id,
      targetId: pair.target_id,
      title: pair.title_a,
      similarity: Number(similarity.toFixed(3)),
      sourceType: pair.type_a,
      targetType: pair.type_b,
    });
  }
  return out;
}

function main(): void {
  if (!existsSync(DB_PATH)) {
    console.error(`no encuentro el store de Engram: ${DB_PATH}`);
    process.exit(2);
  }
  const db = new DatabaseSync(DB_PATH);
  const pending = db
    .prepare(`SELECT COUNT(*) AS n FROM memory_relations WHERE judgment_status = 'pending'`)
    .get() as { n: number };

  const pairs = db
    .prepare(
      `SELECT r.source_id, r.target_id,
              a.title AS title_a, b.title AS title_b,
              a.content AS content_a, b.content AS content_b,
              a.type AS type_a, b.type AS type_b
       FROM memory_relations r
       JOIN observations a ON a.sync_id = r.source_id
       JOIN observations b ON b.sync_id = r.target_id
       WHERE r.judgment_status = 'pending'`,
    )
    .all() as Array<{
    source_id: string;
    target_id: string;
    title_a: string;
    title_b: string;
    content_a: string;
    content_b: string;
    type_a: string;
    type_b: string;
  }>;

  const sameTitle = pairs.filter((p) => p.title_a && p.title_a === p.title_b).length;
  const judged = selectJudgablePairs(pairs);

  console.log(
    `Engram — cierre determinista de relaciones pending${APPLY ? ' (APLICANDO)' : ' (dry-run)'}`,
  );
  console.log(`  relaciones pending: ${pending.n}`);
  console.log(`  pares con mismo titulo: ${sameTitle}`);
  console.log(`  pares deterministas (Jaccard >= ${THRESHOLD}): ${judged.length}`);
  console.log(`  quedan pending sin cierre: ${pending.n - judged.length}`);

  if (judged.length === 0) {
    console.log('  nada que cerrar.');
    db.close();
    return;
  }

  let receipt: string | null = null;
  if (APPLY) {
    const now = new Date().toISOString();
    const stamp = now.replace(/[:.]/g, '-');
    const dir = join(process.cwd(), '.session', 'snapshots', 'engram-judge', stamp);
    mkdirSync(dir, { recursive: true });

    const update = db.prepare(
      `UPDATE memory_relations
       SET judgment_status = 'not_conflict',
           marked_by_actor = 'deterministic-similarity',
           marked_by_kind = 'tool',
           reason = ?,
           updated_at = ?
       WHERE source_id = ? AND target_id = ? AND judgment_status = 'pending'`,
    );
    let closed = 0;
    db.exec('BEGIN');
    try {
      for (const pair of judged) {
        const reason = `mismo titulo + contenido equivalente (Jaccard=${pair.similarity}) -> no hay conflicto`;
        const res = update.run(reason, now, pair.sourceId, pair.targetId);
        closed += Number(res.changes ?? 0);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      console.error(`  ERROR al cerrar (rollback): ${String(error)}`);
      db.close();
      process.exit(1);
    }

    const receiptPath = join(dir, 'judged-deterministic.json');
    writeFileSync(
      receiptPath,
      `${JSON.stringify({ at: now, threshold: THRESHOLD, closed, pairs: judged }, null, 2)}\n`,
      'utf-8',
    );
    receipt = receiptPath;
    console.log(`  cerradas: ${closed}`);
    console.log(`  recibo: ${receipt ?? receiptPath}`);
  } else {
    console.log('  aplicar con: --apply');
  }

  const after = db
    .prepare(`SELECT COUNT(*) AS n FROM memory_relations WHERE judgment_status = 'pending'`)
    .get() as { n: number };
  console.log(`  pending ahora: ${after.n}`);
  db.close();
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main();
}
