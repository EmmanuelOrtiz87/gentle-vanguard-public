import Database from 'better-sqlite3';

export class SkillRepo {
  constructor(private db: Database.Database) {}

  recordSkillUsage(
    tenantId: string,
    skillId: string,
    sessionId?: string,
    tokensUsed = 0,
    cost = 0,
  ): void {
    this.db
      .prepare(
        `INSERT INTO skill_usage (tenant_id, skill_id, session_id, count, tokens_used, cost, last_used)
         VALUES (?, ?, ?, 1, ?, ?, datetime('now'))
         ON CONFLICT(skill_id, session_id, tenant_id) DO UPDATE SET
           count = count + 1,
           tokens_used = tokens_used + excluded.tokens_used,
           cost = cost + excluded.cost,
           last_used = datetime('now')`,
      )
      .run(tenantId, skillId, sessionId ?? 'global', tokensUsed, cost);
  }

  getTopSkills(
    tenantId: string,
    limit = 10,
  ): Array<{ skillId: string; count: number; tokensUsed: number; cost: number }> {
    return this.db
      .prepare(
        `SELECT skill_id as skillId, SUM(count) as count, SUM(tokens_used) as tokensUsed, SUM(cost) as cost
         FROM skill_usage WHERE tenant_id = ? GROUP BY skill_id ORDER BY count DESC LIMIT ?`,
      )
      .all(tenantId, limit) as Array<{
      skillId: string;
      count: number;
      tokensUsed: number;
      cost: number;
    }>;
  }

  recordTokenUsage(
    tenantId: string,
    sessionId: string,
    promptTokens: number,
    completionTokens: number,
    cost: number,
    model?: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO token_usage (session_id, prompt_tokens, completion_tokens, cost, model, tenant_id, timestamp)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(sessionId, promptTokens, completionTokens, cost, model ?? null, tenantId);
  }

  getTokenUsageBySession(
    tenantId: string,
    sessionId: string,
  ): { totalPrompt: number; totalCompletion: number; totalCost: number } {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(prompt_tokens), 0) as totalPrompt,
                COALESCE(SUM(completion_tokens), 0) as totalCompletion,
                COALESCE(SUM(cost), 0) as totalCost
          FROM token_usage WHERE tenant_id = ? AND session_id = ?`,
      )
      .get(tenantId, sessionId) as {
      totalPrompt: number;
      totalCompletion: number;
      totalCost: number;
    };
    return row;
  }

  upsertRoutingRule(tenantId: string, pattern: string, target: string, priority = 0): void {
    this.db
      .prepare(
        `INSERT INTO routing_rules (tenant_id, pattern, target, priority, enabled, hit_count, success_count, success_rate, created_at, updated_at)
          VALUES (?, ?, ?, ?, 1, 0, 0, 0, datetime('now'), datetime('now'))
         ON CONFLICT(pattern, tenant_id) DO UPDATE SET
           target = excluded.target,
           priority = excluded.priority,
           updated_at = datetime('now')`,
      )
      .run(tenantId, pattern, target, priority);
  }

  getEnabledRoutingRules(tenantId: string): Array<{
    pattern: string;
    target: string;
    priority: number;
    hitCount: number;
    successCount: number;
    successRate: number;
  }> {
    return this.db
      .prepare(
        `SELECT pattern, target, priority, hit_count as hitCount,
                success_count as successCount, success_rate as successRate
           FROM routing_rules
         WHERE tenant_id = ? AND enabled = 1 ORDER BY priority DESC, hit_count DESC`,
      )
      .all(tenantId) as Array<{
      pattern: string;
      target: string;
      priority: number;
      hitCount: number;
      successCount: number;
      successRate: number;
    }>;
  }

  recordRoutingHit(tenantId: string, pattern: string): void {
    this.db
      .prepare(
        "UPDATE routing_rules SET hit_count = hit_count + 1, updated_at = datetime('now') WHERE tenant_id = ? AND pattern = ?",
      )
      .run(tenantId, pattern);
  }

  recordRoutingOutcome(tenantId: string, pattern: string, target: string, success: boolean): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO routing_rules
             (tenant_id, pattern, target, priority, enabled, hit_count, success_count, success_rate, created_at, updated_at)
           VALUES (?, ?, ?, 0, 1, 0, 0, 0, datetime('now'), datetime('now'))
           ON CONFLICT(pattern, tenant_id) DO UPDATE SET target = excluded.target,
             updated_at = datetime('now')`,
        )
        .run(tenantId, pattern, target);
      this.db
        .prepare(
          `UPDATE routing_rules
           SET hit_count = hit_count + 1,
               success_count = success_count + ?,
               success_rate = (success_count + ?) * 100.0 / (hit_count + 1),
               updated_at = datetime('now')
           WHERE tenant_id = ? AND pattern = ?`,
        )
        .run(success ? 1 : 0, success ? 1 : 0, tenantId, pattern);
    })();
  }
}
