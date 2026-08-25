import Database from 'better-sqlite3';
import type { MetricSnapshot } from '../manager';

export class MetricsRepo {
  constructor(private db: Database.Database) {}

  insertMetricSnapshot(tenantId: string, data: Partial<MetricSnapshot>): void {
    this.db
      .prepare(
        `INSERT INTO metric_snapshots 
         (tenant_id, timestamp, tokens_used, tokens_limit, cost, sessions_total,
           sessions_active, sessions_today, latency_avg, latency_p50, latency_p95,
           commits, mcp_calls, mcp_skills, health_status)
         VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        tenantId,
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

  getLatestMetricSnapshot(tenantId: string): MetricSnapshot | null {
    const row = this.db
      .prepare('SELECT * FROM metric_snapshots WHERE tenant_id = ? ORDER BY timestamp DESC LIMIT 1')
      .get(tenantId) as MetricSnapshot | undefined;
    return row ?? null;
  }

  getMetricHistory(tenantId: string, limit = 20, since?: string): MetricSnapshot[] {
    if (since) {
      return this.db
        .prepare(
          "SELECT * FROM metric_snapshots WHERE tenant_id = ? AND timestamp >= datetime('now', ?) ORDER BY timestamp DESC LIMIT ?",
        )
        .all(tenantId, since, limit) as MetricSnapshot[];
    }
    return this.db
      .prepare('SELECT * FROM metric_snapshots WHERE tenant_id = ? ORDER BY timestamp DESC LIMIT ?')
      .all(tenantId, limit) as MetricSnapshot[];
  }

  pruneMetricSnapshots(tenantId: string, keep = 1440): void {
    this.db
      .prepare(
        `DELETE FROM metric_snapshots WHERE tenant_id = ? AND id NOT IN (
           SELECT id FROM metric_snapshots WHERE tenant_id = ? ORDER BY timestamp DESC LIMIT ?
         )`,
      )
      .run(tenantId, tenantId, keep);
  }
}
