import Database from 'better-sqlite3';
import type { TraceRecord, FeedbackRecord } from '../manager';

export class TraceRepo {
  constructor(private db: Database.Database) {}

  insertTrace(tenantId: string, trace: Partial<TraceRecord>): void {
    if (!trace.span_id) throw new Error('span_id is required');
    this.db
      .prepare(
        `INSERT OR REPLACE INTO traces 
         (span_id, trace_id, parent_span_id, name, start_time, end_time, duration,
           status, model, input_tokens, output_tokens, cost, session_id, attributes, tenant_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        trace.span_id,
        trace.trace_id ?? '',
        trace.parent_span_id ?? null,
        trace.name ?? '',
        trace.start_time ?? Date.now(),
        trace.end_time ?? null,
        trace.duration ?? null,
        trace.status ?? 'running',
        trace.model ?? null,
        trace.input_tokens ?? 0,
        trace.output_tokens ?? 0,
        trace.cost ?? 0,
        trace.session_id ?? null,
        trace.attributes ?? null,
        tenantId,
      );
  }

  getTracesBySession(tenantId: string, sessionId: string): TraceRecord[] {
    return this.db
      .prepare(
        'SELECT * FROM traces WHERE tenant_id = ? AND session_id = ? ORDER BY start_time ASC',
      )
      .all(tenantId, sessionId) as TraceRecord[];
  }

  getLatencyStats(tenantId: string): { avg: number; p50: number; p95: number; count: number } {
    // Sane window: 0 < duration <= 10min. Clock-skewed spans can produce
    // multi-billion ms durations that would poison every percentile.
    const stats = this.db
      .prepare(
        `SELECT 
           AVG(duration) as avg,
           COUNT(*) as count
          FROM traces WHERE tenant_id = ? AND duration > 0 AND duration <= 600000 AND status = 'completed'`,
      )
      .get(tenantId) as { avg: number | null; count: number };

    const count = stats.count || 0;
    if (count === 0) return { avg: 0, p50: 0, p95: 0, count: 0 };

    const durations = this.db
      .prepare(
        `SELECT duration FROM traces 
          WHERE tenant_id = ? AND duration > 0 AND duration <= 600000 AND status = 'completed'
         ORDER BY duration ASC`,
      )
      .all(tenantId) as { duration: number }[];

    const values = durations.map((r) => r.duration);
    const p50 = values[Math.floor(values.length * 0.5)] || 0;
    const p95 = values[Math.floor(values.length * 0.95)] || 0;

    return {
      avg: Math.round(stats.avg ?? 0),
      p50,
      p95,
      count,
    };
  }

  insertFeedback(
    tenantId: string,
    fb: Omit<FeedbackRecord, 'id' | 'created_at' | 'tenant_id'>,
  ): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO feedback (trace_id, span_id, type, tenant_id, created_at)
          VALUES (?, ?, ?, ?, datetime('now'))`,
      )
      .run(fb.trace_id, fb.span_id, fb.type, tenantId);
  }

  getFeedbackStats(tenantId: string): {
    thumbsUp: number;
    thumbsDown: number;
    total: number;
    score: number;
  } {
    const stats = this.db
      .prepare(
        `SELECT 
           SUM(CASE WHEN type = 'up' THEN 1 ELSE 0 END) as thumbsUp,
           SUM(CASE WHEN type = 'down' THEN 1 ELSE 0 END) as thumbsDown
          FROM feedback WHERE tenant_id = ?`,
      )
      .get(tenantId) as { thumbsUp: number | null; thumbsDown: number | null };
    const up = stats.thumbsUp ?? 0;
    const down = stats.thumbsDown ?? 0;
    const total = up + down;
    return {
      thumbsUp: up,
      thumbsDown: down,
      total,
      score: total > 0 ? Math.round((up / total) * 100) : 0,
    };
  }
}
