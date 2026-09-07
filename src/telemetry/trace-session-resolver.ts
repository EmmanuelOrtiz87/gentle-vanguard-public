/**
 * trace-session-resolver.ts — single code path for resolving the session id of
 * a trace at write time (STACK gap fix, 2026-08-31: Nexus `traces.session_id`
 * was NULL on every row because no writer recorded it).
 *
 * Resolution order (first non-null wins; failure at any step → next step):
 *  1. Correlation context (`withCorrelation`/`getCorrelation` AsyncLocalStorage)
 *     — if the writer runs inside a session correlation context, use it.
 *  2. Tool-reported session id from the trace payload — resolved through the
 *     session-id bridge alias map (`aliasResolve`) when possible; otherwise the
 *     raw tool-native id (`ses_*`, `sess_*`, codex UUID, `mvs_*`) is used as-is
 *     (honest: it identifies the tool session even without a repo mapping).
 *  3. Repo session marker `.session/session-current.json` (same reader
 *     approach as src/knowledge/skill-usage-recorder.ts) — ONLY appropriate for
 *     writers that run inside this repo's session.
 *  4. null — backwards compatible: never break a trace write, never guess.
 *
 * All writers funnel through here (TraceRepo.insertTrace is the single SQL
 * writer for the `traces` table).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCorrelation } from './correlation.js';

export interface ResolveTraceSessionOptions {
  /** Tool-reported session id from the trace payload, if any. */
  payloadSessionId?: string | null;
  /** Repo root used to locate .session/session-current.json (default: cwd). */
  repoRoot?: string;
  /**
   * Optional alias resolver (from the session-id bridge): maps a tool-native
   * session id to the repo stack session id. Return null when unmapped.
   */
  aliasResolve?: (aliasId: string) => string | null;
  /** Test seam: skip the session-current fallback entirely. */
  disableCurrentSessionFallback?: boolean;
}

/**
 * Reads the active repo session id from `.session/session-current.json`
 * (marker written by session autostart). Best-effort: null on any failure.
 * Same reader pattern as skill-usage-recorder.ts.
 */
export function readCurrentRepoSessionId(repoRoot: string = process.cwd()): string | null {
  try {
    const p = join(repoRoot, '.session', 'session-current.json');
    if (!existsSync(p)) return null;
    const data = JSON.parse(readFileSync(p, 'utf-8')) as { sessionId?: string; id?: string };
    const id = data.sessionId ?? data.id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the session id for a trace about to be written. Returns null when
 * nothing honest can be determined (writers must then keep NULL — never throw).
 */
export function resolveTraceSessionId(opts: ResolveTraceSessionOptions = {}): string | null {
  // 1. Correlation context (AsyncLocalStorage) — strongest signal when present.
  const ctx = getCorrelation();
  if (ctx?.sessionId) return ctx.sessionId;

  // 2. Tool-reported session id, resolved through aliases when possible.
  const payloadId = opts.payloadSessionId?.trim();
  if (payloadId) {
    const aliased = opts.aliasResolve?.(payloadId);
    if (aliased) return aliased;
    return payloadId; // unmapped tool-native id is still an honest identifier
  }

  // 3. Repo session marker (only valid for in-repo writers, not multi-tool
  //    aggregators without a payload id — caller decides by passing repoRoot).
  if (opts.disableCurrentSessionFallback || !opts.repoRoot) return null;
  return readCurrentRepoSessionId(opts.repoRoot);
}
