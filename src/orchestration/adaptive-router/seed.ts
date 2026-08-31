import type { DomainEntry, RoutingOverride } from './types.js';
import { now } from './config.js';

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

export function buildSeedDomains(): DomainEntry[] {
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

export function buildSeedOverrides(): RoutingOverride[] {
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
