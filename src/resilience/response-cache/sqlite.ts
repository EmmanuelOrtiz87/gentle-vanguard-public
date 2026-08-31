import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { db as getDbSingleton } from '../../database/db';
import { resolveDeploymentTenantContext } from '../../integrations/deployment-tenant-context';
import type { CacheEntry, CacheConfig } from './cache';
import { computeTfIdfVector, getSemEmbeddings, semanticCacheLookup, semTokenize } from './semantic';
const logger = log('RESILIENCE-RESPONSE-CACHE-SQLITE');
import { log } from '../../utils/logger.js';

const ROOT = resolve(process.cwd());
export const LEGACY_DIR = join(ROOT, '.session', 'response-cache');
export const DEFAULT_CONFIG: CacheConfig = {
  enabled: true,
  defaultTtlMinutes: 60, // Extended from 30 to 60 minutes for better cache hit rate
  maxEntries: 1000,
  cleanupInterval: 5 * 60 * 1000, // 5 minutes
  useSqlite: true,
};

// ─── DB helper ────────────────────────────────────────────────────────────────

/** Minimal DatabaseManager surface used by this module. */
interface DbManagerLike {
  getDb(): {
    prepare(sql: string): {
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown;
      run(...params: unknown[]): { changes: number };
    };
  };
}

let _dbCached: DbManagerLike | null = null;
export function getDb(): DbManagerLike | null {
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
      logger.info('[response-cache] Added tokens_saved column to response_cache table');
    } catch (e2) {
      logger.warn(`[response-cache] Could not add tokens_saved column: ${(e2 as Error).message}`);
    }
  }
}

export function resolveCacheTenantId(): string {
  try {
    return resolveDeploymentTenantContext().tenantId ?? 'gentle-vanguard';
  } catch {
    return 'gentle-vanguard';
  }
}

function hasTenantColumn(db: DbManagerLike): boolean {
  try {
    const columns = db.getDb().prepare("PRAGMA table_info('response_cache')").all() as Array<{
      name?: string;
    }>;
    return columns.some((column) => column.name === 'tenant_id');
  } catch {
    return false;
  }
}

// ─── Core Functions ───────────────────────────────────────────────────────────

export function generateCacheKey(input: string, context: string = ''): string {
  const hash = createHash('sha256');
  hash.update(input + '|' + context);
  return hash.digest('hex');
}

// ─── SQLite Operations (primary) ──────────────────────────────────────────────

export function sqliteGet(key: string, input?: string): CacheEntry | null {
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
      .get(key) as
      | {
          key: string;
          response: string;
          created_at: string;
          hit_count: number;
          expires_at: string | null;
          tokens_saved: number | null;
        }
      | undefined;

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
        logger.info(
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

export function sqliteSet(
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

    if (hasTenantColumn(db)) {
      const tenantId = resolveCacheTenantId();
      db.getDb()
        .prepare(
          `INSERT OR REPLACE INTO response_cache (key, response, model, input_text, input_embedding, created_at, expires_at, hit_count, tokens_saved, tenant_id)
           VALUES (?, ?, NULL, ?, ?, datetime('now'), ?,
             COALESCE((SELECT hit_count FROM response_cache WHERE key = ? AND tenant_id = ?), 0), ?, ?)`,
        )
        .run(
          key,
          response,
          inputText,
          inputEmbedding,
          expiresAt,
          key,
          tenantId,
          tokensSaved,
          tenantId,
        );
    } else {
      db.getDb()
        .prepare(
          `INSERT OR REPLACE INTO response_cache (key, response, model, input_text, input_embedding, created_at, expires_at, hit_count, tokens_saved)
           VALUES (?, ?, NULL, ?, ?, datetime('now'), ?,
             COALESCE((SELECT hit_count FROM response_cache WHERE key = ?), 0), ?)`,
        )
        .run(key, response, inputText, inputEmbedding, expiresAt, key, tokensSaved);
    }
  } catch (e) {
    logger.warn(`[response-cache] SQLite write failed: ${(e as Error).message}`);
  }
}

export function sqliteClear(): void {
  const db = getDb();
  if (!db) return;
  try {
    db.getDb().prepare('DELETE FROM response_cache').run();
  } catch {
    /* ignore */
  }
}

export function sqliteCleanup(): number {
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

// ─── LRU Eviction (N6) ───────────────────────────────────────────────────────

/** Touch an entry: update last_access so LRU eviction keeps recently-used entries. */
export function sqliteTouch(key: string): void {
  const db = getDb();
  if (!db) return;
  try {
    db.getDb()
      .prepare(
        "UPDATE response_cache SET last_access = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE key = ?",
      )
      .run(key);
  } catch {
    /* ignore */
  }
}

/**
 * LRU eviction: when entry count exceeds maxEntries, delete the least-recently
 * accessed entries (fallback to created_at when last_access is NULL). Complements
 * the TTL prune — entries with long TTL but no reuse get evicted first.
 */
export function sqliteEvictLru(maxEntries: number): number {
  const db = getDb();
  if (!db) return 0;
  try {
    const row = db.getDb().prepare('SELECT COUNT(*) as c FROM response_cache').get() as
      { c: number } | undefined;
    const count = row?.c ?? 0;
    if (count <= maxEntries) return 0;

    const excess = count - maxEntries;
    const result = db
      .getDb()
      .prepare(
        `DELETE FROM response_cache WHERE key IN (
           SELECT key FROM response_cache
           ORDER BY COALESCE(last_access, created_at) ASC
           LIMIT ?
         )`,
      )
      .run(excess);
    return result.changes;
  } catch {
    return 0;
  }
}

export function sqliteCount(): number {
  const db = getDb();
  if (!db) return 0;
  try {
    const row = db.getDb().prepare('SELECT COUNT(*) as c FROM response_cache').get() as
      { c: number } | undefined;
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

// ─── Legacy JSON Operations (fallback/deprecated) ────────────────────────────

export function getLegacyFilePath(key: string): string {
  const subdir = key.slice(0, 2);
  return join(LEGACY_DIR, subdir, `${key}.json`);
}

export function legacyLoadEntry(key: string): CacheEntry | null {
  const filePath = getLegacyFilePath(key);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export function legacySaveEntry(entry: CacheEntry): void {
  const subdir = entry.key.slice(0, 2);
  const dir = join(LEGACY_DIR, subdir);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(getLegacyFilePath(entry.key), JSON.stringify(entry, null, 2));
}
