import Database from 'better-sqlite3';

export class HousekeepingRepo {
  constructor(private db: Database.Database) {}

  housekeeping(): void {
    this.runHousekeeping(true);
  }

  /**
   * Rellena `end_time` de spans cerrados que quedaron sin el (2026-11-18: 472
   * trazas `completed` con `end_time` NULL y `duration` valida). Sin esto,
   * cualquier query de spans por ventana temporal pierde esas filas para
   * siempre. No borra ni pisa datos: solo completa el campo faltante.
   */
  backfillTraceEndTimes(): number {
    const res = this.db
      .prepare(
        `UPDATE traces SET end_time = start_time + duration
         WHERE end_time IS NULL AND duration > 0 AND status IN ('completed', 'error')`,
      )
      .run();
    if (res.changes > 0) console.log(`[DB] backfilled end_time on ${res.changes} traces`);
    return res.changes;
  }

  /**
   * Poda stubs de span que nunca se cerraron y no llevan informacion:
   * `end_time`/`duration` NULL, cero tokens y cero costo, mas antiguos que
   * `retentionDays`. Medido 2026-11-18: 472 filas asi (todas con 0 tokens/0
   * costo, del writer historico; ninguna nueva en 7 dias). No es un reaper de
   * spans vivos: si la fila lleva tokens o costo, NUNCA califica.
   */
  pruneIncompleteSpans(retentionDays = 90): number {
    const cutoff = Date.now() - retentionDays * 86_400_000;
    const res = this.db
      .prepare(
        `DELETE FROM traces
         WHERE end_time IS NULL AND duration IS NULL
           AND COALESCE(input_tokens, 0) = 0 AND COALESCE(output_tokens, 0) = 0
           AND COALESCE(cost, 0) = 0 AND start_time < ?`,
      )
      .run(cutoff);
    if (res.changes > 0) {
      console.log(`[DB] pruned ${res.changes} empty never-closed spans (>${retentionDays}d)`);
    }
    return res.changes;
  }

  private runHousekeeping(vacuum: boolean): void {
    this.backfillTraceEndTimes();
    this.pruneIncompleteSpans();
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
