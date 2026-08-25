/**
 * Query Nexus DB for historical session scoring and token usage metrics.
 * Run: npx tsx src/scripts/query-nexus-metrics.ts
 */
import { existsSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';

const ROOT = process.cwd();
const dbPath = join(ROOT, '.runtime', 'gentle-vanguard.db');

if (!existsSync(dbPath)) {
  console.log('❌ Nexus DB not found at:', dbPath);
  process.exit(1);
}

const d = new Database(dbPath, { readonly: true });

/** Row shape of the session_scoring history query */
interface SessionScoringRow {
  created_at?: string | null;
  session_id?: string | null;
  total_delegations?: number | null;
  success_rate?: number | null;
  total_corrections?: number | null;
  total_proactive?: number | null;
  quality_score?: number | null;
}

/** Row shape of the per-session token usage aggregation */
interface TokenUsageRow {
  session_id?: string | null;
  total_in?: number | null;
  total_out?: number | null;
  total_tok?: number | null;
}

/** Row shape of the daily metric snapshot averages */
interface SnapshotRow {
  day?: string | null;
  avg_tokens?: number | null;
  avg_sessions?: number | null;
}

/** Row shape of the global session_scoring stats query */
interface GlobalStatsRow {
  total_rows?: number | null;
  avg_success_rate?: number | null;
  total_delegations?: number | null;
  total_corrections?: number | null;
  total_proactive?: number | null;
}

console.log('\n═══════════════════════════════════════════');
console.log('   NEXUS DB — Métricas Históricas');
console.log('═══════════════════════════════════════════\n');

// Available tables
const tables = d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
  name: string;
}[];
console.log('Tablas disponibles:', tables.map((t) => t.name).join(', '), '\n');

// 1. Session Scoring
try {
  const rows = d
    .prepare(
      `
    SELECT created_at, session_id, total_delegations, success_rate, 
           total_corrections, total_proactive, quality_score
    FROM session_scoring 
    ORDER BY created_at DESC LIMIT 15
  `,
    )
    .all() as SessionScoringRow[];

  console.log('┌──────────────────────────────────────────────────────────────────────────┐');
  console.log('│ SESSION SCORING — Historial (col: created_at, quality_score, total_proactive) │');
  console.log('├──────────────────────────────────────────────────────────────────────────┤');
  if (rows.length === 0) {
    console.log('│ (sin datos — tabla vacía)                                               │');
  } else {
    rows.forEach((r) => {
      const ts = (r.created_at || '').toString().slice(0, 19);
      const sid = (r.session_id || '').toString().slice(0, 22).padEnd(22);
      console.log(
        `│ ${ts} │ ${sid} │ del:${String(r.total_delegations ?? 0).padStart(3)} rate:${String(r.success_rate ?? 0).padStart(5)} corr:${String(r.total_corrections ?? 0).padStart(3)} pro:${String(r.total_proactive ?? 0).padStart(3)} score:${String(r.quality_score ?? '-').padStart(5)} │`,
      );
    });
  }
  console.log('└──────────────────────────────────────────────────────────────────────────┘\n');
} catch (e) {
  console.log('session_scoring table error:', (e as Error).message, '\n');
}

// 2. Token Usage (per session)
try {
  const tok = d
    .prepare(
      `
    SELECT session_id, SUM(prompt_tokens) as total_in, SUM(completion_tokens) as total_out,
           SUM(prompt_tokens + completion_tokens) as total_tok
    FROM token_usage 
    GROUP BY session_id 
    ORDER BY total_tok DESC LIMIT 10
  `,
    )
    .all() as TokenUsageRow[];

  console.log('┌───────────────────────────────────────────────────────────┐');
  console.log('│ TOKEN USAGE — Top 10 sesiones (prompt_tokens, completion_tokens) │');
  console.log('├───────────────────────────────────────────────────────────┤');
  if (tok.length === 0) {
    console.log('│ (sin datos — tabla vacía)                                │');
  } else {
    tok.forEach((r) => {
      const sid = (r.session_id || '').toString().slice(0, 24).padEnd(24);
      console.log(
        `│ ${sid} │ in:${String(r.total_in ?? 0).padStart(8)} out:${String(r.total_out ?? 0).padStart(8)} tot:${String(r.total_tok ?? 0).padStart(10)} │`,
      );
    });
  }
  console.log('└───────────────────────────────────────────────────────────┘\n');
} catch (e) {
  console.log('token_usage table error:', (e as Error).message, '\n');
}

// 3. Metric Snapshots (daily averages)
try {
  const snap = d
    .prepare(
      `
    SELECT substr(timestamp, 1, 10) as day, 
           ROUND(AVG(tokens_used), 0) as avg_tokens, 
           ROUND(AVG(sessions_total), 1) as avg_sessions
    FROM metric_snapshots 
    GROUP BY day 
    ORDER BY day DESC LIMIT 10
  `,
    )
    .all() as SnapshotRow[];

  console.log('┌──────────────────────────────────────────────┐');
  console.log('│ METRIC SNAPSHOTS — Promedios diarios          │');
  console.log('├──────────────────────────────────────────────┤');
  if (snap.length === 0) {
    console.log('│ (sin datos — tabla vacía)                     │');
  } else {
    snap.forEach((r) => {
      console.log(
        `│ ${r.day} │ tokens: ${String(r.avg_tokens ?? 0).padStart(10)} │ sessions: ${String(r.avg_sessions ?? 0).padStart(5)} │`,
      );
    });
  }
  console.log('└──────────────────────────────────────────────┘\n');
} catch (e) {
  console.log('metric_snapshots table error:', (e as Error).message, '\n');
}

// 4. Overall stats
try {
  const stats = d
    .prepare(
      `
    SELECT 
      COUNT(*) as total_rows,
      ROUND(AVG(success_rate), 2) as avg_success_rate,
      SUM(total_delegations) as total_delegations,
      SUM(total_corrections) as total_corrections,
      SUM(total_proactive) as total_proactive
    FROM session_scoring
  `,
    )
    .get() as GlobalStatsRow;

  console.log('┌──────────────────────────────────────────────┐');
  console.log('│ ESTADÍSTICAS GLOBALES                         │');
  console.log('├──────────────────────────────────────────────┤');
  console.log(
    `│ Sesiones: ${String(stats.total_rows ?? 0).padStart(10)}                           │`,
  );
  console.log(
    `│ Avg Success Rate: ${String(stats.avg_success_rate ?? '-').padStart(10)}              │`,
  );
  console.log(
    `│ Total Delegations: ${String(stats.total_delegations ?? 0).padStart(8)}              │`,
  );
  console.log(
    `│ Total Corrections: ${String(stats.total_corrections ?? 0).padStart(8)}              │`,
  );
  console.log(
    `│ Total Proactive: ${String(stats.total_proactive ?? 0).padStart(9)}               │`,
  );
  console.log('└──────────────────────────────────────────────┘\n');
} catch (e) {
  console.log('global stats error:', (e as Error).message, '\n');
}

d.close();
console.log('✅ Query complete\n');
