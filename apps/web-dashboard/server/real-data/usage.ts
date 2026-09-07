import { join } from 'path';
import { ROOT, readJson } from '../shared.ts';
import { DEFAULT_TENANT_ID } from '../database/manager.ts';
import { getOrLoad } from '../cache/tenant-lru-cache.ts';
import { STATS_PATH, getDb, dbAvailable } from './helpers.ts';

// ─── Stack Tables (SQLite queries for Wave 36/37) ─────────────────────

export function getSkillUsageFromDb(limit = 20, tenantId = DEFAULT_TENANT_ID) {
  return getOrLoad('skill-usage', tenantId, () => computeSkillUsage(limit, tenantId), {
    ttlMs: 4000,
  });
}

export function computeSkillUsage(limit: number, tenantId: string) {
  const skillStats = readJson<{ callsBySkill?: Record<string, number> }>(STATS_PATH);
  const fallbackSkills = Object.entries(skillStats?.callsBySkill || {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([skillId, count]) => ({ skillId, count, tokensUsed: 0, cost: 0 }));
  if (!dbAvailable()) return { skills: fallbackSkills, total: fallbackSkills.length };
  try {
    const db = getDb();
    const skills = db.getTopSkills(limit, tenantId);
    return skills.length > 0
      ? { skills, total: skills.length }
      : { skills: fallbackSkills, total: fallbackSkills.length };
  } catch {
    return { skills: fallbackSkills, total: fallbackSkills.length, error: 'DB query failed' };
  }
}

export function getTokenUsageFromDb(sessionId?: string, tenantId = DEFAULT_TENANT_ID) {
  return getOrLoad('token-usage', tenantId, () => computeTokenUsage(sessionId, tenantId), {
    ttlMs: 4000,
  });
}

export function computeTokenUsage(sessionId: string | undefined, tenantId: string) {
  if (!dbAvailable()) return { usage: null };
  try {
    const db = getDb();
    if (sessionId) {
      return { usage: db.getTokenUsageBySession(sessionId, tenantId), sessionId };
    }
    // Get recent token usage across all sessions
    const rows = db
      .getDb()
      .prepare(
        'SELECT session_id, SUM(prompt_tokens) as prompt, SUM(completion_tokens) as completion, SUM(cost) as cost, MAX(timestamp) as last_used FROM token_usage WHERE tenant_id = ? GROUP BY session_id ORDER BY last_used DESC LIMIT 20',
      )
      .all(tenantId) as Array<{
      session_id: string;
      prompt: number;
      completion: number;
      cost: number;
      last_used: string;
    }>;
    return { usage: rows, total: rows.length };
  } catch {
    return { usage: null, error: 'DB query failed' };
  }
}

export function getContractResultsFromDb(limit = 20) {
  if (!dbAvailable()) return { results: [], total: 0 };
  try {
    const db = getDb();
    const rows = db
      .getDb()
      .prepare('SELECT * FROM contract_results ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>;
    return { results: rows, total: rows.length };
  } catch {
    return { results: [], total: 0, error: 'DB query failed' };
  }
}

export function getRoutingRulesFromDb(tenantId = DEFAULT_TENANT_ID) {
  return getOrLoad('routing-rules', tenantId, () => computeRoutingRules(tenantId), { ttlMs: 5000 });
}

export function computeRoutingRules(tenantId: string) {
  if (!dbAvailable()) return { rules: [], total: 0 };
  try {
    const db = getDb();
    const rules = db.getEnabledRoutingRules(tenantId);
    if (rules.length > 0) return { rules, total: rules.length };
    // Nexus routing_rules empty → derive the stack's ACTUAL static routing
    // config (subagent-mapping.json) so the panel reflects reality.
    const mappingPath = join(ROOT, 'config', 'subagent-mapping.json');
    const mapping = readJson<{
      mapping?: Record<string, { name?: string; primary_subagent?: string; triggers?: string[] }>;
    }>(mappingPath);
    if (!mapping?.mapping) return { rules: [], total: 0 };
    // Real usage per subagent as hitCount proxy.
    let hits: Record<string, number> = {};
    try {
      const rows = db
        .getDb()
        .prepare(
          'SELECT agent, COUNT(*) AS n FROM token_transactions WHERE tenant_id = ? AND agent IS NOT NULL GROUP BY agent',
        )
        .all(tenantId) as Array<{ agent: string; n: number }>;
      hits = Object.fromEntries(rows.map((r) => [r.agent, r.n]));
    } catch {
      /* hitCount stays 0 */
    }
    const CORE = ['BA', 'SAD', 'DEV', 'QA'];
    const EXTENDED = ['OPS', 'GOV', 'DOC', 'SESSION', 'PREMORTEM'];
    const rulesOut = Object.entries(mapping.mapping)
      .filter(([, v]) => v.primary_subagent)
      .map(([domain, v]) => ({
        pattern:
          v.triggers && v.triggers.length > 0
            ? v.triggers.slice(0, 3).join(', ')
            : `${domain.toLowerCase()} tasks`,
        target: v.primary_subagent as string,
        priority: CORE.includes(domain) ? 90 : EXTENDED.includes(domain) ? 70 : 50,
        hitCount: hits[v.primary_subagent as string] ?? 0,
      }));
    return { rules: rulesOut, total: rulesOut.length };
  } catch {
    return { rules: [], total: 0, error: 'DB query failed' };
  }
}
