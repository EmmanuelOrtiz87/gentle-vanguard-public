import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';

function hashSessionId(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex');
}

export class AuthSessionRepo {
  constructor(private db: Database.Database) {}

  create(sessionId: string, expiresAt: number): void {
    this.db
      .prepare(
        `INSERT INTO dashboard_auth_sessions (id_hash, expires_at)
         VALUES (?, ?)`,
      )
      .run(hashSessionId(sessionId), expiresAt);
  }

  hasValid(sessionId: string, now: number): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS valid
         FROM dashboard_auth_sessions
         WHERE id_hash = ? AND expires_at > ?`,
      )
      .get(hashSessionId(sessionId), now) as { valid?: number } | undefined;
    return row?.valid === 1;
  }

  revoke(sessionId: string): void {
    this.db
      .prepare('DELETE FROM dashboard_auth_sessions WHERE id_hash = ?')
      .run(hashSessionId(sessionId));
  }

  removeExpired(now: number): void {
    this.db.prepare('DELETE FROM dashboard_auth_sessions WHERE expires_at <= ?').run(now);
  }

  /** Bind a session to a principal and store the hashed CSRF token (migration 014). */
  bindSession(sessionId: string, principalId: string, csrfHash?: string): void {
    this.db
      .prepare(
        `UPDATE dashboard_auth_sessions
         SET principal_id = ?, csrf_hash = COALESCE(?, csrf_hash)
         WHERE id_hash = ?`,
      )
      .run(principalId, csrfHash ?? null, hashSessionId(sessionId));
  }

  getPrincipalId(sessionId: string): string | undefined {
    const row = this.db
      .prepare(
        `SELECT principal_id FROM dashboard_auth_sessions
         WHERE id_hash = ? AND expires_at > ?`,
      )
      .get(hashSessionId(sessionId), Date.now()) as { principal_id?: string } | undefined;
    return row?.principal_id || undefined;
  }

  getCsrfHash(sessionId: string): string | undefined {
    const row = this.db
      .prepare('SELECT csrf_hash FROM dashboard_auth_sessions WHERE id_hash = ?')
      .get(hashSessionId(sessionId)) as { csrf_hash?: string } | undefined;
    return row?.csrf_hash || undefined;
  }

  /** Revoke every active session bound to a principal. Returns rows removed. */
  revokeAllForPrincipal(principalId: string): number {
    const result = this.db
      .prepare('DELETE FROM dashboard_auth_sessions WHERE principal_id = ?')
      .run(principalId);
    return result.changes;
  }
}
