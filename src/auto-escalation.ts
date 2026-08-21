#!/usr/bin/env node
/**
 * auto-escalation.ts — Sistema de escalación automática para fallos recurrentes
 *
 * Cuando watchtower autoheal falla N veces, escala:
 *   Log → Audit → Event Store → Findings Ledger → Acción correctiva
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(process.cwd());
const ESCALATION_DIR = join(ROOT, '.session', 'escalations');
const ESCALATION_LOG = join(ESCALATION_DIR, 'escalation-log.jsonl');
const AUDIT_DIR = join(ROOT, '.session', 'audit', 'logs');
const EVENT_STORE = join(ROOT, '.session', 'event-store');
const FINDINGS_LEDGER = join(ROOT, '.session', 'findings');

export interface EscalationEvent {
  id: string;
  timestamp: string;
  component: string;
  failureCount: number;
  severity: 'warning' | 'critical' | 'emergency';
  description: string;
  currentState: string;
  recommendedAction: string;
  autoResolved: boolean;
  resolution?: string;
}

const ESCALATION_THRESHOLDS = [
  { count: 3, severity: 'warning' as const, action: 'Log to audit' },
  { count: 5, severity: 'critical' as const, action: 'Create incident in event store' },
  { count: 10, severity: 'emergency' as const, action: 'Record in findings ledger + halt' },
];

function ensureDirs(): void {
  for (const dir of [ESCALATION_DIR, AUDIT_DIR, EVENT_STORE, FINDINGS_LEDGER]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

function loadFailureHistory(): Map<string, number> {
  const history = new Map<string, number>();

  if (!existsSync(ESCALATION_LOG)) return history;

  const content = readFileSync(ESCALATION_LOG, 'utf-8').trim();
  if (!content) return history;

  for (const line of content.split('\n')) {
    try {
      const event = JSON.parse(line) as EscalationEvent;
      history.set(event.component, (history.get(event.component) || 0) + 1);
    } catch {
      /* skip corrupt */
    }
  }

  return history;
}

function getSeverity(count: number): EscalationEvent['severity'] {
  for (const t of [...ESCALATION_THRESHOLDS].reverse()) {
    if (count >= t.count) return t.severity;
  }
  return 'warning';
}

function logToAudit(event: EscalationEvent): void {
  ensureDirs();

  // Write to escalation log
  appendFileSync(ESCALATION_LOG, JSON.stringify(event) + '\n', 'utf-8');

  // Write to audit directory
  const auditFile = join(AUDIT_DIR, `escalation-${event.id}.json`);
  writeFileSync(auditFile, JSON.stringify(event, null, 2), 'utf-8');
}

function createEventStoreEntry(event: EscalationEvent): void {
  ensureDirs();
  const eventFile = join(EVENT_STORE, `incident-${event.id}.json`);
  writeFileSync(
    eventFile,
    JSON.stringify(
      {
        aggregateId: `component:${event.component}`,
        eventType: 'incident.escalation',
        timestamp: event.timestamp,
        data: event,
      },
      null,
      2,
    ),
    'utf-8',
  );
}

function recordFindingsLedger(event: EscalationEvent): void {
  ensureDirs();
  const findingFile = join(FINDINGS_LEDGER, `finding-${event.id}.json`);
  writeFileSync(
    findingFile,
    JSON.stringify(
      {
        id: event.id,
        type: 'escalation',
        severity: event.severity,
        component: event.component,
        description: event.description,
        timestamp: event.timestamp,
        resolution: event.resolution || null,
        autoResolved: event.autoResolved,
      },
      null,
      2,
    ),
    'utf-8',
  );
}

export function escalate(
  component: string,
  description: string,
  currentState: string,
): EscalationEvent {
  const history = loadFailureHistory();
  const count = (history.get(component) || 0) + 1;
  const threshold = ESCALATION_THRESHOLDS.find((t) => count === t.count);

  const event: EscalationEvent = {
    id: `esc-${component}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    component,
    failureCount: count,
    severity: getSeverity(count),
    description,
    currentState,
    recommendedAction: threshold?.action || 'Monitor',
    autoResolved: false,
  };

  // Execute escalation actions based on severity
  logToAudit(event);

  if (count >= 5) {
    createEventStoreEntry(event);
  }

  if (count >= 10) {
    event.recommendedAction = 'COMPONENT HALTED — manual intervention required';
    recordFindingsLedger(event);
  }

  // Auto-resolve if count resets
  if (count < 3) {
    event.autoResolved = true;
    event.resolution = 'Auto-resolved — failure count below threshold';
  }

  return event;
}

export function clearHistory(component: string): void {
  // Re-write log without entries for this component
  if (!existsSync(ESCALATION_LOG)) return;

  const content = readFileSync(ESCALATION_LOG, 'utf-8').trim();
  if (!content) return;

  const lines = content.split('\n').filter((line) => {
    try {
      const event = JSON.parse(line);
      return event.component !== component;
    } catch {
      return true;
    }
  });

  writeFileSync(ESCALATION_LOG, lines.join('\n') + (lines.length > 0 ? '\n' : ''), 'utf-8');
}

export function getEscalationStatus(): {
  components: Record<string, number>;
  activeEscalations: number;
} {
  const history = loadFailureHistory();
  const components: Record<string, number> = {};
  let active = 0;

  for (const [comp, count] of history) {
    components[comp] = count;
    if (count >= 3) active++;
  }

  return { components, activeEscalations: active };
}

// ─── CLI ──────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const action = args[0];

  if (action === 'status') {
    const status = getEscalationStatus();
    console.log(JSON.stringify(status));
  } else if (action === 'escalate' && args[1] && args[2]) {
    const event = escalate(args[1], args[2], args[3] || 'unknown');
    console.log(JSON.stringify(event));
  } else if (action === 'clear' && args[1]) {
    clearHistory(args[1]);
    console.log(JSON.stringify({ cleared: args[1] }));
  } else {
    console.log('Auto-Escalation System');
    console.log(
      '  Commands: status, escalate <component> <description> [state], clear <component>',
    );
  }
}

if (process.argv[1]?.includes('auto-escalation')) main();
