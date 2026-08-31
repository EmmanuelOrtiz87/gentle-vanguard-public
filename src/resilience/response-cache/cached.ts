/**
 * cached() — non-invasive response-cache wrapper for real execution paths.
 *
 * Wraps an expensive/deterministic operation with the SQLite-backed
 * ResponseCache (Nexus `response_cache` table). On hit, the operation is
 * skipped entirely and the estimated token saving is recorded in Nexus
 * `token_savings` (category `response-cache`, same pattern as
 * src/tokens/token-ingest/nexus.ts).
 *
 * Safety rules (never break the host path):
 *   - GV_CACHE_DISABLED=1 (or any truthy '1'/'true'/'yes') → total bypass.
 *   - Any cache read/write/deserialize failure → fall through to the real op.
 *   - TTL default 24h, configurable via GV_CACHE_TTL_MINUTES (minutes).
 *
 * Usage:
 *   const { value, cache } = await cached(
 *     { key: 'web-research-select', input: JSON.stringify(args) },
 *     async () => expensiveWork(),
 *   );
 */

import { ResponseCache } from './cache';
import { getDb, resolveCacheTenantId } from './sqlite';

export interface CacheLike {
  get(input: string, context?: string): { response: string; tokensSaved: number } | null;
  set(
    input: string,
    response: string,
    tokensSaved: number,
    context?: string,
    ttlMinutes?: number,
  ): void;
}

export interface CachedOptions {
  /** Namespace / scope discriminator (becomes part of the SHA256 key input). */
  context: string;
  /** Exact input to cache on — hash of this is the cache key. */
  input: string;
  /** Per-call TTL override in minutes. Default: GV_CACHE_TTL_MINUTES or 1440 (24h). */
  ttlMinutes?: number;
  /** Injectable cache (tests). Defaults to the singleton SQLite ResponseCache. */
  cache?: CacheLike;
  /** Token-savings estimator for the produced value (default: chars/4). */
  estimateTokens?: (value: unknown) => number;
}

export type CachedResult<T> = { value: T; cache: 'hit' | 'miss' | 'bypass'; tokensSaved: number };

export const CACHE_CATEGORY = 'response-cache';

/** GV_CACHE_DISABLED=1/true/yes → all cached() calls bypass the cache. */
export function isCacheDisabled(): boolean {
  const v = (process.env.GV_CACHE_DISABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** Default TTL in minutes: GV_CACHE_TTL_MINUTES (min 1) or 24h. */
export function defaultTtlMinutes(): number {
  const raw = Number.parseInt((process.env.GV_CACHE_TTL_MINUTES ?? '').trim(), 10);
  return Number.isFinite(raw) && raw >= 1 ? raw : 1440;
}

/** Rough token estimate: ~4 chars per token (same heuristic family as token-ingest). */
export function estimateTokensFor(value: unknown): number {
  const s = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  return Math.ceil(s.length / 4);
}

let _singleton: CacheLike | null = null;
function defaultCache(): CacheLike {
  if (!_singleton) {
    _singleton = new ResponseCache(); // SQLite-backed (Nexus response_cache)
  }
  return _singleton;
}

/** Record a cache-hit saving into Nexus token_savings (best-effort, never throws). */
function recordTokenSaving(key: string, savedTokens: number): void {
  if (savedTokens <= 0) return;
  const db = getDb();
  if (!db) return;
  try {
    const messageId = `response-cache:${key.slice(0, 32)}:${Date.now()}`;
    db.getDb()
      .prepare(
        `INSERT OR IGNORE INTO token_savings (message_id, session_id, category, saved_tokens, source, created_at, tenant_id)
         VALUES (?, ?, ?, ?, ?, datetime('now'), ?)`,
      )
      .run(
        messageId,
        process.env.GENTLE_VANGUARD_SESSION_ID ?? null,
        CACHE_CATEGORY,
        savedTokens,
        'response-cache',
        resolveCacheTenantId(),
      );
  } catch {
    /* telemetry is best-effort — never break the host path */
  }
}

/**
 * Execute `fn` under the response cache.
 *
 * - bypass: cache disabled via env, or storage unavailable → run fn, no writes.
 * - miss: run fn, store result, return it (tokensSaved = 0).
 * - hit: skip fn, return deserialized cached value + tokensSaved estimate.
 */
export async function cached<T>(options: CachedOptions, fn: () => Promise<T>): Promise<CachedResult<T>> {
  const { context, input, ttlMinutes, estimateTokens = estimateTokensFor } = options;

  if (isCacheDisabled()) {
    return { value: await fn(), cache: 'bypass', tokensSaved: 0 };
  }

  const cache = options.cache ?? defaultCache();

  // Read side — any failure falls through to the real operation.
  try {
    const hit = cache.get(input, context);
    if (hit) {
      const value = JSON.parse(hit.response) as T;
      if (!options.cache) {
        // Only record token_savings when using the real (default) cache —
        // injected test stubs must not pollute Nexus telemetry.
        recordTokenSaving(context + '|' + input, hit.tokensSaved || estimateTokens(value));
      }
      return { value, cache: 'hit', tokensSaved: hit.tokensSaved || estimateTokens(value) };
    }
  } catch {
    /* corrupt entry / storage error → treat as miss */
  }

  const value = await fn();

  // Write side — never let a cache write failure break the host path.
  try {
    cache.set(input, JSON.stringify(value), estimateTokens(value), context, ttlMinutes ?? defaultTtlMinutes());
  } catch {
    /* ignore */
  }

  return { value, cache: 'miss', tokensSaved: 0 };
}
