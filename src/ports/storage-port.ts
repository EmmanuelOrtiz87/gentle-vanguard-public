/**
 * StoragePort — hexagonal port for KV/document storage (STACK-EVOLUTION-PLAN F3.3).
 *
 * Minimal, honest surface: the 8 operations the stack actually needs from a
 * KV/document store (session state, routing tables, cache entries, pidbook-style
 * small records). Values are strings; callers JSON-encode structured payloads.
 *
 * Adapters:
 *   - InMemoryStorage   → tests / ephemeral sessions
 *   - SqliteDiskStorage → local-first default (better-sqlite3 under .runtime/)
 *   - Future: Postgres  → same interface, config swap (GV_STORAGE=postgres)
 *
 * Nexus operational data (metrics/traces/events, ADR-007) does NOT go through
 * this port — it stays SQLite-native behind DatabaseManager. See ADR-0024.
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

/** A storage key/value pair as returned by `list()`. */
export interface StorageEntry {
  key: string;
  value: string;
}

export interface StoragePort {
  /** Read a value; undefined when the key does not exist. */
  get(key: string): string | undefined;

  /** Write a value (upsert). Returns true when a previous value was replaced. */
  set(key: string, value: string): boolean;

  /** Delete a key. Returns true when a key was removed. */
  delete(key: string): boolean;

  /** True when the key exists. */
  exists(key: string): boolean;

  /** List entries whose key starts with `prefix` ("" → all), sorted by key. */
  list(prefix?: string): StorageEntry[];

  /** Append `chunk` to the end of the value stored at `key`.
   *  Creates the key when missing. Returns the new total length. */
  append(key: string, chunk: string): number;

  /** Number of stored keys (optionally scoped to a prefix). */
  count(prefix?: string): number;

  /** Release resources. Implementations must be idempotent. */
  close(): void;
}

// ─── In-memory adapter (tests, ephemeral sessions) ─────────────────────────

export class InMemoryStorage implements StoragePort {
  private readonly map = new Map<string, string>();
  private closed = false;

  private assertOpen(): void {
    if (this.closed) throw new Error('InMemoryStorage: already closed');
  }

  get(key: string): string | undefined {
    this.assertOpen();
    return this.map.get(key);
  }

  set(key: string, value: string): boolean {
    this.assertOpen();
    const existed = this.map.has(key);
    this.map.set(key, value);
    return existed;
  }

  delete(key: string): boolean {
    this.assertOpen();
    return this.map.delete(key);
  }

  exists(key: string): boolean {
    this.assertOpen();
    return this.map.has(key);
  }

  list(prefix = ''): StorageEntry[] {
    this.assertOpen();
    return [...this.map.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => (a.key < b.key ? -1 : 1));
  }

  append(key: string, chunk: string): number {
    this.assertOpen();
    const next = (this.map.get(key) ?? '') + chunk;
    this.map.set(key, next);
    return next.length;
  }

  count(prefix = ''): number {
    this.assertOpen();
    if (prefix === '') return this.map.size;
    let n = 0;
    for (const k of this.map.keys()) if (k.startsWith(prefix)) n++;
    return n;
  }

  close(): void {
    this.closed = true;
    this.map.clear();
  }
}

// ─── SQLite disk adapter (local-first default) ─────────────────────────────

export interface SqliteDiskStorageOptions {
  /** Absolute path to the SQLite file. Parent dirs are created. */
  dbPath: string;
}

/**
 * Wraps better-sqlite3 in the StoragePort surface. Synchronous (matches the
 * interface contract and better-sqlite3's model), WAL journaling, one table:
 * `port_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`.
 */
export class SqliteDiskStorage implements StoragePort {
  private readonly db: Database.Database;
  private closed = false;

  constructor(opts: SqliteDiskStorageOptions) {
    mkdirSync(dirname(opts.dbPath), { recursive: true });
    this.db = new Database(opts.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec('CREATE TABLE IF NOT EXISTS port_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('SqliteDiskStorage: already closed');
  }

  get(key: string): string | undefined {
    this.assertOpen();
    const row = this.db.prepare('SELECT value FROM port_kv WHERE key = ?').get(key) as
      { value: string } | undefined;
    return row?.value;
  }

  set(key: string, value: string): boolean {
    this.assertOpen();
    // ON CONFLICT always reports changes=1, so probe existence to honor the
    // "returns true when a previous value was replaced" contract.
    const existed = this.exists(key);
    this.db
      .prepare(
        'INSERT INTO port_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
    return existed;
  }

  delete(key: string): boolean {
    this.assertOpen();
    return this.db.prepare('DELETE FROM port_kv WHERE key = ?').run(key).changes > 0;
  }

  exists(key: string): boolean {
    this.assertOpen();
    return this.db.prepare('SELECT 1 FROM port_kv WHERE key = ?').get(key) !== undefined;
  }

  list(prefix = ''): StorageEntry[] {
    this.assertOpen();
    const rows = this.db
      .prepare(`SELECT key, value FROM port_kv WHERE key LIKE ? ESCAPE '\\' ORDER BY key`)
      .all(escapeLike(prefix) + '%') as { key: string; value: string }[];
    return rows.map((r) => ({ key: r.key, value: r.value }));
  }

  append(key: string, chunk: string): number {
    this.assertOpen();
    const tx = this.db.transaction(() => {
      const current = this.get(key) ?? '';
      const next = current + chunk;
      this.db
        .prepare(
          'INSERT INTO port_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        )
        .run(key, next);
      return next.length;
    });
    return tx();
  }

  count(prefix = ''): number {
    this.assertOpen();
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM port_kv WHERE key LIKE ? ESCAPE '\\'`)
      .get(escapeLike(prefix) + '%') as { n: number };
    return row.n;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}

/** Escape LIKE metacharacters so prefixes match literally. */
function escapeLike(prefix: string): string {
  return prefix.replace(/[\\%_]/g, (c) => `\\${c}`);
}
