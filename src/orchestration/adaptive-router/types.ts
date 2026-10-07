// ─── Types ────────────────────────────────────────────────────────────

export interface RouterArgs {
  mode: 'build' | 'override' | 'status' | 'reset';
  quiet: boolean;
  dryRun: boolean;
}

export interface AgentPerformance {
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
  /**
   * How many times an OUTCOME was actually recorded, as opposed to how many times the
   * skill was merely loaded. A skill invocation is not a delegation, and a delegation
   * with no recorded outcome is not a success or a failure: it is unknown. Overrides
   * require outcome evidence, not usage volume, otherwise "loaded 3 times, nobody
   * recorded a result" reaches 0.9 confidence.
   */
  outcomeCount: number;
  /** True when successRate is derived from real outcomes rather than inferred. */
  outcomeKnown: boolean;
}

export interface DomainEntry {
  domain: string;
  bestAgent: string;
  alternatives: Array<{ agentId: string; successRate: number }>;
  totalAttempts: number;
  avgSuccessRate: number;
  confidence: number;
  lastRouted: string | null;
}

export interface RoutingOverride {
  domainPattern: string;
  targetAgent: string;
  reason: string;
  confidence: number;
  appliedAt: string;
  expiresAt: string | null;
}

export interface RoutingTable {
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

export interface SkillMetric {
  skillName: string;
  useCount: number;
  failureCount: number;
  successRate: number;
  avgTokensUsed: number;
  lastOutcome: string | null;
  /**
   * Outcomes actually recorded for this skill. Distinct from useCount: a skill can be
   * loaded many times with no result ever recorded, and that is unknown, not success.
   */
  outcomeCount: number;
}

export interface DelegationRecord {
  agent: string;
  domain: string;
  success: boolean;
  duration: number;
  timestamp: string;
}

export interface CorrectionEntry {
  timestamp: string;
  action: string;
  target?: string;
  error?: string;
  resolution?: string;
}
