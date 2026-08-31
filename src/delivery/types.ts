/**
 * delivery/types.ts — Type definitions for the Automated Delivery Orchestrator.
 *
 * Implements the contract defined in ADR-0022. All types are validated with Zod
 * at runtime boundaries. The orchestrator is local-first; GitHub is an external
 * control plane reached only through a least-privilege adapter.
 */

export type DeliveryState =
  | 'planned'
  | 'preflighted'
  | 'reviewed'
  | 'classified'
  | 'staged'
  | 'committed'
  | 'branched'
  | 'pushed'
  | 'pr_open'
  | 'checks_passed'
  | 'awaiting_approval'
  | 'merged'
  | 'promoted'
  | 'rolled_back'
  | 'blocked';

export type DiffClass =
  | 'docs'
  | 'test'
  | 'code'
  | 'config'
  | 'workflow'
  | 'security'
  | 'dependency'
  | 'schema'
  | 'release';

export type PromotionMode = 'none' | 'local' | 'external';

export type DeliveryTarget = 'develop' | 'main';

export type CheckStatus = 'pending' | 'pass' | 'fail' | 'cancelled' | 'skipped';

export interface CommitGroup {
  scope: string;
  paths: string[];
  message: string;
}

export interface DeliveryIntent {
  runId?: string;
  summary: string;
  target: DeliveryTarget;
  changePaths: string[];
  commitGroups: CommitGroup[];
  branchName?: string;
  requestedBy: string;
  promotion: PromotionMode;
}

export interface DeliveryCheckpoint {
  runId: string;
  state: DeliveryState;
  stateVersion: number;
  intentHash: string;
  workspaceHash: string;
  /** Source branch commit materialized into the delivery worktree. */
  sourceSha?: string;
  targetSha: string;
  worktreePath: string;
  branch?: string;
  commitShas: string[];
  prNumber?: number;
  checkSnapshot?: Record<string, CheckStatus>;
  budget: {
    reservedTokens: number;
    usedTokens: number;
    estimatedCost: number;
  };
  updatedAt: string;
}

export interface DeliveryEvent {
  eventId: string;
  runId: string;
  tenantId: string;
  type: string;
  state: DeliveryState;
  actor: 'orchestrator' | 'agent' | 'human' | 'github';
  inputHash: string;
  artifactHashes: string[];
  payload: Record<string, unknown>;
  redactions: string[];
  prevHash: string | null;
  hash: string;
  occurredAt: string;
}

export interface DeliveryOptions {
  dryRun: boolean;
  review: 'ai' | 'ai+human' | 'human';
  maxTokens?: number;
  maxCost?: number;
  resume: boolean;
  keepWorktree: boolean;
  yes: boolean;
  noVersionChange: boolean;
}

export interface DeliveryResult {
  runId: string;
  state: DeliveryState;
  exitCode: number;
  message: string;
  checkpoint?: DeliveryCheckpoint;
  findings?: DeliveryFinding[];
}

export interface DeliveryFinding {
  id: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  category: string;
  message: string;
  file?: string;
  line?: number;
  evidence?: string;
  owner?: string;
  nextAction?: string;
}

export interface GateCheckResult {
  name: string;
  status: CheckStatus;
  degraded?: boolean;
  durationMs: number;
  detail?: string;
  exitCode?: number;
}

export interface DeliveryGateReport {
  runId: string;
  target: DeliveryTarget;
  checks: GateCheckResult[];
  passed: boolean;
  blocked: boolean;
  degraded: boolean;
  summary: string;
  startedAt: string;
  finishedAt: string;
}
