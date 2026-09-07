/**
 * Dashboard Offline Storage
 *
 * Provides localStorage-based persistence for dashboard data when
 * the WebSocket server is unavailable. Enables offline mode operation.
 */

const STORAGE_KEY = 'gentle-vanguard-dashboard-cache';
const STORAGE_VERSION = '1';
const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

export interface CachedDashboardData {
  version: string;
  timestamp: string;
  data: unknown;
  tenantId?: string;
}

/**
 * Save dashboard data to localStorage
 */
export function saveOfflineCache(data: unknown, tenantId?: string): void {
  try {
    const cache: CachedDashboardData = {
      version: STORAGE_VERSION,
      timestamp: new Date().toISOString(),
      data,
      tenantId,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage might be unavailable or full
  }
}

/**
 * Load dashboard data from localStorage
 * Returns null if data is stale or invalid
 */
export function loadOfflineCache(tenantId?: string): unknown | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const cache: CachedDashboardData = JSON.parse(stored);

    // Version check
    if (cache.version !== STORAGE_VERSION) return null;

    // Tenant check
    if (cache.tenantId !== tenantId) return null;

    // Staleness check
    const age = Date.now() - new Date(cache.timestamp).getTime();
    if (age > MAX_AGE_MS) return null;

    return cache.data;
  } catch {
    return null;
  }
}

/**
 * Check if offline cache is available and fresh
 */
export function hasFreshOfflineCache(tenantId?: string): boolean {
  return loadOfflineCache(tenantId) !== null;
}

/**
 * Clear offline cache
 */
export function clearOfflineCache(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
}

/**
 * Get cache metadata (for UI display)
 */
export function getOfflineCacheInfo(): { timestamp: string | null; age: number } {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { timestamp: null, age: 0 };

    const cache: CachedDashboardData = JSON.parse(stored);
    const age = Date.now() - new Date(cache.timestamp).getTime();
    return { timestamp: cache.timestamp, age };
  } catch {
    return { timestamp: null, age: 0 };
  }
}
