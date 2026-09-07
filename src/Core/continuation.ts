/**
 * continuation.ts — Machine-executable re-entry for long-running transactions
 *
 * Absorbed natively from gentle-ai v2.5.0-rc.3 ("Re-entry ships with the
 * freeze") and rc.2 ("One record, and a review that waits to be told it landed"):
 *
 *   rc.3 headline: "The re-entry knowledge lived in prose; the machine refused
 *   the prose." A START froze the candidate and then stopped talking; the
 *   operator was told, in prose, to reconstruct a command the CLI does not
 *   parse — a dead end. Fix: the transaction now returns `next_transition`
 *   with the operation, ordered `--name=value` tokens, a byte-identical
 *   selector echo and the lineage/target binding. Run the returned command
 *   verbatim.
 *
 *   rc.2 headline: approval burned its authority on return; if the host never
 *   received the response the review was over and nothing said so. Fix
 *   (ack-before-burn): a terminal transition stages one pending acknowledgement
 *   token and returns `review.acknowledge-approved`; a restarted STATUS replays
 *   the same operation, arguments, token and revision; only the exact
 *   acknowledgement burns; wrong, stale or replayed acks refuse and create
 *   nothing. Also: ONE durable record owns the active transaction (CAS
 *   replacement per lineage) — no split-brain representations.
 *
 * Contract: gentle-vanguard.continuation/v1 (record / resolve / next-transition)
 * Contract: gentle-vanguard.ack/v1 (stage / acknowledge)
 *
 * Usage (see rdd-core.ts and sdd-pipeline.ts for live wiring):
 *   const env = recordContinuation({ workflowId, operation: 'rdd.classify',
 *     args: { workflow: id }, command: `npx tsx src/rdd/rdd-core.ts classify --workflow ${id}`,
 *     requireEcho: true });
 *   const r = resolveContinuation(env.id, { selectorEcho: env.selectorArgumentsEcho });
 *   // terminal steps:
 *   const { token } = stageAck(`rdd:${id}`, revision);
 *   acknowledge(`rdd:${id}`, token); // exact → burns; wrong/replay → typed refusal
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  renameSync,
  readdirSync,
} from 'fs';
import { join, resolve } from 'path';
import { randomBytes, timingSafeEqual } from 'crypto';
import { canonicalPath } from './path-identity.js';
import { refusal, isTypedRefusal, type TypedRefusal } from './typed-refusal.js';

export const CONTINUATION_CONTRACT = 'gentle-vanguard.continuation/v1';
export const ACK_CONTRACT = 'gentle-vanguard.ack/v1';

export interface ContinuationBinding {
  workflowId: string;
  /** Canonical (identity-correct) root of the workspace that owns the transaction. */
  root: string;
  revision?: string;
}

export interface ContinuationEnvelope {
  id: string;
  contract: typeof CONTINUATION_CONTRACT;
  operation: string;
  /** Ordered `--name=value` argument tokens for the re-entry command. */
  args: Record<string, string>;
  /** The exact command to run verbatim to re-enter this transaction. */
  command: string;
  binding: ContinuationBinding;
  /** Byte-identical echo the resolver must send back (scope selectors). */
  selectorArgumentsEcho: string | null;
  requireEcho: boolean;
  version: number; // CAS version — replacement increments, never forks
  createdAt: string;
  status: 'active' | 'resolved';
}

export interface AckPending {
  resource: string;
  token: string;
  revision: string;
  createdAt: string;
}

export type AckResult =
  { ok: true; burned: true; resource: string } | { ok: false; refusal: TypedRefusal };

let baseDirOverride: string | null = null;

/** Test/DI override for where continuations and acks are persisted. */
export function setContinuationBaseDir(dir: string | null): void {
  baseDirOverride = dir;
}

function baseDir(): string {
  return baseDirOverride ?? join(resolve(process.cwd()), '.session');
}
function contDir(): string {
  return join(baseDir(), 'continuations');
}
function ackDir(): string {
  return join(baseDir(), 'acks');
}
function contIndex(): string {
  return join(contDir(), 'index.json');
}

function ensureDirs(): void {
  for (const d of [contDir(), ackDir()]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

/** Atomic write: temp file + rename — a reader never sees a half-written record. */
function atomicWrite(file: string, data: string): void {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, data, 'utf-8');
  renameSync(tmp, file);
}

function loadIndex(): Record<string, string> {
  if (!existsSync(contIndex())) return {};
  try {
    return JSON.parse(readFileSync(contIndex(), 'utf-8'));
  } catch {
    return {};
  }
}

function saveIndex(index: Record<string, string>): void {
  atomicWrite(contIndex(), JSON.stringify(index, null, 2));
}

export interface RecordContinuationInput {
  workflowId: string;
  operation: string;
  args?: Record<string, string>;
  command: string;
  revision?: string;
  /** Scope selectors the resolver must echo byte-identically. */
  selectorArguments?: string;
  requireEcho?: boolean;
  root?: string;
}

/**
 * Publish (or CAS-replace) THE one record that owns re-entry for
 * workflowId+operation. Recording the same key again replaces in place with
 * version+1 — and recording for the same workflowId SUPERSEDES every other
 * active continuation of that workflow (one durable owner per transaction,
 * the rc.2 lesson: a lifecycle that reads two representations is the defect).
 */
export function recordContinuation(input: RecordContinuationInput): ContinuationEnvelope {
  ensureDirs();
  const key = `${input.workflowId}::${input.operation}`;
  const file = join(contDir(), `${key.replace(/[^a-zA-Z0-9_-]+/g, '_')}.json`);

  // Supersede sibling actives of the same workflow before (re)publishing.
  const index = loadIndex();
  for (const otherKey of Object.keys(index)) {
    if (!otherKey.startsWith(`${input.workflowId}::`) || otherKey === key) continue;
    const otherFile = join(contDir(), `${otherKey.replace(/[^a-zA-Z0-9_-]+/g, '_')}.json`);
    if (!existsSync(otherFile)) continue;
    try {
      const other: ContinuationEnvelope = JSON.parse(readFileSync(otherFile, 'utf-8'));
      if (other.status === 'active') {
        other.status = 'resolved';
        atomicWrite(otherFile, JSON.stringify(other, null, 2));
      }
    } catch {
      /* corrupt sibling is left alone — index sweep replaces it on next record */
    }
  }

  let version = 1;
  if (existsSync(file)) {
    try {
      const prev: ContinuationEnvelope = JSON.parse(readFileSync(file, 'utf-8'));
      version = prev.version + 1;
    } catch {
      version = 1;
    }
  }

  const envelope: ContinuationEnvelope = {
    id: `cont-${randomBytes(6).toString('hex')}`,
    contract: CONTINUATION_CONTRACT,
    operation: input.operation,
    args: input.args ?? {},
    command: input.command,
    binding: {
      workflowId: input.workflowId,
      root: canonicalPath(input.root ?? resolve(process.cwd())),
      revision: input.revision,
    },
    selectorArgumentsEcho: input.selectorArguments ?? null,
    requireEcho: input.requireEcho ?? false,
    version,
    createdAt: new Date().toISOString(),
    status: 'active',
  };

  atomicWrite(file, JSON.stringify(envelope, null, 2));
  index[key] = envelope.id;
  saveIndex(index);
  return envelope;
}

/**
 * Fetch the active continuation for a workflow+operation (or by envelope id).
 * A resolved envelope replays as-is until replaced — STATUS before ack must
 * return the same operation, arguments and revision, never invent a new one.
 */
export function getContinuation(
  key: { workflowId: string; operation: string } | { id: string },
): ContinuationEnvelope | null {
  const file = (() => {
    if ('id' in key) {
      const index = loadIndex();
      for (const [k, id] of Object.entries(index)) {
        if (id === key.id) return join(contDir(), `${k.replace(/[^a-zA-Z0-9_-]+/g, '_')}.json`);
      }
      return null;
    }
    const k = `${key.workflowId}::${key.operation}`;
    return join(contDir(), `${k.replace(/[^a-zA-Z0-9_-]+/g, '_')}.json`);
  })();
  if (!file || !existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

export interface ResolveContinuationInput {
  selectorEcho?: string;
}

/**
 * Re-enter a transaction: validates the envelope is active, the binding root is
 * the caller's workspace, and the selector echo is byte-identical when
 * required. On success marks resolved atomically (temp+rename).
 * Every failure is a TypedRefusal — never a raw filesystem error with a path.
 */
export function resolveContinuation(
  id: string,
  input: ResolveContinuationInput = {},
): ContinuationEnvelope | TypedRefusal {
  const envelope = getContinuation({ id });
  if (!envelope) {
    return refusal('replay', 'continuation.unknown', `no continuation exists for id ${id}`, {
      nothingStarted: true,
    });
  }
  if (envelope.status === 'resolved') {
    return refusal(
      'replay',
      'continuation.already-resolved',
      `continuation for ${envelope.operation} was already re-entered`,
      { nothingStarted: true },
    );
  }
  const callerRoot = canonicalPath(resolve(process.cwd()));
  if (callerRoot !== envelope.binding.root) {
    return refusal(
      'outside-scope',
      'continuation.root-mismatch',
      'continuation belongs to a different workspace root',
      { nothingStarted: true },
    );
  }
  if (envelope.requireEcho) {
    const echo = input.selectorEcho ?? '';
    if (echo !== envelope.selectorArgumentsEcho) {
      return refusal(
        'selector',
        'continuation.echo-mismatch',
        'selector echo does not match the frozen scope byte-identically',
        {
          nothingStarted: true,
          remediation: {
            command: envelope.command,
            description: 're-run the continuation command verbatim instead of reconstructing it',
          },
        },
      );
    }
  }
  envelope.status = 'resolved';
  const k = `${envelope.binding.workflowId}::${envelope.operation}`;
  const file = join(contDir(), `${k.replace(/[^a-zA-Z0-9_-]+/g, '_')}.json`);
  atomicWrite(file, JSON.stringify(envelope, null, 2));
  return envelope;
}

/**
 * The single question an operator asks after a crash: "what do I run now?"
 * Returns the envelope holding the verbatim command, or null when the
 * workflow has no active continuation.
 */
export function nextTransition(workflowId: string): ContinuationEnvelope | null {
  const index = loadIndex();
  for (const key of Object.keys(index)) {
    if (!key.startsWith(`${workflowId}::`)) continue;
    const file = join(contDir(), `${key.replace(/[^a-zA-Z0-9_-]+/g, '_')}.json`);
    if (!existsSync(file)) continue;
    try {
      const env: ContinuationEnvelope = JSON.parse(readFileSync(file, 'utf-8'));
      if (env.status === 'active') return env;
    } catch {
      /* skip corrupt record — index sweep will replace it on next record */
    }
  }
  return null;
}

/**
 * All active continuations, newest first — the "what do I run now?" surface
 * for the dashboard and operators with more than one live transaction.
 * Corrupt records are skipped, never thrown.
 */
export function listActiveContinuations(): ContinuationEnvelope[] {
  const index = loadIndex();
  const out: ContinuationEnvelope[] = [];
  for (const key of Object.keys(index)) {
    const file = join(contDir(), `${key.replace(/[^a-zA-Z0-9_-]+/g, '_')}.json`);
    if (!existsSync(file)) continue;
    try {
      const env: ContinuationEnvelope = JSON.parse(readFileSync(file, 'utf-8'));
      if (env.status === 'active') out.push(env);
    } catch {
      /* skip corrupt record */
    }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * Retention for continuation records (lesson from gentle-ai #1656: lineages
 * accumulate with no retention policy):
 *   - RESOLVED envelopes older than the window are deleted.
 *   - ACTIVE envelopes older than the window are closed honestly (status
 *     flips to resolved) — a transaction nobody re-entered in N days is dead,
 *     not pending — and kept for audit until the next pass.
 *   - Pending acks older than the window are burned (removed): an
 *     acknowledgement nobody delivered in N days will never arrive.
 * `dir` is injectable for unit tests via setContinuationBaseDir.
 */
export interface ContinuationPruneResult {
  prunedResolved: number;
  closedStaleActive: number;
  burnedStaleAcks: number;
  retentionDays: number;
}

export function pruneContinuations(retentionDays = 30): ContinuationPruneResult {
  const result: ContinuationPruneResult = {
    prunedResolved: 0,
    closedStaleActive: 0,
    burnedStaleAcks: 0,
    retentionDays,
  };
  const cutoff = Date.now() - retentionDays * 24 * 3_600_000;
  if (existsSync(contDir())) {
    for (const f of readdirSync(contDir())) {
      if (!f.endsWith('.json') || f === 'index.json') continue;
      const p = join(contDir(), f);
      try {
        const env: ContinuationEnvelope = JSON.parse(readFileSync(p, 'utf-8'));
        const created = new Date(env.createdAt).getTime();
        if (isNaN(created) || created >= cutoff) continue;
        if (env.status === 'resolved') {
          rmSync(p, { force: true });
          result.prunedResolved++;
        } else if (env.status === 'active') {
          env.status = 'resolved';
          atomicWrite(p, JSON.stringify(env, null, 2));
          result.closedStaleActive++;
        }
      } catch {
        /* unreadable files are never deleted blindly */
      }
    }
  }
  if (existsSync(ackDir())) {
    for (const f of readdirSync(ackDir())) {
      if (!f.endsWith('.json')) continue;
      const p = join(ackDir(), f);
      try {
        const pending: AckPending = JSON.parse(readFileSync(p, 'utf-8'));
        const created = new Date(pending.createdAt).getTime();
        if (isNaN(created) || created >= cutoff) continue;
        rmSync(p, { force: true });
        result.burnedStaleAcks++;
      } catch {
        /* unreadable acks are never deleted blindly */
      }
    }
  }
  // Rebuild the index from surviving records so it never points at pruned
  // files (the one durable owner stays consistent with its own index).
  if (existsSync(contDir())) {
    const index = loadIndex();
    const rebuilt: Record<string, string> = {};
    for (const key of Object.keys(index)) {
      const file = join(contDir(), `${key.replace(/[^a-zA-Z0-9_-]+/g, '_')}.json`);
      if (existsSync(file)) rebuilt[key] = index[key];
    }
    saveIndex(rebuilt);
  }
  return result;
}

/** All pending acknowledgements, oldest first (dashboard surface). */
export function listPendingAcks(): AckPending[] {
  if (!existsSync(ackDir())) return [];
  const out: AckPending[] = [];
  for (const f of readdirSync(ackDir())) {
    if (!f.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(readFileSync(join(ackDir(), f), 'utf-8')));
    } catch {
      /* skip corrupt record */
    }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

// ─── Ack-before-burn (gentle-vanguard.ack/v1) ─────────────────────────────────

function ackFile(resource: string): string {
  return join(ackDir(), `${resource.replace(/[^a-zA-Z0-9_-]+/g, '_')}.json`);
}

/**
 * Stage the pending acknowledgement for a terminal transition. Staging does
 * NOT burn anything — the resource stays live until `acknowledge` receives
 * the exact token. Re-staging before acknowledgement replaces the pending
 * token in place (one durable owner, CAS semantics).
 */
export function stageAck(resource: string, revision: string): AckPending {
  ensureDirs();
  const pending: AckPending = {
    resource,
    token: `ack-${randomBytes(12).toString('hex')}`,
    revision,
    createdAt: new Date().toISOString(),
  };
  atomicWrite(ackFile(resource), JSON.stringify(pending, null, 2));
  return pending;
}

export function getPendingAck(resource: string): AckPending | null {
  const file = ackFile(resource);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Acknowledge a staged terminal transition. Only the exact token burns the
 * authority (deletes the pending record — "the authority is burned"). A wrong
 * token, a stale revision or a replay refuses and creates NOTHING: no receipt,
 * no tombstone, no delivery authority behind.
 */
export function acknowledge(resource: string, token: string, revision?: string): AckResult {
  const pending = getPendingAck(resource);
  if (!pending) {
    return {
      ok: false,
      refusal: refusal(
        'replay',
        'ack.nothing-pending',
        `no pending acknowledgement exists for this resource`,
        { nothingStarted: true },
      ),
    };
  }
  // Constant-time comparison: security tokens must not leak length/content
  // through early-exit string comparison (security/detect-possible-timing-attacks).
  const tokenMatches = (() => {
    try {
      return timingSafeEqual(Buffer.from(token, 'utf8'), Buffer.from(pending.token, 'utf8'));
    } catch {
      return false; // length mismatch → tokens differ
    }
  })();
  if (!tokenMatches) {
    return {
      ok: false,
      refusal: refusal('authority', 'ack.wrong-token', 'acknowledgement token is wrong', {
        nothingStarted: true,
        remediation: {
          command: `npx tsx src/core/continuation.ts ack-status --resource ${resource}`,
          description: 'inspect the pending acknowledgement and replay its staging command',
        },
      }),
    };
  }
  if (revision !== undefined && revision !== pending.revision) {
    return {
      ok: false,
      refusal: refusal('stale', 'ack.stale-revision', 'revision is no longer current', {
        nothingStarted: true,
      }),
    };
  }
  rmSync(ackFile(resource), { force: true });
  return { ok: true, burned: true, resource };
}

/** Interop: treat an AckResult's failure arm as a TypedRefusal. */
export function ackRefusal(result: AckResult): TypedRefusal | null {
  if (result.ok) return null;
  return isTypedRefusal(result.refusal) ? result.refusal : null;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const isMainModule =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!);
if (isMainModule) {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = rest.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (i < 0) return undefined;
    const a = rest[i];
    return a.includes('=') ? a.split('=').slice(1).join('=') : rest[i + 1];
  };
  if (cmd === 'next') {
    const workflowId = flag('workflow');
    if (!workflowId) {
      console.error('usage: continuation.ts next --workflow <id>');
      process.exit(1);
    }
    const env = nextTransition(workflowId);
    if (!env) {
      console.log(`no active continuation for ${workflowId}`);
      process.exit(0);
    }
    console.log(`operation: ${env.operation}  (v${env.version}, ${env.status})`);
    console.log(`run verbatim:\n  ${env.command}`);
  } else if (cmd === 'ack-status') {
    const resource = flag('resource');
    const pending = resource ? getPendingAck(resource) : null;
    console.log(pending ? JSON.stringify(pending, null, 2) : 'no pending acknowledgement');
  } else {
    console.log('usage: continuation.ts next --workflow <id> | ack-status --resource <r>');
  }
}
