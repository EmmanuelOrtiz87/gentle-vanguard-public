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

  /** Historial de transiciones dentro de una ventana (para el panel con filtro de tiempo). */
  getAlertHistory(tenantId: string, sinceIso: string, limit = 100): AlertRecord[] {
    return this.db
      .prepare(
        `SELECT * FROM alerts
         WHERE tenant_id = ? AND created_at >= ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(tenantId, sinceIso, limit) as AlertRecord[];
  }

  // ─── Ack persistente (migración 023_alert_acks) ─────────────────────

  ackAlert(tenantId: string, name: string, ackedBy?: string): void {
    this.db
      .prepare(
        `INSERT INTO alert_acks (name, tenant_id, acknowledged_at, acked_by)
         VALUES (?, ?, datetime('now'), ?)
         ON CONFLICT (name, tenant_id) DO UPDATE SET acknowledged_at = datetime('now'), acked_by = excluded.acked_by`,
      )
      .run(name, tenantId, ackedBy ?? null);
  }

  unackAlert(tenantId: string, name: string): void {
    this.db.prepare('DELETE FROM alert_acks WHERE name = ? AND tenant_id = ?').run(name, tenantId);
  }

  /** Ack activos del tenant: name -> epoch ms de cuando se reconoció. */
  getAckedAlerts(tenantId: string): Map<string, number> {
    const rows = this.db
      .prepare('SELECT name, acknowledged_at FROM alert_acks WHERE tenant_id = ?')
      .all(tenantId) as Array<{ name: string; acknowledged_at: string }>;
    const out = new Map<string, number>();
    for (const r of rows) {
      const ms = Date.parse(r.acknowledged_at.includes('T') ? r.acknowledged_at : `${r.acknowledged_at}Z`);
      out.set(r.name, Number.isFinite(ms) ? ms : Date.now());
    }
    return out;
  }

  /** Libera acks resueltos (fin del episodio): un re-disparo re-notifica. */
  releaseResolvedAcks(tenantId: string, names: string[]): void {
    if (names.length === 0) return;
    const stmt = this.db.prepare('DELETE FROM alert_acks WHERE tenant_id = ? AND name = ?');
    for (const name of names) stmt.run(tenantId, name);
  }
}
