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
  model: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  createdAt: string;
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
       (message_id, session_id, agent, model, input_tokens, output_tokens, reasoning_tokens,
        cache_read_tokens, cache_write_tokens, cost, created_at, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let inserted = 0;
    let skipped = 0;
    const write = this.db.transaction(() => {
      for (const transaction of transactions) {
        const result = insert.run(
          transaction.messageId,
          transaction.sessionId,
          transaction.agent,
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
}
