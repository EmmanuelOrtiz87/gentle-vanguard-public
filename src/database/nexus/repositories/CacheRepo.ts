import Database from 'better-sqlite3';

export class CacheRepo {
  constructor(private db: Database.Database) {}

  getCachedResponse(
    tenantId: string,
    key: string,
  ): { response: string; model?: string; hitCount: number } | null {
    const row = this.db
      .prepare(
        `SELECT response, model, hit_count, expires_at FROM response_cache WHERE tenant_id = ? AND key = ?
         AND (expires_at IS NULL OR expires_at > datetime('now'))`,
      )
      .get(tenantId, key) as
      | { response: string; model: string | null; hit_count: number; expires_at: string | null }
      | undefined;
    if (!row) return null;

    this.db
      .prepare(
        'UPDATE response_cache SET hit_count = hit_count + 1 WHERE tenant_id = ? AND key = ?',
      )
      .run(tenantId, key);
    return { response: row.response, model: row.model ?? undefined, hitCount: row.hit_count };
  }

  setCachedResponse(
    tenantId: string,
    key: string,
    response: string,
    model?: string,
    ttlMinutes = 30,
  ): void {
    const expiresAt =
      ttlMinutes > 0 ? new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString() : null;
    this.db
      .prepare(
        `INSERT OR REPLACE INTO response_cache (key, response, model, created_at, expires_at, hit_count, tenant_id)
          VALUES (?, ?, ?, datetime('now'), ?, COALESCE((SELECT hit_count FROM response_cache WHERE tenant_id = ? AND key = ?), 0), ?)`,
      )
      .run(key, response, model ?? null, expiresAt, tenantId, key, tenantId);
  }

  deleteCachedResponse(tenantId: string, key: string): void {
    this.db
      .prepare('DELETE FROM response_cache WHERE tenant_id = ? AND key = ?')
      .run(tenantId, key);
  }

  getCacheStats(tenantId: string): { entries: number; totalHits: number; expired: number } {
    const entries = (
      this.db
        .prepare('SELECT COUNT(*) as c FROM response_cache WHERE tenant_id = ?')
        .get(tenantId) as any
    ).c;
    const totalHits = (
      this.db
        .prepare('SELECT COALESCE(SUM(hit_count), 0) as h FROM response_cache WHERE tenant_id = ?')
        .get(tenantId) as any
    ).h;
    const expired = (
      this.db
        .prepare("SELECT COUNT(*) as c FROM response_cache WHERE expires_at < datetime('now')")
        .get(tenantId) as any
    ).c;
    return { entries, totalHits, expired };
  }

  saveSemanticCache(
    entry: {
      key: string;
      response: string;
      inputText: string;
      inputEmbedding: Record<string, number>;
      model?: string;
      ttlMinutes?: number;
    },
    tenantId = 'gentle-vanguard',
  ): void {
    const expiresAt = entry.ttlMinutes
      ? new Date(Date.now() + entry.ttlMinutes * 60000).toISOString()
      : null;
    this.db
      .prepare(
        `INSERT OR REPLACE INTO response_cache
                (key, response, model, input_text, input_embedding, created_at, expires_at, hit_count, tokens_saved, tenant_id)
                VALUES (?, ?, ?, ?, ?, datetime('now'), ?, 0, 0, ?)`,
      )
      .run(
        entry.key,
        entry.response,
        entry.model ?? null,
        entry.inputText,
        JSON.stringify(entry.inputEmbedding),
        expiresAt,
        tenantId,
      );
  }

  findExactCache(
    key: string,
    tenantId = 'gentle-vanguard',
  ): { response: string; inputText: string; inputEmbedding: Record<string, number> } | null {
    const row = this.db
      .prepare(
        `SELECT response, input_text, input_embedding FROM response_cache
                WHERE tenant_id = ? AND key = ? AND (expires_at IS NULL OR expires_at > datetime('now'))`,
      )
      .get(tenantId, key) as any;
    if (!row) return null;
    this.db
      .prepare(
        'UPDATE response_cache SET hit_count = hit_count + 1 WHERE tenant_id = ? AND key = ?',
      )
      .run(tenantId, key);
    return {
      response: row.response,
      inputText: row.input_text ?? '',
      inputEmbedding: row.input_embedding ? JSON.parse(row.input_embedding) : {},
    };
  }

  getAllCacheEntries(tenantId = 'gentle-vanguard'): Array<{
    key: string;
    response: string;
    inputText: string;
    inputEmbedding: Record<string, number>;
  }> {
    const rows = this.db
      .prepare(
        `SELECT key, response, input_text, input_embedding FROM response_cache
                WHERE tenant_id = ? AND input_embedding IS NOT NULL AND input_embedding != '{}'
                AND (expires_at IS NULL OR expires_at > datetime('now'))`,
      )
      .all(tenantId) as any[];
    return rows.map((r: any) => ({
      key: r.key,
      response: r.response,
      inputText: r.input_text ?? '',
      inputEmbedding: r.input_embedding ? JSON.parse(r.input_embedding) : {},
    }));
  }

  pruneExpiredCache(): number {
    return this.db
      .prepare(
        "DELETE FROM response_cache WHERE expires_at IS NOT NULL AND expires_at < datetime('now')",
      )
      .run().changes;
  }
}
