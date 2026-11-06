#!/usr/bin/env node
/**
 * Orphan Native Sessions — enforcement del autostart por observabilidad.
 *
 * El autostart es una instruccion (AGENTS.md), no un enforcement: un cliente
 * que no lo ejecuta no crea sesion en el context-log y sus tokens quedan sin
 * atribuir. Este detector hace que NADA escape en silencio: lista las sesiones
 * nativas del ledger token_transactions que NO tienen alias hacia una sesion
 * del stack (session_id_aliases) ni coinciden con el context-log.
 *
 * Uso:
 *   npx tsx src/tokens/orphan-native-sessions.ts            # reporte
 *   npx tsx src/tokens/orphan-native-sessions.ts --json     # machine-readable
 *   npm run metrics:orphans                                 # alias
 *
 * Exit code: 0 siempre (observabilidad, no bloqueo). El output alimenta el
 * log de la tarea y puede engancharse a alerts.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import Database from 'better-sqlite3';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NEXUS_DB = join(ROOT, '.runtime', 'gentle-vanguard.db');
const CONTEXT_LOG_DIR = join(ROOT, '.session', 'context-log');

export interface OrphanReport {
  checkedAt: string;
  nativeSessions: number;
  orphanSessions: number;
  orphanTokens: number;
  totalTokens: number;
  orphans: Array<{ sessionId: string; agent: string | null; tokens: number; lastSeen: string }>;
}

export function collectOrphanNativeSessions(dbPath = NEXUS_DB, contextLogDir = CONTEXT_LOG_DIR): OrphanReport {
  const empty: OrphanReport = {
    checkedAt: new Date().toISOString(),
    nativeSessions: 0,
    orphanSessions: 0,
    orphanTokens: 0,
    totalTokens: 0,
    orphans: [],
  };
  if (!existsSync(dbPath)) return empty;
  const db = new Database(dbPath, { readonly: true });
  try {
    // ids de sesion del context-log local (stack)
    const localStackIds = new Set<string>();
    if (existsSync(contextLogDir)) {
      try {
        for (const d of readdirSync(contextLogDir)) localStackIds.add(d);
      } catch { /* best-effort */ }
    }
    const rows = db
      .prepare(
        `SELECT session_id, MAX(agent) as agent, SUM(input_tokens + output_tokens) as tokens,
                MAX(created_at) as last_seen
         FROM token_transactions WHERE tenant_id = 'gentle-vanguard'
         GROUP BY session_id`,
      )
      .all() as Array<{ session_id: string; agent: string | null; tokens: number; last_seen: string }>;
    // aliases: native -> stack
    let aliases = new Set<string>();
    try {
      const aliasRows = db
        .prepare(`SELECT DISTINCT alias_id FROM session_id_aliases`)
        .all() as Array<{ alias_id: string }>;
      aliases = new Set(aliasRows.map((r) => r.alias_id));
    } catch { /* tabla puede no existir */ }
    const orphans: OrphanReport['orphans'] = [];
    let nativeSessions = 0;
    let totalTokens = 0;
    for (const r of rows) {
      nativeSessions++;
      totalTokens += r.tokens;
      const attributed = aliases.has(r.session_id) || localStackIds.has(r.session_id);
      if (!attributed) {
        orphans.push({
          sessionId: r.session_id,
          agent: r.agent,
          tokens: r.tokens,
          lastSeen: r.last_seen,
        });
      }
    }
    orphans.sort((a, b) => b.tokens - a.tokens);
    return {
      checkedAt: new Date().toISOString(),
      nativeSessions,
      orphanSessions: orphans.length,
      orphanTokens: orphans.reduce((s, o) => s + o.tokens, 0),
      totalTokens,
      orphans: orphans.slice(0, 50),
    };
  } finally {
    db.close();
  }
}

function main(): void {
  const json = process.argv.includes('--json');
  const report = collectOrphanNativeSessions();
  const outPath = join(ROOT, '.runtime', 'metrics', 'orphan-native-sessions.json');
  try {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(report, null, 2));
  } catch { /* best-effort */ }
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const share = report.totalTokens > 0 ? ((report.orphanTokens / report.totalTokens) * 100).toFixed(1) : '0.0';
  console.log(`[orphans] sesiones nativas: ${report.nativeSessions} | sin atribuir: ${report.orphanSessions} (${share}% de tokens)`);
  for (const o of report.orphans.slice(0, 10)) {
    console.log(`  ${o.sessionId} [${o.agent ?? 'unknown'}] ${o.tokens.toLocaleString()} tokens, last ${o.lastSeen}`);
  }
  if (report.orphanSessions > 0) {
    console.log(`[orphans] reporte completo: ${outPath}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
