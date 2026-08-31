#!/usr/bin/env node
/**
 * Decisions Log — Memoria de decisiones y acuerdos (Sugerencia 2)
 *
 * Bitácora de decisiones explícitas del usuario y del sistema:
 * - Decisiones tomadas con rationale y alternativas evaluadas
 * - Acuerdos operativos: "cuando pase X, actuar así"
 * - Revisión programada de decisiones
 * - Integración con event sourcing para audit trail
 * - Engram para recuperación semántica cross-session
 *
 * Este complementa Work Objectives técnico con la capa humana de decisiones.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { appendEventFireAndForget } from './event-sourcing-api.js';

// ─── Types ────────────────────────────────────────────────────────────────

export type DecisionStatus = 'active' | 'superseded' | 'reverted' | 'under_review';
export type DecisionType = 'technical' | 'product' | 'process' | 'architecture' | 'preference';
export type AgreementTrigger = 'manual' | 'scheduled' | 'event_based' | 'metric_threshold';

export interface DecisionAlternative {
  id: string;
  description: string;
  pros: string[];
  cons: string[];
  rejectedReason?: string;
}

export interface DecisionRecord {
  id: string;
  title: string;
  description: string;
  type: DecisionType;
  status: DecisionStatus;
  rationale: string;
  context: string;
  alternatives: DecisionAlternative[];
  selectedAlternativeId: string;
  stakeholders: string[];
  consequences: string[];
  reversible: boolean;
  reviewAt?: string;
  reviewedAt?: string;
  reviewOutcome?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OperationalAgreement {
  id: string;
  title: string;
  description: string;
  trigger: {
    type: AgreementTrigger;
    condition: string;
    eventType?: string;
    schedule?: string;
    metric?: string;
    threshold?: number;
  };
  action: string;
  actionType: 'suggest' | 'execute' | 'escalate' | 'log_only';
  active: boolean;
  executedCount: number;
  lastExecutedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DecisionReview {
  id: string;
  decisionId: string;
  scheduledAt: string;
  status: 'pending' | 'completed' | 'overdue';
  outcome?: 'confirmed' | 'revised' | 'reverted';
  notes?: string;
  completedAt?: string;
}

export interface DecisionsLog {
  version: string;
  updatedAt: string;
  decisions: DecisionRecord[];
  agreements: OperationalAgreement[];
  reviews: DecisionReview[];
}

// ─── Constants ────────────────────────────────────────────────────────────

const ROOT = resolve(process.cwd());
const DECISIONS_DIR = join(ROOT, '.session', 'decisions-log');
const DECISIONS_FILE = join(DECISIONS_DIR, 'decisions-log.json');

const DEFAULT_LOG: DecisionsLog = {
  version: '1.0.0',
  updatedAt: new Date().toISOString(),
  decisions: [],
  agreements: [],
  reviews: [],
};

// ─── Utilities ─────────────────────────────────────────────────────────────

function ensureDir() {
  if (!existsSync(DECISIONS_DIR)) {
    mkdirSync(DECISIONS_DIR, { recursive: true });
  }
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function loadLog(): DecisionsLog {
  ensureDir();
  if (!existsSync(DECISIONS_FILE)) {
    return { ...DEFAULT_LOG };
  }
  try {
    const data = JSON.parse(readFileSync(DECISIONS_FILE, 'utf-8'));
    return { ...DEFAULT_LOG, ...data };
  } catch {
    return { ...DEFAULT_LOG };
  }
}

function saveLog(log: DecisionsLog): void {
  ensureDir();
  log.updatedAt = new Date().toISOString();
  writeFileSync(DECISIONS_FILE, JSON.stringify(log, null, 2) + '\n');
}

function log(msg: string, level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS' = 'INFO') {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const colors: Record<string, string> = {
    INFO: '\x1b[36m',
    WARN: '\x1b[33m',
    ERROR: '\x1b[31m',
    SUCCESS: '\x1b[32m',
  };
  console.log(`${colors[level] ?? ''}[${ts}] [DECISIONS] [${level}] ${msg}\x1b[0m`);
}

function appendToEventStore(
  eventType: string,
  aggregateId: string,
  data: Record<string, unknown>,
): void {
  appendEventFireAndForget({
    aggregateId: `decisions-${aggregateId}`,
    eventType,
    eventData: data,
    quiet: true,
  });
}

// ─── Decision Operations ───────────────────────────────────────────────────

export async function logDecision(params: {
  title: string;
  description: string;
  type: DecisionType;
  rationale: string;
  context: string;
  alternatives: Omit<DecisionAlternative, 'id'>[];
  selectedAlternativeIndex: number;
  stakeholders: string[];
  consequences: string[];
  reversible: boolean;
  reviewInDays?: number;
  tags: string[];
}): Promise<DecisionRecord> {
  const logData = loadLog();

  const alternatives: DecisionAlternative[] = params.alternatives.map((alt, idx) => ({
    ...alt,
    id: generateId('alt'),
    rejectedReason: idx === params.selectedAlternativeIndex ? undefined : 'Not selected',
  }));

  const decision: DecisionRecord = {
    id: generateId('dec'),
    title: params.title,
    description: params.description,
    type: params.type,
    status: 'active',
    rationale: params.rationale,
    context: params.context,
    alternatives,
    selectedAlternativeId: alternatives[params.selectedAlternativeIndex]?.id ?? '',
    stakeholders: params.stakeholders,
    consequences: params.consequences,
    reversible: params.reversible,
    reviewAt: params.reviewInDays
      ? new Date(Date.now() + params.reviewInDays * 24 * 60 * 60 * 1000).toISOString()
      : undefined,
    tags: params.tags,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  logData.decisions.push(decision);

  if (decision.reviewAt) {
    const review: DecisionReview = {
      id: generateId('review'),
      decisionId: decision.id,
      scheduledAt: decision.reviewAt,
      status: 'pending',
    };
    logData.reviews.push(review);
  }

  saveLog(logData);

  appendToEventStore('decision-logged', decision.id, {
    decision,
  });

  log(`Logged decision: "${params.title}" (${params.type})`, 'SUCCESS');
  if (decision.reviewAt) {
    log(`Review scheduled for: ${decision.reviewAt.slice(0, 10)}`, 'INFO');
  }

  return decision;
}

export function searchDecisions(query: string, type?: DecisionType): DecisionRecord[] {
  const logData = loadLog();
  let results = logData.decisions;

  if (type) {
    results = results.filter((d) => d.type === type);
  }

  if (query) {
    const q = query.toLowerCase();
    results = results.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        d.description.toLowerCase().includes(q) ||
        d.rationale.toLowerCase().includes(q) ||
        d.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }

  return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getDecisionById(id: string): DecisionRecord | undefined {
  const logData = loadLog();
  return logData.decisions.find((d) => d.id === id);
}

export async function scheduleReview(decisionId: string, reviewInDays: number): Promise<void> {
  const logData = loadLog();
  const decision = logData.decisions.find((d) => d.id === decisionId);
  if (!decision) {
    throw new Error(`Decision ${decisionId} not found`);
  }

  const reviewAt = new Date(Date.now() + reviewInDays * 24 * 60 * 60 * 1000).toISOString();
  decision.reviewAt = reviewAt;
  decision.updatedAt = new Date().toISOString();

  const review: DecisionReview = {
    id: generateId('review'),
    decisionId: decision.id,
    scheduledAt: reviewAt,
    status: 'pending',
  };
  logData.reviews.push(review);

  saveLog(logData);
  appendToEventStore('decision-review-scheduled', decisionId, { reviewAt });
  log(`Review scheduled for "${decision.title}" in ${reviewInDays} days`, 'INFO');
}

export async function completeReview(
  decisionId: string,
  outcome: 'confirmed' | 'revised' | 'reverted',
  notes: string,
): Promise<void> {
  const logData = loadLog();
  const review = logData.reviews.find((r) => r.decisionId === decisionId && r.status === 'pending');
  const decision = logData.decisions.find((d) => d.id === decisionId);

  if (!review || !decision) {
    throw new Error(`No pending review found for decision ${decisionId}`);
  }

  review.status = 'completed';
  review.outcome = outcome;
  review.notes = notes;
  review.completedAt = new Date().toISOString();

  decision.reviewedAt = new Date().toISOString();
  decision.reviewOutcome = notes;

  if (outcome === 'reverted') {
    decision.status = 'reverted';
  } else if (outcome === 'revised') {
    decision.status = 'under_review';
  }

  saveLog(logData);
  appendToEventStore('decision-review-completed', decisionId, { outcome, notes });
  log(`Review completed: "${decision.title}" → ${outcome}`, 'SUCCESS');
}

export async function supersedeDecision(
  oldDecisionId: string,
  newDecisionTitle: string,
  reason: string,
): Promise<void> {
  const logData = loadLog();
  const oldDecision = logData.decisions.find((d) => d.id === oldDecisionId);
  if (!oldDecision) {
    throw new Error(`Decision ${oldDecisionId} not found`);
  }

  oldDecision.status = 'superseded';
  oldDecision.updatedAt = new Date().toISOString();

  saveLog(logData);
  appendToEventStore('decision-superseded', oldDecisionId, {
    reason,
    supersededBy: newDecisionTitle,
  });
  log(`Decision "${oldDecision.title}" superseded: ${reason}`, 'WARN');
}

// ─── Agreement Operations ───────────────────────────────────────────────────

export async function createAgreement(params: {
  title: string;
  description: string;
  triggerType: AgreementTrigger;
  triggerCondition: string;
  action: string;
  actionType: 'suggest' | 'execute' | 'escalate' | 'log_only';
  eventType?: string;
  schedule?: string;
  metric?: string;
  threshold?: number;
}): Promise<OperationalAgreement> {
  const logData = loadLog();

  const agreement: OperationalAgreement = {
    id: generateId('agr'),
    title: params.title,
    description: params.description,
    trigger: {
      type: params.triggerType,
      condition: params.triggerCondition,
      eventType: params.eventType,
      schedule: params.schedule,
      metric: params.metric,
      threshold: params.threshold,
    },
    action: params.action,
    actionType: params.actionType,
    active: true,
    executedCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  logData.agreements.push(agreement);
  saveLog(logData);

  appendToEventStore('agreement-created', agreement.id, { agreement });
  log(`Created agreement: "${params.title}" (${params.triggerType})`, 'SUCCESS');

  return agreement;
}

export function listAgreements(activeOnly = true): OperationalAgreement[] {
  const logData = loadLog();
  let agreements = logData.agreements;
  if (activeOnly) {
    agreements = agreements.filter((a) => a.active);
  }
  return agreements.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export async function disableAgreement(id: string): Promise<void> {
  const logData = loadLog();
  const agreement = logData.agreements.find((a) => a.id === id);
  if (!agreement) {
    throw new Error(`Agreement ${id} not found`);
  }

  agreement.active = false;
  agreement.updatedAt = new Date().toISOString();
  saveLog(logData);

  appendToEventStore('agreement-disabled', id, {});
  log(`Disabled agreement: "${agreement.title}"`, 'WARN');
}

export async function executeAgreement(id: string, result: string): Promise<void> {
  const logData = loadLog();
  const agreement = logData.agreements.find((a) => a.id === id);
  if (!agreement) {
    throw new Error(`Agreement ${id} not found`);
  }

  agreement.executedCount++;
  agreement.lastExecutedAt = new Date().toISOString();
  agreement.updatedAt = new Date().toISOString();
  saveLog(logData);

  appendToEventStore('agreement-executed', id, { result });
  log(`Executed agreement: "${agreement.title}" → ${result}`, 'INFO');
}

// ─── Review Operations ───────────────────────────────────────────────────────

export function getPendingReviews(): DecisionReview[] {
  const logData = loadLog();
  return logData.reviews
    .filter((r) => r.status === 'pending')
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
}

export function getOverdueReviews(): DecisionReview[] {
  const now = new Date().toISOString();
  return getPendingReviews().filter((r) => r.scheduledAt < now);
}

export function generateDecisionsReport(): string {
  const logData = loadLog();
  const pendingReviews = getPendingReviews();
  const overdueReviews = getOverdueReviews();
  const activeAgreements = listAgreements(true);

  let report = `# Decisions Log Report\n\n`;
  report += `**Generated:** ${new Date().toISOString().slice(0, 10)}\n\n`;
  report += `**Active Objectives:** ${logData.decisions.filter((d) => d.status === 'active').length}\n\n`;
  report += `**Reviews completed:** ${logData.decisions.filter((d) => d.status === 'active').length}\n\n`;
  report += `**Blocked:** ${overdueReviews.length}\n\n`;

  if (pendingReviews.length > 0) {
    report += `## Pending Reviews\n`;
    for (const r of pendingReviews) {
      const decision = logData.decisions.find((d) => d.id === r.decisionId);
      report += `- ${decision?.title ?? 'Unknown'} (${r.scheduledAt})\n`;
    }
    report += `\n`;
  }

  if (activeAgreements.length > 0) {
    report += `## Active Agreements\n`;
    for (const a of activeAgreements) {
      report += `- ${a.title} (${a.trigger.type})\n`;
    }
  }

  return report;
}

// ─── CLI Main ──────────────────────────────────────────────────────────────

function printUsage() {
  console.log(`
Decisions Log CLI

Usage:
  npx tsx src/tools/decisions-log.ts <command> [args]

Commands:
  decision log --title "..." --description "..." --type technical|product|process|architecture|preference --rationale "..." --context "..." [--alternative "..."] [--review 30] [--tags a,b,c]
  decision search <query> [--type technical|product|process|architecture|preference]
  decision get <id>
  decision review schedule <id> --in-days <n>
  decision review complete <id> --outcome confirmed|revised|reverted --notes "..."
  decision supersede <old-id> --with-title "..." --reason "..."

  agreement create --title "..." --description "..." --trigger manual|scheduled|event_based|metric_threshold --condition "..." --action "..." [--action-type suggest|execute|escalate|log_only] [--event-type "..."] [--schedule "..."]
  agreement list [--include-inactive]
  agreement disable <id>
  agreement execute <id> --result "..."

  reviews pending
  reviews overdue

  report
`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    printUsage();
    process.exit(0);
  }

  const command = args[0];

  switch (command) {
    case 'decision': {
      const sub = args[1];
      if (sub === 'log') {
        // Handle decision log
        console.log('Decision logged (CLI mode NYI)');
      } else if (sub === 'search') {
        const results = searchDecisions(args[2] || '');
        console.table(results);
      } else if (sub === 'get') {
        const decision = getDecisionById(args[2]);
        if (decision) {
          console.log(JSON.stringify(decision, null, 2));
        } else {
          console.error('Decision not found');
          process.exit(1);
        }
      }
      break;
    }
    case 'agreement': {
      const sub = args[1];
      if (sub === 'list') {
        const agreements = listAgreements();
        console.table(agreements);
      }
      break;
    }
    case 'report': {
      console.log(generateDecisionsReport());
      break;
    }
    default:
      printUsage();
      process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
