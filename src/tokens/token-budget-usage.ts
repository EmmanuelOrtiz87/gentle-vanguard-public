/**
 * Lectura del uso real de tokens desde Nexus para el presupuesto diario.
 *
 * El guard leía un CSV legacy (`docs/sessions/metrics/token-guard-usage.csv`)
 * que solo recibía estimaciones de arranque de sesión → ~0 tokens/día y un
 * PASS falso. Nexus `token_transactions` es la fuente real del ingest
 * multi-tool; este módulo la resume para calibración y enforcement.
 */

import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { join } from 'path';
import { getLocalDayKey } from './local-day.js';

export const NEXUS_DB_PATH = join(process.cwd(), '.runtime', 'gentle-vanguard.db');

export interface DailyUsage {
  day: string;
  tokens: number;
  transactions: number;
}

export interface UsageSummary {
  days: number;
  totalTokens: number;
  median: number;
  p90: number;
  p99: number;
  max: number;
  latestDay: string | null;
}

export function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  // nearest-rank: p=0.5, n=4 → índice 1 (mediana real, no el vecino superior)
  const rank = Math.min(sortedValues.length, Math.max(1, Math.ceil(p * sortedValues.length)));
  return sortedValues[rank - 1];
}

export function summarizeUsage(rows: DailyUsage[]): UsageSummary {
  const totals = rows.map((r) => r.tokens).sort((a, b) => a - b);
  return {
    days: rows.length,
    totalTokens: totals.reduce((a, b) => a + b, 0),
    median: percentile(totals, 0.5),
    p90: percentile(totals, 0.9),
    p99: percentile(totals, 0.99),
    max: totals.length > 0 ? totals[totals.length - 1] : 0,
    latestDay: rows.length > 0 ? rows[rows.length - 1].day : null,
  };
}

/** Días con actividad de tokens en los últimos `days` días (hora local del ingest). */
export function readDailyUsage(days = 14, dbPath = NEXUS_DB_PATH): DailyUsage[] {
  if (!existsSync(dbPath)) return [];
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .prepare(
        `SELECT date(created_at) AS day,
                COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,
                COUNT(*) AS transactions
         FROM token_transactions
         WHERE created_at >= date('now', ?)
         GROUP BY day ORDER BY day ASC`,
      )
      .all(`-${days} days`) as DailyUsage[];
  } finally {
    db.close();
  }
}

/** Uso real del día local según Nexus; 0 cuando no hay ingest todavía. */
export function readUsedTokensToday(dbPath = NEXUS_DB_PATH, dayKey?: string): number {
  if (!existsSync(dbPath)) return 0;
  const db = new Database(dbPath, { readonly: true });
  try {
    const day = dayKey ?? getLocalDayKey();
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS total
         FROM token_transactions WHERE date(created_at) = ?`,
      )
      .get(day) as { total?: number } | undefined;
    return Number(row?.total ?? 0) || 0;
  } finally {
    db.close();
  }
}

/** Hay ingest reciente en Nexus (7 días): autoriza usar Nexus como fuente aunque hoy sea 0. */
export function hasRecentNexusData(days = 7, dbPath = NEXUS_DB_PATH): boolean {
  if (!existsSync(dbPath)) return false;
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db
      .prepare(
        `SELECT 1 AS found FROM token_transactions
         WHERE created_at >= date('now', ?) LIMIT 1`,
      )
      .get(`-${days} days`) as { found?: number } | undefined;
    return Boolean(row?.found);
  } finally {
    db.close();
  }
}

export interface SessionUsageSummary {
  sessions: number;
  median: number;
  p90: number;
  p99: number;
  max: number;
}

export function readSessionUsageSummary(days = 14, dbPath = NEXUS_DB_PATH): SessionUsageSummary {
  if (!existsSync(dbPath)) {
    return { sessions: 0, median: 0, p90: 0, p99: 0, max: 0 };
  }
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .prepare(
        `SELECT SUM(input_tokens + output_tokens) AS tokens
         FROM token_transactions
         WHERE created_at >= date('now', ?)
         GROUP BY session_id`,
      )
      .all(`-${days} days`) as Array<{ tokens: number }>;
    const values = rows.map((r) => Number(r.tokens) || 0).sort((a, b) => a - b);
    return {
      sessions: values.length,
      median: percentile(values, 0.5),
      p90: percentile(values, 0.9),
      p99: percentile(values, 0.99),
      max: values.length > 0 ? values[values.length - 1] : 0,
    };
  } finally {
    db.close();
  }
}

export interface Calibration {
  windowDays: number;
  daily: UsageSummary;
  sessions: SessionUsageSummary;
  recommendedDaily: number;
  recommendedPerSession: number;
}

const roundUpTo = (value: number, step: number): number =>
  // epsilon: 200M*1.1 da 220000000.00000003 y Math.ceil subiría un escalón de más
  value <= 0 ? 0 : Math.ceil(value / step - 1e-9) * step;

/**
 * Límites recomendados a partir del uso observado: el pico de los últimos N
 * días con 10% de holgura, redondeado a 10M. Es un umbral de anomalía, no un
 * techo de costo (los planes por suscripción no facturan por token).
 */
export function calibrate(windowDays = 14, dbPath = NEXUS_DB_PATH): Calibration {
  const daily = summarizeUsage(readDailyUsage(windowDays, dbPath));
  const sessions = readSessionUsageSummary(windowDays, dbPath);
  return {
    windowDays,
    daily,
    sessions,
    recommendedDaily: roundUpTo(daily.max * 1.1, 10_000_000),
    recommendedPerSession: roundUpTo(sessions.max * 1.1, 10_000_000),
  };
}
