#!/usr/bin/env node
/**
 * Event Sourcing Engine — Append-only event store with replay and projection.
 *
 * Implements event sourcing pattern for session events:
 * - Append-only event store (JSONL)
 * - Event replay by aggregate ID
 * - Projection building for current state
 * - Snapshot creation for performance
 *
 * Migrated from: scripts/utilities/ops/ADVANCED-PATTERNS/event-sourcing.ps1
 */

import {
  existsSync,
  readFileSync,
  appendFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { randomBytes, createHash } from 'crypto';
import { createRequire } from 'module';
import { isWithinRoot } from '../core/path-identity.js';
import type { DatabaseManager } from '../database/nexus//manager.js';

const _require = createRequire(import.meta.url);

// Lazy db import for SQLite dual-write
let _db: DatabaseManager | null = null;
function getDb(): DatabaseManager | null {
  if (!_db) {
    try {
      const mod = _require('../database/nexus//manager');
      _db = mod.DatabaseManager.getInstance();
    } catch {
      // SQLite not available — skip dual-write
    }
  }
  return _db;
}

/**
 * DI injection point (STACK-EVOLUTION-PLAN F2.6 batch 2).
 * Container-injected db handle takes precedence over the lazy require().
 */
export function setEventSourcingDb(handle: DatabaseManager | null): void {
  _db = handle;
}

const ROOT = resolve(process.cwd());
const EVENT_STORE_DIR = join(ROOT, '.session', 'event-store');
const SNAPSHOT_DIR = join(ROOT, '.session', 'event-snapshots');

let quiet = false;

// ─── Security: Path traversal validation ─────────────────────────────────────
function safePath(userPath: string, allowedBase: string): string | null {
  const resolved = resolve(allowedBase, userPath);
  if (!isWithinRoot(resolved, allowedBase)) return null;
  return resolved;
}

function log(msg: string, level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS' = 'INFO') {
  if (quiet) return;
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const colors: Record<string, string> = {
    INFO: '\x1b[36m',
    WARN: '\x1b[33m',
    ERROR: '\x1b[31m',
    SUCCESS: '\x1b[32m',
  };
  console.log(`${colors[level] ?? ''}[${ts}] [EVT] [${level}] ${msg}\x1b[0m`);
}

function ensureDirs() {
  for (const d of [EVENT_STORE_DIR, SNAPSHOT_DIR]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

function getStorePath(id: string): string | null {
  const safe = safePath(`${id}.jsonl`, EVENT_STORE_DIR);
  if (!safe) return null;
  return safe;
}

function getSnapshotPath(id: string): string | null {
  const safe = safePath(`${id}-snapshot.json`, SNAPSHOT_DIR);
  if (!safe) return null;
  return safe;
}

function newEventId(): string {
  const date = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
  const rand = randomBytes(4).toString('hex');
  return `evt-${date}-${rand}`;
}

interface StoredEvent {
  eventId: string;
  aggregateId: string;
  type: string;
  data: Record<string, unknown>;
  version: number;
  timestamp: string;
  sessionId?: string;
  /** SHA-256 of the previous event in the chain (hash-chained audit trail). */
  prevHash?: string;
  /** SHA-256 of this event's canonical content (tamper-evident). */
  hash?: string;
}

/** Compute a canonical SHA-256 hash for an event (excluding the hash field itself). */
function eventHash(event: StoredEvent): string {
  const content: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(event)) {
    if (k !== 'hash') content[k] = v;
  }
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

/** Load the last event of an aggregate (for hash chaining). */
function getLastEvent(aggregateId: string): StoredEvent | null {
  const path = getStorePath(aggregateId);
  if (!path || !existsSync(path)) return null;
  const lines = readFileSync(path, 'utf-8')
    .split('\n')
    .filter((l) => l.trim());
  if (lines.length === 0) return null;
  try {
    return JSON.parse(lines[lines.length - 1]) as StoredEvent;
  } catch {
    return null;
  }
}

function newEvent(
  aggregateId: string,
  type: string,
  data: Record<string, unknown>,
  version: number,
): StoredEvent {
  const prev = getLastEvent(aggregateId);
  const base: StoredEvent = {
    eventId: newEventId(),
    aggregateId,
    type,
    data,
    version,
    timestamp: new Date().toISOString(),
    sessionId: process.env.SESSION_ID,
    prevHash: prev?.hash,
  };
  base.hash = eventHash(base);
  return base;
}

function saveEvent(event: StoredEvent): void {
  const path = getStorePath(event.aggregateId);
  if (!path) {
    log('Invalid aggregate ID', 'ERROR');
    return;
  }
  appendFileSync(path, JSON.stringify(event) + '\n');

  // SQLite dual-write
  try {
    const mgr = getDb();
    if (mgr) {
      mgr.insertEvent(event.type, {
        eventId: event.eventId,
        aggregateId: event.aggregateId,
        version: event.version,
        data: event.data,
        sessionId: event.sessionId,
      });
    }
  } catch {
    // Dual-write failure is non-critical
  }
}

function loadEvents(id: string): StoredEvent[] {
  const path = getStorePath(id);
  if (!path) return [];
  if (!existsSync(path)) return [];
  const events: StoredEvent[] = [];
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as StoredEvent);
    } catch {
      log(`Skipping corrupt event line in ${id}`, 'WARN');
    }
  }
  return events;
}

function getNextVersion(id: string): number {
  const events = loadEvents(id);
  if (events.length === 0) return 1;
  return events[events.length - 1].version + 1;
}

type ProjectionHandler = (state: Record<string, unknown>, evt: StoredEvent) => void;

const PROJECTIONS: Record<string, ProjectionHandler> = {
  'session.started': (state, evt) => {
    state.status = 'active';
    state.startedAt = evt.timestamp;
  },
  'session.ended': (state, evt) => {
    state.status = 'completed';
    state.endedAt = evt.timestamp;
    state.duration = evt.data.duration;
  },
  'session.scored': (state, evt) => {
    state.score = evt.data.score;
    state.quality = evt.data.quality;
  },
  'skill.executed': (state, evt) => {
    state.skillsExecuted = ((state.skillsExecuted as number) ?? 0) + 1;
    state.lastSkill = evt.data.skillId;
  },
  'config.changed': (state, evt) => {
    state.configChanges = ((state.configChanges as number) ?? 0) + 1;
    state.lastConfigChange = evt.data.key;
  },
  'correction.applied': (state, evt) => {
    state.corrections = ((state.corrections as number) ?? 0) + 1;
    state.lastCorrection = evt.data.ruleId;
  },
  'checkpoint.created': (state, evt) => {
    state.checkpoints = ((state.checkpoints as number) ?? 0) + 1;
    state.lastCheckpoint = evt.data.checkpointId;
  },
  'rollback.executed': (state, evt) => {
    state.rollbacks = ((state.rollbacks as number) ?? 0) + 1;
    state.lastRollback = evt.data.checkpointId;
  },
  'cloud.invocation': (state, evt) => {
    state.cloudCalls = ((state.cloudCalls as number) ?? 0) + 1;
    state.cloudCost = ((state.cloudCost as number) ?? 0) + ((evt.data.cost as number) ?? 0);
  },
};

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('-')) {
      const key = arg.slice(1);
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        args[key] = next;
        i++;
      } else {
        args[key] = 'true';
      }
    }
  }
  return args;
}

function appendAction(args: Record<string, string>): StoredEvent {
  ensureDirs();
  const aggregateId = args['AggregateId'];
  const eventType = args['EventType'];
  const eventDataRaw = args['EventData'];
  if (!aggregateId) throw new Error('AggregateId required');
  if (!eventType) throw new Error('EventType required');
  let data: Record<string, unknown> = {};
  if (eventDataRaw) {
    try {
      data = JSON.parse(eventDataRaw);
    } catch {
      data = { raw: eventDataRaw };
    }
  }
  const version = getNextVersion(aggregateId);
  const event = newEvent(aggregateId, eventType, data, version);
  saveEvent(event);
  log(`Event #${version}: ${eventType} → ${aggregateId}`, 'SUCCESS');
  return event;
}

function replayAction(args: Record<string, string>): StoredEvent[] {
  const aggregateId = args['AggregateId'];
  if (!aggregateId) throw new Error('AggregateId required');
  const fromVersion = parseInt(args['FromVersion'] ?? '0', 10);
  const events = loadEvents(aggregateId);
  const filtered = events.filter((e) => e.version > fromVersion);
  log(`Replaying ${filtered.length} events from ${aggregateId} (v${fromVersion}+)`, 'INFO');
  return filtered;
}

function projectAction(args: Record<string, string>): Record<string, unknown> {
  const aggregateId = args['AggregateId'];
  if (!aggregateId) throw new Error('AggregateId required');
  const events = loadEvents(aggregateId);
  const snapshotPath = getSnapshotPath(aggregateId);
  let startVersion = 0;
  const state: Record<string, unknown> = {
    aggregateId,
    status: 'unknown',
    eventsCount: 0,
  };

  if (snapshotPath && existsSync(snapshotPath)) {
    const snap = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
    Object.assign(state, snap.state);
    startVersion = snap.version;
    log(`Loaded snapshot at v${startVersion}`, 'INFO');
  }

  const eventsToApply = events.filter((e) => e.version > startVersion);
  for (const evt of eventsToApply) {
    const handler = PROJECTIONS[evt.type];
    if (handler) handler(state, evt);
    state.eventsCount = ((state.eventsCount as number) ?? 0) + 1;
  }

  log(`Projection built for ${aggregateId}: v${state.eventsCount}`, 'SUCCESS');
  return state;
}

function snapshotAction(args: Record<string, string>): Record<string, unknown> {
  const aggregateId = args['AggregateId'];
  if (!aggregateId) throw new Error('AggregateId required');
  const state = projectAction(args);
  const events = loadEvents(aggregateId);
  const snapshot = {
    aggregateId,
    version: events.length,
    state,
    createdAt: new Date().toISOString(),
  };
  ensureDirs();
  const snapPath = getSnapshotPath(aggregateId);
  if (snapPath) writeFileSync(snapPath, JSON.stringify(snapshot, null, 2));
  log(`Snapshot saved at v${events.length} for ${aggregateId}`, 'SUCCESS');
  return snapshot;
}

function listAction(): Array<{
  aggregateId: string;
  eventCount: number;
  lastEvent: string | null;
  size: string;
}> {
  const aggregates: Array<{
    aggregateId: string;
    eventCount: number;
    lastEvent: string | null;
    size: string;
  }> = [];
  if (!existsSync(EVENT_STORE_DIR)) return aggregates;
  const files = readdirSync(EVENT_STORE_DIR).filter((f) => f.endsWith('.jsonl'));
  for (const file of files) {
    const id = file.replace('.jsonl', '');
    const content = readFileSync(join(EVENT_STORE_DIR, file), 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    let lastEventType: string | null = null;
    if (lines.length > 0) {
      try {
        const last = JSON.parse(lines[lines.length - 1]) as StoredEvent;
        lastEventType = last.type;
      } catch {
        /* skip */
      }
    }
    const fileStat = statSync(join(EVENT_STORE_DIR, file));
    aggregates.push({
      aggregateId: id,
      eventCount: lines.length,
      lastEvent: lastEventType,
      size: `${(fileStat.size / 1024).toFixed(1)} KB`,
    });
  }
  return aggregates.sort((a, b) => b.eventCount - a.eventCount);
}

/**
 * Verify the hash-chained audit trail integrity for an aggregate.
 * Recomputes each event's hash and checks that prevHash of event N matches
 * the hash of event N-1. Returns per-event status plus overall verdict.
 */
function verifyChainAction(args: Record<string, string>): {
  aggregateId: string;
  total: number;
  valid: number;
  broken: number;
  intact: boolean;
  checks: Array<{
    version: number;
    type: string;
    status: 'ok' | 'broken' | 'tamper-mismatch';
    detail?: string;
  }>;
} {
  const aggregateId = args['AggregateId'];
  if (!aggregateId) throw new Error('AggregateId required');
  const events = loadEvents(aggregateId);
  const checks: Array<{
    version: number;
    type: string;
    status: 'ok' | 'broken' | 'tamper-mismatch';
    detail?: string;
  }> = [];
  let valid = 0;
  let broken = 0;

  for (let i = 0; i < events.length; i++) {
    const evt = events[i];
    const recomputed = eventHash(evt);
    const selfOk = recomputed === evt.hash;
    if (!selfOk) {
      broken++;
      checks.push({
        version: evt.version,
        type: evt.type,
        status: 'tamper-mismatch',
        detail: 'event hash does not match its content',
      });
      continue;
    }
    if (i > 0) {
      const prev = events[i - 1];
      if (evt.prevHash !== prev.hash) {
        broken++;
        checks.push({
          version: evt.version,
          type: evt.type,
          status: 'broken',
          detail: 'prevHash does not link to previous event hash',
        });
        continue;
      }
    }
    valid++;
    checks.push({ version: evt.version, type: evt.type, status: 'ok' });
  }

  return {
    aggregateId,
    total: events.length,
    valid,
    broken,
    intact: broken === 0,
    checks,
  };
}

// ===== MAIN =====

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv);
  const action = args['Action'] ?? 'list';
  quiet = args['Quiet'] === 'true';

  try {
    let result: unknown;
    switch (action) {
      case 'append':
        result = appendAction(args);
        break;
      case 'replay':
        result = replayAction(args);
        break;
      case 'project':
        result = projectAction(args);
        break;
      case 'snapshot':
        result = snapshotAction(args);
        break;
      case 'list':
        result = listAction();
        break;
      case 'verify':
        result = verifyChainAction(args);
        break;
      default:
        console.error(`Unknown action: ${action}`);
        process.exit(1);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`Fatal error: ${msg}`, 'ERROR');
    process.exit(1);
  }
}
