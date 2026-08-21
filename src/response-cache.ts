#!/usr/bin/env node
/**
 * SHA256 Response Cache — SQLite-backed
 *
 * Caches responses based on SHA256 hash of input + context.
 * Persisted in gentle-vanguard.db via the response_cache table.
 * Legacy JSON files in .session/response-cache/ are migrated on first use.
 *
 * Features:
 * - SHA256-based cache keys
 * - TTL-based expiration (default 30 min)
 * - Cache hit/miss metrics tracking
 * - Automatic cleanup of expired entries
 * - Persistent storage in SQLite (response_cache table)
 *
 * Expected Impact: 33-41% latency reduction, 25-35% token cost reduction
 */

import { createHash } from 'crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  statSync,
} from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { db as getDbSingleton } from './database/db';

// ─── Semantic Search Helpers (reused from skill-router) ──────────────────────

const SEM_STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'and',
  'or',
  'is',
  'it',
  'as',
  'be',
  'by',
  'with',
  'from',
  'that',
  'this',
  'are',
  'was',
  'were',
  'been',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'can',
  'could',
  'should',
  'may',
  'might',
  'shall',
  'not',
  'no',
  'but',
  'if',
  'so',
  'up',
  'out',
  'about',
  'into',
  'over',
  'after',
  'before',
  'between',
  'under',
  'again',
  'further',
  'then',
  'once',
  'also',
  'very',
  'just',
  'each',
  'any',
  'all',
  'both',
  'more',
  'most',
  'some',
  'such',
  'only',
  'own',
  'same',
  'than',
  'too',
  'el',
  'la',
  'los',
  'las',
  'de',
  'del',
  'en',
  'un',
  'una',
  'que',
  'es',
  'se',
  'por',
  'para',
  'con',
  'una',
  'lo',
  'como',
  'mas',
  'pero',
  'sus',
  'le',
  'ya',
  'este',
  'entre',
  'porque',
  'todo',
  'esta',
  'sin',
  'son',
]);

function semTokenize(text: string): string[] {
  if (!text) return [];
  const cleaned = text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ');
  return cleaned
    .split(/[\s-]+/)
    .filter((t) => t.length >= 2 && t.length <= 40 && !SEM_STOP_WORDS.has(t));
}

function computeTfIdfVector(
  tokens: string[],
  vocab: string[],
  idf: Record<string, number>,
): Record<string, number> {
  const tf: Record<string, number> = {};
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
  const totalTerms = tokens.length || 1;
  const vec: Record<string, number> = {};
  for (const [term, count] of Object.entries(tf)) {
    if (vocab.indexOf(term) === -1) continue;
    const tfVal = Math.log10(1 + (count / totalTerms) * 100);
    const idfVal = idf[term] !== undefined ? idf[term] : 1.0;
    vec[term] = tfVal * idfVal;
  }
  let norm = 0;
  for (const v of Object.values(vec)) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) for (const t of Object.keys(vec)) vec[t] /= norm;
  return vec;
}

function cosineSim(a: Record<string, number>, b: Record<string, number>): number {
  let dot = 0;
  for (const [term, val] of Object.entries(a)) {
    if (b[term] !== undefined) dot += val * b[term];
  }
  return dot;
}

// Lazy-loaded embeddings index
let _semEmbeddings: { vocabulary: string[]; idf: Record<string, number> } | null = null;

function getSemEmbeddings(): { vocabulary: string[]; idf: Record<string, number> } | null {
  if (!_semEmbeddings) {
    const embPath = join(
      resolve(process.env.GENTLE_VANGUARD_BASE_DIR ?? process.cwd()),
      '.atl',
      'skill-embeddings.json',
    );
    if (!existsSync(embPath)) return null;
    try {
      const data = JSON.parse(readFileSync(embPath, 'utf-8'));
      _semEmbeddings = { vocabulary: data.vocabulary, idf: data.idf };
    } catch {
      return null;
    }
  }
  return _semEmbeddings;
}

// Semantic similarity gate for cache hits. 0.9 (not 0.85) + a minimum token
// count: TF-IDF cosine with a small vocabulary biases short inputs to ~87%
// similarity, causing false-positive semantic hits (verified 2026-08-14).
const SEMANTIC_CACHE_THRESHOLD = 0.9;
const MIN_SEMANTIC_INPUT_TOKENS = 40;

/** Try to find a semantically similar cache entry when exact match fails */
function semanticCacheLookup(
  input: string,
): { response: string; key: string; similarity: number } | null {
  const emb = getSemEmbeddings();
  if (!emb) return null;

  const tokens = semTokenize(input);
  // Short inputs are unreliable under cosine similarity (false-positive risk).
  if (tokens.length < MIN_SEMANTIC_INPUT_TOKENS) return null;

  const queryVec = computeTfIdfVector(tokens, emb.vocabulary, emb.idf);
  if (Object.keys(queryVec).length === 0) return null;

  try {
    const db = getDbSingleton();
    if (!db) return null;

    // Get all cache entries that have embeddings
    const rows = db
      .getDb()
      .prepare(
        `SELECT key, response, input_embedding FROM response_cache
       WHERE input_embedding IS NOT NULL AND input_embedding != '{}'
       AND (expires_at IS NULL OR expires_at > datetime('now'))`,
      )
      .all() as Array<{ key: string; response: string; input_embedding: string }>;

    let bestMatch: { key: string; response: string; similarity: number } | null = null;

    for (const row of rows) {
      try {
        const storedVec = JSON.parse(row.input_embedding) as Record<string, number>;
        const sim = cosineSim(queryVec, storedVec);
        if (sim > SEMANTIC_CACHE_THRESHOLD && (!bestMatch || sim > bestMatch.similarity)) {
          bestMatch = { key: row.key, response: row.response, similarity: sim };
        }
      } catch {
        /* skip unparseable embeddings */
      }
    }

    if (bestMatch) {
      // Record hit on the matched entry
      try {
        db.getDb()
          .prepare('UPDATE response_cache SET hit_count = hit_count + 1 WHERE key = ?')
          .run(bestMatch.key);
      } catch {
        /* ignore */
      }
    }

    return bestMatch;
  } catch {
    return null;
  }
}

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

const ROOT = resolve(process.cwd());
const LEGACY_DIR = join(ROOT, '.session', 'response-cache');
const DEFAULT_CONFIG: CacheConfig = {
  enabled: true,
  defaultTtlMinutes: 60, // Extended from 30 to 60 minutes for better cache hit rate
  maxEntries: 1000,
  cleanupInterval: 5 * 60 * 1000, // 5 minutes
  useSqlite: true,
};

// ─── DB helper ────────────────────────────────────────────────────────────────

let _dbCached: any = null;
function getDb(): any {
  if (!_dbCached) {
    try {
      _dbCached = getDbSingleton();
      // Ensure tokens_saved column exists (Wave 35 migration for existing DBs)
      ensureTokensColumn();
    } catch {
      return null;
    }
  }
  return _dbCached;
}

/** Ensure the tokens_saved column exists in response_cache table */
function ensureTokensColumn(): void {
  if (!_dbCached) return;
  try {
    // Check if column exists
    _dbCached.getDb().prepare('SELECT tokens_saved FROM response_cache LIMIT 1').get();
  } catch {
    // Column doesn't exist — add it
    try {
      _dbCached
        .getDb()
        .prepare('ALTER TABLE response_cache ADD COLUMN tokens_saved INTEGER DEFAULT 0')
        .run();
      console.log('[response-cache] Added tokens_saved column to response_cache table');
    } catch (e2) {
      console.warn('[response-cache] Could not add tokens_saved column:', (e2 as Error).message);
    }
  }
}

// ─── Core Functions ───────────────────────────────────────────────────────────

function generateCacheKey(input: string, context: string = ''): string {
  const hash = createHash('sha256');
  hash.update(input + '|' + context);
  return hash.digest('hex');
}

// ─── SQLite Operations (primary) ──────────────────────────────────────────────

function sqliteGet(key: string, input?: string): CacheEntry | null {
  const db = getDb();
  if (!db) return null;

  try {
    let tokensCol = '0';
    try {
      db.getDb().prepare('SELECT tokens_saved FROM response_cache LIMIT 1').get();
      tokensCol = 'tokens_saved';
    } catch {
      /* column doesn't exist yet */
    }

    const row = db
      .getDb()
      .prepare(
        `SELECT key, response, created_at, hit_count, expires_at, ${tokensCol} as tokens_saved
         FROM response_cache WHERE key = ?
         AND (expires_at IS NULL OR expires_at > datetime('now'))`,
      )
      .get(key) as any;

    if (row) {
      // Exact hit — increment hit count
      db.getDb()
        .prepare('UPDATE response_cache SET hit_count = hit_count + 1 WHERE key = ?')
        .run(key);

      return {
        key: row.key,
        input: '',
        response: row.response,
        timestamp: new Date(row.created_at).getTime(),
        ttl: DEFAULT_CONFIG.defaultTtlMinutes * 60 * 1000,
        hitCount: row.hit_count + 1,
        tokensSaved: row.tokens_saved ?? 0,
      };
    }

    // Exact miss — try semantic lookup
    if (input) {
      const semantic = semanticCacheLookup(input);
      if (semantic) {
        console.log(
          `[response-cache] Semantic cache HIT: "${input.substring(0, 60)}..." → "${semantic.key.substring(0, 16)}" (sim: ${(semantic.similarity * 100).toFixed(0)}%)`,
        );
        return {
          key: semantic.key,
          input,
          response: semantic.response,
          timestamp: Date.now(),
          ttl: DEFAULT_CONFIG.defaultTtlMinutes * 60 * 1000,
          hitCount: 1,
          tokensSaved: 0,
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

function sqliteSet(
  key: string,
  response: string,
  tokensSaved = 0,
  ttlMinutes?: number,
  input?: string,
): void {
  const db = getDb();
  if (!db) return;

  try {
    const ttl = ttlMinutes ?? DEFAULT_CONFIG.defaultTtlMinutes;
    const expiresAt = ttl > 0 ? new Date(Date.now() + ttl * 60 * 1000).toISOString() : null;

    // Compute input embedding for semantic search
    const inputText = input ?? '';
    let inputEmbedding = '{}';
    if (input) {
      const emb = getSemEmbeddings();
      if (emb) {
        const tokens = semTokenize(input);
        if (tokens.length > 0) {
          const vec = computeTfIdfVector(tokens, emb.vocabulary, emb.idf);
          if (Object.keys(vec).length > 0) {
            inputEmbedding = JSON.stringify(vec);
          }
        }
      }
    }

    db.getDb()
      .prepare(
        `INSERT OR REPLACE INTO response_cache (key, response, model, input_text, input_embedding, created_at, expires_at, hit_count, tokens_saved)
         VALUES (?, ?, NULL, ?, ?, datetime('now'), ?,
           COALESCE((SELECT hit_count FROM response_cache WHERE key = ?), 0), ?)`,
      )
      .run(key, response, inputText, inputEmbedding, expiresAt, key, tokensSaved);
  } catch (e) {
    console.warn('[response-cache] SQLite write failed:', (e as Error).message);
  }
}

function sqliteClear(): void {
  const db = getDb();
  if (!db) return;
  try {
    db.getDb().prepare('DELETE FROM response_cache').run();
  } catch {
    /* ignore */
  }
}

function sqliteCleanup(): number {
  const db = getDb();
  if (!db) return 0;
  try {
    const result = db
      .getDb()
      .prepare("DELETE FROM response_cache WHERE expires_at < datetime('now')")
      .run();
    return result.changes;
  } catch {
    return 0;
  }
}

function sqliteCount(): number {
  const db = getDb();
  if (!db) return 0;
  try {
    const row = db.getDb().prepare('SELECT COUNT(*) as c FROM response_cache').get() as any;
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

// ─── Legacy JSON Operations (fallback/deprecated) ────────────────────────────

function getLegacyFilePath(key: string): string {
  const subdir = key.slice(0, 2);
  return join(LEGACY_DIR, subdir, `${key}.json`);
}

function legacyLoadEntry(key: string): CacheEntry | null {
  const filePath = getLegacyFilePath(key);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function legacySaveEntry(entry: CacheEntry): void {
  const subdir = entry.key.slice(0, 2);
  const dir = join(LEGACY_DIR, subdir);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(getLegacyFilePath(entry.key), JSON.stringify(entry, null, 2));
}

// ─── Public API ──────────────────────────────────────────────────────────────

export { generateCacheKey };

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
      console.log('[response-cache] No legacy cache directory found');
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
    console.log(`[response-cache] Migrated ${migrated} entries from JSON to SQLite`);
    return migrated;
  }
}

// ─── CLI Interface ──────────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`
SHA256 Response Cache CLI (SQLite-backed)

Usage:
  npx tsx src/response-cache.ts <command> [options]

Commands:
  stats                    Show cache statistics
  get <input> [context]    Get cached response (test)
  set <input> <response>   Store response in cache (test)
  clear                    Clear all cache entries
  cleanup                  Remove expired entries
  migrate                  Migrate legacy JSON cache to SQLite
  test                     Run cache tests

Options:
  --legacy                 Use legacy JSON files instead of SQLite

Examples:
  npx tsx src/response-cache.ts stats
  npx tsx src/response-cache.ts cleanup
  npx tsx src/response-cache.ts migrate
`);
}

function runCLI(): void {
  const args = process.argv.slice(2);
  const command = args[0];
  const useLegacy = args.includes('--legacy');

  const cache = new ResponseCache({ useSqlite: !useLegacy });

  switch (command) {
    case 'stats': {
      const stats = cache.getStats();
      console.log('\n=== Response Cache Statistics ===\n');
      console.log(`Storage:         ${useLegacy ? 'JSON files' : 'SQLite'}`);
      console.log(`Cache Hits:      ${stats.hits}`);
      console.log(`Cache Misses:    ${stats.misses}`);
      console.log(`Hit Rate:        ${stats.hitRate}%`);
      console.log(`Total Savings:   ${stats.totalSavings} tokens`);
      console.log(`Active Entries:  ${stats.entries}`);
      console.log(`Expired Removed: ${stats.expired}`);
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

// Run CLI if called directly
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCLI();
}
