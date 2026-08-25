import Database from 'better-sqlite3';
import type { EventRecord, AlertRecord } from '../manager';

export class EventRepo {
  constructor(private db: Database.Database) {}

  insertEvent(tenantId: string, type: string, payload?: unknown): void {
    this.db
      .prepare(
        "INSERT INTO events (tenant_id, type, payload, created_at) VALUES (?, ?, ?, datetime('now'))",
      )
      .run(tenantId, type, payload ? JSON.stringify(payload) : null);
  }

  getRecentEvents(tenantId: string, limit = 50): EventRecord[] {
    return this.db
      .prepare('SELECT * FROM events WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(tenantId, limit) as EventRecord[];
  }

  insertAlert(tenantId: string, alert: Omit<AlertRecord, 'id' | 'created_at' | 'tenant_id'>): void {
    this.db
      .prepare(
        `INSERT INTO alerts (name, rule, severity, triggered, actual, threshold, transition, tenant_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        alert.name,
        alert.rule,
        alert.severity,
        alert.triggered ? 1 : 0,
        alert.actual,
        alert.threshold,
        alert.transition ?? null,
        tenantId,
      );
  }

  getRecentAlerts(tenantId: string, limit = 20): AlertRecord[] {
    return this.db
      .prepare('SELECT * FROM alerts WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(tenantId, limit) as AlertRecord[];
  }

  getTriggeredAlerts(tenantId: string): AlertRecord[] {
    return this.db
      .prepare(
        `SELECT * FROM alerts
         WHERE id IN (
            SELECT MAX(id) FROM alerts WHERE tenant_id = ? GROUP BY rule
          )
          AND tenant_id = ? AND triggered = 1
         ORDER BY created_at DESC
         LIMIT 10`,
      )
      .all(tenantId, tenantId) as AlertRecord[];
  }
}
