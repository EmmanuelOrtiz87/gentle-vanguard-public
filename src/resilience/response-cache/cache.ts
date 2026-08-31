import { existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import {
  DEFAULT_CONFIG,
  generateCacheKey,
  getLegacyFilePath,
  legacyLoadEntry,
  legacySaveEntry,
  LEGACY_DIR,
  sqliteClear,
  sqliteCleanup,
  sqliteCount,
  sqliteEvictLru,
  sqliteGet,
  sqliteSet,
  sqliteTouch,
} from './sqlite';
import { recordHit, recordMiss } from './telemetry';
const logger = log('RESILIENCE-RESPONSE-CACHE-CACHE');
import { log } from '../../utils/logger.js';

export interface CacheEntry {
  key: string;
  input: string;
  response: string;
  timestamp: number;
  ttl: number;
  hitCount: number;
  tokensSaved: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  totalSavings: number;
  entries: number;
  expired: number;
}

export interface CacheConfig {
  enabled: boolean;
  defaultTtlMinutes: number; // minutes
  maxEntries: number;
  cleanupInterval: number; // milliseconds
  useSqlite: boolean; // true = SQLite storage, false = legacy JSON
}

// ─── ResponseCache Class ──────────────────────────────────────────────────────

export class ResponseCache {
  private config: CacheConfig;
  private stats: CacheStats;
  private legacyStatsFile: string;

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.legacyStatsFile = join(LEGACY_DIR, 'cache-stats.json');
    this.stats = this.loadStats();
  }

  private loadStats(): CacheStats {
    if (existsSync(this.legacyStatsFile)) {
      try {
        return JSON.parse(readFileSync(this.legacyStatsFile, 'utf-8'));
      } catch {
        /* reset on error */
      }
    }
    return { hits: 0, misses: 0, hitRate: 0, totalSavings: 0, entries: 0, expired: 0 };
  }

  private saveStats(): void {
    if (existsSync(LEGACY_DIR)) {
      try {
        writeFileSync(this.legacyStatsFile, JSON.stringify(this.stats, null, 2));
      } catch {
        /* ignore */
      }
    }
  }

  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? Math.round((this.stats.hits / total) * 10000) / 100 : 0;
  }

  /**
   * Get a cached response. Returns null if not found or expired.
   * Tries exact SHA256 match first, then semantic similarity.
   */
  get(input: string, context: string = ''): { response: string; tokensSaved: number } | null {
    if (!this.config.enabled) return null;

    const key = generateCacheKey(input, context);

    if (this.config.useSqlite) {
      const entry = sqliteGet(key, input);
      if (entry) {
        this.stats.hits++;
        this.stats.totalSavings += entry.tokensSaved;
        this.updateHitRate();
        this.saveStats();
        recordHit();
        sqliteTouch(entry.key);
        return { response: entry.response, tokensSaved: entry.tokensSaved };
      }
    } else {
      // Legacy JSON path
      const entry = legacyLoadEntry(key);
      if (entry) {
        const now = Date.now();
        if (now > entry.timestamp + entry.ttl) {
          this.stats.expired++;
          this.stats.misses++;
          this.updateHitRate();
          this.saveStats();
          try {
            unlinkSync(getLegacyFilePath(key));
          } catch {
            /* ignore */
          }
          return null;
        }
        entry.hitCount++;
        this.stats.hits++;
        this.stats.totalSavings += entry.tokensSaved;
        this.updateHitRate();
        this.saveStats();
        legacySaveEntry(entry);
        return { response: entry.response, tokensSaved: entry.tokensSaved };
      }
    }

    this.stats.misses++;
    this.updateHitRate();
    this.saveStats();
    recordMiss();
    return null;
  }

  /**
   * Store a response in cache with semantic embedding for future fuzzy matching.
   */
  set(
    input: string,
    response: string,
    tokensSaved: number,
    context: string = '',
    ttlMinutes?: number,
  ): void {
    if (!this.config.enabled) return;

    const key = generateCacheKey(input, context);

    if (this.config.useSqlite) {
      sqliteSet(key, response, tokensSaved, ttlMinutes, input);
      sqliteEvictLru(this.config.maxEntries);
      this.stats.entries = sqliteCount();
    } else {
      const entry: CacheEntry = {
        key,
        input: input.slice(0, 500),
        response,
        timestamp: Date.now(),
        ttl: (ttlMinutes ?? DEFAULT_CONFIG.defaultTtlMinutes) * 60 * 1000,
        hitCount: 0,
        tokensSaved,
      };
      legacySaveEntry(entry);
      this.stats.entries = this.countEntriesLegacy();
    }

    this.saveStats();
  }

  /**
   * Get current statistics.
   */
  getStats(): CacheStats {
    this.stats.entries = this.config.useSqlite ? sqliteCount() : this.countEntriesLegacy();
    return { ...this.stats };
  }

  /**
   * Clear all cache entries.
   */
  clear(): void {
    if (this.config.useSqlite) {
      sqliteClear();
    } else {
      this.clearLegacy();
    }

    this.stats = {
      hits: 0,
      misses: 0,
      hitRate: 0,
      totalSavings: 0,
      entries: 0,
      expired: 0,
    };
    this.saveStats();
  }

  private clearLegacy(): void {
    if (!existsSync(LEGACY_DIR)) return;
    const entries = readdirSync(LEGACY_DIR, { recursive: true });
    for (const entry of entries) {
      const fullPath = join(LEGACY_DIR, entry.toString());
      try {
        if (statSync(fullPath).isFile()) unlinkSync(fullPath);
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Clean up expired entries. Returns count of cleaned entries.
   */
  cleanup(): number {
    let cleaned = 0;

    if (this.config.useSqlite) {
      cleaned = sqliteCleanup();
      cleaned += sqliteEvictLru(this.config.maxEntries);
      this.stats.entries = sqliteCount();
    } else {
      cleaned = this.cleanupLegacy();
    }

    this.saveStats();
    return cleaned;
  }

  private cleanupLegacy(): number {
    if (!existsSync(LEGACY_DIR)) return 0;
    let cleaned = 0;
    const now = Date.now();

    const walkDir = (dir: string) => {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            walkDir(fullPath);
          } else if (entry.endsWith('.json') && entry !== 'cache-stats.json') {
            const data: CacheEntry = JSON.parse(readFileSync(fullPath, 'utf-8'));
            if (now > data.timestamp + data.ttl) {
              unlinkSync(fullPath);
              cleaned++;
              this.stats.expired++;
            }
          }
        } catch {
          /* ignore */
        }
      }
    };

    walkDir(LEGACY_DIR);
    this.stats.entries = this.countEntriesLegacy();
    return cleaned;
  }

  private countEntriesLegacy(): number {
    if (!existsSync(LEGACY_DIR)) return 0;
    let count = 0;

    const walkDir = (dir: string) => {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        try {
          if (statSync(fullPath).isDirectory()) {
            walkDir(fullPath);
          } else if (entry.endsWith('.json') && entry !== 'cache-stats.json') {
            count++;
          }
        } catch {
          /* ignore */
        }
      }
    };

    walkDir(LEGACY_DIR);
    return count;
  }

  /**
   * Migrate legacy JSON cache entries to SQLite.
   * Reads all JSON files from .session/response-cache/ and inserts into response_cache table.
   */
  migrateFromJson(): number {
    if (!existsSync(LEGACY_DIR)) {
      logger.info('[response-cache] No legacy cache directory found');
      return 0;
    }

    let migrated = 0;

    const walkDir = (dir: string) => {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            walkDir(fullPath);
          } else if (entry.endsWith('.json') && entry !== 'cache-stats.json') {
            const data: CacheEntry = JSON.parse(readFileSync(fullPath, 'utf-8'));
            const now = Date.now();

            // Skip expired entries
            if (now > data.timestamp + data.ttl) {
              try {
                unlinkSync(fullPath);
              } catch {
                /* ignore */
              }
              continue;
            }

            // Calculate remaining TTL in minutes
            const remainingMs = data.timestamp + data.ttl - now;
            const ttlMinutes = Math.max(1, Math.ceil(remainingMs / 60000));

            sqliteSet(data.key, data.response, data.tokensSaved, ttlMinutes);
            migrated++;
          }
        } catch {
          /* ignore */
        }
      }
    };

    walkDir(LEGACY_DIR);
    logger.info(`[response-cache] Migrated ${migrated} entries from JSON to SQLite`);
    return migrated;
  }
}
