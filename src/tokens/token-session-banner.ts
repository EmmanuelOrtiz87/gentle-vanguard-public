#!/usr/bin/env node
/**
 * Token Session Banner — muestra al inicio de sesión los tokens consumidos
 * por el arranque del stack y cuántos quedan disponibles en la sesión,
 * segmentado por input/output/total.
 *
 * Uso:
 *   npx tsx src/tokens/token-session-banner.ts            # banner completo
 *   npx tsx src/tokens/token-session-banner.ts --json     # salida JSON
 *   npx tsx src/tokens/token-session-banner.ts --quiet    # solo si hay alerta
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

interface BudgetLimits {
  daily: number;
  perSession: number;
  perAgent: number;
  softThreshold: number;
  hardThreshold: number;
}

interface BannerData {
  session_id: string;
  generated_at: string;
  startup: { input: number; output: number; total: number };
  session: { used: number; limit: number; remaining: number; pct: number };
  daily: { used: number; limit: number; remaining: number; pct: number };
  thresholds: { soft: number; hard: number };
  status: 'OK' | 'SOFT_LIMIT' | 'HARD_LIMIT';
}

function loadBudget(): BudgetLimits {
  const def: BudgetLimits = {
    daily: 5000000,
    perSession: 3000000,
    perAgent: 100000,
    softThreshold: 70,
    hardThreshold: 90,
  };
  try {
    if (fs.existsSync(BUDGET_CONFIG)) {
      const raw = JSON.parse(fs.readFileSync(BUDGET_CONFIG, 'utf-8'));
      const l = raw?.tokenBudget?.limits;
      if (l) {
        return {
          daily: l.daily ?? def.daily,
          perSession: l.perSession ?? def.perSession,
          perAgent: l.perAgent ?? def.perAgent,
          softThreshold: l.softThreshold ?? def.softThreshold,
          hardThreshold: l.hardThreshold ?? def.hardThreshold,
        };
      }
    }
  } catch {
    /* ignore */
  }
  return def;
}

function readSessionId(): string {
  const fp = path.join(SESSION_DIR, 'session-current.json');
  try {
    if (fs.existsSync(fp)) {
      const data = JSON.parse(fs.readFileSync(fp, 'utf-8')) as Record<string, unknown>;
      const sid = String(data.sessionId ?? data.id ?? '').trim();
      if (sid) return sid;
    }
  } catch {
    /* ignore */
  }
  return `session-${new Date().toISOString().slice(0, 13).replace('T', '-')}`;
}

/** Tokens consumed by the stack startup (session file accumulated + Nexus). */
function readStartupTokens(sessionId: string): { input: number; output: number; total: number } {
  // Session file accumulated totals
  let input = 0,
    output = 0,
    total = 0;
  const fp = path.join(SESSION_DIR, 'session-current.json');
  try {
    if (fs.existsSync(fp)) {
      const data = JSON.parse(fs.readFileSync(fp, 'utf-8')) as Record<string, unknown>;
      input = Number(data.totalInputTokens ?? data.inputTokens ?? 0) || 0;
      output = Number(data.totalOutputTokens ?? data.outputTokens ?? 0) || 0;
      total = Number(data.totalTokens ?? 0) || input + output;
    }
  } catch {
    /* ignore */
  }

  // Prefer Nexus real data if present for this session
  try {
    const Database = _require('better-sqlite3');
    if (fs.existsSync(NEXUS_DB_PATH)) {
      const db = new Database(NEXUS_DB_PATH, { readonly: true });
      try {
        const row = db
          .prepare(
            `SELECT COALESCE(SUM(prompt_tokens),0) as p, COALESCE(SUM(completion_tokens),0) as c
             FROM token_usage WHERE session_id = ?`,
          )
          .get(sessionId) as { p: number; c: number };
        if (row.p > 0 || row.c > 0) {
          input = row.p;
          output = row.c;
          total = input + output;
        }
      } finally {
        db.close();
      }
    }
  } catch {
    /* ignore */
  }

  return { input, output, total };
}

/** Tokens used today across all sessions (from Nexus token_usage). */
function readDailyTokens(): number {
  try {
    const Database = _require('better-sqlite3');
    if (fs.existsSync(NEXUS_DB_PATH)) {
      const db = new Database(NEXUS_DB_PATH, { readonly: true });
      try {
        const row = db
          .prepare(
            `SELECT COALESCE(SUM(prompt_tokens + completion_tokens),0) as t
             FROM token_usage WHERE date(timestamp) = date('now')`,
          )
          .get() as { t: number };
        return row.t || 0;
      } finally {
        db.close();
      }
    }
  } catch {
    /* ignore */
  }
  return 0;
}

function buildBanner(): BannerData {
  const budget = loadBudget();
  const sessionId = readSessionId();
  const startup = readStartupTokens(sessionId);
  const dailyUsed = readDailyTokens();

  const sessionUsed = startup.total;
  const sessionRemaining = Math.max(0, budget.perSession - sessionUsed);
  const sessionPct =
    budget.perSession > 0 ? Math.round((sessionUsed / budget.perSession) * 100) : 0;

  const dailyRemaining = Math.max(0, budget.daily - dailyUsed);
  const dailyPct = budget.daily > 0 ? Math.round((dailyUsed / budget.daily) * 100) : 0;

  let status: BannerData['status'] = 'OK';
  if (dailyPct >= budget.hardThreshold || sessionPct >= budget.hardThreshold) status = 'HARD_LIMIT';
  else if (dailyPct >= budget.softThreshold || sessionPct >= budget.softThreshold)
    status = 'SOFT_LIMIT';

  return {
    session_id: sessionId,
    generated_at: new Date().toISOString(),
    startup,
    session: {
      used: sessionUsed,
      limit: budget.perSession,
      remaining: sessionRemaining,
      pct: sessionPct,
    },
    daily: { used: dailyUsed, limit: budget.daily, remaining: dailyRemaining, pct: dailyPct },
    thresholds: { soft: budget.softThreshold, hard: budget.hardThreshold },
    status,
  };
}

function render(b: BannerData): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('══════════════════════════════════════════════════════');
  lines.push('  TOKEN SESSION BANNER');
  lines.push('══════════════════════════════════════════════════════');
  lines.push(`  Session:   ${b.session_id}`);
  lines.push('');
  lines.push('  ── Consumidos en el inicio del stack ──');
  lines.push(`    Input:   ${b.startup.input.toLocaleString()} tokens`);
  lines.push(`    Output:  ${b.startup.output.toLocaleString()} tokens`);
  lines.push(`    Total:   ${b.startup.total.toLocaleString()} tokens`);
  lines.push('');
  lines.push('  ── Presupuesto de sesión ──');
  lines.push(
    `    Usados:    ${b.session.used.toLocaleString()} / ${b.session.limit.toLocaleString()} (${b.session.pct}%)`,
  );
  lines.push(`    Restantes: ${b.session.remaining.toLocaleString()} tokens`);
  lines.push('');
  lines.push('  ── Presupuesto diario ──');
  lines.push(
    `    Usados:    ${b.daily.used.toLocaleString()} / ${b.daily.limit.toLocaleString()} (${b.daily.pct}%)`,
  );
  lines.push(`    Restantes: ${b.daily.remaining.toLocaleString()} tokens`);
  lines.push(`    Umbrales:  soft ${b.thresholds.soft}% / hard ${b.thresholds.hard}%`);
  lines.push('');
  lines.push('  ── Gestión de Contexto ──');
  lines.push('    Nota: Cada turno envía TODO el historial. Después de 15-20 turnos,');
  lines.push('    cree una nueva sesión o restaure un checkpoint para evitar');
  lines.push('    consumo masivo (>50K tokens por turno).');
  lines.push('    Ver: docs/reference/CONTEXT-OPTIMIZATION-GUIDE.md');
  lines.push('══════════════════════════════════════════════════════');
  if (b.status === 'HARD_LIMIT')
    lines.push('  ⚠️  HARD LIMIT alcanzado — considere compactar o cerrar sesión.');
  else if (b.status === 'SOFT_LIMIT') lines.push('  ⚠️  SOFT LIMIT alcanzado — vigile el consumo.');
  lines.push('');
  return lines.join('\n');
}

function main(): void {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json') || args.includes('-AsJson');
  const quiet = args.includes('--quiet') || args.includes('-Quiet');

  const banner = buildBanner();

  if (asJson) {
    console.log(JSON.stringify(banner, null, 2));
    return;
  }
  if (quiet && banner.status === 'OK') return;
  console.log(render(banner));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
