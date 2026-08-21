#!/usr/bin/env node
/**
 * Token Status — comando a demanda para ver el acumulado de tokens
 * antes/después de compactar, presupuesto de sesión y diario, segmentado
 * por input/output/total.
 *
 * Uso:
 *   npx tsx src/token-status.ts              # estado completo
 *   npx tsx src/token-status.ts --json       # salida JSON
 *   npx tsx src/token-status.ts --compact    # solo info de compactación
 */

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);

const ROOT = path.resolve(process.cwd());
const RUNTIME_DIR = path.join(ROOT, '.runtime');
const SESSION_DIR = path.join(ROOT, '.session');
const NEXUS_DB_PATH = path.join(RUNTIME_DIR, 'gentle-vanguard.db');
const BUDGET_CONFIG = path.join(ROOT, 'config', 'token-budget-guard.json');
const COMPACTED_DIR = path.join(SESSION_DIR, 'compacted');

interface CompactionRecord {
  id: string;
  timestamp: string;
  originalTokens: number;
  summaryTokens: number;
  tokenReduction: number;
  reductionPct: number;
}

interface StatusData {
  generated_at: string;
  session_id: string;
  session: { used: number; limit: number; remaining: number; pct: number };
  daily: { used: number; limit: number; remaining: number; pct: number };
  breakdown: { input: number; output: number; total: number };
  compact: {
    total: number;
    latest?: CompactionRecord;
    tokens_before: number;
    tokens_after: number;
    tokens_saved: number;
  };
}

function loadBudget(): { daily: number; perSession: number; soft: number; hard: number } {
  const def = { daily: 60000, perSession: 7500, soft: 70, hard: 90 };
  try {
    if (fs.existsSync(BUDGET_CONFIG)) {
      const raw = JSON.parse(fs.readFileSync(BUDGET_CONFIG, 'utf-8'));
      const l = raw?.tokenBudget?.limits;
      if (l)
        return {
          daily: l.daily ?? def.daily,
          perSession: l.perSession ?? def.perSession,
          soft: l.softThreshold ?? def.soft,
          hard: l.hardThreshold ?? def.hard,
        };
    }
  } catch {
    /* ignore */
  }
  return def;
}

function readSessionId(): string {
  const candidates = [
    path.join(SESSION_DIR, 'session-current.json'),
    path.join(SESSION_DIR, 'token-usage.json'),
    path.join(RUNTIME_DIR, 'session-current.json'),
  ];
  for (const fp of candidates) {
    try {
      if (!fs.existsSync(fp)) continue;
      const data = JSON.parse(fs.readFileSync(fp, 'utf-8')) as Record<string, unknown>;
      const id = String(data.sessionId ?? data.id ?? '').trim();
      if (id) return id;
    } catch {
      /* try the next durable session marker */
    }
  }
  return 'unknown';
}

function queryNexus(sql: string, params: unknown[] = []): unknown {
  try {
    const Database = _require('better-sqlite3');
    if (!fs.existsSync(NEXUS_DB_PATH)) return null;
    const db = new Database(NEXUS_DB_PATH, { readonly: true });
    try {
      return db.prepare(sql).get(...params);
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

function readCompactions(): CompactionRecord[] {
  try {
    if (!fs.existsSync(COMPACTED_DIR)) return [];
    const files = fs.readdirSync(COMPACTED_DIR).filter((f) => f.endsWith('.json'));
    const records: CompactionRecord[] = [];
    for (const f of files) {
      try {
        const r = JSON.parse(
          fs.readFileSync(path.join(COMPACTED_DIR, f), 'utf-8'),
        ) as CompactionRecord;
        if (typeof r.originalTokens === 'number') records.push(r);
      } catch {
        /* ignore */
      }
    }
    return records.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  } catch {
    return [];
  }
}

function buildStatus(): StatusData {
  const budget = loadBudget();
  const sessionId = readSessionId();

  // Session usage from Nexus
  const sessionRow = queryNexus(
    'SELECT COALESCE(SUM(prompt_tokens),0) as p, COALESCE(SUM(completion_tokens),0) as c FROM token_usage WHERE session_id = ?',
    [sessionId],
  ) as { p?: number; c?: number } | null;
  const input = Number(sessionRow?.p ?? 0) || 0;
  const output = Number(sessionRow?.c ?? 0) || 0;
  const total = input + output;

  // Daily usage from Nexus
  const dailyRow = queryNexus(
    `SELECT COALESCE(SUM(prompt_tokens + completion_tokens),0) as t FROM token_usage WHERE date(timestamp) = date('now')`,
  ) as { t?: number } | null;
  const dailyUsed = Number(dailyRow?.t ?? 0) || 0;

  const compactions = readCompactions();
  const latest = compactions[0];

  return {
    generated_at: new Date().toISOString(),
    session_id: sessionId,
    session: {
      used: total,
      limit: budget.perSession,
      remaining: Math.max(0, budget.perSession - total),
      pct: budget.perSession > 0 ? Math.round((total / budget.perSession) * 100) : 0,
    },
    daily: {
      used: dailyUsed,
      limit: budget.daily,
      remaining: Math.max(0, budget.daily - dailyUsed),
      pct: budget.daily > 0 ? Math.round((dailyUsed / budget.daily) * 100) : 0,
    },
    breakdown: { input, output, total },
    compact: {
      total: compactions.length,
      latest,
      tokens_before: latest?.originalTokens ?? 0,
      tokens_after: latest?.summaryTokens ?? 0,
      tokens_saved: latest?.tokenReduction ?? 0,
    },
  };
}

function render(s: StatusData): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('══════════════════════════════════════════════════════');
  lines.push('  TOKEN STATUS (a demanda)');
  lines.push('══════════════════════════════════════════════════════');
  lines.push(`  Session:      ${s.session_id}`);
  lines.push('');
  lines.push('  ── Desglose de sesión ──');
  lines.push(`    Input:       ${s.breakdown.input.toLocaleString()} tokens`);
  lines.push(`    Output:      ${s.breakdown.output.toLocaleString()} tokens`);
  lines.push(`    Total:       ${s.breakdown.total.toLocaleString()} tokens`);
  lines.push('');
  lines.push('  ── Presupuesto de sesión ──');
  lines.push(
    `    Usados:      ${s.session.used.toLocaleString()} / ${s.session.limit.toLocaleString()} (${s.session.pct}%)`,
  );
  lines.push(`    Restantes:   ${s.session.remaining.toLocaleString()} tokens`);
  lines.push('');
  lines.push('  ── Presupuesto diario ──');
  lines.push(
    `    Usados:      ${s.daily.used.toLocaleString()} / ${s.daily.limit.toLocaleString()} (${s.daily.pct}%)`,
  );
  lines.push(`    Restantes:   ${s.daily.remaining.toLocaleString()} tokens`);
  lines.push('');
  lines.push('  ── Compactación ──');
  if (s.compact.total > 0 && s.compact.latest) {
    lines.push(`    Total eventos: ${s.compact.total}`);
    lines.push(`    Última:       ${s.compact.latest.timestamp}`);
    lines.push(`    Antes:        ${s.compact.tokens_before.toLocaleString()} tokens`);
    lines.push(`    Después:      ${s.compact.tokens_after.toLocaleString()} tokens`);
    lines.push(
      `    Ahorro:       ${s.compact.tokens_saved.toLocaleString()} tokens (${s.compact.latest.reductionPct}%)`,
    );
  } else {
    lines.push('    (sin eventos de compactación registrados)');
  }
  lines.push('══════════════════════════════════════════════════════');
  return lines.join('\n');
}

function main(): void {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json') || args.includes('-AsJson');
  const onlyCompact = args.includes('--compact');

  const data = buildStatus();

  if (asJson) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (onlyCompact) {
    if (data.compact.latest) {
      console.log(JSON.stringify(data.compact, null, 2));
    } else {
      console.log('No compaction events found.');
    }
    return;
  }
  console.log(render(data));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
