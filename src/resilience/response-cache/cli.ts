import { ResponseCache } from './cache';
import { DEFAULT_CONFIG, sqliteEvictLru } from './sqlite';
import {
  getCacheTelemetry,
  getLifetimeSavings,
  isCacheHitRateBelow,
  recordCacheTelemetry,
} from './telemetry';

// ─── CLI Interface ──────────────────────────────────────────────────────────────

export function printUsage(): void {
  console.log(`
SHA256 Response Cache CLI (SQLite-backed)

Usage:
  npx tsx src/resilience/response-cache.ts <command> [options]

Commands:
  stats                    Show cache statistics
  get <input> [context]    Get cached response (test)
  set <input> <response>   Store response in cache (test)
  clear                    Clear all cache entries
  cleanup                  Remove expired entries + LRU eviction
  migrate                  Migrate legacy JSON cache to SQLite
  telemetry [hours]        Persist hourly hit/miss buckets to Nexus + show report
  hitrate                  Show latest hourly hit-rate (alert check)
  evict                    Force LRU eviction to maxEntries
  test                     Run cache tests

Options:
  --legacy                 Use legacy JSON files instead of SQLite

Examples:
  npx tsx src/resilience/response-cache.ts stats
  npx tsx src/resilience/response-cache.ts cleanup
  npx tsx src/resilience/response-cache.ts migrate
`);
}

export function runCLI(): void {
  const args = process.argv.slice(2);
  const command = args[0];
  const useLegacy = args.includes('--legacy');

  const cache = new ResponseCache({ useSqlite: !useLegacy });

  switch (command) {
    case 'stats': {
      const stats = cache.getStats();
      const savings = getLifetimeSavings();
      console.log('\n=== Response Cache Statistics ===\n');
      console.log(`Storage:         ${useLegacy ? 'JSON files' : 'SQLite'}`);
      console.log(`Cache Hits:      ${stats.hits}`);
      console.log(`Cache Misses:    ${stats.misses}`);
      console.log(`Hit Rate:        ${stats.hitRate}%`);
      console.log(`Total Savings:   ${stats.totalSavings} tokens`);
      console.log(`Active Entries:  ${stats.entries}`);
      console.log(`Expired Removed: ${stats.expired}`);
      console.log(
        `cached() Savings (token_savings): ${savings.tokensSaved} tokens across ${savings.hits} recorded hits`,
      );
      console.log(`Cache Bypassed:  ${process.env.GV_CACHE_DISABLED === '1' ? 'YES (GV_CACHE_DISABLED=1)' : 'no'}`);
      console.log('\nExpected Impact: 33-41% latency reduction');
      console.log('                 25-35% token cost reduction\n');
      break;
    }

    case 'get': {
      const input = args[1];
      const context = args[2] || '';
      if (!input) {
        console.error('Error: Input required');
        process.exit(1);
      }
      const result = cache.get(input, context);
      if (result) {
        console.log('Cache HIT!');
        console.log(`Tokens Saved: ${result.tokensSaved}`);
        console.log(`Response: ${result.response.slice(0, 200)}...`);
      } else {
        console.log('Cache MISS');
      }
      break;
    }

    case 'set': {
      const input = args[1];
      const response = args[2];
      if (!input || !response) {
        console.error('Error: Input and response required');
        process.exit(1);
      }
      cache.set(input, response, 100);
      console.log('Response cached successfully');
      break;
    }

    case 'clear': {
      cache.clear();
      console.log('Cache cleared successfully');
      break;
    }

    case 'cleanup': {
      const cleaned = cache.cleanup();
      console.log(`Cleaned up ${cleaned} expired entries`);
      break;
    }

    case 'migrate': {
      const count = cache.migrateFromJson();
      console.log(`Migration complete: ${count} entries migrated to SQLite`);
      break;
    }

    case 'telemetry': {
      const written = recordCacheTelemetry();
      const hours = parseInt(args[1] ?? '24', 10);
      const report = getCacheTelemetry(hours);
      console.log('\n=== Cache Telemetry (hourly) ===\n');
      console.log(`Buckets persisted: ${written}`);
      if (report.length === 0) {
        console.log('No hourly telemetry recorded yet.');
      } else {
        for (const r of report) {
          const total = r.hits + r.misses;
          console.log(
            `${r.hour}  hits=${r.hits}  misses=${r.misses}  hitRate=${r.hitRate}%  (total=${total})`,
          );
        }
      }
      const below = isCacheHitRateBelow(0.5);
      console.log(`\nLatest hit-rate below 50%: ${below ? 'YES ⚠️' : 'no ✅'}`);
      break;
    }

    case 'hitrate': {
      const report = getCacheTelemetry(1);
      if (report.length === 0) {
        console.log(
          'No hourly telemetry recorded yet. Run: npx tsx src/resilience/response-cache.ts telemetry',
        );
        break;
      }
      const latest = report[0];
      const total = latest.hits + latest.misses;
      const rate = total > 0 ? Math.round((latest.hits / total) * 10000) / 100 : 0;
      console.log(
        `Latest hour (${latest.hour}): hitRate=${rate}% (${latest.hits} hits / ${total} total)`,
      );
      console.log(`Below 50% threshold: ${rate < 50 ? 'YES ⚠️' : 'no ✅'}`);
      break;
    }

    case 'evict': {
      const evicted = sqliteEvictLru(DEFAULT_CONFIG.maxEntries);
      console.log(
        `LRU eviction: ${evicted} entries removed (maxEntries=${DEFAULT_CONFIG.maxEntries})`,
      );
      break;
    }

    case 'test': {
      console.log('\n=== Running Cache Tests ===\n');

      // Test 1: Basic set/get
      console.log('Test 1: Basic set/get');
      cache.set('test-input-1', 'test-response-1', 50);
      const result1 = cache.get('test-input-1');
      console.log(result1?.response === 'test-response-1' ? '✅ PASS' : '❌ FAIL');

      // Test 2: Cache hit
      console.log('Test 2: Cache hit tracking');
      const result2 = cache.get('test-input-1');
      console.log(result2?.tokensSaved === 50 ? '✅ PASS' : '❌ FAIL');

      // Test 3: Cache miss
      console.log('Test 3: Cache miss');
      const result3 = cache.get('non-existent-input');
      console.log(result3 === null ? '✅ PASS' : '❌ FAIL');

      // Test 4: Stats
      console.log('Test 4: Stats tracking');
      const stats = cache.getStats();
      console.log(stats.hits >= 2 && stats.misses >= 1 ? '✅ PASS' : '❌ FAIL');

      console.log('\n=== Tests Complete ===\n');
      break;
    }

    default:
      printUsage();
      process.exit(1);
  }
}
