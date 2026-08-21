import Database from 'better-sqlite3';
import type { MetricSnapshot } from '../manager';

export class MetricsRepo {
  constructor(private db: Database.Database) {}

  insertMetricSnapshot(data: Partial<MetricSnapshot>): void {
    this.db
      .prepare(
        `INSERT INTO metric_snapshots 
         (timestamp, tokens_used, tokens_limit, cost, sessions_total, 
          sessions_active, sessions_today, latency_avg, latency_p50, latency_p95,
          commits, mcp_calls, mcp_skills, health_status)
         VALUES (datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.tokens_used ?? 0,
        data.tokens_limit ?? 120000,
        data.cost ?? 0,
        data.sessions_total ?? 0,
        data.sessions_active ?? 0,
        data.sessions_today ?? 0,
        data.latency_avg ?? 0,
        data.latency_p50 ?? 0,
        data.latency_p95 ?? 0,
        data.commits ?? 0,
        data.mcp_calls ?? 0,
        data.mcp_skills ?? 0,
        data.health_status ?? 'unknown',
      );
  }

  getLatestMetricSnapshot(): MetricSnapshot | null {
    const row = this.db
      .prepare('SELECT * FROM metric_snapshots ORDER BY timestamp DESC LIMIT 1')
      .get() as MetricSnapshot | undefined;
    return row ?? null;
  }

  getMetricHistory(limit = 20): MetricSnapshot[] {
    return this.db
      .prepare('SELECT * FROM metric_snapshots ORDER BY timestamp DESC LIMIT ?')
      .all(limit) as MetricSnapshot[];
  }

  pruneMetricSnapshots(keep = 1440): void {
    this.db
      .prepare(
        `DELETE FROM metric_snapshots WHERE id NOT IN (
          SELECT id FROM metric_snapshots ORDER BY timestamp DESC LIMIT ?
        )`,
      )
      .run(keep);
  }
}
