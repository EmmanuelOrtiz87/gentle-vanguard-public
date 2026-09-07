import { readFileSync } from 'fs';
import { join } from 'path';
import { ROOT } from '../shared.ts';
import { getProcessExecutionTimeouts } from '@gentle-vanguard/core/timeout-config';
import { DatabaseManager } from '../database/manager.ts';
import { runSync } from '@gentle-vanguard/core/run-command';

// ─── Fallback JSON paths (used only when DB has no data) ──────────────
export const CONSOLIDATED_PATH = join(ROOT, '.runtime', 'metrics', 'consolidated.json');
export const STATS_PATH = join(ROOT, '.atl', 'skill-stats.json');
export const REGISTRY_PATH = join(ROOT, '.atl', 'skill-registry.md');
export const SESSIONS_HISTORY_PATH = join(ROOT, '.event-bus', 'sessions-history.json');
export const CONTEXT_LOG_DIR = join(ROOT, '.session', 'context-log');
export const TELEMETRY_TRACES_DIR = join(ROOT, '.telemetry', 'traces');
export const TOKEN_BUDGET_PATH = join(ROOT, 'config', 'token-budget-guard.json');
export const SYSTEM_WIDE_FILESYSTEM_METADATA = { scope: 'system-wide' } as const;

/** Dashboard token limit from the canonical budget config (not a legacy fallback). */
export function getConfiguredSessionTokenLimit(): number {
  try {
    const config = JSON.parse(readFileSync(TOKEN_BUDGET_PATH, 'utf8')) as {
      tokenBudget?: { limits?: { perSession?: number } };
    };
    const limit = config.tokenBudget?.limits?.perSession;
    if (typeof limit === 'number' && limit > 0) return limit;
  } catch {
    // Keep the operational default if config is temporarily unavailable.
  }
  return 3_000_000;
}

export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'big-pickle': { input: 10, output: 30 },
  'gpt-4': { input: 30, output: 60 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'claude-3-opus': { input: 15, output: 75 },
  'claude-3-sonnet': { input: 3, output: 15 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  'claude-4-sonnet': { input: 3, output: 15 },
  default: { input: 10, output: 30 },
};

// ─── LRU Cache for .state.json reads ──────────────────────────────────
export const stateCache = new Map<string, { data: string; timestamp: number }>();
const CACHE_MAX = 20;
const CACHE_TTL = 2000;

export function readWithCache(path: string): string {
  const now = Date.now();
  const cached = stateCache.get(path);
  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  if (stateCache.size >= CACHE_MAX) {
    const key = stateCache.keys().next().value;
    if (key) stateCache.delete(key);
  }
  const data = readFileSync(path, 'utf-8');
  stateCache.set(path, { data, timestamp: now });
  return data;
}

// ─── Helpers ──────────────────────────────────────────────────────────

export function execGit(args: string): string {
  try {
    const result = runSync('git', args.split(' '), {
      cwd: ROOT,
      timeout: getProcessExecutionTimeouts().git_operation_ms ?? 3000,
    });
    return result.stdout?.trim() ?? '';
  } catch {
    return '';
  }
}

// ─── Database Access ──────────────────────────────────────────────────

let dbInstance: DatabaseManager | null = null;

export function getDb(): DatabaseManager {
  if (!dbInstance) {
    try {
      dbInstance = DatabaseManager.getInstance();
    } catch {
      // If DB is not available, we'll use fallback
    }
  }
  return dbInstance!;
}

export function dbAvailable(): boolean {
  try {
    return !!getDb() && getDb().hasData();
  } catch {
    return false;
  }
}

export const ACTIVE_SESSION_FRESHNESS_MS = 15 * 60 * 1000;

export function getFreshActiveSessions(): ReturnType<DatabaseManager['getActiveSessions']> {
  const cutoff = Date.now() - ACTIVE_SESSION_FRESHNESS_MS;
  return getDb()
    .getActiveSessions()
    .filter((session) => {
      const updatedAt = Date.parse(session.updated_at || '');
      return Number.isFinite(updatedAt) && updatedAt >= cutoff;
    });
}
