/**
 * delivery/state-machine.ts — Durable state machine + checkpoint store.
 *
 * Implements the ADR-0022 state machine with write-ahead events, atomic
 * checkpoint replacement, and hash-chained audit. Every side effect is
 * preceded by a persisted event so `resume` can safely continue.
 */

import { createHash, randomUUID } from 'crypto';
import { execSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  renameSync,
  appendFileSync,
  statSync,
} from 'fs';
import { join, resolve } from 'path';
import { DeliveryCheckpoint, DeliveryEvent, DeliveryIntent, DeliveryState } from './types.js';

const ROOT = resolve(import.meta.dirname, '..', '..');
const DELIVERY_DIR = join(ROOT, '.session', 'delivery');
const TENANT_ID = 'gentle-vanguard';

// ─── Allowed transitions ─────────────────────────────────────────────────────

const TRANSITIONS: Record<DeliveryState, DeliveryState[]> = {
  planned: ['preflighted', 'blocked'],
  preflighted: ['reviewed', 'blocked'],
  reviewed: ['classified', 'staged', 'blocked'],
  classified: ['staged', 'blocked'],
  staged: ['committed', 'blocked', 'rolled_back'],
  committed: ['branched', 'blocked', 'rolled_back'],
  branched: ['pushed', 'blocked', 'rolled_back'],
  pushed: ['pr_open', 'blocked', 'rolled_back'],
  pr_open: ['checks_passed', 'blocked', 'rolled_back'],
  checks_passed: ['awaiting_approval', 'blocked', 'rolled_back'],
  awaiting_approval: ['merged', 'blocked', 'rolled_back'],
  merged: ['promoted', 'blocked', 'rolled_back'],
  promoted: [],
  rolled_back: [],
  blocked: [
    'planned',
    'preflighted',
    'reviewed',
    'classified',
    'staged',
    'committed',
    'branched',
    'pushed',
    'pr_open',
    'checks_passed',
    'awaiting_approval',
    'merged',
  ],
};

// ─── Hashing ─────────────────────────────────────────────────────────────────

export function hashObject(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export function hashIntent(intent: DeliveryIntent): string {
  const copy = { ...intent };
  delete copy.runId;
  return hashObject(copy);
}

export function computeWorkspaceHash(): string {
  // Hash of the current git tree (staged + tracked) — used for TOCTOU detection.
  try {
    const tree = execSync('git write-tree', {
      cwd: ROOT,
      encoding: 'utf-8',
      windowsHide: true,
    }).trim();
    return tree;
  } catch {
    // Fallback: hash of tracked file list + mtimes
    try {
      const files = execSync('git ls-files', {
        cwd: ROOT,
        encoding: 'utf-8',
        windowsHide: true,
      })
        .trim()
        .split('\n')
        .filter(Boolean);
      const h = createHash('sha256');
      for (const f of files) {
        const p = join(ROOT, f);
        if (existsSync(p)) {
          const s = statSync(p);
          h.update(`${f}:${s.size}:${s.mtimeMs}`);
        }
      }
      return h.digest('hex').slice(0, 40);
    } catch {
      return 'UNKNOWN';
    }
  }
}

// ─── Checkpoint store ────────────────────────────────────────────────────────

function runDir(runId: string): string {
  return join(DELIVERY_DIR, runId);
}

function checkpointPath(runId: string): string {
  return join(runDir(runId), 'checkpoint.json');
}

function eventLogPath(runId: string): string {
  return join(runDir(runId), 'events.jsonl');
}

export function ensureRunDir(runId: string): void {
  mkdirSync(runDir(runId), { recursive: true });
}

export function loadCheckpoint(runId: string): DeliveryCheckpoint | null {
  const p = checkpointPath(runId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as DeliveryCheckpoint;
  } catch {
    return null;
  }
}

export function saveCheckpoint(cp: DeliveryCheckpoint): void {
  ensureRunDir(cp.runId);
  const tmp = checkpointPath(cp.runId) + '.tmp';
  writeFileSync(tmp, JSON.stringify(cp, null, 2));
  // Atomic-ish replace
  try {
    renameSync(tmp, checkpointPath(cp.runId));
  } catch {
    writeFileSync(checkpointPath(cp.runId), JSON.stringify(cp, null, 2));
  }
}

export function appendEvent(event: DeliveryEvent): void {
  ensureRunDir(event.runId);
  const p = eventLogPath(event.runId);
  const line = JSON.stringify(event) + '\n';
  appendFileSync(p, line, 'utf-8');
}

export function loadEvents(runId: string): DeliveryEvent[] {
  const p = eventLogPath(runId);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as DeliveryEvent;
      } catch {
        return null;
      }
    })
    .filter((e): e is DeliveryEvent => e !== null);
}

export function verifyEventChain(runId: string): {
  valid: boolean;
  count: number;
  brokenAt?: number;
} {
  const events = loadEvents(runId);
  let prevHash: string | null = null;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.prevHash !== prevHash) {
      return { valid: false, count: events.length, brokenAt: i };
    }
    const recomputed = hashObject({
      eventId: e.eventId,
      runId: e.runId,
      tenantId: e.tenantId,
      type: e.type,
      state: e.state,
      actor: e.actor,
      inputHash: e.inputHash,
      artifactHashes: e.artifactHashes,
      payload: e.payload,
      redactions: e.redactions,
      occurredAt: e.occurredAt,
    });
    if (recomputed !== e.hash) {
      return { valid: false, count: events.length, brokenAt: i };
    }
    prevHash = e.hash;
  }
  return { valid: true, count: events.length };
}

// ─── State machine ───────────────────────────────────────────────────────────

export class DeliveryStateMachine {
  private checkpoint: DeliveryCheckpoint;
  private eventChain: DeliveryEvent[] = [];

  constructor(intent: DeliveryIntent, targetSha: string, emitStarted = true) {
    const runId = intent.runId ?? `delivery-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    this.checkpoint = {
      runId,
      state: 'planned',
      stateVersion: 1,
      intentHash: hashIntent(intent),
      workspaceHash: computeWorkspaceHash(),
      targetSha,
      worktreePath: '',
      commitShas: [],
      budget: {
        reservedTokens: 0,
        usedTokens: 0,
        estimatedCost: 0,
      },
      updatedAt: new Date().toISOString(),
    };
    if (emitStarted) {
      this.emit('delivery.started', 'orchestrator', {
        summary: intent.summary,
        target: intent.target,
      });
    }
  }

  static resume(runId: string): DeliveryStateMachine | null {
    const cp = loadCheckpoint(runId);
    if (!cp) return null;
    const sm = new DeliveryStateMachine(
      {
        runId,
        summary: '',
        target: cp.state === 'merged' || cp.state === 'promoted' ? 'main' : 'develop',
        changePaths: [],
        commitGroups: [],
        requestedBy: 'resume',
        promotion: 'none',
      },
      cp.targetSha,
      false,
    );
    sm.checkpoint = cp;
    sm.eventChain = loadEvents(runId);
    return sm;
  }

  get runId(): string {
    return this.checkpoint.runId;
  }

  get state(): DeliveryState {
    return this.checkpoint.state;
  }

  get checkpointData(): DeliveryCheckpoint {
    return this.checkpoint;
  }

  canTransition(to: DeliveryState): boolean {
    return TRANSITIONS[this.checkpoint.state]?.includes(to) ?? false;
  }

  transition(
    to: DeliveryState,
    actor: DeliveryEvent['actor'],
    payload: Record<string, unknown> = {},
  ): boolean {
    if (!this.canTransition(to)) {
      this.emit('delivery.blocked', actor, {
        ...payload,
        reason: `Invalid transition ${this.checkpoint.state} → ${to}`,
      });
      return false;
    }
    this.checkpoint.state = to;
    this.checkpoint.stateVersion += 1;
    this.checkpoint.updatedAt = new Date().toISOString();
    saveCheckpoint(this.checkpoint);
    this.emit(`state.${to}`, actor, payload);
    return true;
  }

  update(patch: Partial<DeliveryCheckpoint>): void {
    this.checkpoint = { ...this.checkpoint, ...patch, updatedAt: new Date().toISOString() };
    saveCheckpoint(this.checkpoint);
  }

  private emit(
    type: string,
    actor: DeliveryEvent['actor'],
    payload: Record<string, unknown>,
  ): void {
    const prevHash =
      this.eventChain.length > 0 ? this.eventChain[this.eventChain.length - 1].hash : null;
    const event: DeliveryEvent = {
      eventId: randomUUID(),
      runId: this.checkpoint.runId,
      tenantId: TENANT_ID,
      type,
      state: this.checkpoint.state,
      actor,
      inputHash: this.checkpoint.intentHash,
      artifactHashes: [],
      payload,
      redactions: [],
      prevHash,
      hash: '',
      occurredAt: new Date().toISOString(),
    };
    event.hash = hashObject({
      eventId: event.eventId,
      runId: event.runId,
      tenantId: event.tenantId,
      type: event.type,
      state: event.state,
      actor: event.actor,
      inputHash: event.inputHash,
      artifactHashes: event.artifactHashes,
      payload: event.payload,
      redactions: event.redactions,
      occurredAt: event.occurredAt,
    });
    this.eventChain.push(event);
    appendEvent(event);
  }

  verifyIntegrity(): { valid: boolean; count: number; brokenAt?: number } {
    return verifyEventChain(this.checkpoint.runId);
  }

  cleanup(): void {
    // Remove run directory (forensic worktree is separate)
    const dir = runDir(this.checkpoint.runId);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
