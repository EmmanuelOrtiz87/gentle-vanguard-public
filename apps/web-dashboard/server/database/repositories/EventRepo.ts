import Database from 'better-sqlite3';
import type { EventRecord, AlertRecord } from '../manager';

export class EventRepo {
  constructor(private db: Database.Database) {}

  insertEvent(type: string, payload?: unknown): void {
    this.db
      .prepare("INSERT INTO events (type, payload, created_at) VALUES (?, ?, datetime('now'))")
      .run(type, payload ? JSON.stringify(payload) : null);
  }

  getRecentEvents(limit = 50): EventRecord[] {
    return this.db
      .prepare('SELECT * FROM events ORDER BY created_at DESC LIMIT ?')
      .all(limit) as EventRecord[];
  }

  insertAlert(alert: Omit<AlertRecord, 'id' | 'created_at'>): void {
    this.db
      .prepare(
        `INSERT INTO alerts (name, rule, severity, triggered, actual, threshold, transition, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        alert.name,
        alert.rule,
        alert.severity,
        alert.triggered ? 1 : 0,
        alert.actual,
        alert.threshold,
        alert.transition ?? null,
      );
  }

  getRecentAlerts(limit = 20): AlertRecord[] {
    return this.db
      .prepare('SELECT * FROM alerts ORDER BY created_at DESC LIMIT ?')
      .all(limit) as AlertRecord[];
  }

  getTriggeredAlerts(): AlertRecord[] {
    return this.db
      .prepare(
        `SELECT * FROM alerts
         WHERE id IN (
           SELECT MAX(id) FROM alerts GROUP BY rule
         )
         AND triggered = 1
         ORDER BY created_at DESC
         LIMIT 10`,
      )
      .all() as AlertRecord[];
  }
}
