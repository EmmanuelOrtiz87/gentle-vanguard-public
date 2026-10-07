import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'node:module';
import type { SkillMetric, DelegationRecord, CorrectionEntry } from './types.js';
import {
  SKILL_USAGE_DIR,
  METRICS_FILE,
  CORRECTIONS_LOG,
  REFLECTIONS_DIR,
  KNOWLEDGE_DIR,
  ROOT,
  loadJson,
  loadJsonLines,
  now,
  type Logger,
} from './config.js';

// ─── Data Collection ──────────────────────────────────────────────────

/**
 * Reads real usage from Nexus, which is where `src/knowledge/skill-usage-recorder.ts`
 * actually writes. Nexus held 39 `skill_usage` rows and 36 `skill_execution_outcomes`
 * rows while the router reported "0 agents scored": the evidence existed and the
 * collector was reading a different place entirely. Nexus is authoritative; the
 * filesystem JSON is only a fallback.
 */
function collectFromNexus(log: Logger): SkillMetric[] {
  const dbPath = join(ROOT, '.runtime', 'gentle-vanguard.db');
  if (!existsSync(dbPath)) return [];
  let db: import('better-sqlite3').Database | undefined;
  try {
    // Required lazily through createRequire so this file stays loadable when the
    // native module is unavailable; a static import would not.
    const require_ = createRequire(import.meta.url);
    const Database = require_('better-sqlite3') as typeof import('better-sqlite3');
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const rows = db
      .prepare(
        `SELECT skill_id AS skillId,
                SUM(count)       AS useCount,
                SUM(cost)        AS cost,
                SUM(tokens_used) AS tokens,
                MAX(last_used)   AS lastUsed
           FROM skill_usage
          GROUP BY skill_id`,
      )
      .all() as Array<Record<string, unknown>>;

    // Outcomes, when present, are the success signal. Absent outcomes mean unknown,
    // never perfect.
    const outcomes = new Map<string, { total: number; failures: number }>();
    try {
      const outcomeRows = db
        .prepare(
          `SELECT skill_id AS skillId, success AS success
             FROM skill_execution_outcomes`,
        )
        .all() as Array<{ skillId: string; success: number | null }>;
      for (const row of outcomeRows) {
        const entry = outcomes.get(row.skillId) ?? { total: 0, failures: 0 };
        entry.total++;
        if (row.success === 0) entry.failures++;
        outcomes.set(row.skillId, entry);
      }
    } catch {
      log('  Nexus: skill_execution_outcomes unavailable, using usage counts only');
    }

    const metrics: SkillMetric[] = [];
    for (const row of rows) {
      const useCount = Number(row.useCount) || 0;
      if (useCount <= 0) continue;
      const outcome = outcomes.get(String(row.skillId));
      const failureCount = outcome ? outcome.failures : 0;
      const successRate = outcome && outcome.total > 0 ? (outcome.total - outcome.failures) / outcome.total : 0;
      metrics.push({
        skillName: String(row.skillId),
        useCount,
        failureCount,
        successRate,
        avgTokensUsed: useCount > 0 ? Math.round((Number(row.tokens) || 0) / useCount) : 0,
        lastOutcome: (row.lastUsed as string) ?? null,
        outcomeCount: outcome?.total ?? 0,
      });
    }
    log(`  Nexus skill_usage: ${metrics.length} skill(s) with real observations`);

    // routing_rules is where src/orchestration/route-and-delegate.ts actually records
    // delegation outcomes (recordRoutingOutcome). It was the one live sink the collector
    // did not read: skill_usage records that a skill was used, and nothing recorded the
    // result of a delegation. hit_count is the attempt count and success_count the wins,
    // so this is genuine outcome evidence by the same definition used elsewhere.
    try {
      const rules = db
        .prepare(
          `SELECT target, pattern, hit_count, success_count, success_rate
             FROM routing_rules
            WHERE enabled = 1 AND hit_count > 0`,
        )
        .all() as Array<{
        target: string;
        pattern: string;
        hit_count: number;
        success_count: number;
        success_rate: number;
      }>;
      for (const rule of rules) {
        const attempts = Number(rule.hit_count) || 0;
        if (attempts <= 0) continue;
        const successes = Number(rule.success_count) || 0;
        const ruleRate = successes / attempts;
        const existing = metrics.find((m) => m.skillName === rule.target);
        if (!existing) {
          // The two sources use different namespaces on purpose: skill_usage.skill_id
          // holds SKILL names, routing_rules.target holds AGENT names. They are not
          // merged, and pretending otherwise was a silent no-op: the strict-equality
          // lookup below never matched, so this branch always ran and every agent
          // outcome became a separate metric with no relation to its skills. Logged
          // because a routing rule whose target matches no skill is worth seeing.
          log(
            `  routing_rules target '${rule.target}' (${rule.pattern}) is an agent name, ` +
              `not a skill: recorded as its own metric, not merged into a skill`,
          );
          metrics.push({
            skillName: rule.target,
            useCount: attempts,
            failureCount: Math.max(0, attempts - successes),
            successRate: ruleRate,
            avgTokensUsed: 0,
            lastOutcome: null,
            outcomeCount: attempts,
          });
          continue;
        }
        // A skill that also has an agent-name routing rule: pool the two streams.
        // Reached only when a target genuinely is a skill name.
        const priorOutcomes = existing.outcomeCount;
        const priorSuccesses = existing.successRate * priorOutcomes;
        const totalOutcomes = priorOutcomes + attempts;
        existing.outcomeCount = totalOutcomes;
        existing.successRate = (priorSuccesses + successes) / totalOutcomes;
        existing.useCount += attempts;
        existing.failureCount = Math.max(0, totalOutcomes - Math.round(existing.successRate * totalOutcomes));
      }
      if (rules.length > 0) {
        log(`  Nexus routing_rules: ${rules.length} rule(s) with recorded delegation outcomes`);
      }
    } catch (error) {
      log(`  Nexus routing_rules unreadable, continuing: ${(error as Error).message}`);
    }

    return metrics;
  } catch (error) {
    log(`  Nexus read failed, falling back to filesystem: ${(error as Error).message}`);
    return [];
  } finally {
    // `db` is only assigned inside the try, so close only on the success path.
    db?.close();
  }
}

export function collectSkillUsage(log: Logger): SkillMetric[] {
  const fromNexus = collectFromNexus(log);
  if (fromNexus.length > 0) return fromNexus;

  if (!existsSync(SKILL_USAGE_DIR)) {
    log('  Skill usage dir not found');
    return [];
  }
  const files = readdirSync(SKILL_USAGE_DIR).filter((f) => f.endsWith('.json'));
  const metrics: SkillMetric[] = [];

  for (const f of files) {
    const raw = loadJson<unknown>(join(SKILL_USAGE_DIR, f), null);
    if (!raw) continue;

    // Format A: array of usage records — emitted by src/agents/domain-agent-core.ts
    // [{ agent, domain, timestamp, task, flags: [{severity, advisory?}], ... }]
    if (Array.isArray(raw)) {
      const byAgent = new Map<
        string,
        { useCount: number; criticalFlags: number; lastOutcome: string | null }
      >();
      for (const rec of raw) {
        const r = rec as Record<string, unknown>;
        const agent = (r.agent as string) || (r.skillName as string) || f.replace('.json', '');
        if (!agent) continue;
        const entry = byAgent.get(agent) || { useCount: 0, criticalFlags: 0, lastOutcome: null };
        entry.useCount++;
        const flags =
          (r.flags as Array<{ severity?: string; advisory?: boolean; message?: string }>) || [];
        // Non-advisory critical flags are real failures. Advisory flags are
        // domain design-time notices (e.g. legal escalate-to-counsel) and must
        // not penalize the agent's success rate. A flag is advisory if it
        // carries the advisory flag OR its message self-identifies as advisory
        // (covers legacy records written before the field existed).
        if (
          flags.some(
            (fl) =>
              fl?.severity === 'critical' &&
              !fl?.advisory &&
              !(fl?.message || '').toLowerCase().includes('advisory'),
          )
        ) {
          entry.criticalFlags++;
        }
        if (r.timestamp as string) entry.lastOutcome = (r.timestamp as string) || entry.lastOutcome;
        byAgent.set(agent, entry);
      }
      for (const [agent, e] of byAgent) {
        metrics.push({
          skillName: agent,
          useCount: e.useCount,
          failureCount: e.criticalFlags,
          successRate: e.useCount > 0 ? (e.useCount - e.criticalFlags) / e.useCount : 0,
          avgTokensUsed: 0,
          lastOutcome: e.lastOutcome,
          // Critical flags ARE recorded outcomes, so they count as evidence.
          outcomeCount: e.useCount,
        });
      }
      continue;
    }

    // Format B: single SkillMetric object { skillName, useCount, failureCount, ... }
    const obj = raw as Partial<SkillMetric>;
    const skillName = obj.skillName || f.replace('.json', '');
    if (!skillName) continue;
    // A record with no observations is not evidence of anything. The seed files in
    // .session/skill-usage/ were written as { useCount: 0, successRate: 1 }, and the
    // previous `obj.useCount || 1` / `obj.successRate ?? 1` turned those into one
    // successful delegation per agent. That produced 45 agents at 100% success with
    // avgDuration 0 and lastEvent null, which then scored a domain confidence of 0.95
    // and created an override routing every request to a single agent. Absence of data
    // is unknown, not perfect.
    const useCount = Number.isFinite(obj.useCount) ? Number(obj.useCount) : 0;
    if (useCount <= 0) {
      log(`  Skipping '${skillName}': no observations recorded (successRate is not evidence)`);
      continue;
    }
    const failureCount = Number.isFinite(obj.failureCount) ? Number(obj.failureCount) : 0;
    const recorded = Number.isFinite(obj.successRate) ? Number(obj.successRate) : undefined;
    const successRate = recorded ?? (useCount - failureCount) / useCount;
    metrics.push({
      skillName,
      useCount,
      failureCount,
      successRate,
      avgTokensUsed: obj.avgTokensUsed || 0,
      lastOutcome: obj.lastOutcome || null,
      // Format B carries no separate outcome stream: a lastOutcome means at least one
      // result was recorded, its absence means none was.
      outcomeCount: obj.lastOutcome ? 1 : 0,
    });
  }
  log(`  Skill usage records: ${metrics.length}`);
  return metrics;
}

export function collectDelegations(log: Logger): DelegationRecord[] {
  const metrics = loadJson<Record<string, unknown>>(METRICS_FILE, {});
  const agents = (metrics.agents as Record<string, unknown>) || {};
  const delegations: DelegationRecord[] = [];

  for (const [agentId, data] of Object.entries(agents)) {
    const agentData = data as Record<string, unknown>;
    const total = (agentData.total as number) || 0;
    const successes = (agentData.successes as number) || 0;
    const avgDuration = (agentData.avg_duration as number) || 0;
    const lastEvent = (agentData.last_event as string) || null;

    if (total > 0) {
      // Emit one record per unit of work so computeAgentPerformance preserves
      // the real success ratio (total/successes/failures) instead of collapsing
      // the aggregate into a single binary record.
      const successCount = Math.min(successes, total);
      const failureCount = Math.max(0, total - successCount);
      for (let i = 0; i < successCount; i++) {
        delegations.push({
          agent: agentId,
          domain: 'general',
          success: true,
          duration: avgDuration,
          timestamp: lastEvent || now(),
        });
      }
      for (let i = 0; i < failureCount; i++) {
        delegations.push({
          agent: agentId,
          domain: 'general',
          success: false,
          duration: avgDuration,
          timestamp: lastEvent || now(),
        });
      }
    }
  }

  // Fallback: derive delegations from skill-usage arrays (domain agents)
  // when metrics-report.json is absent or empty. Each usage record that has
  // an agent + domain counts as one (successful) delegation, giving the
  // adaptive router real execution history on cold start.
  if (delegations.length === 0 && existsSync(SKILL_USAGE_DIR)) {
    for (const f of readdirSync(SKILL_USAGE_DIR).filter((x) => x.endsWith('.json'))) {
      const raw = loadJson<unknown>(join(SKILL_USAGE_DIR, f), null);
      if (!Array.isArray(raw)) continue;
      for (const rec of raw) {
        const r = rec as Record<string, unknown>;
        const agent = (r.agent as string) || f.replace('.json', '');
        const domain = (r.domain as string) || 'general';
        const flags =
          (r.flags as Array<{ severity?: string; advisory?: boolean; message?: string }>) || [];
        const hasCritical = flags.some(
          (fl) =>
            fl?.severity === 'critical' &&
            !fl?.advisory &&
            !(fl?.message || '').toLowerCase().includes('advisory'),
        );
        delegations.push({
          agent,
          domain,
          success: !hasCritical,
          duration: 0,
          timestamp: (r.timestamp as string) || now(),
        });
      }
    }
  }

  // Try to extract per-domain from summary
  const summary = (metrics.summary as Record<string, unknown>) || {};
  const totalDelegations = (summary.total_delegations as number) || 0;
  log(`  Delegation records: ${delegations.length} (total: ${totalDelegations})`);
  return delegations;
}

export function collectCorrections(log: Logger): CorrectionEntry[] {
  const entries = loadJsonLines(CORRECTIONS_LOG);
  const corrections: CorrectionEntry[] = entries.map((e) => ({
    timestamp: (e.timestamp as string) || '',
    action: (e.action as string) || '',
    target: (e.target as string) || undefined,
    error: (e.error as string) || undefined,
    resolution: (e.resolution as string) || undefined,
  }));
  log(`  Correction entries: ${corrections.length}`);
  return corrections;
}

export function collectReflections(): Array<Record<string, unknown>> {
  if (!existsSync(REFLECTIONS_DIR)) return [];
  return readdirSync(REFLECTIONS_DIR)
    .filter((f) => f.startsWith('reflection-') && f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, 10)
    .map((f) => loadJson<Record<string, unknown>>(join(REFLECTIONS_DIR, f), {}))
    .filter((r) => Object.keys(r).length > 0);
}

export function collectKnowledgeConcepts(log: Logger): Array<Record<string, unknown>> {
  if (!existsSync(KNOWLEDGE_DIR)) {
    log('  Knowledge dir not found');
    return [];
  }
  const files = readdirSync(KNOWLEDGE_DIR)
    .filter((f) => f.startsWith('synthesis-') && f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, 5);

  const concepts: Array<Record<string, unknown>> = [];
  for (const f of files) {
    const synth = loadJson<Record<string, unknown>>(join(KNOWLEDGE_DIR, f), {});
    const synthConcepts = (synth.concepts as Array<Record<string, unknown>>) || [];
    concepts.push(...synthConcepts);
  }
  log(`  Knowledge concepts: ${concepts.length}`);
  return concepts;
}

export function collectStaticRouterSkills(): string[] {
  // Read the static skill-router module's keyword map
  // We can't import TS at runtime, so we parse the source
  const routerPath = join(ROOT, 'src', 'skill-router.ts');
  if (!existsSync(routerPath)) return [];
  const content = readFileSync(routerPath, 'utf-8');
  const skills = new Set<string>();
  // Extract skill names from SKILL_KEYWORDS values
  const re = /['"]([a-z][a-z0-9_-]+)['"]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const skill = m[1];
    if (
      skill.length > 2 &&
      ![
        'query',
        'project',
        'status',
        'routed',
        'skills',
        'querylower',
        'angul',
        'react',
        'docker',
        'security',
        'typescript',
        'database',
        'documentation',
        'architecture',
        'session',
        'automation',
        'gentle',
      ].includes(skill)
    ) {
      skills.add(skill);
    }
  }
  return [...skills];
}
