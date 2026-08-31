import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
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

export function collectSkillUsage(log: Logger): SkillMetric[] {
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
        });
      }
      continue;
    }

    // Format B: single SkillMetric object { skillName, useCount, failureCount, ... }
    const obj = raw as Partial<SkillMetric>;
    const skillName = obj.skillName || f.replace('.json', '');
    if (!skillName) continue;
    metrics.push({
      skillName,
      useCount: obj.useCount || 1,
      failureCount: obj.failureCount || 0,
      successRate: obj.successRate ?? 1,
      avgTokensUsed: obj.avgTokensUsed || 0,
      lastOutcome: obj.lastOutcome || null,
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
