import assert from 'node:assert/strict';
import test from 'node:test';

import { db } from '../../src/database/db';
import {
  ResponseCache,
  recordCacheTelemetry,
  getCacheTelemetry,
  isCacheHitRateBelow,
} from '../../src/resilience/response-cache';

test('LRU eviction caps entries and preserves recently-touched keys', () => {
  const cache = new ResponseCache({ useSqlite: true, maxEntries: 3 });
  cache.clear();

  const base = `lru-${Date.now()}-`;
  cache.set(`${base}1`, 'r1', 1);
  cache.set(`${base}2`, 'r2', 1);
  cache.set(`${base}3`, 'r3', 1);

  // Touch key 1 so it becomes the most-recently-used.
  assert.ok(cache.get(`${base}1`), 'key 1 should be a hit after set');

  // Inserting a 4th entry with maxEntries=3 must evict the least-recently-used.
  cache.set(`${base}4`, 'r4', 1);

  // The touched key survives; at least one of the untouched keys was evicted.
  assert.ok(cache.get(`${base}1`), 'touched key survives LRU eviction');
  assert.ok(cache.get(`${base}4`), 'newly inserted key survives');
  assert.ok(
    cache.get(`${base}2`) === null || cache.get(`${base}3`) === null,
    'at least one untouched key evicted',
  );

  cache.clear();
});

test('hourly telemetry round-trips hit/miss buckets to Nexus metric_snapshots', () => {
  const cache = new ResponseCache({ useSqlite: true });
  cache.clear();

  // 1 hit + 3 misses in the current hour bucket.
  cache.set('telemetry-hit-key', 'response', 10);
  assert.ok(cache.get('telemetry-hit-key'), 'hit');
  assert.equal(cache.get('telemetry-miss-1'), null, 'miss 1');
  assert.equal(cache.get('telemetry-miss-2'), null, 'miss 2');
  assert.equal(cache.get('telemetry-miss-3'), null, 'miss 3');

  const written = recordCacheTelemetry();
  assert.ok(written >= 1, `expected >=1 bucket written, got ${written}`);

  const report = getCacheTelemetry(1);
  assert.ok(report.length >= 1, 'telemetry readable from Nexus');
  const latest = report[0];
  assert.ok(latest.hits >= 1, `hits recorded (got ${latest.hits})`);
  assert.ok(latest.misses >= 3, `misses recorded (got ${latest.misses})`);
  assert.ok(
    typeof latest.hitRate === 'number' && latest.hitRate >= 0 && latest.hitRate <= 100,
    `hitRate is a valid percentage (got ${latest.hitRate})`,
  );

  cache.clear();
});

test('isCacheHitRateBelow flags low hit-rate from the latest telemetry row', () => {
  const d = db().getDb();

  // Deterministic ordering: use strictly increasing ISO timestamps (same format
  // as the hourly buckets) so the "latest" row is unambiguous regardless of
  // concurrent test writes.
  const lowRateTs = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
  const highRateTs = new Date(Date.now() + 4 * 3600 * 1000).toISOString();

  // Low hit-rate row (1 hit / 9 misses = 10%) → below 50% threshold.
  d.prepare(
    `INSERT INTO metric_snapshots
       (tenant_id, timestamp, cache_hits, cache_misses, cache_hit_rate, health_status)
     VALUES ('gentle-vanguard', ?, 1, 9, 10, 'cache-telemetry')`,
  ).run(lowRateTs);
  assert.equal(isCacheHitRateBelow(0.5), true, '10% hit-rate must be flagged');

  // High hit-rate row (9 hits / 1 miss = 90%) → above threshold.
  d.prepare(
    `INSERT INTO metric_snapshots
       (tenant_id, timestamp, cache_hits, cache_misses, cache_hit_rate, health_status)
     VALUES ('gentle-vanguard', ?, 9, 1, 90, 'cache-telemetry')`,
  ).run(highRateTs);
  assert.equal(isCacheHitRateBelow(0.5), false, '90% hit-rate must not be flagged');

  // Cleanup: remove the synthetic future rows only.
  d.prepare(
    `DELETE FROM metric_snapshots
     WHERE health_status = 'cache-telemetry' AND timestamp > ?`,
  ).run(new Date(Date.now() + 2 * 3600 * 1000).toISOString());
});
