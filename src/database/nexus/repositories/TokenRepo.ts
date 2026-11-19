import Database from 'better-sqlite3';

export interface TokenUsageAggregate {
  sessionId: string;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  model?: string;
  timestamp: string;
}

export interface TokenTransaction {
  messageId: string;
  sessionId: string;
  agent: string;
  /** Nombre del subagente cuando la fuente lo expone (ej: guardian, mavis/worker, subagent:<uuid>). */
  agentName?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  createdAt: string;
}

export interface ReconciledUsage {
  sessions: number;
  updated: number;
}

export class TokenRepo {
  constructor(private db: Database.Database) {}

  upsertUsage(tenantId: string, usage: TokenUsageAggregate): 'inserted' | 'updated' {
    const existing = this.db
      .prepare('SELECT id FROM token_usage WHERE tenant_id = ? AND session_id = ?')
      .get(tenantId, usage.sessionId) as { id: number } | undefined;
    if (existing) {
      this.db
        .prepare(
          `UPDATE token_usage
           SET prompt_tokens = ?, completion_tokens = ?, cost = ?, model = ?, timestamp = ?
           WHERE id = ? AND tenant_id = ?`,
        )
        .run(
          usage.promptTokens,
          usage.completionTokens,
          usage.cost,
          usage.model ?? null,
          usage.timestamp,
          existing.id,
          tenantId,
        );
      return 'updated';
    }
    this.db
      .prepare(
        `INSERT INTO token_usage
         (session_id, prompt_tokens, completion_tokens, cost, model, timestamp, tenant_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        usage.sessionId,
        usage.promptTokens,
        usage.completionTokens,
        usage.cost,
        usage.model ?? null,
        usage.timestamp,
        tenantId,
      );
    return 'inserted';
  }

  insertTransactions(
    tenantId: string,
    transactions: TokenTransaction[],
  ): { inserted: number; skipped: number } {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO token_transactions
       (message_id, session_id, agent, agent_name, model, input_tokens, output_tokens, reasoning_tokens,
        cache_read_tokens, cache_write_tokens, cost, created_at, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let inserted = 0;
    let skipped = 0;
    const write = this.db.transaction(() => {
      for (const transaction of transactions) {
        const result = insert.run(
          transaction.messageId,
          transaction.sessionId,
          transaction.agent,
          transaction.agentName ?? null,
          transaction.model,
          transaction.inputTokens,
          transaction.outputTokens,
          transaction.reasoningTokens,
          transaction.cacheReadTokens,
          transaction.cacheWriteTokens,
          transaction.cost,
          transaction.createdAt,
          tenantId,
        );
        if (result.changes > 0) inserted++;
        else skipped++;
      }
    });
    write();
    return { inserted, skipped };
  }

  /**
   * Eleva cada agregado `token_usage` al mínimo real dictado por sus transacciones.
   *
   * Las fuentes incrementales (codex/zcode/minimax/claude) sobrescribían el
   * agregado con la última ventana ingerida, dejando p.ej. 349k de 41.9M reales.
   * La reconciliación es monotónica (MAX) para no destruir históricos cuyas
   * transacciones solo cubren parte de la sesión, e idempotente por diseño.
   * Sesiones de sondeo (`probe:`) quedan excluidas: no son uso real.
   */
  reconcileUsageFromTransactions(
    tenantId: string,
    excludedPrefixes: string[] = ['probe:'],
  ): ReconciledUsage {
    const rows = this.db
      .prepare(
        `SELECT u.id, u.prompt_tokens p, u.completion_tokens c, COALESCE(u.cost, 0) cost,
                COALESCE(SUM(t.input_tokens), 0) input_total,
                COALESCE(SUM(t.output_tokens), 0) output_total,
                COALESCE(SUM(t.cost), 0) cost_total
         FROM token_usage u
         JOIN token_transactions t ON t.session_id = u.session_id AND t.tenant_id = u.tenant_id
         WHERE u.tenant_id = ?
           AND NOT (${excludedPrefixes.map(() => 'u.session_id LIKE ?').join(' OR ') || '0'})
         GROUP BY u.id`,
      )
      .all(tenantId, ...excludedPrefixes.map((prefix) => `${prefix}%`)) as Array<{
      id: number;
      p: number;
      c: number;
      cost: number;
      input_total: number;
      output_total: number;
      cost_total: number;
    }>;
    const update = this.db.prepare(
      `UPDATE token_usage SET prompt_tokens = ?, completion_tokens = ?, cost = ? WHERE id = ?`,
    );
    const apply = this.db.transaction(() => {
      let updated = 0;
      for (const row of rows) {
        const prompt = Math.max(row.p ?? 0, row.input_total);
        const completion = Math.max(row.c ?? 0, row.output_total);
        const cost = Math.max(row.cost, row.cost_total);
        if (prompt === (row.p ?? 0) && completion === (row.c ?? 0) && cost === row.cost) continue;
        update.run(prompt, completion, cost, row.id);
        updated++;
      }
      return updated;
    });
    return { sessions: rows.length, updated: apply() };
  }
}
