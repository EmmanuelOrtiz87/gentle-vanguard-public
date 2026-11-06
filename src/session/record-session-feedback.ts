#!/usr/bin/env node
/**
 * Record Session Feedback — convierte el feedback VERBAL del owner en datos
 * de eval reales (tabla feedback, 👍/👎 por traza).
 *
 * GAP cerrado: el owner da feedback en la sesion ("quedo bien/mal") pero ese
 * feedback nunca llegaba a la tabla feedback -> EvalsPanel del dashboard se
 * veia vacio. Este script resuelve las trazas de la sesion (via
 * session_id_aliases + traces) y inserta un registro de feedback por traza.
 *
 * Uso:
 *   npx tsx src/session/record-session-feedback.ts --type up   [--session <id>] [--note "..."]
 *   npx tsx src/session/record-session-feedback.ts --type down [--session <id>] [--note "..."]
 *   Sin --session usa la sesion actual del repo (.session/session-current.json).
 *   --days N: ventana de trazas hacia atras (default 1 = trazas de las ultimas 24h de la sesion)
 */
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import Database from 'better-sqlite3';

const ROOT = resolve(process.cwd());
const NEXUS = join(ROOT, '.runtime', 'gentle-vanguard.db');

function currentSessionId(): string | null {
  const p = join(ROOT, '.session', 'session-current.json');
  if (!existsSync(p)) return null;
  try {
    const s = JSON.parse(readFileSync(p, 'utf-8')) as { sessionId?: string; id?: string };
    return s.sessionId ?? s.id ?? null;
  } catch { return null; }
}

function main(): void {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const type = get('--type') ?? '';
  const sessionArg = get('--session');
  const note = get('--note');
  const days = Math.max(1, parseInt(get('--days') ?? '1', 10) || 1);
  if (type !== 'up' && type !== 'down') {
    console.error('[feedback] --type debe ser up o down');
    process.exit(1);
  }
  const sessionId = sessionArg ?? currentSessionId();
  if (!sessionId) {
    console.error('[feedback] sin sesion: pasar --session <id> o correr desde el repo con sesion activa');
    process.exit(1);
  }
  if (!existsSync(NEXUS)) {
    console.error('[feedback] Nexus no existe:', NEXUS);
    process.exit(1);
  }
  const db = new Database(NEXUS);
  try {
    // ids de sesion: la propia + aliases nativos que apunten a ella
    const ids: string[] = [sessionId];
    const aliases = db
      .prepare('SELECT alias_id FROM session_id_aliases WHERE session_id = ?')
      .all(sessionId) as Array<{ alias_id: string }>;
    ids.push(...aliases.map((a) => a.alias_id));
    const placeholders = ids.map(() => '?').join(',');
    const since = Date.now() - days * 86_400_000;
    const traces = db
      .prepare(
        `SELECT trace_id, span_id FROM traces
         WHERE tenant_id = 'gentle-vanguard' AND session_id IN (${placeholders})
           AND end_time >= ? ORDER BY end_time DESC LIMIT 500`,
      )
      .all(...ids, since) as Array<{ trace_id: string; span_id: string }>;
    if (traces.length === 0) {
      console.log(`[feedback] sin trazas para sesion ${sessionId} en las ultimas ${days}d — nada que registrar`);
      process.exit(0);
    }
    const ins = db.prepare(
      `INSERT INTO feedback (tenant_id, trace_id, span_id, type, created_at)
       VALUES ('gentle-vanguard', ?, ?, ?, ?)`,
    );
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      for (const t of traces) ins.run(t.trace_id, t.span_id, type, now);
    });
    tx();
    console.log(`[feedback] ${type.toUpperCase()} registrada en ${traces.length} traza(s) de la sesion ${sessionId}${note ? ' — nota: ' + note : ''}`);
    console.log('[feedback] EvalsPanel del dashboard lo refleja en el proximo refresh');
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
