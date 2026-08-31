import { getDb, resolveCacheTenantId } from './sqlite';

// ─── Hourly Telemetry (N6) ───────────────────────────────────────────────────

export interface HourlyCacheStats {
  hour: string; // ISO hour bucket, e.g. 2026-08-29T14:00
  hits: number;
  misses: number;
  hitRate: number;
}

/** In-memory rolling hourly buckets. Cleared after each recordCacheTelemetry(). */
const hourlyBuckets = new Map<string, { hits: number; misses: number }>();

function hourBucketKey(ts: number = Date.now()): string {
  const d = new Date(ts);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

export function recordHit(): void {
  const key = hourBucketKey();
  const bucket = hourlyBuckets.get(key) ?? { hits: 0, misses: 0 };
  bucket.hits++;
  hourlyBuckets.set(key, bucket);
}

export function recordMiss(): void {
  const key = hourBucketKey();
  const bucket = hourlyBuckets.get(key) ?? { hits: 0, misses: 0 };
  bucket.misses++;
  hourlyBuckets.set(key, bucket);
}

/**
 * Persist hourly hit/miss buckets to Nexus metric_snapshots (cache_hits,
 * cache_misses, cache_hit_rate) and clear the in-memory buckets.
 * Returns the number of hour buckets written.
 */
export function recordCacheTelemetry(): number {
  const db = getDb();
  if (!db || hourlyBuckets.size === 0) return 0;

  let written = 0;
  const tenantId = resolveCacheTenantId();
  const insert = db.getDb().prepare(
    `INSERT INTO metric_snapshots
         (tenant_id, timestamp, tokens_used, tokens_limit, cost, sessions_total,
          sessions_active, sessions_today, latency_avg, latency_p50, latency_p95,
          commits, mcp_calls, mcp_skills, health_status, cache_hits, cache_misses, cache_hit_rate)
       VALUES (?, ?, 0, 120000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'cache-telemetry', ?, ?, ?)`,
  );

  for (const [hour, bucket] of hourlyBuckets) {
    const total = bucket.hits + bucket.misses;
    const hitRate = total > 0 ? Math.round((bucket.hits / total) * 10000) / 100 : 0;
    try {
      insert.run(tenantId, hour, bucket.hits, bucket.misses, hitRate);
      written++;
    } catch {
      /* ignore per-bucket failures */
    }
  }

  hourlyBuckets.clear();
  return written;
}

/** Aggregate hourly telemetry from metric_snapshots (read-only, for reports). */
export function getCacheTelemetry(limit = 24): HourlyCacheStats[] {
  const db = getDb();
  if (!db) return [];
  try {
    const tenantId = resolveCacheTenantId();
    const rows = db
      .getDb()
      .prepare(
        `SELECT timestamp, cache_hits, cache_misses, cache_hit_rate
         FROM metric_snapshots
         WHERE tenant_id = ? AND health_status = 'cache-telemetry'
         ORDER BY timestamp DESC LIMIT ?`,
      )
      .all(tenantId, limit) as Array<{
      timestamp: string;
      cache_hits: number;
      cache_misses: number;
      cache_hit_rate: number;
    }>;
    return rows.map((r) => ({
      hour: r.timestamp,
      hits: r.cache_hits,
      misses: r.cache_misses,
      hitRate: r.cache_hit_rate,
    }));
  } catch {
    return [];
  }
}

/** Check the latest hourly hit-rate against a threshold; returns true if below. */
export function isCacheHitRateBelow(threshold = 0.5): boolean {
  const telemetry = getCacheTelemetry(1);
  if (telemetry.length === 0) return false;
  const latest = telemetry[0];
  const total = latest.hits + latest.misses;
  if (total === 0) return false;
  return latest.hits / total < threshold;
}

/** Lifetime token savings recorded by cached() hits (token_savings, category response-cache). */
export function getLifetimeSavings(): { hits: number; tokensSaved: number } {
  const db = getDb();
  if (!db) return { hits: 0, tokensSaved: 0 };
  try {
    const tenantId = resolveCacheTenantId();
    const row = db
      .getDb()
      .prepare(
        `SELECT COUNT(*) as hits, COALESCE(SUM(saved_tokens), 0) as tokens_saved
         FROM token_savings WHERE tenant_id = ? AND category = 'response-cache'`,
      )
      .get(tenantId) as { hits: number; tokens_saved: number } | undefined;
    return { hits: row?.hits ?? 0, tokensSaved: row?.tokens_saved ?? 0 };
  } catch {
    return { hits: 0, tokensSaved: 0 };
  }
}
