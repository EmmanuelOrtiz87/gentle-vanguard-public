/**
 * typed-refusal.ts — Refusals that describe what actually happened
 *
 * Absorbed natively from gentle-ai v2.5.0-rc.2/rc.3 and v2.4.0:
 *   - v2.4.0: "A candidate with more than 32 changed paths is reviewable. The
 *     entry cap that refused it reported itself under the byte-budget reason
 *     code, so the advice it gave — split the candidate — could never work."
 *     → reason codes must name the real limit that fired.
 *   - rc.2: "An over-budget pre-edit forecast reported an unknown outcome and
 *     auto-filed a defect report for ordinary caller input, when nothing had
 *     been written." → a refusal states whether anything started, and ordinary
 *     caller input never files defect evidence.
 *   - rc.2: "A replayed acknowledgement surfaced a raw filesystem error carrying
 *     an absolute path." → typed messages carry no filesystem paths.
 *   - rc.2: "the refusal advertised a retry that reproduced forever" → a
 *     remediation command must be one the receiver can actually execute.
 *   - rc.3 (#3911/#3799): rejected validator attempts close atomically and a
 *     terminal escalation leaves inspectable evidence of what was refused.
 *
 * Contract: gentle-vanguard.typed-refusal/v1
 */

import { mkdirSync, appendFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

export type RefusalKind =
  | 'capability' // undeclared/missing capability or tool grant
  | 'selector' // scope selector malformed, unknown or not admitted
  | 'budget' // a measured limit (paths, tokens, time) was exceeded
  | 'authority' // authority absent, stale, burned or wrong lineage
  | 'persistence' // store unavailable, unwritable or inconsistent
  | 'state' // transition invalid for the current state
  | 'untracked' // untracked files the transaction must account for
  | 'unsupported' // operation exists but not on this surface/runtime
  | 'outside-scope' // requested thing is outside the frozen scope
  | 'replay' // exact invocation already consumed
  | 'stale' // revision/epoch no longer current
  | 'io'; // filesystem/transport failure (no paths in message)

export interface Remediation {
  /** Exact command the receiver can run verbatim. Must not reproduce forever. */
  command: string;
  description: string;
}

export interface TypedRefusal {
  kind: RefusalKind;
  /** Machine-readable, names the REAL limit/cause (never a lookalike code). */
  code: string;
  /** Describes the outcome that actually happened. Contains no absolute paths. */
  message: string;
  /** True when the refusal fired before any effect — callers must not clean up. */
  nothingStarted?: boolean;
  /** Names the way forward, only when one exists. */
  remediation?: Remediation;
  /** Where inspectable evidence of this refusal was written, if it was. */
  evidencePath?: string;
}

export function refusal(
  kind: RefusalKind,
  code: string,
  message: string,
  extra?: Partial<Pick<TypedRefusal, 'nothingStarted' | 'remediation'>>,
): TypedRefusal {
  return { kind, code, message, ...extra };
}

export function isTypedRefusal(x: unknown): x is TypedRefusal {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Record<string, unknown>;
  return typeof r.kind === 'string' && typeof r.code === 'string' && typeof r.message === 'string';
}

/**
 * Human/agent-facing one-block description. Every field present is rendered;
 * nothingStarted defaults to omitted (refusals that fired mid-flight say so
 * explicitly instead).
 */
export function describe(r: TypedRefusal): string {
  const lines = [`REFUSED [${r.kind}] ${r.code}: ${r.message}`];
  if (r.nothingStarted) lines.push('  nothing started — no cleanup or rollback needed');
  if (r.remediation) {
    lines.push(`  way forward: ${r.remediation.description}`);
    lines.push(`  run: ${r.remediation.command}`);
  }
  if (r.evidencePath) lines.push(`  evidence: ${r.evidencePath}`);
  return lines.join('\n');
}

/**
 * Append inspectable rejection evidence (rc.3 #3799). Terminal escalations and
 * atomic validator closures record what was refused. Refusals with
 * `nothingStarted` are ordinary caller input and are NOT filed.
 * Returns the evidence file path, or null when nothing should be written.
 */
export function writeEvidence(r: TypedRefusal, baseDir?: string): string | null {
  if (r.nothingStarted) return null;
  const dir = join(baseDir ?? join(resolve(process.cwd()), '.session', 'refusals'));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, 'evidence.jsonl');
  const entry = {
    at: new Date().toISOString(),
    kind: r.kind,
    code: r.code,
    message: r.message,
    remediation: r.remediation?.command ?? null,
  };
  appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf-8');
  return file;
}
