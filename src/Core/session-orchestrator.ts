#!/usr/bin/env node
/**
 * Session Orchestrator — explicit state machine for the session lifecycle.
 *
 * Unifies the three existing lifecycle entry points behind one coordinator
 * WITHOUT rewriting them (they are battle-tested):
 *
 *   idle ──bootstrap──▶ bootstrapping ──▶ active ──cleanup──▶ cleaning ──┐
 *     ▲                                              ▲                   │
 *     │                                              └─────(continues)───┘
 *     └──reset── closed ◀──close── closing ◀───────(active|cleaning)
 *
 * Delegation map:
 *   bootstrap      → src/session-autostart-detached.ts (detached, fire-and-forget)
 *   startupCleanup → src/session-manager.ts --quiet    (sync phase-0)
 *   close          → src/session-close-orchestrator.ts (sync)
 *
 * State persists to .runtime/session-orchestrator-state.json so any process
 * (CLI, dashboard, watchtower) can observe the current lifecycle phase.
 *
 * Usage:
 *   npx tsx src/core/session-orchestrator.ts --status
 *   npx tsx src/core/session-orchestrator.ts --bootstrap
 *   npx tsx src/core/session-orchestrator.ts --startup
 *   npx tsx src/core/session-orchestrator.ts --close
 *   npx tsx src/core/session-orchestrator.ts --reset
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { runNpxTsx, runNpxTsxSync } from './run-command';

const ROOT = resolve(process.cwd());
const STATE_PATH = join(ROOT, '.runtime', 'session-orchestrator-state.json');

export type SessionPhase =
  | 'idle'
  | 'bootstrapping'
  | 'active'
  | 'cleaning'
  | 'closing'
  | 'closed';

interface Transition {
  from: SessionPhase;
  to: SessionPhase;
  at: string;
  trigger: string;
}

interface OrchestratorState {
  phase: SessionPhase;
  updatedAt: string;
  history: Transition[];
}

/** Allowed phase transitions — anything else is rejected. */
const TRANSITIONS: Record<SessionPhase, SessionPhase[]> = {
  idle: ['bootstrapping'],
  bootstrapping: ['active', 'idle'], // idle = bootstrap failed/aborted
  active: ['cleaning', 'closing'],
  cleaning: ['active', 'closing'],
  closing: ['closed'],
  closed: ['idle'],
};

function loadState(): OrchestratorState {
  try {
    if (existsSync(STATE_PATH)) {
      const raw = JSON.parse(readFileSync(STATE_PATH, 'utf-8')) as OrchestratorState;
      if (raw.phase && TRANSITIONS[raw.phase]) return raw;
    }
  } catch {
    /* corrupt → start fresh */
  }
  return { phase: 'idle', updatedAt: new Date().toISOString(), history: [] };
}

function saveState(state: OrchestratorState): void {
  mkdirSync(join(ROOT, '.runtime'), { recursive: true });
  // Keep the last 50 transitions for forensics.
  state.history = state.history.slice(-50);
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
}

export function getPhase(): SessionPhase {
  return loadState().phase;
}

export function transition(to: SessionPhase, trigger = 'manual'): OrchestratorState {
  const state = loadState();
  const allowed = TRANSITIONS[state.phase];
  if (!allowed.includes(to)) {
    throw new Error(
      `Invalid transition ${state.phase} → ${to} (allowed: ${allowed.join(', ')})`,
    );
  }
  state.history.push({ from: state.phase, to, at: new Date().toISOString(), trigger });
  state.phase = to;
  state.updatedAt = new Date().toISOString();
  saveState(state);
  return state;
}

// ─── Lifecycle operations (delegate to existing entry points) ─────────────

export function bootstrapSession(): void {
  transition('bootstrapping', 'bootstrap');
  // Detached launcher: returns immediately, pipeline runs in background.
  // On success the pipeline marks the session active via the session file;
  // we flip the FSM when the caller observes it or on next status check.
  try {
    runNpxTsx('src/session-autostart-detached.ts', [], { stdio: 'ignore' });
    transition('active', 'bootstrap-launched');
  } catch (e) {
    transition('idle', 'bootstrap-failed');
    throw e;
  }
}

export function startupCleanup(): number {
  transition('cleaning', 'startup-cleanup');
  const er = runNpxTsxSync('src/session-manager.ts', ['--quiet'], { stdio: 'pipe' });
  transition('active', 'startup-cleanup-done');
  return er.status ?? 1;
}

export function closeSession(): number {
  transition('closing', 'close');
  const er = runNpxTsxSync('src/session-close-orchestrator.ts', [], { stdio: 'inherit' });
  transition('closed', 'close-done');
  return er.status ?? 1;
}

export function getStatus(): OrchestratorState & { pidAliveHint?: string } {
  return loadState();
}

export function reset(): void {
  const state = loadState();
  state.history.push({
    from: state.phase,
    to: 'idle',
    at: new Date().toISOString(),
    trigger: 'reset',
  });
  state.phase = 'idle';
  state.updatedAt = new Date().toISOString();
  saveState(state);
}

// ─── CLI ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--status')) {
    const s = getStatus();
    console.log(`[SESSION-ORCHESTRATOR] phase: ${s.phase} (updated ${s.updatedAt})`);
    for (const t of s.history.slice(-5)) {
      console.log(`  ${t.at}  ${t.from} → ${t.to}  (${t.trigger})`);
    }
    return;
  }
  if (args.includes('--bootstrap')) {
    bootstrapSession();
    console.log('[SESSION-ORCHESTRATOR] bootstrap launched (detached)');
    return;
  }
  if (args.includes('--startup')) {
    const code = startupCleanup();
    console.log(`[SESSION-ORCHESTRATOR] startup cleanup exit=${code}`);
    process.exitCode = code;
    return;
  }
  if (args.includes('--close')) {
    const code = closeSession();
    console.log(`[SESSION-ORCHESTRATOR] close exit=${code}`);
    process.exitCode = code;
    return;
  }
  if (args.includes('--reset')) {
    reset();
    console.log('[SESSION-ORCHESTRATOR] reset to idle');
    return;
  }
  console.log(
    'Usage: npx tsx src/core/session-orchestrator.ts [--status|--bootstrap|--startup|--close|--reset]',
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e) => {
    console.error(`[SESSION-ORCHESTRATOR] ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
