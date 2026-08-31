/**
 * Correlation Context — native lightweight OTel-compatible correlation layer.
 *
 * Unifies traces + metrics + logs under one correlation key chain:
 *   session_id ↔ trace_id ↔ token_transactions
 *
 * Design (F3.6, STACK-EVOLUTION-PLAN-2026):
 *   - AsyncLocalStorage-based context (`withCorrelation`) that every telemetry
 *     event emitted inside the callback is automatically enriched with.
 *   - Events are appended as JSONL to `.telemetry/correlation/correlation-YYYYMMDD.jsonl`
 *     (one line per event: ts, sessionId, traceId, agent, spanId, kind, name, payload).
 *   - Zero new dependencies: `node:async_hooks` + `node:fs`. The JSONL record
 *     shape mirrors the OTLP/JSON mental model (trace_id/span_id/attributes) so a
 *     real OTLP collector can be slotted in later without changing emitters
 *     (see docs/reference/TELEMETRY-CORRELATION.md — promotion path).
 *
 * Usage:
 *   import { withCorrelation, traceEvent, metricEvent, logEvent } from
 *     '../telemetry/correlation.ts';
 *   await withCorrelation({ sessionId: 'sess-1', agentName: 'mavis' }, async () => {
 *     traceEvent('skill.run.start', { skill: 'nexus-database' });
 *     metricEvent('tokens.consumed', 1500);
 *     logEvent('INFO', 'skill finished');
 *   });
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

/** Correlation context carried through async boundaries. */
export interface CorrelationContext {
  sessionId?: string;
  agentName?: string;
  traceId: string;
}

/** Kinds of telemetry events in the unified timeline. */
export type CorrelationKind = 'trace' | 'metric' | 'log' | 'token';

/** One line of the correlation JSONL log (OTel-compat shape). */
export interface CorrelationEvent {
  /** ISO timestamp of the event. */
  ts: string;
  /** Session ID (chain root: session_id ↔ trace_id ↔ tokens). */
  sessionId?: string;
  /** Trace ID — 32 hex chars, same format as OTLP trace_id. */
  traceId: string;
  /** Agent / component that emitted the event. */
  agent?: string;
  /** Span ID — 16 hex chars, same format as OTLP span_id. */
  spanId: string;
  kind: CorrelationKind;
  /** Event name (trace op, metric name, or log level for logs). */
  name: string;
  /** Event payload / attributes (OTel attribute-set equivalent). */
  payload?: Record<string, unknown>;
}

const als = new AsyncLocalStorage<CorrelationContext>();

/** Root dir for correlation JSONL. Override via GV_TELEMETRY_CORRELATION_DIR (tests). */
export function correlationDir(root: string = process.cwd()): string {
  return (
    process.env.GV_TELEMETRY_CORRELATION_DIR ?? join(root, '.telemetry', 'correlation')
  );
}

/** Generate an OTLP-format trace id (32 lowercase hex chars). */
export function newCorrelationTraceId(): string {
  return randomBytes(16).toString('hex');
}

/** Generate an OTLP-format span id (16 lowercase hex chars). */
export function newCorrelationSpanId(): string {
  return randomBytes(8).toString('hex');
}

/**
 * Run `fn` inside a correlation context. Every telemetry event emitted from
 * within `fn` (including awaited async work and nested `withCorrelation`
 * blocks that do not override the trace) is enriched with the context keys.
 * Nested calls that provide their own `sessionId`/`agentName` extend the
 * parent context; a nested `traceId` starts a child context with a new trace.
 */
export function withCorrelation<T>(
  ctx: { sessionId?: string; agentName?: string; traceId?: string },
  fn: () => T,
): T {
  const parent = als.getStore();
  const merged: CorrelationContext = {
    sessionId: ctx.sessionId ?? parent?.sessionId,
    agentName: ctx.agentName ?? parent?.agentName,
    traceId: ctx.traceId ?? parent?.traceId ?? newCorrelationTraceId(),
  };
  return als.run(merged, fn);
}

/**
 * Get the current correlation context, or `undefined` when running outside a
 * `withCorrelation` block. Used by the logger bridge (src/utils/logger.ts) to
 * enrich lines only when a context exists (fully backwards compatible).
 */
export function getCorrelation(): Readonly<CorrelationContext> | undefined {
  return als.getStore();
}

function dayStamp(date = new Date()): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Append one correlation event to today's JSONL file. Events emitted outside a
 * correlation context are dropped (no context → no chain → no timeline value),
 * unless `force` is used with an explicit event carrying its own keys.
 */
export function emitCorrelationEvent(
  kind: CorrelationKind,
  name: string,
  payload?: Record<string, unknown>,
  options?: { force?: CorrelationEvent },
): CorrelationEvent | null {
  const ctx = als.getStore();
  if (!ctx && !options?.force) return null;

  const event: CorrelationEvent = ctx
    ? {
        ts: new Date().toISOString(),
        sessionId: ctx.sessionId,
        traceId: ctx.traceId,
        agent: ctx.agentName,
        spanId: newCorrelationSpanId(),
        kind,
        name,
        ...(payload !== undefined ? { payload } : {}),
      }
    : (options?.force as CorrelationEvent);

  try {
    const dir = correlationDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `correlation-${dayStamp()}.jsonl`), JSON.stringify(event) + '\n');
  } catch {
    // Telemetry must never break the host process — swallow fs errors.
  }
  return event;
}

/** Emit a trace-kind event (span marker / operation milestone). */
export function traceEvent(
  name: string,
  payload?: Record<string, unknown>,
): CorrelationEvent | null {
  return emitCorrelationEvent('trace', name, payload);
}

/** Emit a metric-kind event (numeric measurement). */
export function metricEvent(
  name: string,
  value: number,
  payload?: Record<string, unknown>,
): CorrelationEvent | null {
  return emitCorrelationEvent('metric', name, { value, ...payload });
}

/** Emit a log-kind event. */
export function logEvent(
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG',
  message: string,
  payload?: Record<string, unknown>,
): CorrelationEvent | null {
  return emitCorrelationEvent('log', level, { message, ...payload });
}

/** Resolve a path against the repo root (cwd), exposed for CLI/tests. */
export function resolveCorrelationPath(file: string, root: string = process.cwd()): string {
  return resolve(correlationDir(root), file);
}
