export interface RepositoryHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'down';
  lastCommit: string;
  openPRs: number;
  ciStatus: 'passing' | 'failing' | 'unknown';
  coverage: number;
  contributors: number;
  updatedAt: string;
}

export interface GlobalHealth {
  repositories: RepositoryHealth[];
  overallStatus: 'healthy' | 'degraded' | 'critical';
  totalRepos: number;
  healthyRepos: number;
  degradedRepos: number;
  criticalRepos: number;
  avgCoverage: number;
  totalOpenPRs: number;
  lastUpdated: string;
}

export interface ModelCost {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  calls: number;
}

export interface LatencyMetrics {
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  samples: number;
  responseTimes: Record<string, { avg: number; count: number }>;
}

export interface FeedbackMetric {
  thumbsUp: number;
  thumbsDown: number;
  total: number;
  score: number;
}

export interface CostInsight {
  model: string;
  cost: number;
  tokens: number;
  pct: number;
  estimatedCost?: number;
  savingsPct?: number;
  suggestedAction?: string;
  potentialSavings?: number;
  roi?: number;
}

export interface DashboardData {
  timestamp?: string;
  source?: 'aggregated' | 'sqlite' | 'json';
  sourceClassification?: {
    scope: 'deployment-tenant' | 'system-wide';
    source: 'database' | 'filesystem' | 'mixed';
    provenance: 'explicit' | 'unprovenanced';
    tenantId?: string;
  };
  tokens: { used: number; limit: number; cost: number; byModel: ModelCost[] };
  sessions: { total: number; active: number; today: number; avgDuration: number };
  git: { commits: number; prsMerged: number; contributors: number };
  health: { status: string; routing: number };
  globalHealth?: GlobalHealth;
  tenantScope?: {
    type: 'deployment-tenant' | 'system-wide';
    tenantId?: string;
    warning?: string;
  };
  latency?: LatencyMetrics;
  feedback?: FeedbackMetric;
  costInsights?: CostInsight[];
  cloud?: { executions: number; totalCost: number };
  checkpoints?: number;
  auditLogs?: number;
  traceFiles?: number;
  mcp?: {
    skills: { total: number; byAgent: Record<string, number>; recentlyUsed: string[] };
    calls: {
      total: number;
      byTool: Record<string, number>;
      bySkill: Record<string, number>;
      lastCall: string | null;
    };
    performance: {
      avgResponseTime: number;
      errorRate: number;
      responseTimes: Record<string, { avg: number; count: number }>;
    };
  };
  system?: {
    memory: {
      rss: number;
      heapUsed: number;
      heapTotal: number;
      total: number;
      free: number;
      usagePercent: number;
    };
    cpu: { user: number; system: number; cores: number; loadAverage: number[] };
    uptime: number;
    pid: number;
    platform: string;
    arch: string;
  };
  sla?: {
    uptime: number;
    incidents: number;
    lastIncident: string | null;
    sloCompliance: number;
    responseTime95th: number;
    throughput: number;
  };
  operational?: OperationalMetrics;
  tenantId?: string;
  tenantName?: string;
  sqlite?: SqliteMetrics;
  swarmWorkers?: SwarmWorkerData;
  stackCapabilities?: StackCapabilities;
}

export interface OperationalMetrics {
  velocity: {
    commitsPerHour: number;
    filesModifiedPerSession: number;
    linesAdded: number;
    linesDeleted: number;
    avgTimeBetweenCommits: number;
  };
  efficiency: {
    avgToolLatency: number;
    successRate: number;
    fastestTool: string;
    slowestTool: string;
    responseTimeP95: number;
  };
  productivity: {
    skillsUsed: number;
    uniqueSkills: string[];
    agentsActive: number;
    tasksCompleted: number;
    sessionsCompleted: number;
  };
  quality: {
    buildSuccessRate: number;
    testPassRate: number;
    errorsDetected: number;
    autoCorrections: number;
    typeCheckFailures: number;
  };
  totalOperations: number;
  lastUpdated: string;
}

export interface SwarmWorkerEntry {
  skill: string;
  status: 'running' | 'completed' | 'failed' | 'timeout';
  started: string;
  finished?: string;
  exitCode: number | null;
  output: string;
  error: string | null;
  workerDir: string;
}

export interface SwarmWorkerData {
  activeCount: number;
  completedCount: number;
  failedCount: number;
  workers: SwarmWorkerEntry[];
  lastReport: string | null;
  reports: number;
}

export interface Session {
  id: string;
  agent: string;
  status: 'active' | 'idle' | 'stale' | 'completed';
  startTime: string;
  lastActivity?: string;
  tokensUsed: number;
  model?: string;
  cost?: number;
}

export interface CloudConnectorExecution {
  provider: string;
  timestamp: string;
  duration: number;
  success: boolean;
  cost: number;
}

export interface CloudMetrics {
  sourceClassification?: {
    scope: 'deployment-tenant' | 'system-wide';
    source: 'database' | 'filesystem' | 'mixed';
    provenance: 'explicit' | 'unprovenanced';
    tenantId?: string;
  };
  executions: CloudConnectorExecution[];
  stats: {
    totalExecutions: number;
    totalCost: number;
    successRate: number;
    avgLatency: number;
    byProvider: Record<
      string,
      {
        executions: number;
        cost: number;
        successRate: number;
        avgLatency: number;
      }
    >;
    circuitBreakerStates: Record<string, string>;
  };
}

export interface SqliteMetrics {
  skillCount: number;
  skillAvgCost: number;
  tokenTotalCost: number;
  contractPassRate: number;
  routingTotalHits: number;
}

// ─── Stack Capabilities (Fase 1/2: anomalies, circuit breakers, DB healing) ─────

export interface StackAnomaly {
  id: string;
  type: 'CRITICAL' | 'WARNING' | 'PREDICTION';
  category: string;
  message: string;
  confidence: number;
  detectedAt: string;
  recommendation?: string;
  autoHealed?: boolean;
  autoHealingAction?: string;
}

export interface StackCircuitBreaker {
  name: string;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failureThreshold: number;
  successThreshold: number;
  resetTimeout: number;
  failures: number;
  successes: number;
  openedAt: number | null;
  lastStateChange: number;
}

export interface StackDbHealing {
  lastHealTime: number;
  healCount: number;
  healAttempts: number;
  lastError: string | null;
  lastBackup: string | null;
  metrics: {
    vacuumCount: number;
    checkpointCount: number;
    reindexCount: number;
    analyzeCount: number;
    pruneCount: number;
  };
}

export interface StackCapabilities {
  anomalies: {
    total: number;
    critical: number;
    warning: number;
    predictions: number;
    autoHealed: number;
    latest: StackAnomaly[];
  };
  circuitBreakers: {
    total: number;
    open: number;
    halfOpen: number;
    closed: number;
    breakers: StackCircuitBreaker[];
  };
  dbHealing: StackDbHealing | null;
  lastUpdated: string;
}

export interface MetricHistory {
  timestamp: string;
  tokens: number;
  sessions: number;
  cost: number;
  latency?: number;
  mcpSkills?: number;
  commits?: number;
}

export type HistoryRange = '5m' | '1h' | '24h' | '7d' | '30d';

// ─── Stack Tables (Wave 37: SQLite-backed panels) ─────────────────────

export interface SkillUsageRow {
  skillId: string;
  count: number;
  tokensUsed: number;
  cost: number;
}

export interface TokenUsageRow {
  session_id: string;
  prompt: number;
  completion: number;
  cost: number;
  last_used: string;
}

export interface ContractResultRow {
  id?: number;
  contract_id: string;
  result: string;
  score?: number;
  created_at: string;
  [key: string]: unknown;
}

export interface RoutingRuleRow {
  pattern: string;
  target: string;
  priority: number;
  hitCount: number;
}

export interface StackTablesData {
  skillUsage: { skills: SkillUsageRow[]; total: number };
  tokenUsage: { usage: TokenUsageRow[]; total: number };
  contractResults: { results: ContractResultRow[]; total: number };
  routingRules: { rules: RoutingRuleRow[]; total: number };
}
