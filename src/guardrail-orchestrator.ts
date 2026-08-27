#!/usr/bin/env node
/**
 * guardrail-orchestrator.ts — Unified Guardrail Orchestrator
 *
 * A single entry point where the orchestrator (or any agent) can ask:
 *   "What should I do about this failure?"
 *
 * It CLASSIFIES the failure into a category, DECIDES the corrective action,
 * EXECUTES it (delegating to the existing specialized guardrails instead of
 * duplicating them), and LEARNS from the outcome so future incidents resolve
 * faster without human intervention.
 *
 * This is the complement to the anti-loop guard: anti-loop detects *reasoning
 * loops* (same strategy failing repeatedly); this orchestrator handles *any
 * failure type* with a coherent decision + learning loop.
 *
 * Failure categories:
 *   config, network, model, db, git, security, resource, reasoning, quality, unknown
 *
 * Actions:
 *   retry, correct, escalate, isolate, continue, block
 *
 * State: `.session/guardrails/`
 *   - incidents.jsonl  — append-only incident log (learning)
 *   - decisions.json   — latest decision per failure category
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join, resolve } from 'path';

// Derive the state dir dynamically from process.cwd() so the orchestrator is
// testable via chdir to temp dirs (same pattern as anti-loop-guard).
function stateDir(): string {
  return join(resolve(process.cwd()), '.session', 'guardrails');
}
function incidentsLog(): string {
  return join(stateDir(), 'incidents.jsonl');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FailureCategory =
  | 'config'
  | 'network'
  | 'model'
  | 'db'
  | 'git'
  | 'security'
  | 'resource'
  | 'reasoning'
  | 'quality'
  | 'unknown';

export type GuardAction =
  | 'retry'
  | 'correct'
  | 'escalate'
  | 'isolate'
  | 'continue'
  | 'block';

export interface GuardDecision {
  category: FailureCategory;
  action: GuardAction;
  reason: string;
  /** Suggested next step for the caller (human-readable). */
  guidance: string;
  /** Whether this decision should be surfaced to the user. */
  surfaceToUser: boolean;
  /** Optional: which existing guardrail to delegate execution to. */
  delegateTo?: string;
}

export interface IncidentRecord {
  id: string;
  timestamp: string;
  category: FailureCategory;
  action: GuardAction;
  source: string;
  error: string;
  resolved: boolean;
  resolution?: string;
  durationMs?: number;
}

export interface ClassifyInput {
  error: string | Error;
  source?: string;
}

// ---------------------------------------------------------------------------
// Failure classification — keyword signatures per category
// ---------------------------------------------------------------------------

const SIGNATURES: Record<Exclude<FailureCategory, 'unknown'>, RegExp[]> = {
  config: [
    /config.*(not found|invalid|missing|parse)/i,
    /(invalid|malformed) json/i,
    /expected an object/i,
    /field.*(missing|required)/i,
    /(cannot|failed to) (read|parse).*config/i,
  ],
  network: [
    /ECONNREFUSED/i,
    /ECONNRESET/i,
    /ETIMEDOUT/i,
    /ENOTFOUND/i,
    /EAI_AGAIN/i,
    /fetch failed/i,
    /socket hang up/i,
    /network (error|unreachable)/i,
    /connect.*timed out/i,
  ],
  model: [
    /model not found/i,
    /model.*(unavailable|unsupported|not supported)/i,
    /rate limit/i,
    /429/i,
    /provider.*(error|failed|unavailable)/i,
    /context length exceeded/i,
    /insufficient.*quota/i,
  ],
  db: [
    /sqlite/i,
    /database (locked|corrupt|not found)/i,
    /no such table/i,
    /no such column/i,
    /constraint failed/i,
    /db.*(error|failed)/i,
  ],
  git: [
    /not a git repository/i,
    /merge conflict/i,
    /push rejected/i,
    /non-fast-forward/i,
    /failed to push/i,
    /unable to (access|resolve).*git/i,
    /remote.*(rejected|error)/i,
  ],
  security: [
    /prompt injection/i,
    /blocked pattern/i,
    /constitutional.*violation/i,
    /secret.*(found|detected|leaked)/i,
    /unauthorized/i,
    /forbidden/i,
    /permission denied/i,
  ],
  resource: [
    /token budget/i,
    /token.*(limit|exceeded)/i,
    /workload.*(limit|exceeded)/i,
    /out of memory/i,
    /heap.*(limit|exceeded)/i,
    /too many (open files|requests)/i,
    /resource.*(exhausted|limit)/i,
  ],
  reasoning: [
    /anti-loop/i,
    /loop.*(detected|escalat)/i,
    /same strategy/i,
    /maximum steps reached/i,
    /infinite loop/i,
  ],
  quality: [
    /quality.*(score|degrad)/i,
    /low quality/i,
    /hallucination/i,
    /coverage.*(below|failed)/i,
    /lint.*(error|failed)/i,
    /typecheck.*(error|failed)/i,
  ],
};

const CATEGORY_ORDER: Exclude<FailureCategory, 'unknown'>[] = [
  'security',
  'reasoning',
  'config',
  'model',
  'network',
  'db',
  'git',
  'resource',
  'quality',
];

export function classifyFailure(input: ClassifyInput): FailureCategory {
  const message =
    typeof input.error === 'string' ? input.error : input.error?.message ?? String(input.error);
  for (const category of CATEGORY_ORDER) {
    for (const re of SIGNATURES[category]) {
      if (re.test(message)) return category;
    }
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Decision engine — maps category -> action with guidance
// ---------------------------------------------------------------------------

const DECISION_MAP: Record<FailureCategory, GuardDecision> = {
  config: {
    category: 'config',
    action: 'correct',
    reason: 'Configuration error detected — attempt automatic correction.',
    guidance:
      'Validate and repair the config file. If it is a JSON parse error, back up and regenerate. If a field is missing, apply the default. Do not retry the same broken config.',
    surfaceToUser: false,
    delegateTo: 'correction-rules-engine',
  },
  network: {
    category: 'network',
    action: 'retry',
    reason: 'Transient network failure — retry with backoff.',
    guidance:
      'Retry the operation with exponential backoff (up to 3 attempts). If it still fails, treat as a circuit-breaker open and isolate the network call.',
    surfaceToUser: false,
    delegateTo: 'resilience-handler',
  },
  model: {
    category: 'model',
    action: 'retry',
    reason: 'Model/provider error — retry or fall back to another model.',
    guidance:
      'Retry once. If rate-limited (429) or model unavailable, fall back to the next model in the fallback chain (see config/model-fallback.json). If all models fail, escalate.',
    surfaceToUser: false,
    delegateTo: 'model-provider-healer',
  },
  db: {
    category: 'db',
    action: 'correct',
    reason: 'Database error — attempt self-healing.',
    guidance:
      'Run the DB self-healing routine (src/self-healing-db.ts). If the DB is locked, wait and retry. If corrupt, restore from the latest backup.',
    surfaceToUser: false,
    delegateTo: 'self-healing-db',
  },
  git: {
    category: 'git',
    action: 'retry',
    reason: 'Git operation failed — inspect and retry safely.',
    guidance:
      'Inspect the git error. For merge conflicts, do NOT force-resolve blindly — surface the conflict. For push rejection, check hooks and remote state before retrying.',
    surfaceToUser: true,
    delegateTo: 'git-workflow',
  },
  security: {
    category: 'security',
    action: 'block',
    reason: 'Security violation detected — block the operation.',
    guidance:
      'STOP the operation. Do not continue. Log the violation to the audit trail and surface to the user. Never bypass a security guardrail.',
    surfaceToUser: true,
    delegateTo: 'safety-guardrails',
  },
  resource: {
    category: 'resource',
    action: 'isolate',
    reason: 'Resource limit reached — isolate and throttle.',
    guidance:
      'Stop allocating resources for this operation. Apply the resource guard (token/workload). Reduce scope or defer the operation. Do not retry immediately.',
    surfaceToUser: false,
    delegateTo: 'workload-guard',
  },
  reasoning: {
    category: 'reasoning',
    action: 'escalate',
    reason: 'Reasoning loop detected — stop retrying and escalate.',
    guidance:
      'The same strategy has failed repeatedly. STOP retrying. Change strategy or escalate to the user with the options. See anti-loop-guard.',
    surfaceToUser: true,
    delegateTo: 'anti-loop-guard',
  },
  quality: {
    category: 'quality',
    action: 'correct',
    reason: 'Quality degradation detected — apply correction rules.',
    guidance:
      'Apply the correction-rules-engine to raise quality (e.g. enforce SDD lifecycle, enable premortem). Re-run validation after correction.',
    surfaceToUser: false,
    delegateTo: 'correction-rules-engine',
  },
  unknown: {
    category: 'unknown',
    action: 'continue',
    reason: 'Unclassified failure — continue with warning and log for learning.',
    guidance:
      'The failure could not be classified. Log it as an incident for future learning, continue with a warning, and surface to the user for awareness.',
    surfaceToUser: true,
    delegateTo: undefined,
  },
};

export function decideAction(category: FailureCategory): GuardDecision {
  return DECISION_MAP[category];
}

// ---------------------------------------------------------------------------
// Learning — incident log + per-category success stats
// ---------------------------------------------------------------------------

function ensureStateDir(): void {
  if (!existsSync(stateDir())) mkdirSync(stateDir(), { recursive: true });
}

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function recordIncident(incident: Omit<IncidentRecord, 'id' | 'timestamp'>): IncidentRecord {
  ensureStateDir();
  const record: IncidentRecord = {
    id: genId(),
    timestamp: new Date().toISOString(),
    ...incident,
  };
  try {
    appendFileSync(incidentsLog(), JSON.stringify(record) + '\n', 'utf-8');
  } catch {
    /* ignore */
  }
  return record;
}

export interface CategoryStats {
  category: FailureCategory;
  total: number;
  resolved: number;
  unresolved: number;
  resolveRate: number;
  lastAction: GuardAction | null;
}

export function getCategoryStats(): CategoryStats[] {
  if (!existsSync(incidentsLog())) return [];
  const byCategory = new Map<FailureCategory, { total: number; resolved: number }>();
  try {
    const lines = readFileSync(incidentsLog(), 'utf-8').trim().split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line) as IncidentRecord;
        const cur = byCategory.get(rec.category) ?? { total: 0, resolved: 0 };
        cur.total++;
        if (rec.resolved) cur.resolved++;
        byCategory.set(rec.category, cur);
      } catch {
        /* skip corrupt */
      }
    }
  } catch {
    return [];
  }
  return [...byCategory.entries()].map(([category, s]) => ({
    category,
    total: s.total,
    resolved: s.resolved,
    unresolved: s.total - s.resolved,
    resolveRate: s.total > 0 ? Math.round((s.resolved / s.total) * 10000) / 100 : 0,
    lastAction: null,
  }));
}

// ---------------------------------------------------------------------------
// High-level API — the single entry point
// ---------------------------------------------------------------------------

export interface GuardResult {
  decision: GuardDecision;
  category: FailureCategory;
  incident: IncidentRecord;
  /** True if the caller should proceed with the operation. */
  proceed: boolean;
}

/**
 * Evaluate a failure and return the decision + a recorded incident.
 *
 * This is the primary API the orchestrator calls. It classifies, decides,
 * records the incident for learning, and tells the caller whether to proceed.
 *
 * @param input  The failure (error message or Error object) + optional source.
 * @param opts   Optional overrides (e.g. resolved outcome to record).
 */
export function evaluateFailure(
  input: ClassifyInput,
  opts: { resolved?: boolean; resolution?: string } = {},
): GuardResult {
  const category = classifyFailure(input);
  const decision = decideAction(category);
  const incident = recordIncident({
    category,
    action: decision.action,
    source: input.source ?? 'unknown',
    error: typeof input.error === 'string' ? input.error : input.error?.message ?? String(input.error),
    resolved: opts.resolved ?? false,
    resolution: opts.resolution,
  });
  const proceed =
    decision.action === 'retry' ||
    decision.action === 'correct' ||
    decision.action === 'continue';
  return { decision, category, incident, proceed };
}

/**
 * Record the outcome of a previously-evaluated incident (learning loop).
 * Call this after the corrective action has been attempted.
 */
export function resolveIncident(incidentId: string, resolution: string): boolean {
  if (!existsSync(incidentsLog())) return false;
  const lines = readFileSync(incidentsLog(), 'utf-8').trim().split('\n');
  let updated = false;
  const out = lines.map((line) => {
    if (!line.trim()) return line;
    try {
      const rec = JSON.parse(line) as IncidentRecord;
      if (rec.id === incidentId) {
        rec.resolved = true;
        rec.resolution = resolution;
        updated = true;
        return JSON.stringify(rec);
      }
    } catch {
      /* keep as-is */
    }
    return line;
  });
  if (updated) {
    try {
      writeFileSync(incidentsLog(), out.join('\n') + '\n', 'utf-8');
    } catch {
      return false;
    }
  }
  return updated;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printDecision(d: GuardDecision): void {
  console.log(JSON.stringify(d, null, 2));
}

function runCli(): void {
  const args = process.argv.slice(2);
  const cmd = args[0];

  switch (cmd) {
    case 'classify': {
      const error = args[1] ?? '';
      const category = classifyFailure({ error });
      console.log(category);
      break;
    }
    case 'decide': {
      const error = args[1] ?? '';
      const category = classifyFailure({ error });
      const decision = decideAction(category);
      printDecision(decision);
      break;
    }
    case 'evaluate': {
      const error = args[1] ?? '';
      const source = args[2] ?? 'cli';
      const result = evaluateFailure({ error, source });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'stats': {
      const stats = getCategoryStats();
      console.log(JSON.stringify(stats, null, 2));
      break;
    }
    case 'resolve': {
      const id = args[1];
      const resolution = args[2] ?? 'resolved';
      if (!id) {
        console.error('Usage: guardrail-orchestrator resolve <incidentId> [resolution]');
        process.exit(1);
      }
      const ok = resolveIncident(id, resolution);
      console.log(ok ? `Resolved incident ${id}` : `Incident ${id} not found`);
      break;
    }
    default: {
      console.log(`Guardrail Orchestrator
Usage:
  guardrail-orchestrator classify <error>      -> failure category
  guardrail-orchestrator decide <error>        -> decision JSON
  guardrail-orchestrator evaluate <error> [src] -> full result + incident
  guardrail-orchestrator stats                 -> per-category learning stats
  guardrail-orchestrator resolve <id> [res]    -> mark incident resolved
`);
    }
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  runCli();
}
