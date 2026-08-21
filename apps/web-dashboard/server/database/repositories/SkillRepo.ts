import Database from 'better-sqlite3';

export class SkillRepo {
  constructor(private db: Database.Database) {}

  recordSkillUsage(skillId: string, sessionId?: string, tokensUsed = 0, cost = 0): void {
    this.db
      .prepare(
        `INSERT INTO skill_usage (skill_id, session_id, count, tokens_used, cost, last_used)
         VALUES (?, ?, 1, ?, ?, datetime('now'))
         ON CONFLICT(skill_id, session_id) DO UPDATE SET
           count = count + 1,
           tokens_used = tokens_used + excluded.tokens_used,
           cost = cost + excluded.cost,
           last_used = datetime('now')`,
      )
      .run(skillId, sessionId ?? 'global', tokensUsed, cost);
  }

  getTopSkills(
    limit = 10,
  ): Array<{ skillId: string; count: number; tokensUsed: number; cost: number }> {
    return this.db
      .prepare(
        `SELECT skill_id, SUM(count) as count, SUM(tokens_used) as tokens_used, SUM(cost) as cost
         FROM skill_usage GROUP BY skill_id ORDER BY count DESC LIMIT ?`,
      )
      .all(limit) as any[];
  }

  recordTokenUsage(
    sessionId: string,
    promptTokens: number,
    completionTokens: number,
    cost: number,
    model?: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO token_usage (session_id, prompt_tokens, completion_tokens, cost, model, timestamp)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(sessionId, promptTokens, completionTokens, cost, model ?? null);
  }

  getTokenUsageBySession(sessionId: string): {
    totalPrompt: number;
    totalCompletion: number;
    totalCost: number;
  } {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(prompt_tokens), 0) as totalPrompt,
                COALESCE(SUM(completion_tokens), 0) as totalCompletion,
                COALESCE(SUM(cost), 0) as totalCost
         FROM token_usage WHERE session_id = ?`,
      )
      .get(sessionId) as any;
    return row;
  }

  upsertRoutingRule(pattern: string, target: string, priority = 0): void {
    this.db
      .prepare(
        `INSERT INTO routing_rules (pattern, target, priority, enabled, hit_count, created_at, updated_at)
         VALUES (?, ?, ?, 1, 0, datetime('now'), datetime('now'))
         ON CONFLICT(pattern) DO UPDATE SET
           target = excluded.target,
           priority = excluded.priority,
           updated_at = datetime('now')`,
      )
      .run(pattern, target, priority);
  }

  getEnabledRoutingRules(): Array<{
    pattern: string;
    target: string;
    priority: number;
    hitCount: number;
  }> {
    return this.db
      .prepare(
        `SELECT pattern, target, priority, hit_count FROM routing_rules
         WHERE enabled = 1 ORDER BY priority DESC, hit_count DESC`,
      )
      .all() as any[];
  }

  recordRoutingHit(pattern: string): void {
    this.db
      .prepare(
        "UPDATE routing_rules SET hit_count = hit_count + 1, updated_at = datetime('now') WHERE pattern = ?",
      )
      .run(pattern);
  }
}
