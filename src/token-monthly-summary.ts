#!/usr/bin/env node
/**
 * Token Monthly Summary — genera un resumen automático del consumo de tokens
 * de los últimos 30 días y lo persiste en un archivo para observar el
 * comportamiento del stack en consumos.
 *
 * Uso:
 *   npx tsx src/token-monthly-summary.ts                 # resumen de los últimos 30 días
 *   npx tsx src/token-monthly-summary.ts --month 2026-07 # mes específico
 *   npx tsx src/token-monthly-summary.ts --json          # salida JSON
 *   npx tsx src/token-monthly-summary.ts --quiet         # solo escribe archivo, sin stdout
 *
 * Salida: docs/sessions/metrics/monthly/token-summary-YYYY-MM.md (+ .json)
 */

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);

const ROOT = path.resolve(process.cwd());
const RUNTIME_DIR = path.join(ROOT, '.runtime');
const NEXUS_DB_PATH = path.join(RUNTIME_DIR, 'gentle-vanguard.db');
const OUT_DIR = path.join(ROOT, 'docs', 'sessions', 'metrics', 'monthly');

interface DayRow {
  day: string;
  input: number;
  output: number;
  total: number;
  cost: number;
  sessions: number;
}

interface ModelRow {
  model: string;
  input: number;
  output: number;
  total: number;
  cost: number;
}

interface SummaryData {
  generated_at: string;
  period: string;
  days: number;
  totals: { input: number; output: number; total: number; cost: number };
  daily_avg: { input: number; output: number; total: number };
  by_day: DayRow[];
  by_model: ModelRow[];
  top_sessions: Array<{ session_id: string; total: number; cost: number }>;
}

function nowISO(): string {
  return new Date().toISOString();
}

function queryAll(sql: string, params: unknown[] = []): unknown[] {
  try {
    const Database = _require('better-sqlite3');
    if (!fs.existsSync(NEXUS_DB_PATH)) return [];
    const db = new Database(NEXUS_DB_PATH, { readonly: true });
    try {
      return db.prepare(sql).all(...params) as unknown[];
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

function queryGet(sql: string, params: unknown[] = []): unknown {
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

/** Compute the month window (YYYY-MM) for the summary. */
function resolveMonth(monthArg: string): { start: string; end: string; label: string } {
  if (monthArg) {
    const [y, m] = monthArg.split('-').map(Number);
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const end = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    return { start, end, label: monthArg };
  }
  // Last 30 days from today
  const now = new Date();
  const end = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
  const start = new Date(now.getTime() - 29 * 86400000).toISOString().slice(0, 10);
  return { start, end, label: `${start.slice(0, 7)}` };
}

function buildSummary(monthArg: string): SummaryData {
  const { start, end, label } = resolveMonth(monthArg);

  const totals = queryGet(
    `SELECT COALESCE(SUM(prompt_tokens),0) as input,
            COALESCE(SUM(completion_tokens),0) as output,
            COALESCE(SUM(cost),0) as cost
     FROM token_usage WHERE date(timestamp) >= ? AND date(timestamp) < ?`,
    [start, end],
  ) as { input: number; output: number; cost: number } | null;

  const byDay = queryAll(
    `SELECT date(timestamp) as day,
            SUM(prompt_tokens) as input,
            SUM(completion_tokens) as output,
            SUM(prompt_tokens + completion_tokens) as total,
            SUM(cost) as cost,
            COUNT(DISTINCT session_id) as sessions
     FROM token_usage WHERE date(timestamp) >= ? AND date(timestamp) < ?
     GROUP BY day ORDER BY day`,
    [start, end],
  ) as DayRow[];

  const byModel = queryAll(
    `SELECT COALESCE(model,'unknown') as model,
            SUM(prompt_tokens) as input,
            SUM(completion_tokens) as output,
            SUM(prompt_tokens + completion_tokens) as total,
            SUM(cost) as cost
     FROM token_usage WHERE date(timestamp) >= ? AND date(timestamp) < ?
     GROUP BY model ORDER BY total DESC`,
    [start, end],
  ) as ModelRow[];

  const topSessions = queryAll(
    `SELECT session_id, SUM(prompt_tokens + completion_tokens) as total, SUM(cost) as cost
     FROM token_usage WHERE date(timestamp) >= ? AND date(timestamp) < ?
     GROUP BY session_id ORDER BY total DESC LIMIT 10`,
    [start, end],
  ) as Array<{ session_id: string; total: number; cost: number }>;

  const input = totals?.input ?? 0;
  const output = totals?.output ?? 0;
  const cost = totals?.cost ?? 0;
  const total = input + output;
  const days = byDay.length || 1;

  return {
    generated_at: nowISO(),
    period: label,
    days: byDay.length,
    totals: { input, output, total, cost },
    daily_avg: {
      input: Math.round(input / days),
      output: Math.round(output / days),
      total: Math.round(total / days),
    },
    by_day: byDay,
    by_model: byModel,
    top_sessions: topSessions,
  };
}

function renderMarkdown(s: SummaryData): string {
  const lines: string[] = [];
  lines.push(`# Token Summary — ${s.period}`);
  lines.push('');
  lines.push(`Generado: ${s.generated_at}`);
  lines.push('');
  lines.push('## Totales del período');
  lines.push('');
  lines.push(`| Métrica | Valor |`);
  lines.push(`|---|---|`);
  lines.push(`| Input | ${s.totals.input.toLocaleString()} tokens |`);
  lines.push(`| Output | ${s.totals.output.toLocaleString()} tokens |`);
  lines.push(`| **Total** | **${s.totals.total.toLocaleString()} tokens** |`);
  lines.push(`| Costo | $${s.totals.cost.toFixed(4)} USD |`);
  lines.push(`| Días con datos | ${s.days} |`);
  lines.push(`| Promedio diario | ${s.daily_avg.total.toLocaleString()} tokens |`);
  lines.push('');
  lines.push('## Por modelo');
  lines.push('');
  lines.push('| Modelo | Input | Output | Total | Costo |');
  lines.push('|---|---|---|---|---|');
  for (const m of s.by_model) {
    lines.push(
      `| ${m.model} | ${m.input.toLocaleString()} | ${m.output.toLocaleString()} | ${m.total.toLocaleString()} | $${m.cost.toFixed(4)} |`,
    );
  }
  lines.push('');
  lines.push('## Top sesiones');
  lines.push('');
  lines.push('| Sesión | Total | Costo |');
  lines.push('|---|---|---|');
  for (const t of s.top_sessions) {
    lines.push(`| ${t.session_id} | ${t.total.toLocaleString()} | $${t.cost.toFixed(4)} |`);
  }
  lines.push('');
  lines.push('## Consumo diario');
  lines.push('');
  lines.push('| Día | Input | Output | Total | Sesiones |');
  lines.push('|---|---|---|---|---|');
  for (const d of s.by_day) {
    lines.push(
      `| ${d.day} | ${d.input.toLocaleString()} | ${d.output.toLocaleString()} | ${d.total.toLocaleString()} | ${d.sessions} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

function main(): void {
  const args = process.argv.slice(2);
  const monthArg = args.includes('--month') ? args[args.indexOf('--month') + 1] : '';
  const asJson = args.includes('--json');
  const quiet = args.includes('--quiet');

  const summary = buildSummary(monthArg);

  // Persist to file
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const mdPath = path.join(OUT_DIR, `token-summary-${summary.period}.md`);
  const jsonPath = path.join(OUT_DIR, `token-summary-${summary.period}.json`);
  fs.writeFileSync(mdPath, renderMarkdown(summary), 'utf-8');
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), 'utf-8');

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  if (!quiet) {
    console.log(`Token summary written to:`);
    console.log(`  ${mdPath}`);
    console.log(`  ${jsonPath}`);
    console.log(
      `Período: ${summary.period} | Total: ${summary.totals.total.toLocaleString()} tokens | Costo: $${summary.totals.cost.toFixed(4)}`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
