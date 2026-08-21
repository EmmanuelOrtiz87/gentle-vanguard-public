#!/usr/bin/env node
/**
 * Adaptive Router Dinámico — Dynamic routing layer for Gentle-Vanguard.
 *
 * Reads historical performance data from skill usage, metrics, corrections,
 * reflections, and knowledge maps to build a dynamic routing table that
 * overrides the static skill-router when confidence is high enough.
 *
 * The adaptive router closes the routing gap:
 *   Static Rules → Historial de Ejecución → Aprendizaje → Routing Dinámico
 *
 * Flags:
 *   --build       Build/update routing table (default)
 *   --override    Apply routing overrides
 *   --status      Show current routing table summary
 *   --reset       Reset routing table to defaults
 *   --quiet       Minimal output (pipeline mode)
 *   --dry-run     Preview without saving
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);

// Lazy db import for SQLite dual-write
let _db: any = null;
function getDb(): any {
  if (!_db) {
    try {
      const mod = _require('../apps/web-dashboard/server/database/manager');
      _db = mod.DatabaseManager.getInstance();
    } catch {
      // SQLite not available — skip dual-write
    }
  }
  return _db;
}

// ─── Types ────────────────────────────────────────────────────────────

interface RouterArgs {
  mode: 'build' | 'override' | 'status' | 'reset';
  quiet: boolean;
  dryRun: boolean;
}

interface AgentPerformance {
  agentId: string;
  domain: string;
  totalDelegations: number;
  successes: number;
  failures: number;
  corrections: number;
  avgDuration: number;
  successRate: number;
  lastEvent: string | null;
  confidence: number; // 0..1
}

interface DomainEntry {
  domain: string;
  bestAgent: string;
  alternatives: Array<{ agentId: string; successRate: number }>;
  totalAttempts: number;
  avgSuccessRate: number;
  confidence: number;
  lastRouted: string | null;
}

interface RoutingOverride {
  domainPattern: string;
  targetAgent: string;
  reason: string;
  confidence: number;
  appliedAt: string;
  expiresAt: string | null;
}

interface RoutingTable {
  version: string;
  builtAt: string;
  agentPerformance: AgentPerformance[];
  domainEntries: DomainEntry[];
  overrides: RoutingOverride[];
  summary: {
    totalAgents: number;
    totalDomains: number;
    totalOverrides: number;
    overallConfidence: number;
  };
}

interface SkillMetric {
  skillName: string;
  useCount: number;
  failureCount: number;
  successRate: number;
  avgTokensUsed: number;
  lastOutcome: string | null;
}

interface DelegationRecord {
  agent: string;
  domain: string;
  success: boolean;
  duration: number;
  timestamp: string;
}

interface CorrectionEntry {
  timestamp: string;
  action: string;
  target?: string;
  error?: string;
  resolution?: string;
}

// ─── Seed: cold-start domain routing (17 domains + 10 high-priority overrides) ──

/**
 * Baseline domains per AGENTS.md routing-table learnable: 17 pre-configured
 * domains mapping to the agent with native capacity. Used on cold start so
 * recommend-agent never falls back to static-fallback (confidence 0.3).
 */
const SEED_DOMAINS: Array<{ domain: string; bestAgent: string; confidence: number }> = [
  { domain: 'requirements', bestAgent: 'sdd-explore', confidence: 0.7 },
  { domain: 'architecture', bestAgent: 'sdd-design', confidence: 0.7 },
  { domain: 'implementation', bestAgent: 'sdd-apply', confidence: 0.75 },
  { domain: 'code-apply', bestAgent: 'sdd-apply', confidence: 0.75 },
  { domain: 'testing', bestAgent: 'sdd-verify', confidence: 0.7 },
  { domain: 'code-review', bestAgent: 'sdd-verify', confidence: 0.7 },
  { domain: 'docs', bestAgent: 'doc-agent', confidence: 0.65 },
  { domain: 'ops', bestAgent: 'ops-agent', confidence: 0.65 },
  { domain: 'security', bestAgent: 'gov-agent', confidence: 0.7 },
  { domain: 'governance', bestAgent: 'gov-agent', confidence: 0.7 },
  { domain: 'session', bestAgent: 'session-agent', confidence: 0.6 },
  { domain: 'marketing', bestAgent: 'mkt-agent', confidence: 0.7 },
  { domain: 'sales', bestAgent: 'sales-agent', confidence: 0.7 },
  { domain: 'finance', bestAgent: 'finance-agent', confidence: 0.7 },
  { domain: 'hr', bestAgent: 'hr-agent', confidence: 0.7 },
  { domain: 'legal', bestAgent: 'legal-agent', confidence: 0.7 },
  { domain: 'business-telemetry', bestAgent: 'bus-tele-agent', confidence: 0.7 },
  { domain: 'gitflow', bestAgent: 'gitflow-agent', confidence: 0.7 },
  { domain: 'knowledge', bestAgent: 'knowledge-agent', confidence: 0.65 },
  { domain: 'sia', bestAgent: 'sia-agent', confidence: 0.7 },
];

/**
 * High-priority overrides per AGENTS.md: 10 patterns that should always route
 * to a specific agent regardless of learned history.
 */
const SEED_OVERRIDES: Array<{
  domainPattern: string;
  targetAgent: string;
  reason: string;
  confidence: number;
}> = [
  {
    domainPattern: 'security audit',
    targetAgent: 'gov-agent',
    reason: 'High-priority: security audit',
    confidence: 0.9,
  },
  {
    domainPattern: 'code review',
    targetAgent: 'sdd-verify',
    reason: 'High-priority: code review',
    confidence: 0.9,
  },
  {
    domainPattern: 'bug',
    targetAgent: 'sdd-apply',
    reason: 'High-priority: bug fix',
    confidence: 0.8,
  },
  {
    domainPattern: 'gdpr',
    targetAgent: 'legal-agent',
    reason: 'High-priority: compliance',
    confidence: 0.9,
  },
  {
    domainPattern: 'compliance',
    targetAgent: 'legal-agent',
    reason: 'High-priority: compliance',
    confidence: 0.85,
  },
  {
    domainPattern: 'forecast',
    targetAgent: 'finance-agent',
    reason: 'High-priority: financial modeling',
    confidence: 0.85,
  },
  {
    domainPattern: 'revenue',
    targetAgent: 'finance-agent',
    reason: 'High-priority: financial modeling',
    confidence: 0.85,
  },
  {
    domainPattern: 'job description',
    targetAgent: 'hr-agent',
    reason: 'High-priority: hiring',
    confidence: 0.85,
  },
  {
    domainPattern: 'campaign',
    targetAgent: 'mkt-agent',
    reason: 'High-priority: marketing campaign',
    confidence: 0.85,
  },
  {
    domainPattern: 'sales pipeline',
    targetAgent: 'sales-agent',
    reason: 'High-priority: sales pipeline',
    confidence: 0.8,
  },
];

function buildSeedDomains(): DomainEntry[] {
  return SEED_DOMAINS.map((s) => ({
    domain: s.domain,
    bestAgent: s.bestAgent,
    alternatives: [],
    totalAttempts: 0,
    avgSuccessRate: s.confidence,
    confidence: s.confidence,
    lastRouted: null,
  }));
}

function buildSeedOverrides(): RoutingOverride[] {
  const now_ = now();
  return SEED_OVERRIDES.map((s) => ({
    domainPattern: s.domainPattern,
    targetAgent: s.targetAgent,
    reason: s.reason,
    confidence: s.confidence,
    appliedAt: now_,
    expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
  }));
}

// ─── Constants ────────────────────────────────────────────────────────

const ROOT = resolve(process.cwd());
const SESSION_DIR = join(ROOT, '.session');
const SKILL_USAGE_DIR = join(SESSION_DIR, 'skill-usage');
const METRICS_FILE = join(SESSION_DIR, 'metrics-report.json');
const CORRECTIONS_LOG = join(SESSION_DIR, 'corrections-log.jsonl');
const REFLECTIONS_DIR = join(SESSION_DIR, 'reflections');
const KNOWLEDGE_DIR = join(SESSION_DIR, 'knowledge');
const ROUTING_DIR = join(SESSION_DIR, 'routing');
const ROUTING_TABLE_FILE = join(ROUTING_DIR, 'routing-table.json');
const ROUTING_CONFIG = join(ROOT, 'config', 'adaptive-router.json');

const DEFAULT_CONFIG = {
  minDataPoints: 3,
  minConfidenceForOverride: 0.8,
  maxOverrides: 20,
  decayDays: 14,
  outputDir: ROUTING_DIR,
  sources: {
    skillUsage: true,
    metricsDelegations: true,
    corrections: true,
    reflections: true,
    knowledgeConcepts: true,
    staticRouter: true,
  },
  routingTable: { maxEntries: 50, minSuccessRate: 0.3, preferRecentOverrides: true },
  autoApply: { overridesToPipeline: true, updateSkillRouter: false, maxChangesPerRun: 3 },
};

// ─── Helpers ──────────────────────────────────────────────────────────

function loadJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function loadJsonLines(path: string): Record<string, unknown>[] {
  try {
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf-8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Record<string, unknown>[];
  } catch {
    return [];
  }
}

interface Logger {
  (msg: string): void;
}

function getLogger(quiet: boolean): Logger {
  return (msg: string) => {
    if (!quiet) console.log(msg);
  };
}

function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function now(): string {
  return new Date().toISOString();
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}

// ─── Data Collection ──────────────────────────────────────────────────

function collectSkillUsage(log: Logger): SkillMetric[] {
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

function collectDelegations(log: Logger): DelegationRecord[] {
  const metrics = loadJson<Record<string, unknown>>(METRICS_FILE, {});
  const agents = (metrics.agents as Record<string, unknown>) || {};
  const delegations: DelegationRecord[] = [];

  for (const [agentId, data] of Object.entries(agents)) {
    const agentData = data as Record<string, unknown>;
    const total = (agentData.total as number) || 0;
    const successes = (agentData.successes as number) || 0;
    const failures = (agentData.failures as number) || 0;
    const avgDuration = (agentData.avg_duration as number) || 0;
    const lastEvent = (agentData.last_event as string) || null;

    if (total > 0) {
      delegations.push({
        agent: agentId,
        domain: 'general',
        success: successes > failures,
        duration: avgDuration,
        timestamp: lastEvent || now(),
      });
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

function collectCorrections(log: Logger): CorrectionEntry[] {
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

function collectReflections(): Array<Record<string, unknown>> {
  if (!existsSync(REFLECTIONS_DIR)) return [];
  return readdirSync(REFLECTIONS_DIR)
    .filter((f) => f.startsWith('reflection-') && f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, 10)
    .map((f) => loadJson<Record<string, unknown>>(join(REFLECTIONS_DIR, f), {}))
    .filter((r) => Object.keys(r).length > 0);
}

function collectKnowledgeConcepts(log: Logger): Array<Record<string, unknown>> {
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

function collectStaticRouterSkills(): string[] {
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

// ─── Performance Analysis ─────────────────────────────────────────────

function computeAgentPerformance(
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

function buildOverrides(
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

function buildRoutingTable(config: typeof DEFAULT_CONFIG, log: Logger): RoutingTable {
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

function formatStatus(table: RoutingTable): string {
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

// ─── Main ─────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): RouterArgs {
  const args: RouterArgs = {
    mode: 'build',
    quiet: false,
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--build') args.mode = 'build';
    else if (arg === '--override') args.mode = 'override';
    else if (arg === '--status') args.mode = 'status';
    else if (arg === '--reset') args.mode = 'reset';
    else if (arg === '--quiet') args.quiet = true;
    else if (arg === '--dry-run') args.dryRun = true;
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv);
  const log = getLogger(args.quiet);

  log('[ADAPTIVE-ROUTER] Starting...');

  // 1. Load config
  const config = loadJson<typeof DEFAULT_CONFIG>(ROUTING_CONFIG, DEFAULT_CONFIG);
  const outputDir = join(ROOT, config.outputDir);
  ensureDir(outputDir);

  // 2. Handle reset
  if (args.mode === 'reset') {
    const defaultTable: RoutingTable = {
      version: '1.0.0',
      builtAt: now(),
      agentPerformance: [],
      domainEntries: [],
      overrides: [],
      summary: { totalAgents: 0, totalDomains: 0, totalOverrides: 0, overallConfidence: 0 },
    };
    if (!args.dryRun) {
      writeFileSync(ROUTING_TABLE_FILE, JSON.stringify(defaultTable, null, 2), 'utf-8');
      // SQLite dual-write: clear routing rules
      try {
        const mgr = getDb();
        if (mgr) {
          /* routing_rules table cleared on next upsert */
        }
      } catch {
        /* */
      }
    }
    log('[OK] Routing table reset to defaults');
    if (!args.quiet) console.log(JSON.stringify(defaultTable.summary));
    return;
  }

  // 3. Build routing table
  if (args.mode === 'build' || args.mode === 'override') {
    const table = buildRoutingTable(config, log);

    if (!args.dryRun) {
      writeFileSync(ROUTING_TABLE_FILE, JSON.stringify(table, null, 2), 'utf-8');
      log(
        `[OK] Routing table saved: ${table.summary.totalAgents} agents, ${table.summary.totalDomains} domains, ${table.summary.totalOverrides} overrides`,
      );

      // SQLite dual-write: upsert each domain entry as a routing rule
      try {
        const mgr = getDb();
        if (mgr) {
          for (const entry of table.domainEntries) {
            mgr.upsertRoutingRule(
              entry.domain,
              entry.bestAgent,
              Math.round(entry.confidence * 100),
            );
          }
          log(`[OK] Synced ${table.domainEntries.length} routing rules to SQLite`);
        }
      } catch {
        // Dual-write failure is non-critical
      }
    }

    // Override mode: also apply overrides
    if (args.mode === 'override' && !args.dryRun) {
      log(`[OK] ${table.overrides.length} overrides ready for consumption by orchestrator`);
    }

    if (!args.quiet) {
      console.log(
        JSON.stringify({
          agents: table.summary.totalAgents,
          domains: table.summary.totalDomains,
          overrides: table.summary.totalOverrides,
          confidence: table.summary.overallConfidence,
        }),
      );
    }
    return;
  }

  // 4. Status mode
  if (args.mode === 'status') {
    const table = loadJson<RoutingTable>(ROUTING_TABLE_FILE, null as unknown as RoutingTable);
    if (!table || table.summary.totalAgents === 0) {
      log('[INFO] No routing table found. Run --build first.');
      return;
    }
    const status = formatStatus(table);
    if (!args.quiet) console.log(`\n${status}\n`);
    return;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
