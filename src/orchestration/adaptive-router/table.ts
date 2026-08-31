import type {
  AgentPerformance,
  DomainEntry,
  RoutingOverride,
  RoutingTable,
  SkillMetric,
  DelegationRecord,
  CorrectionEntry,
} from './types.js';
import {
  ROUTING_TABLE_FILE,
  DEFAULT_CONFIG,
  loadJson,
  now,
  daysAgo,
  type Logger,
} from './config.js';
import { buildSeedDomains, buildSeedOverrides } from './seed.js';
import {
  collectSkillUsage,
  collectDelegations,
  collectCorrections,
  collectReflections,
  collectKnowledgeConcepts,
  collectStaticRouterSkills,
} from './collect.js';

// ─── Performance Analysis ─────────────────────────────────────────────

export function computeAgentPerformance(
  skillMetrics: SkillMetric[],
  delegations: DelegationRecord[],
  corrections: CorrectionEntry[],
  _reflections: Array<Record<string, unknown>>,
  _knowledgeConcepts: Array<Record<string, unknown>>,
  _routerSkills: string[],
  config: typeof DEFAULT_CONFIG,
): { agentPerformance: AgentPerformance[]; domainEntries: DomainEntry[] } {
  const decayThreshold = daysAgo(config.decayDays);
  const agentMap = new Map<string, AgentPerformance>();

  // Process skill usage metrics
  for (const sm of skillMetrics) {
    const agentId = sm.skillName;
    const existing = agentMap.get(agentId) || {
      agentId,
      domain: 'general',
      totalDelegations: 0,
      successes: 0,
      failures: 0,
      corrections: 0,
      avgDuration: 0,
      successRate: 0,
      lastEvent: null,
      confidence: 0,
    };

    existing.totalDelegations += sm.useCount || 0;
    existing.successes += Math.round((sm.successRate || 0) * (sm.useCount || 0));
    existing.failures += sm.failureCount || 0;
    existing.avgDuration = (existing.avgDuration + (sm.avgTokensUsed || 0)) / 2;
    existing.lastEvent = existing.lastEvent || sm.lastOutcome || null;
    agentMap.set(agentId, existing);
  }

  // Process delegation records from metrics
  for (const d of delegations) {
    const existing = agentMap.get(d.agent) || {
      agentId: d.agent,
      domain: d.domain || 'general',
      totalDelegations: 0,
      successes: 0,
      failures: 0,
      corrections: 0,
      avgDuration: 0,
      successRate: 0,
      lastEvent: null,
      confidence: 0,
    };

    // A delegation with a specific domain upgrades the agent's domain,
    // overriding the 'general' default assigned from skill-usage metrics.
    if (d.domain && d.domain !== 'general' && existing.domain === 'general') {
      existing.domain = d.domain;
    }

    existing.totalDelegations++;
    if (d.success) existing.successes++;
    else existing.failures++;
    existing.avgDuration =
      existing.avgDuration === 0 ? d.duration : (existing.avgDuration + d.duration) / 2;
    if (d.timestamp && (!existing.lastEvent || d.timestamp > existing.lastEvent)) {
      existing.lastEvent = d.timestamp;
    }
    agentMap.set(d.agent, existing);
  }

  // Process corrections (count corrections per target)
  const correctionsByTarget = new Map<string, number>();
  for (const c of corrections) {
    if (c.target) {
      correctionsByTarget.set(c.target, (correctionsByTarget.get(c.target) || 0) + 1);
    }
  }
  for (const [target, count] of correctionsByTarget) {
    const existing = agentMap.get(target);
    if (existing) {
      existing.corrections += count;
      // Corrections reduce success rate weight
      existing.successes = Math.max(0, existing.successes - Math.floor(count * 0.5));
    }
  }

  // Compute final metrics per agent
  const agents: AgentPerformance[] = [];
  for (const agent of agentMap.values()) {
    const total = agent.totalDelegations;
    if (total < config.minDataPoints) continue;

    agent.successRate = total > 0 ? agent.successes / total : 0;
    // Confidence: based on data volume and recency
    const volumeFactor = Math.min(total / 10, 1);
    const recencyFactor = agent.lastEvent && agent.lastEvent >= decayThreshold ? 0.3 : 0;
    agent.confidence = Math.min(0.5 + volumeFactor * 0.4 + recencyFactor, 0.95);
    agents.push(agent);
  }

  agents.sort((a, b) => b.successRate - a.successRate);

  // Build domain entries
  const domainMap = new Map<
    string,
    { agents: Array<{ agentId: string; successRate: number }>; totalAttempts: number }
  >();

  for (const agent of agents) {
    const domain = agent.domain || 'general';
    const existing = domainMap.get(domain) || { agents: [], totalAttempts: 0 };
    existing.agents.push({ agentId: agent.agentId, successRate: agent.successRate });
    existing.totalAttempts += agent.totalDelegations;
    domainMap.set(domain, existing);
  }

  // Add general domain if no specific domains exist
  if (domainMap.size === 0) {
    domainMap.set('general', {
      agents: agents.map((a) => ({ agentId: a.agentId, successRate: a.successRate })),
      totalAttempts: agents.reduce((s, a) => s + a.totalDelegations, 0),
    });
  }

  const domainEntries: DomainEntry[] = [];
  for (const [domain, info] of domainMap) {
    if (info.agents.length === 0) continue;
    info.agents.sort((a, b) => b.successRate - a.successRate);
    const best = info.agents[0];
    const avgRate = info.agents.reduce((s, a) => s + a.successRate, 0) / info.agents.length;

    domainEntries.push({
      domain,
      bestAgent: best.agentId,
      alternatives: info.agents.slice(1, 3),
      totalAttempts: info.totalAttempts,
      avgSuccessRate: avgRate,
      confidence: Math.min(0.3 + info.totalAttempts * 0.05, 0.95),
      lastRouted: null,
    });
  }

  domainEntries.sort((a, b) => b.confidence - a.confidence);

  return {
    agentPerformance: agents,
    domainEntries: domainEntries.slice(0, config.routingTable.maxEntries),
  };
}

// ─── Override Engine ──────────────────────────────────────────────────

export function buildOverrides(
  domainEntries: DomainEntry[],
  existingOverrides: RoutingOverride[],
  config: typeof DEFAULT_CONFIG,
): RoutingOverride[] {
  const overrides: RoutingOverride[] = [...existingOverrides];
  const now_ = now();
  const threshold = config.minConfidenceForOverride;
  const maxOverrides = config.maxOverrides;

  // Remove expired overrides
  const validExisting = overrides.filter((o) => !o.expiresAt || o.expiresAt > now_);

  // Generate new overrides from high-confidence domain entries
  for (const entry of domainEntries) {
    if (validExisting.length >= maxOverrides) break;
    if (entry.confidence < threshold) continue;

    // Check if an override already exists for this domain
    const alreadyExists = validExisting.some(
      (o) => o.domainPattern.toLowerCase() === entry.domain.toLowerCase(),
    );
    if (alreadyExists) continue;

    validExisting.push({
      domainPattern: entry.domain,
      targetAgent: entry.bestAgent,
      reason: `Dynamic routing: ${entry.bestAgent} has ${(entry.avgSuccessRate * 100).toFixed(0)}% success rate in '${entry.domain}' (${entry.totalAttempts} attempts)`,
      confidence: entry.confidence,
      appliedAt: now_,
      expiresAt: new Date(Date.now() + config.decayDays * 86400000).toISOString(),
    });
  }

  return validExisting;
}

// ─── Routing Table ────────────────────────────────────────────────────

export function buildRoutingTable(config: typeof DEFAULT_CONFIG, log: Logger): RoutingTable {
  const now_ = now();

  // 1. Collect data
  log('Collecting data sources...');
  const skillMetrics = collectSkillUsage(log);
  const delegations = collectDelegations(log);
  const corrections = collectCorrections(log);
  const reflections = collectReflections();
  const knowledgeConcepts = collectKnowledgeConcepts(log);
  const routerSkills = collectStaticRouterSkills();
  log(`  Static router skills: ${routerSkills.length}`);

  // 2. Compute performance
  log('Computing agent performance...');
  const { agentPerformance, domainEntries } = computeAgentPerformance(
    skillMetrics,
    delegations,
    corrections,
    reflections,
    knowledgeConcepts,
    routerSkills,
    config,
  );
  log(`  Agents scored: ${agentPerformance.length}, Domains mapped: ${domainEntries.length}`);

  // 3. Load existing overrides
  const existingTable = loadJson<RoutingTable>(ROUTING_TABLE_FILE, null as unknown as RoutingTable);
  const existingOverrides = existingTable?.overrides || [];

  // 3b. Cold-start seed: if no learned domains/overrides yet, seed the baseline
  // so recommend-agent has confidence > 0.3 from day one.
  const finalDomainEntries = domainEntries.length > 0 ? domainEntries : buildSeedDomains();
  const seededOverrides = existingOverrides.length > 0 ? existingOverrides : buildSeedOverrides();
  log(`  Effective domains: ${finalDomainEntries.length} (seed: ${domainEntries.length === 0})`);
  log(`  Effective overrides: ${seededOverrides.length} (seed: ${existingOverrides.length === 0})`);

  // 4. Build overrides (append learned ones on top of seed baseline)
  log('Building routing overrides...');
  const overrides = buildOverrides(domainEntries, seededOverrides, config);
  log(`  Overrides: ${overrides.length} (max: ${config.maxOverrides})`);

  // 5. Assemble table
  const table: RoutingTable = {
    version: '1.0.0',
    builtAt: now_,
    agentPerformance,
    domainEntries: finalDomainEntries,
    overrides,
    summary: {
      totalAgents: agentPerformance.length,
      totalDomains: finalDomainEntries.length,
      totalOverrides: overrides.length,
      overallConfidence:
        finalDomainEntries.length > 0
          ? Math.round(
              (finalDomainEntries.reduce((s, d) => s + d.confidence, 0) /
                finalDomainEntries.length) *
                100,
            ) / 100
          : 0,
    },
  };

  return table;
}

// ─── Output ───────────────────────────────────────────────────────────

export function formatStatus(table: RoutingTable): string {
  const lines: string[] = [];
  lines.push('=== Adaptive Router Status ===');
  lines.push(`Built: ${table.builtAt}`);
  lines.push(`Agents: ${table.summary.totalAgents}`);
  lines.push(`Domains: ${table.summary.totalDomains}`);
  lines.push(`Overrides: ${table.summary.totalOverrides}`);
  lines.push(`Overall confidence: ${(table.summary.overallConfidence * 100).toFixed(0)}%`);
  lines.push('');

  if (table.domainEntries.length > 0) {
    lines.push('── Domain Routing Table ──');
    for (const d of table.domainEntries.slice(0, 10)) {
      const icon = d.confidence >= 0.8 ? '✅' : d.confidence >= 0.5 ? '🟡' : '🟢';
      lines.push(
        `  ${icon} ${d.domain} → ${d.bestAgent} (${(d.avgSuccessRate * 100).toFixed(0)}% success, ${d.totalAttempts} attempts, conf: ${(d.confidence * 100).toFixed(0)}%)`,
      );
    }
    lines.push('');
  }

  if (table.overrides.length > 0) {
    lines.push('── Active Overrides ──');
    for (const o of table.overrides) {
      lines.push(
        `  🔄 ${o.domainPattern} → ${o.targetAgent} (conf: ${(o.confidence * 100).toFixed(0)}%)`,
      );
      lines.push(`     ${o.reason}`);
    }
    lines.push('');
  }

  if (table.agentPerformance.length > 0) {
    lines.push('── Agent Performance ──');
    const topAgents = [...table.agentPerformance]
      .sort((a, b) => b.successRate - a.successRate)
      .slice(0, 10);
    for (const a of topAgents) {
      lines.push(
        `  ${a.agentId}: ${(a.successRate * 100).toFixed(0)}% success (${a.totalDelegations} calls, ${a.corrections} corrections, conf: ${(a.confidence * 100).toFixed(0)}%)`,
      );
    }
  }

  return lines.join('\n');
}
