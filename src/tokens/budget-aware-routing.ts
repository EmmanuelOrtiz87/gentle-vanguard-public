#!/usr/bin/env node
/**
 * Budget-Aware Routing — automatic, reversible downgrade of INTERNAL model
 * resolution (subagent delegation / research workloads) when the daily token
 * budget is exceeded.
 *
 * INVARIANT: the interactive/main session model is NEVER modified. This module
 * is only invoked from internal chokepoints (agent-delegator model resolution)
 * and only rewrites the model handed to spawned subagents.
 *
 * Config: config/token-budget-guard.json → top-level optional section:
 *   "routingDowngrade": {
 *     "enabled": true,
 *     "softThresholdPct": 100,
 *     "hardThresholdPct": 150,
 *     "downgradeProfile": "cheap",
 *     "applyTo": ["subagent", "delegation", "research"]
 *   }
 *
 * Opt-out: set routingDowngrade.enabled=false OR env GV_BUDGET_ROUTING=0.
 *
 * Every automatic downgrade decision is:
 *   - appended to .runtime/budget-routing-decisions.jsonl
 *   - recorded as a Nexus event (type 'budget.routing_downgrade')
 *
 * Usage (library):
 *   import { getBudgetRoutingState, resolveBudgetAwareModel } from './tokens/budget-aware-routing.js';
 *   const model = resolveBudgetAwareModel('subagent', requestedModel);
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import { join, resolve } from 'path';
import { log } from '../utils/logger.js';

const _require = createRequire(import.meta.url);
const logger = log('BUDGET-ROUTING');

const ROOT = resolve(process.cwd());
const RUNTIME_DIR = join(ROOT, '.runtime');
const NEXUS_DB_PATH = join(RUNTIME_DIR, 'gentle-vanguard.db');
const BUDGET_CONFIG_PATH = join(ROOT, 'config', 'token-budget-guard.json');
const MODEL_ROUTER_PATH = join(ROOT, 'config', 'model-router.json');
const DECISION_LOG = join(RUNTIME_DIR, 'budget-routing-decisions.jsonl');

export type RoutingPath = 'subagent' | 'delegation' | 'research' | 'interactive';

export interface RoutingDowngradeConfig {
  enabled: boolean;
  softThresholdPct: number;
  hardThresholdPct: number;
  downgradeProfile: string;
  applyTo: string[];
  /** Optional explicit model. Defaults to model-router fallback.model for the 'cheap' profile. */
  downgradeModel?: string;
}

export type BudgetTier = 'ok' | 'soft' | 'hard';

export interface BudgetRoutingState {
  /** Effective enablement after config + env kill-switch (GV_BUDGET_ROUTING=0). */
  enabled: boolean;
  /** Disabled by env override specifically. */
  disabledByEnv: boolean;
  usedTokensToday: number;
  dailyBudget: number;
  usagePct: number;
  softThresholdPct: number;
  hardThresholdPct: number;
  tier: BudgetTier;
  downgradeProfile: string;
  downgradeModel: string | null;
  applyTo: string[];
}

export interface RoutingDecision {
  ts: string;
  path: string;
  from: string;
  to: string;
  usagePct: number;
  reason: string;
}

const DEFAULT_CONFIG: RoutingDowngradeConfig = {
  enabled: true,
  softThresholdPct: 100,
  hardThresholdPct: 150,
  downgradeProfile: 'cheap',
  applyTo: ['subagent', 'delegation', 'research'],
};

/** In-process throttle for the hard-tier WARN (once per hour). */
let lastHardWarnMs = 0;
const HARD_WARN_INTERVAL_MS = 60 * 60 * 1000;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Manual validation (config-loader uses JSON-Schema subset, not zod). Invalid fields fall back to defaults. */
function sanitizeConfig(raw: unknown): RoutingDowngradeConfig {
  const cfg: RoutingDowngradeConfig = { ...DEFAULT_CONFIG, applyTo: [...DEFAULT_CONFIG.applyTo] };
  const rec = asRecord(raw);
  if (!rec) return cfg;
  if (typeof rec.enabled === 'boolean') cfg.enabled = rec.enabled;
  if (typeof rec.softThresholdPct === 'number' && rec.softThresholdPct > 0)
    cfg.softThresholdPct = rec.softThresholdPct;
  if (typeof rec.hardThresholdPct === 'number' && rec.hardThresholdPct >= cfg.softThresholdPct)
    cfg.hardThresholdPct = rec.hardThresholdPct;
  if (typeof rec.downgradeProfile === 'string' && rec.downgradeProfile.trim())
    cfg.downgradeProfile = rec.downgradeProfile.trim();
  if (Array.isArray(rec.applyTo)) {
    const paths = rec.applyTo.filter((p): p is string => typeof p === 'string' && p.length > 0);
    if (paths.length > 0) cfg.applyTo = paths;
  }
  if (typeof rec.downgradeModel === 'string' && rec.downgradeModel.trim())
    cfg.downgradeModel = rec.downgradeModel.trim();
  return cfg;
}

function loadRoutingConfig(): RoutingDowngradeConfig {
  try {
    if (!existsSync(BUDGET_CONFIG_PATH)) return { ...DEFAULT_CONFIG };
    const raw = JSON.parse(readFileSync(BUDGET_CONFIG_PATH, 'utf-8'));
    // Accept the section at top level or nested under tokenBudget.
    const section = raw?.routingDowngrade ?? raw?.tokenBudget?.routingDowngrade;
    return sanitizeConfig(section);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function loadDailyBudget(): number {
  try {
    const raw = JSON.parse(readFileSync(BUDGET_CONFIG_PATH, 'utf-8'));
    const daily = raw?.tokenBudget?.limits?.daily;
    if (typeof daily === 'number' && daily > 0) return daily;
  } catch {
    /* ignore */
  }
  return 5_000_000;
}

/**
 * Default downgrade model: the free-tier fallback from model-router.json
 * (opencode/mimo-v2.5-free) when the downgrade profile is 'cheap'. Profiles
 * balanced/premium map to the same native model in this environment, so
 * without an explicit downgradeModel they imply no model rewrite.
 */
function resolveDefaultDowngradeModel(profile: string, explicit?: string): string | null {
  if (explicit) return explicit;
  if (profile !== 'cheap') return null;
  try {
    if (existsSync(MODEL_ROUTER_PATH)) {
      const raw = JSON.parse(readFileSync(MODEL_ROUTER_PATH, 'utf-8'));
      const fb = raw?.fallback?.model;
      if (typeof fb === 'string' && fb.trim()) return fb.trim();
    }
  } catch {
    /* ignore */
  }
  return 'opencode/mimo-v2.5-free';
}

/** Today's real usage from Nexus token_usage (same source as token:status). Returns 0 if DB unavailable. */
export function getUsedTokensToday(): number {
  try {
    if (!existsSync(NEXUS_DB_PATH)) return 0;
    const Database = _require('better-sqlite3');
    const db = new Database(NEXUS_DB_PATH, { readonly: true });
    try {
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(prompt_tokens + completion_tokens),0) as t FROM token_usage WHERE date(timestamp) = date('now')`,
        )
        .get() as { t?: number } | undefined;
      return Number(row?.t ?? 0) || 0;
    } finally {
      db.close();
    }
  } catch {
    return 0;
  }
}

/**
 * Snapshot of budget-aware routing state: usage vs thresholds, effective tier,
 * and the downgrade target model. Cheap (single SQLite read + 2 JSON reads).
 */
export function getBudgetRoutingState(overrides?: {
  /** Test/override hook: force used-tokens-today (skips the Nexus read). */
  usedTokensToday?: number;
  /** Test/override hook: force the routingDowngrade config section. */
  configOverride?: RoutingDowngradeConfig;
}): BudgetRoutingState {
  const cfg = overrides?.configOverride ?? loadRoutingConfig();
  const disabledByEnv = process.env.GV_BUDGET_ROUTING === '0';
  const enabled = cfg.enabled && !disabledByEnv;

  const usedTokensToday = overrides?.usedTokensToday ?? getUsedTokensToday();
  const dailyBudget = loadDailyBudget();
  const usagePct =
    dailyBudget > 0 ? Math.round((usedTokensToday / dailyBudget) * 10000) / 100 : 0;

  let tier: BudgetTier = 'ok';
  if (usagePct >= cfg.hardThresholdPct) tier = 'hard';
  else if (usagePct >= cfg.softThresholdPct) tier = 'soft';

  return {
    enabled,
    disabledByEnv,
    usedTokensToday,
    dailyBudget,
    usagePct,
    softThresholdPct: cfg.softThresholdPct,
    hardThresholdPct: cfg.hardThresholdPct,
    tier,
    downgradeProfile: cfg.downgradeProfile,
    downgradeModel: resolveDefaultDowngradeModel(cfg.downgradeProfile, cfg.downgradeModel),
    applyTo: cfg.applyTo,
  };
}

function recordNexusEvent(decision: RoutingDecision): void {
  try {
    if (!existsSync(NEXUS_DB_PATH)) return;
    const Database = _require('better-sqlite3');
    const db = new Database(NEXUS_DB_PATH);
    try {
      db
        .prepare('INSERT INTO events (type, payload) VALUES (?, ?)')
        .run('budget.routing_downgrade', JSON.stringify({ event: 'budget.routing_downgrade', ...decision }));
    } finally {
      db.close();
    }
  } catch {
    /* Nexus unavailable — the JSONL log is the durable record */
  }
}

function appendDecisionLog(decision: RoutingDecision): void {
  try {
    if (!existsSync(RUNTIME_DIR)) mkdirSync(RUNTIME_DIR, { recursive: true });
    appendFileSync(DECISION_LOG, JSON.stringify(decision) + '\n');
  } catch (e) {
    logger.warn(`failed to append decision log: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function maybeWarnHard(state: BudgetRoutingState): void {
  if (state.tier !== 'hard') return;
  const now = Date.now();
  if (now - lastHardWarnMs < HARD_WARN_INTERVAL_MS) return;
  lastHardWarnMs = now;
  logger.warn(
    `[BUDGET-ROUTING] HARD threshold: usage ${state.usagePct}% >= ${state.hardThresholdPct}% of daily budget ` +
      `(${state.usedTokensToday.toLocaleString()} / ${state.dailyBudget.toLocaleString()} tokens). ` +
      `Internal paths downgraded to profile '${state.downgradeProfile}'` +
      `${state.downgradeModel ? ` (${state.downgradeModel})` : ''}. Interactive model NOT modified.`,
  );
}

/**
 * Apply budget-aware downgrade to an INTERNAL model resolution.
 *
 * Returns the model that should actually be used:
 *   - unchanged when routing is disabled (config/env), the path is not in
 *     applyTo, usage is below the soft threshold, or no downgrade model
 *     resolves for the configured profile;
 *   - the downgrade model otherwise, with the decision recorded.
 *
 * `from` is never rewritten for the interactive/main session — callers must
 * only invoke this for internal paths (subagent/delegation/research).
 */
export function resolveBudgetAwareModel(
  path: string,
  requestedModel: string,
  stateOverride?: BudgetRoutingState,
): string {
  const state = stateOverride ?? getBudgetRoutingState();
  maybeWarnHard(state);

  if (!state.enabled) return requestedModel;
  if (!state.applyTo.includes(path)) return requestedModel;
  if (state.tier === 'ok') return requestedModel;
  if (!state.downgradeModel || state.downgradeModel === requestedModel) return requestedModel;

  const reason =
    state.tier === 'hard'
      ? `usage ${state.usagePct}% >= hard ${state.hardThresholdPct}%`
      : `usage ${state.usagePct}% >= soft ${state.softThresholdPct}%`;

  const decision: RoutingDecision = {
    ts: new Date().toISOString(),
    path,
    from: requestedModel,
    to: state.downgradeModel,
    usagePct: state.usagePct,
    reason,
  };
  appendDecisionLog(decision);
  recordNexusEvent(decision);
  logger.info(
    `[BUDGET-ROUTING] downgrade path=${path} ${decision.from} -> ${decision.to} (${reason})`,
  );
  return state.downgradeModel;
}

// ─── CLI: npx tsx src/tokens/budget-aware-routing.ts [--demo path model] ────
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === '--demo') {
    const path = args[1] ?? 'subagent';
    const requested = args[2] ?? 'opencode/big-pickle';
    const state = getBudgetRoutingState();
    const resolved = resolveBudgetAwareModel(path, requested);
    console.log(
      JSON.stringify(
        {
          state: {
            enabled: state.enabled,
            tier: state.tier,
            usagePct: state.usagePct,
            usedTokensToday: state.usedTokensToday,
            dailyBudget: state.dailyBudget,
            downgradeModel: state.downgradeModel,
          },
          path,
          requested,
          resolved,
          downgraded: resolved !== requested,
        },
        null,
        2,
      ),
    );
    return;
  }
  console.log(JSON.stringify(getBudgetRoutingState(), null, 2));
}

import { pathToFileURL } from 'url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
