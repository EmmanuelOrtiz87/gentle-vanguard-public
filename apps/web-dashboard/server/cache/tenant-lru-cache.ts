/**
 * Tenant-scoped LRU cache for dashboard hot paths.
 *
 * Purpose: absorb burst reads of synchronous better-sqlite3 queries in
 * real-data.ts / websocket-server.ts without serving stale data across
 * push cycles.
 *
 * Strategy: short TTL (default 3s < the 5s WS push interval) so each push
 * computes fresh data, while concurrent REST requests within the same
 * window share a single computation. Event-driven invalidation is exposed
 * via invalidate() for repos that want immediate coherence after writes.
 *
 * Usage:
 *   const data = getOrLoad('metrics', tenantId, () => computeHeavy(), { ttlMs: 3000 });
 *   invalidate('metrics', tenantId); // after a write, if needed
 */
export interface LruEntry<V> {
  value: V;
  expiresAt: number;
  createdAt: number;
}

export interface LruStats {
  hits: number;
  misses: number;
  evictions: number;
  expirations: number;
  size: number;
  hitRate: number;
}

interface ScopeState {
  entries: Map<string, LruEntry<unknown>>;
  hits: number;
  misses: number;
  evictions: number;
  expirations: number;
}

const DEFAULT_TTL_MS = 3000;
const DEFAULT_MAX_ENTRIES = 64;

const scopes = new Map<string, ScopeState>();

function scopeFor(name: string): ScopeState {
  let s = scopes.get(name);
  if (!s) {
    s = { entries: new Map(), hits: 0, misses: 0, evictions: 0, expirations: 0 };
    scopes.set(name, s);
  }
  return s;
}

/** Composite key: tenant + caller-supplied param signature. */
function buildKey(tenantId: string | undefined, params?: unknown[]): string {
  const p = params && params.length ? ':' + params.map((x) => String(x)).join('|') : '';
  return `${tenantId ?? '_global_'}${p}`;
}

export interface GetOrLoadOptions {
  /** Entry lifetime. Default 3000ms (< WS push interval). */
  ttlMs?: number;
  /** Max entries kept per cache name (LRU eviction). Default 64. */
  maxEntries?: number;
  /** Extra params folded into the cache key (beyond tenant). */
  params?: unknown[];
}

/**
 * Return cached value for (name, tenantId, params) or compute via `loader`,
 * storing the result. Expired entries are transparently recomputed.
 */
export function getOrLoad<V>(
  name: string,
  tenantId: string | undefined,
  loader: () => V,
  options: GetOrLoadOptions = {},
): V {
  const scope = scopeFor(name);
  const key = buildKey(tenantId, options.params);
  const now = Date.now();
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;

  const existing = scope.entries.get(key);
  if (existing) {
    if (existing.expiresAt > now) {
      scope.hits++;
      // LRU touch: re-insert to move to most-recent position
      scope.entries.delete(key);
      scope.entries.set(key, existing);
      return existing.value as V;
    }
    scope.expirations++;
    scope.entries.delete(key);
  }

  scope.misses++;
  const value = loader();
  scope.entries.set(key, { value, expiresAt: now + ttl, createdAt: now });

  // LRU eviction when over capacity
  while (scope.entries.size > maxEntries) {
    const oldest = scope.entries.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    scope.entries.delete(oldest);
    scope.evictions++;
  }

  return value;
}

/**
 * Invalidate cached entries.
 *  - invalidate()                      → everything
 *  - invalidate('metrics')             → all tenants of one cache name
 *  - invalidate('metrics', 'acme')     → single tenant of one cache name
 */
export function invalidate(name?: string, tenantId?: string): number {
  if (!name) {
    let n = 0;
    for (const s of scopes.values()) n += s.entries.size;
    scopes.clear();
    return n;
  }
  const scope = scopes.get(name);
  if (!scope) return 0;
  if (!tenantId) {
    const n = scope.entries.size;
    scope.entries.clear();
    return n;
  }
  let n = 0;
  for (const key of [...scope.entries.keys()]) {
    if (key.startsWith(`${tenantId}:`) || key === tenantId) {
      scope.entries.delete(key);
      n++;
    }
  }
  return n;
}

/** Observability snapshot for dashboards/watchtower. */
export function getLruStats(): Record<string, LruStats> {
  const out: Record<string, LruStats> = {};
  for (const [name, s] of scopes.entries()) {
    const total = s.hits + s.misses;
    out[name] = {
      hits: s.hits,
      misses: s.misses,
      evictions: s.evictions,
      expirations: s.expirations,
      size: s.entries.size,
      hitRate: total === 0 ? 0 : s.hits / total,
    };
  }
  return out;
}
