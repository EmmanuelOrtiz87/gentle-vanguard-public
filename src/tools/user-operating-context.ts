#!/usr/bin/env node
/**
 * User Operating Context — Gestión explícita de objetivos, preferencias y contexto personal del usuario
 *
 * Sugerencia 1: Capa "humana" que complementa el sistema técnico existente
 * - Objetivos activos del usuario (semanales, mensuales, trimestrales)
 * - Preferencias personales (estilo de comunicación, horarios, energía)
 * - Proyectos personales y prioridades
 * - Tolerancia al riesgo y modos de autonomía preferidos
 * - Bloqueos y postergaciones explícitas
 * - Cosas que NO quiere repetir
 *
 * Integración:
 * - Event Sourcing para audit trail (src/tools/event-sourcing.ts)
 * - Nexus DB para queries rápidas (apps/web-dashboard/server/database/manager.ts)
 * - Engram para memoria semántica cross-session
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { appendEventFireAndForget } from './event-sourcing-api.js';

// ─── Types ────────────────────────────────────────────────────────────────

export type ObjectiveTimeframe = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type ObjectiveStatus = 'active' | 'completed' | 'blocked' | 'deferred' | 'cancelled';
export type EnergyLevel = 'high' | 'medium' | 'low';
export type CommunicationStyle = 'direct' | 'detailed' | 'concise' | 'collaborative';
export type RiskTolerance = 'conservative' | 'moderate' | 'aggressive';
export type PreferredAutonomy = 'observe' | 'suggest' | 'assist' | 'autopilot';

export interface UserObjective {
  id: string;
  title: string;
  description: string;
  timeframe: ObjectiveTimeframe;
  status: ObjectiveStatus;
  priority: number; // 1-10
  tags: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  blockedReason?: string;
  deferredUntil?: string;
  successCriteria: string[];
  progress: number; // 0-100
}

export interface UserPreferences {
  communicationStyle: CommunicationStyle;
  preferredLanguage: string; // 'es', 'en', etc.
  riskTolerance: RiskTolerance;
  preferredAutonomy: PreferredAutonomy;
  workingHours: {
    timezone: string;
    start: string; // "09:00"
    end: string; // "18:00"
  };
  highEnergyHours: string[]; // ["09:00-11:00", "15:00-17:00"]
  doNotRepeat: string[]; // Cosas que el usuario NO quiere repetir
  preferredNotificationChannels: string[]; // ['console', 'dashboard', 'email']
}

export interface BlockedItem {
  id: string;
  type: 'objective' | 'decision' | 'task' | 'project';
  reason: string;
  blocker: string; // Dependencia externa
  since: string;
  escalationAt?: string;
}

export interface DeferredItem {
  id: string;
  type: 'objective' | 'decision' | 'task';
  originalDate: string;
  deferredUntil: string;
  reason: string;
}

export interface RecurringPattern {
  id: string;
  pattern: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  lastOccurred: string;
  mitigation?: string; // Cómo evitar que se repita
}

export interface UserContext {
  version: string;
  updatedAt: string;
  userName?: string;
  objectives: UserObjective[];
  preferences: UserPreferences;
  blocked: BlockedItem[];
  deferred: DeferredItem[];
  patterns: RecurringPattern[]; // "cosas que se repiten"
  currentFocus?: string; // Objetivo actual en foco
  notes: string; // Notas libres
}

// ─── Constants ────────────────────────────────────────────────────────────

const ROOT = resolve(process.cwd());
const CONTEXT_DIR = join(ROOT, '.session', 'user-context');
const CONTEXT_FILE = join(CONTEXT_DIR, 'user-context.json');
const DEFAULT_CONTEXT: UserContext = {
  version: '1.0.0',
  updatedAt: new Date().toISOString(),
  userName: 'Emmanuel',
  objectives: [],
  preferences: {
    communicationStyle: 'direct',
    preferredLanguage: 'es',
    riskTolerance: 'moderate',
    preferredAutonomy: 'assist',
    workingHours: {
      timezone: 'America/Bogota',
      start: '09:00',
      end: '18:00',
    },
    highEnergyHours: ['09:00-11:00', '15:00-17:00'],
    doNotRepeat: [],
    preferredNotificationChannels: ['console', 'dashboard'],
  },
  blocked: [],
  deferred: [],
  patterns: [],
  currentFocus: undefined,
  notes: '',
};

// ─── Utilities ─────────────────────────────────────────────────────────────

function ensureDir() {
  if (!existsSync(CONTEXT_DIR)) {
    mkdirSync(CONTEXT_DIR, { recursive: true });
  }
}

function generateId(): string {
  return `uc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function loadContext(): UserContext {
  ensureDir();
  if (!existsSync(CONTEXT_FILE)) {
    return { ...DEFAULT_CONTEXT };
  }
  try {
    const data = JSON.parse(readFileSync(CONTEXT_FILE, 'utf-8'));
    return { ...DEFAULT_CONTEXT, ...data };
  } catch {
    return { ...DEFAULT_CONTEXT };
  }
}

function saveContext(context: UserContext): void {
  ensureDir();
  context.updatedAt = new Date().toISOString();
  writeFileSync(CONTEXT_FILE, JSON.stringify(context, null, 2) + '\n');
}

function log(msg: string, level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS' = 'INFO') {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const colors: Record<string, string> = {
    INFO: '\x1b[36m',
    WARN: '\x1b[33m',
    ERROR: '\x1b[31m',
    SUCCESS: '\x1b[32m',
  };
  console.log(`${colors[level] ?? ''}[${ts}] [UOC] [${level}] ${msg}\x1b[0m`);
}

function appendToEventStore(
  eventType: string,
  aggregateId: string,
  data: Record<string, unknown>,
): void {
  // Fire-and-forget to avoid blocking user context operations
  appendEventFireAndForget({
    aggregateId: `user-context-${aggregateId}`,
    eventType,
    eventData: data,
    quiet: true,
  });
}

// ─── Core Operations ───────────────────────────────────────────────────────

// Create a new user objective
export async function createObjective(
  title: string,
  description: string,
  timeframe: ObjectiveTimeframe,
  priority: number,
  tags: string[] = [],
  successCriteria: string[] = [],
): Promise<UserObjective> {
  const context = loadContext();
  const objective: UserObjective = {
    id: generateId(),
    title,
    description,
    timeframe,
    status: 'active',
    priority: Math.min(10, Math.max(1, priority)),
    tags,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    successCriteria,
    progress: 0,
  };

  context.objectives.push(objective);
  saveContext(context);
  appendToEventStore('user-objective-created', objective.id, { objective });

  log(`Created objective: "${title}" (${timeframe}, priority ${priority})`, 'SUCCESS');
  return objective;
}

// List objectives with filtering
export function listObjectives(
  status?: ObjectiveStatus,
  timeframe?: ObjectiveTimeframe,
): UserObjective[] {
  const context = loadContext();
  let objectives = context.objectives;

  if (status) {
    objectives = objectives.filter((o) => o.status === status);
  }
  if (timeframe) {
    objectives = objectives.filter((o) => o.timeframe === timeframe);
  }

  return objectives.sort((a, b) => b.priority - a.priority);
}

// Update objective progress
export async function updateObjectiveProgress(id: string, progress: number): Promise<void> {
  const context = loadContext();
  const objective = context.objectives.find((o) => o.id === id);
  if (!objective) {
    throw new Error(`Objective ${id} not found`);
  }

  objective.progress = Math.min(100, Math.max(0, progress));
  objective.updatedAt = new Date().toISOString();

  if (objective.progress === 100) {
    objective.status = 'completed';
    objective.completedAt = new Date().toISOString();
  }

  saveContext(context);
  appendToEventStore('user-objective-updated', id, { progress });

  log(`Updated "${objective.title}": ${progress}%`, 'SUCCESS');
}

// Block an objective
export async function blockObjective(id: string, reason: string, blocker: string): Promise<void> {
  const context = loadContext();
  const objective = context.objectives.find((o) => o.id === id);
  if (!objective) {
    throw new Error(`Objective ${id} not found`);
  }

  objective.status = 'blocked';
  objective.blockedReason = reason;
  objective.updatedAt = new Date().toISOString();

  const blockedItem: BlockedItem = {
    id: generateId(),
    type: 'objective',
    reason,
    blocker,
    since: new Date().toISOString(),
  };
  context.blocked.push(blockedItem);

  saveContext(context);
  appendToEventStore('user-objective-blocked', id, { reason, blocker });

  log(`Blocked "${objective.title}": ${reason}`, 'WARN');
}

// Defer an objective
export async function deferObjective(
  id: string,
  deferredUntil: string,
  reason: string,
): Promise<void> {
  const context = loadContext();
  const objective = context.objectives.find((o) => o.id === id);
  if (!objective) {
    throw new Error(`Objective ${id} not found`);
  }

  objective.status = 'deferred';
  objective.deferredUntil = deferredUntil;
  objective.updatedAt = new Date().toISOString();

  const deferredItem: DeferredItem = {
    id: generateId(),
    type: 'objective',
    originalDate: new Date().toISOString(),
    deferredUntil,
    reason,
  };
  context.deferred.push(deferredItem);

  saveContext(context);
  appendToEventStore('user-objective-deferred', id, { deferredUntil, reason });

  log(`Deferred "${objective.title}" until ${deferredUntil}: ${reason}`, 'INFO');
}

// Add to "do not repeat" list
export async function addDoNotRepeat(pattern: string): Promise<void> {
  const context = loadContext();
  if (!context.preferences.doNotRepeat.includes(pattern)) {
    context.preferences.doNotRepeat.push(pattern);
    saveContext(context);
    appendToEventStore('user-do-not-repeat-added', generateId(), { pattern });
    log(`Added to do-not-repeat: "${pattern}"`, 'SUCCESS');
  }
}

// Record a recurring pattern
export async function recordPattern(pattern: string, mitigation?: string): Promise<void> {
  const context = loadContext();
  const patternRecord: RecurringPattern = {
    id: generateId(),
    pattern,
    frequency: 'weekly',
    lastOccurred: new Date().toISOString(),
    mitigation,
  };
  context.patterns.push(patternRecord);
  saveContext(context);
  appendToEventStore('user-pattern-recorded', patternRecord.id, {
    pattern,
    mitigation,
  });
  log(`Recorded pattern: "${pattern}"`, 'INFO');
}

// Set current focus
export async function setCurrentFocus(objectiveId: string | null): Promise<void> {
  const context = loadContext();
  context.currentFocus = objectiveId ?? undefined;
  saveContext(context);
  appendToEventStore('user-focus-changed', 'focus', { focus: objectiveId });
  if (objectiveId) {
    const obj = context.objectives.find((o) => o.id === objectiveId);
    log(`Focus set on: "${obj?.title ?? objectiveId}"`, 'SUCCESS');
  } else {
    log('Focus cleared', 'INFO');
  }
}

// Update preferences
export async function updatePreferences(updates: Partial<UserPreferences>): Promise<void> {
  const context = loadContext();
  context.preferences = { ...context.preferences, ...updates };
  saveContext(context);
  appendToEventStore('user-preferences-updated', 'prefs', updates);
  log('Preferences updated', 'SUCCESS');
}

// Get current context summary
export function getContextSummary(): {
  activeObjectives: number;
  blocked: number;
  deferred: number;
  currentFocus?: string;
  doNotRepeatCount: number;
  patternsCount: number;
} {
  const context = loadContext();
  return {
    activeObjectives: context.objectives.filter((o) => o.status === 'active').length,
    blocked: context.blocked.length,
    deferred: context.deferred.length,
    currentFocus: context.currentFocus,
    doNotRepeatCount: context.preferences.doNotRepeat.length,
    patternsCount: context.patterns.length,
  };
}

// Generate weekly report
export function generateWeeklyReport(): string {
  const context = loadContext();
  const active = context.objectives.filter((o) => o.status === 'active');
  const completed = context.objectives.filter(
    (o) => o.status === 'completed' && o.completedAt && isRecent(o.completedAt, 7),
  );
  const blocked = context.blocked.filter((b) => isRecent(b.since, 7));

  let report = `# Weekly User Context Report\n\n`;
  report += `**Period:** ${new Date().toISOString().slice(0, 10)}\n`;
  report += `**Active Objectives:** ${active.length}\n`;
  report += `**Completed (last 7 days):** ${completed.length}\n`;
  report += `**Blocked:** ${blocked.length}\n\n`;

  if (context.currentFocus) {
    const focus = context.objectives.find((o) => o.id === context.currentFocus);
    report += `## Current Focus\n- ${focus?.title ?? context.currentFocus}\n\n`;
  }

  if (active.length > 0) {
    report += `## Active Objectives\n`;
    active
      .sort((a, b) => b.priority - a.priority)
      .forEach((o) => {
        report += `- [${o.progress}%] ${o.title} (P${o.priority})\n`;
      });
    report += `\n`;
  }

  if (blocked.length > 0) {
    report += `## Blocked (needs attention)\n`;
    blocked.forEach((b) => {
      report += `- ${b.type}: ${b.reason} (blocked by: ${b.blocker})\n`;
    });
    report += `\n`;
  }

  if (context.preferences.doNotRepeat.length > 0) {
    report += `## Do Not Repeat\n`;
    context.preferences.doNotRepeat.forEach((item) => {
      report += `- ${item}\n`;
    });
  }

  return report;
}

function isRecent(dateStr: string, days: number): boolean {
  const date = new Date(dateStr);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return date >= cutoff;
}

// ─── CLI Main ──────────────────────────────────────────────────────────────

function printUsage() {
  console.log(`
User Operating Context CLI

Usage:
  npx tsx src/tools/user-operating-context.ts <command> [args]

Commands:
  objective create --title "..." --desc "..." --timeframe weekly|monthly|quarterly --priority 1-10 [--tags a,b,c] [--criteria "...","..."]
  objective list [--status active|completed|blocked|deferred] [--timeframe weekly|monthly|quarterly]
  objective progress <id> --percent 0-100
  objective block <id> --reason "..." --blocker "..."
  objective defer <id> --until YYYY-MM-DD --reason "..."
  
  preferences show
  preferences update --risk conservative|moderate|aggressive --autonomy observe|suggest|assist|autopilot --style direct|detailed|concise
  
  focus set <objective-id>
  focus clear
  
  do-not-repeat add "..."
  
  pattern record "..." [--mitigation "..."]
  
  report weekly
  
  summary
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
    case 'objective': {
      const sub = args[1];
      if (sub === 'create') {
        const title = getArg(args, '--title');
        const desc = getArg(args, '--desc') ?? getArg(args, '--description');
        const timeframe = (getArg(args, '--timeframe') ?? 'weekly') as ObjectiveTimeframe;
        const priority = parseInt(getArg(args, '--priority') ?? '5', 10);
        const tags = getArg(args, '--tags')?.split(',') ?? [];
        const criteria = getArg(args, '--criteria')?.split('|') ?? [];

        if (!title || !desc) {
          console.error('Error: --title and --desc are required');
          process.exit(1);
        }
        void createObjective(title, desc, timeframe, priority, tags, criteria);
      } else if (sub === 'list') {
        const status = getArg(args, '--status') as ObjectiveStatus | undefined;
        const timeframe = getArg(args, '--timeframe') as ObjectiveTimeframe | undefined;
        const objectives = listObjectives(status, timeframe);
        console.table(
          objectives.map((o) => ({
            id: o.id,
            title: o.title,
            status: o.status,
            priority: o.priority,
            progress: `${o.progress}%`,
            timeframe: o.timeframe,
          })),
        );
      } else if (sub === 'progress') {
        const id = args[2];
        const percent = parseInt(getArg(args, '--percent') ?? '0', 10);
        void updateObjectiveProgress(id, percent);
      } else if (sub === 'block') {
        const id = args[2];
        const reason = getArg(args, '--reason');
        const blocker = getArg(args, '--blocker');
        if (!reason || !blocker) {
          console.error('Error: --reason and --blocker are required');
          process.exit(1);
        }
        void blockObjective(id, reason, blocker);
      } else if (sub === 'defer') {
        const id = args[2];
        const until = getArg(args, '--until');
        const reason = getArg(args, '--reason');
        if (!until || !reason) {
          console.error('Error: --until and --reason are required');
          process.exit(1);
        }
        void deferObjective(id, until, reason);
      }
      break;
    }

    case 'preferences': {
      const sub = args[1];
      if (sub === 'show') {
        const context = loadContext();
        console.log(JSON.stringify(context.preferences, null, 2));
      } else if (sub === 'update') {
        const updates: Partial<UserPreferences> = {};
        const risk = getArg(args, '--risk') as RiskTolerance | undefined;
        if (risk) updates.riskTolerance = risk;
        const autonomy = getArg(args, '--autonomy') as PreferredAutonomy | undefined;
        if (autonomy) updates.preferredAutonomy = autonomy;
        const style = getArg(args, '--style') as CommunicationStyle | undefined;
        if (style) updates.communicationStyle = style;
        void updatePreferences(updates);
      }
      break;
    }

    case 'focus': {
      const sub = args[1];
      if (sub === 'set') {
        void setCurrentFocus(args[2]);
      } else if (sub === 'clear') {
        void setCurrentFocus(null);
      }
      break;
    }

    case 'do-not-repeat': {
      const sub = args[1];
      if (sub === 'add') {
        void addDoNotRepeat(args.slice(2).join(' '));
      }
      break;
    }

    case 'pattern': {
      const sub = args[1];
      if (sub === 'record') {
        const pattern = args.slice(2).join(' ');
        const mitigation = getArg(args, '--mitigation');
        void recordPattern(pattern, mitigation ?? undefined);
      }
      break;
    }

    case 'report': {
      if (args[1] === 'weekly') {
        console.log(generateWeeklyReport());
      }
      break;
    }

    case 'summary': {
      console.log(getContextSummary());
      break;
    }

    default:
      printUsage();
      process.exit(1);
  }
}

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

// Re-export for programmatic use
export { loadContext, saveContext };
