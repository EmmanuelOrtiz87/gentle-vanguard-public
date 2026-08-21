import Database from 'better-sqlite3';
import type { SessionRecord } from '../manager';

export class SessionRepo {
  constructor(private db: Database.Database) {}

  upsertSession(session: Partial<SessionRecord>): void {
    if (!session.id) throw new Error('Session ID is required');
    this.db
      .prepare(
        `INSERT INTO sessions (id, agent, status, created_at, updated_at, tokens_used, cost, message_count, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           updated_at = excluded.updated_at,
           tokens_used = excluded.tokens_used,
           cost = excluded.cost,
           message_count = excluded.message_count,
           metadata = excluded.metadata`,
      )
      .run(
        session.id,
        session.agent ?? 'unknown',
        session.status ?? 'idle',
        session.created_at ?? new Date().toISOString(),
        session.updated_at ?? new Date().toISOString(),
        session.tokens_used ?? 0,
        session.cost ?? 0,
        session.message_count ?? 0,
        session.metadata ?? null,
      );
  }

  getActiveSessions(): SessionRecord[] {
    return this.db
      .prepare(
        "SELECT * FROM sessions WHERE status IN ('active', 'awaiting_input') ORDER BY updated_at DESC",
      )
      .all() as SessionRecord[];
  }

  getAllSessions(): SessionRecord[] {
    return this.db
      .prepare('SELECT * FROM sessions ORDER BY updated_at DESC')
      .all() as SessionRecord[];
  }

  getSessionsToday(): SessionRecord[] {
    return this.db
      .prepare(
        "SELECT * FROM sessions WHERE date(created_at) = date('now') ORDER BY updated_at DESC",
      )
      .all() as SessionRecord[];
  }

  saveSessionScoring(data: {
    sessionId: string;
    qualityScore: number;
    successRate: number;
    totalDelegations: number;
    totalCorrections: number;
    totalProactive: number;
    proactiveHits: number;
    totalCloudCalls: number;
    totalCheckpoints: number;
    totalTracingSpans: number;
    totalAuditEvents: number;
    summaryJson: string;
  }): void {
    const existing = this.db
      .prepare('SELECT id FROM session_scoring WHERE session_id = ?')
      .get(data.sessionId) as any;

    if (existing) {
      this.db
        .prepare(
          `UPDATE session_scoring SET
          quality_score = ?, success_rate = ?, total_delegations = ?, total_corrections = ?,
          total_proactive = ?, proactive_hits = ?, total_cloud_calls = ?, total_checkpoints = ?,
          total_tracing_spans = ?, total_audit_events = ?, summary_json = ?,
          updated_at = datetime('now')
          WHERE session_id = ?`,
        )
        .run(
          data.qualityScore,
          data.successRate,
          data.totalDelegations,
          data.totalCorrections,
          data.totalProactive,
          data.proactiveHits,
          data.totalCloudCalls,
          data.totalCheckpoints,
          data.totalTracingSpans,
          data.totalAuditEvents,
          data.summaryJson,
          data.sessionId,
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO session_scoring
          (session_id, quality_score, success_rate, total_delegations, total_corrections,
           total_proactive, proactive_hits, total_cloud_calls, total_checkpoints,
           total_tracing_spans, total_audit_events, summary_json, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        )
        .run(
          data.sessionId,
          data.qualityScore,
          data.successRate,
          data.totalDelegations,
          data.totalCorrections,
          data.totalProactive,
          data.proactiveHits,
          data.totalCloudCalls,
          data.totalCheckpoints,
          data.totalTracingSpans,
          data.totalAuditEvents,
          data.summaryJson,
        );
    }
  }

  getSessionScoring(sessionId: string): Record<string, unknown> | null {
    return (
      (this.db
        .prepare('SELECT * FROM session_scoring WHERE session_id = ?')
        .get(sessionId) as any) ?? null
    );
  }

  getAllSessionScoring(limit = 20): Array<Record<string, unknown>> {
    return this.db
      .prepare('SELECT * FROM session_scoring ORDER BY updated_at DESC LIMIT ?')
      .all(limit) as any[];
  }
}
