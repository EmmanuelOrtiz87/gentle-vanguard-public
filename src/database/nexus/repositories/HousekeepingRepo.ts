import Database from 'better-sqlite3';

export class HousekeepingRepo {
  constructor(private db: Database.Database) {}

  housekeeping(): void {
    this.runHousekeeping(true);
  }

  private runHousekeeping(vacuum: boolean): void {
    this.db.exec("DELETE FROM events WHERE created_at < datetime('now', '-7 days')");
    this.db.exec(
      `DELETE FROM metric_snapshots WHERE id NOT IN (SELECT id FROM metric_snapshots ORDER BY timestamp DESC LIMIT 1000)`,
    );
    this.db.exec(
      `DELETE FROM alerts WHERE id NOT IN (SELECT id FROM alerts ORDER BY created_at DESC LIMIT 500)`,
    );
    const count = (this.db.prepare('SELECT COUNT(*) as c FROM metric_snapshots').get() as any).c;
    if (vacuum && count % 500 === 0 && count > 0) {
      this.db.exec('VACUUM');
      console.log('[DB] Vacuum completed');
    }
    console.log('[DB] Housekeeping done');
  }

  pruneAll(): { events: number; cache: number; tokenUsage: number; skillUsage: number } {
    const result = { events: 0, cache: 0, tokenUsage: 0, skillUsage: 0 };
    try {
      this.db.transaction(() => {
        result.events = this.db
          .prepare("DELETE FROM events WHERE created_at < datetime('now', '-30 days')")
          .run().changes;
        result.cache = this.db
          .prepare("DELETE FROM response_cache WHERE created_at < datetime('now', '-7 days')")
          .run().changes;
        result.tokenUsage = this.db
          .prepare("DELETE FROM token_usage WHERE timestamp < datetime('now', '-90 days')")
          .run().changes;
        result.skillUsage = this.db
          .prepare(
            'DELETE FROM skill_usage WHERE session_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sessions WHERE id = skill_usage.session_id AND tenant_id = skill_usage.tenant_id)',
          )
          .run().changes;
        this.runHousekeeping(false);
      })();
      this.vacuumIfNeeded();
      console.log(`[DB] PruneAll done: ${JSON.stringify(result)}`);
    } catch (err) {
      console.error('[DB] PruneAll error:', err);
    }
    return result;
  }

  private vacuumIfNeeded(): void {
    const count = (this.db.prepare('SELECT COUNT(*) as c FROM metric_snapshots').get() as any).c;
    if (count % 500 === 0 && count > 0) {
      this.db.exec('VACUUM');
      console.log('[DB] Vacuum completed');
    }
  }
}
