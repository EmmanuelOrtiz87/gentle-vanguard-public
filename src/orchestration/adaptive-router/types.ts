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
