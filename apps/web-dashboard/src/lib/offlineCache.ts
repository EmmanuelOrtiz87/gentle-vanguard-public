/**
 * Dashboard Offline Cache
 *
 * Per-key localStorage cache for dashboard API responses. Enables offline
 * mode: the last successful response per endpoint is persisted with a
 * timestamp, and served back when the server is unavailable.
 *
 * - Per-key size cap (~200KB): oversized entries are skipped with a warning.
 * - All localStorage access is wrapped in try/catch (quota / privacy mode).
 */

const CACHE_PREFIX = 'gv-dash-cache:';
const CACHE_VERSION = 1;
const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRY_BYTES = 200 * 1024; // ~200KB per key

interface CacheEntry<T> {
  version: number;
  cachedAt: number;
  data: T;
}

export interface CachedRead<T> {
  data: T | null;
  cachedAt: number | null;
}

/**
 * Read a cached entry by key.
 * Returns null when nothing is cached (or the cache is unreadable).
 */
export function readCached<T>(key: string): CachedRead<T> | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (!entry || entry.version !== CACHE_VERSION) return null;
    return { data: entry.data, cachedAt: entry.cachedAt };
  } catch {
    return null;
  }
}

/**
 * Write an entry to the cache.
 * Entries larger than the per-key cap are skipped with a warning.
 */
export function writeCached<T>(key: string, data: T): void {
  try {
    const entry: CacheEntry<T> = { version: CACHE_VERSION, cachedAt: Date.now(), data };
    const serialized = JSON.stringify(entry);
    if (serialized.length > MAX_ENTRY_BYTES) {
      console.warn(
        `[offlineCache] "${key}" exceeded ${MAX_ENTRY_BYTES} bytes (${serialized.length}); skipping write`,
      );
      return;
    }
    localStorage.setItem(CACHE_PREFIX + key, serialized);
  } catch {
    // localStorage unavailable or quota exceeded — cache is best-effort
  }
}

/**
 * Whether a cached entry is older than the allowed maximum age.
 */
export function isStale(cachedAt: number, maxAgeMs: number = DEFAULT_MAX_AGE_MS): boolean {
  return Date.now() - cachedAt > maxAgeMs;
}
