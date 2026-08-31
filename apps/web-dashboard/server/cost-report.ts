/**
 * Runtime cost report (F3.5 — sostenibilidad económica del runtime).
 *
 * Derives USD cost aggregates from historical token data in Nexus
 * (`token_transactions` per message — the most granular source) using the
 * reference pricing table in `config/model-pricing.json` and the budgets in
 * `config/token-budget-guard.json`. Pure computation over an injected
 * better-sqlite3 handle so it is unit-testable without the HTTP layer.
 */
import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './shared.ts';

export interface ModelPrice {
  input: number;
  output: number;
}

export interface CostSlice {
  key: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  sharePct: number;
}

export interface CostReport {
  generatedAt: string;
  currency: string;
  totals: {
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    monthToDateCostUsd: number;
  };
  perDay: { date: string; costUsd: number; totalTokens: number }[];
  perAgent: CostSlice[];
  perModel: CostSlice[];
  topSessions: {
    sessionId: string;
    costUsd: number;
    totalTokens: number;
    transactions: number;
    lastActivity: string;
  }[];
  monthlyProjection: { from7d: number; from30d: number };
  budget: {
    dailyTokens: number;
    perSessionTokens: number;
    usedTodayTokens: number;
    usedTodayPct: number;
    softThresholdPct: number;
    hardThresholdPct: number;
    status: 'ok' | 'soft' | 'hard';
  };
  insight: string;
  unpricedModels: string[];
}

export interface CostReportOptions {
  pricingPath?: string;
  budgetPath?: string;
  now?: Date;
}

interface PricingFile {
  currency?: string;
  models?: Record<string, ModelPrice>;
}

interface BudgetFile {
  tokenBudget?: {
    limits?: {
      daily?: number;
      perSession?: number;
      softThreshold?: number;
      hardThreshold?: number;
    };
  };
}

interface TxRow {
  day: string;
  agent: string | null;
  model: string | null;
  session_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string | null;
}

const WINDOW_DAYS = 30;
const ZERO_PRICE = { input: 0, output: 0 } as const;

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

/**
 * Resolve a (possibly provider-prefixed / cased) model name to a price.
 * Exact normalized match first, then prefix/substring match (longest key
 * wins). Returns null for unmatched models — the caller prices them at 0 and
 * flags them as unpriced. Free-tier and local models are explicit 0 entries
 * in the table and are NOT flagged.
 */
export function resolvePrice(
  model: string | null,
  pricing: Record<string, ModelPrice>,
): ModelPrice | null {
  if (!model) return null;
  const normalized = model.toLowerCase();
  if (pricing[normalized]) return pricing[normalized];
  let best: string | null = null;
  for (const key of Object.keys(pricing)) {
    const matches =
      normalized.startsWith(`${key}/`) || key.startsWith(normalized) || normalized.includes(key);
    if (matches && (!best || key.length > best.length)) best = key;
  }
  return best ? pricing[best] : null;
}

export function computeCost(
  model: string | null,
  inputTokens: number,
  outputTokens: number,
  pricing: Record<string, ModelPrice>,
): number {
  const price = resolvePrice(model, pricing) ?? ZERO_PRICE;
  return (inputTokens / 1e6) * price.input + (outputTokens / 1e6) * price.output;
}

function dayKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function makeCostReport(
  db: Database.Database,
  options: CostReportOptions = {},
): CostReport {
  const now = options.now ?? new Date();
  const pricingFile =
    readJson<PricingFile>(options.pricingPath ?? join(ROOT, 'config', 'model-pricing.json')) ?? {};
  const budgetFile =
    readJson<BudgetFile>(options.budgetPath ?? join(ROOT, 'config', 'token-budget-guard.json')) ??
    {};
  const pricing = Object.fromEntries(
    Object.entries(pricingFile.models ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const limits = budgetFile.tokenBudget?.limits ?? {};

  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - (WINDOW_DAYS - 1));
  const rows = db
    .prepare(
      `SELECT date(created_at) AS day, agent, model, session_id,
              input_tokens, output_tokens, created_at
       FROM token_transactions
       WHERE created_at >= ?
         AND (input_tokens > 0 OR output_tokens > 0)`,
    )
    .all(cutoff.toISOString().slice(0, 19).replace('T', ' ')) as TxRow[];

  let totalCost = 0;
  let totalIn = 0;
  let totalOut = 0;
  let monthToDateCost = 0;
  const monthPrefix = dayKey(now).slice(0, 7);
  const dayMap = new Map<string, { costUsd: number; totalTokens: number }>();
  const agentMap = new Map<string, CostSlice>();
  const modelMap = new Map<string, CostSlice>();
  const sessionMap = new Map<string, { costUsd: number; totalTokens: number; transactions: number; lastActivity: string }>();
  const unpriced = new Set<string>();
  // For the insight: tokens weighted by actual price tier vs cheapest tier.
  let cost7d = 0;
  const cutoff7 = dayKey(new Date(now.getTime() - 6 * 86400000));

  for (const row of rows) {
    const inTok = row.input_tokens ?? 0;
    const outTok = row.output_tokens ?? 0;
    const cost = computeCost(row.model, inTok, outTok, pricing);
    if (resolvePrice(row.model, pricing) === null && row.model) unpriced.add(row.model);
    totalCost += cost;
    totalIn += inTok;
    totalOut += outTok;
    if ((row.day ?? '').startsWith(monthPrefix)) monthToDateCost += cost;
    if (row.day && row.day >= cutoff7) cost7d += cost;

    const day = dayMap.get(row.day ?? '') ?? { costUsd: 0, totalTokens: 0 };
    day.costUsd += cost;
    day.totalTokens += inTok + outTok;
    dayMap.set(row.day ?? '', day);

    for (const [map, key] of [
      [agentMap, row.agent ?? 'unknown'],
      [modelMap, row.model?.toLowerCase() ?? 'unknown'],
    ] as const) {
      const slice = map.get(key) ?? {
        key,
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        sharePct: 0,
      };
      slice.costUsd += cost;
      slice.inputTokens += inTok;
      slice.outputTokens += outTok;
      slice.totalTokens += inTok + outTok;
      map.set(key, slice);
    }

    if (row.session_id) {
      const sess =
        sessionMap.get(row.session_id) ??
        { costUsd: 0, totalTokens: 0, transactions: 0, lastActivity: row.created_at ?? '' };
      sess.costUsd += cost;
      sess.totalTokens += inTok + outTok;
      sess.transactions += 1;
      if ((row.created_at ?? '') > sess.lastActivity) sess.lastActivity = row.created_at ?? '';
      sessionMap.set(row.session_id, sess);
    }
  }

  const finalize = (map: Map<string, CostSlice>): CostSlice[] =>
    [...map.values()]
      .map((s) => ({ ...s, sharePct: totalCost > 0 ? (s.costUsd / totalCost) * 100 : 0 }))
      .sort((a, b) => b.costUsd - a.costUsd);

  const perDay = [...dayMap.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const perAgent = finalize(agentMap);
  const perModel = finalize(modelMap);

  // Monthly projection (run-rate): average daily cost over trailing windows.
  const daysWith30 = rows.length ? Math.min(WINDOW_DAYS, perDay.length || 1) : 1;
  const from30d = (totalCost / daysWith30) * 30;
  const from7d = (cost7d / Math.min(7, perDay.filter((d) => d.date >= cutoff7).length || 1)) * 30;

  // Budget usage: tokens consumed today vs daily limit.
  const dailyTokens = limits.daily ?? 5_000_000;
  const today = dayKey(now);
  const usedTodayTokens = dayMap.get(today)?.totalTokens ?? 0;
  const usedTodayPct = dailyTokens > 0 ? (usedTodayTokens / dailyTokens) * 100 : 0;
  const softThresholdPct = limits.softThreshold ?? 70;
  const hardThresholdPct = limits.hardThreshold ?? 90;
  const status: 'ok' | 'soft' | 'hard' =
    usedTodayPct >= hardThresholdPct ? 'hard' : usedTodayPct >= softThresholdPct ? 'soft' : 'ok';

  // Insight: what would the same tokens cost on the cheapest priced model
  // (the "cheap profile" lever of config/model-router.json).
  let insight: string;
  const priced = perModel.filter((m) => m.costUsd > 0);
  if (priced.length === 0 || totalCost === 0) {
    insight = 'No billable usage in the window — running on free/local tiers only.';
  } else {
    // Blended per-1M-token rate of each priced model.
    const rates = priced.map((m) => ({
      key: m.key,
      blended: m.totalTokens > 0 ? (m.costUsd / m.totalTokens) * 1e6 : 0,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
    }));
    // Cheapest priced model by combined input+output rate.
    const prices = priced
      .map((m) => ({ key: m.key, price: resolvePrice(m.key, pricing) }))
      .filter((p): p is { key: string; price: ModelPrice } => p.price !== null);
    const cheapest = prices.reduce((a, b) =>
      (a.price.input + a.price.output) <= (b.price.input + b.price.output) ? a : b,
    );
    // Cost if the same input/output split ran on the cheapest priced model.
    const cheapCost = rates.reduce(
      (sum, r) =>
        sum +
        (r.inputTokens / 1e6) * cheapest.price.input +
        (r.outputTokens / 1e6) * cheapest.price.output,
      0,
    );
    if (cheapCost > 0 && cheapCost < totalCost * 0.95) {
      const savingPct = Math.round((1 - cheapCost / totalCost) * 100);
      insight = `Routing all billable volume through the cheapest priced model (${cheapest.key}) would cut spend ~${savingPct}% — consider the "cheap" profile for low-stakes phases.`;
    } else {
      insight = 'Current routing is already close to the cheapest priced tier available.';
    }
  }

  return {
    generatedAt: now.toISOString(),
    currency: pricingFile.currency ?? 'USD',
    totals: {
      costUsd: totalCost,
      inputTokens: totalIn,
      outputTokens: totalOut,
      totalTokens: totalIn + totalOut,
      monthToDateCostUsd: monthToDateCost,
    },
    perDay,
    perAgent,
    perModel,
    topSessions: [...sessionMap.entries()]
      .map(([sessionId, v]) => ({ sessionId, ...v }))
      .sort((a, b) => b.costUsd - a.costUsd)
      .slice(0, 5),
    monthlyProjection: { from7d, from30d },
    budget: {
      dailyTokens,
      perSessionTokens: limits.perSession ?? 3_000_000,
      usedTodayTokens,
      usedTodayPct,
      softThresholdPct,
      hardThresholdPct,
      status,
    },
    insight,
    unpricedModels: [...unpriced].sort(),
  };
}
