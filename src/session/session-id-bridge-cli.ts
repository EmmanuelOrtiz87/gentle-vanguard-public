/**
 * session-id-bridge-cli.ts — CLI para el puente de namespaces de session ids.
 *
 * Uso:
 *   npx tsx src/session/session-id-bridge-cli.ts --backfill            (dry-run default)
 *   npx tsx src/session/session-id-bridge-cli.ts --backfill --apply
 *   npx tsx src/session/session-id-bridge-cli.ts --stats
 */

import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import {
  NEXUS_DB,
  aliasStats,
  backfillAliases,
  backfillTraces,
  ensureAliasTable,
} from './session-id-bridge.js';

const args = process.argv.slice(2);
const has = (f: string): boolean => args.includes(f);

function main(): void {
  if (!has('--backfill') && !has('--backfill-traces') && !has('--stats')) {
    console.log(
      'Uso: session-id-bridge-cli --backfill [--apply] [--tolerance-min N] | --backfill-traces [--apply] | --stats',
    );
    process.exit(1);
  }
  if (!existsSync(NEXUS_DB)) {
    console.error(`Nexus DB no encontrada: ${NEXUS_DB}`);
    process.exit(1);
  }
  const db = new Database(NEXUS_DB);
  try {
    ensureAliasTable(db);
    if (has('--stats')) {
      const s = aliasStats(db);
      if (!s) {
        console.log('Sin tabla de alias.');
        return;
      }
      console.log('════════ SESSION ID ALIASES ════════');
      console.log(
        `aliases: ${s.totalAliases} | sesiones: ${s.distinctSessions} | alias-ids: ${s.distinctAliasIds}`,
      );
      for (const b of s.bySource) {
        console.log(`  [${b.source}] n=${b.n} avgConfidence=${b.avgConfidence}`);
      }
      console.log(
        `tokens atribuidos vía alias: ${s.attributedTokens.toLocaleString()} / ${s.totalTxnTokens.toLocaleString()} total (${s.totalTxnTokens > 0 ? ((s.attributedTokens / s.totalTxnTokens) * 100).toFixed(1) : 0}%)`,
      );
      return;
    }
    // --backfill-traces
    if (has('--backfill-traces')) {
      const apply = has('--apply');
      const res = backfillTraces(db, { apply });
      const mode = apply ? 'APPLY' : 'DRY-RUN';
      console.log(`════════ TRACE SESSION BACKFILL — ${mode} ════════`);
      console.log(
        `traces con session_id NULL: ${res.totalNullTraces} | matched: ${res.matched.length} | aplicados: ${res.applied}`,
      );
      console.log(`omitidos: ambiguos=${res.skippedAmbiguous} sin-ventana=${res.skippedNoWindow}`);
      if (res.matched.length > 0) {
        console.log('\nMuestra (primeros 15):');
        for (const m of res.matched.slice(0, 15)) {
          console.log(`  ${m.spanId.slice(0, 32).padEnd(32)} → ${m.sessionId}`);
        }
        if (!apply) console.log('\n(re-ejecutar con --apply para persistir)');
      }
      return;
    }

    // --backfill
    const tolIdx = args.indexOf('--tolerance-min');
    const toleranceMs = tolIdx >= 0 ? Number(args[tolIdx + 1] ?? 2) * 60_000 : 2 * 60_000;
    const apply = has('--apply');
    const res = backfillAliases(db, { apply, toleranceMs });
    const mode = apply ? 'APPLY' : 'DRY-RUN';
    console.log(`════════ SESSION ID BRIDGE — ${mode} ════════`);
    console.log(
      `alias-ids analizados: ${res.totalAliasIds} | candidatos: ${res.candidates.length} | aplicados: ${res.applied}`,
    );
    console.log(
      `omitidos: ambiguos=${res.skippedAmbiguous} sin-ventana=${res.skippedNoWindow} ya-aliaseados=${res.alreadyAliased}`,
    );
    if (res.candidates.length > 0) {
      console.log('\nMuestra (primeros 15):');
      for (const c of res.candidates.slice(0, 15)) {
        console.log(
          `  ${c.aliasId.slice(0, 40).padEnd(40)} → ${c.sessionId} (conf=${c.confidence}, ventana=${Math.round(c.windowMs / 60000)}min)`,
        );
      }
      if (!apply) console.log('\n(re-ejecutar con --apply para persistir)');
    }
  } finally {
    db.close();
  }
}

main();
