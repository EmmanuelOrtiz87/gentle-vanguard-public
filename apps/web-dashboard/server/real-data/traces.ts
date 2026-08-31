import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { DashboardData } from '../../src/types/dashboard.ts';
import { DEFAULT_TENANT_ID } from '../database/manager.ts';
import { classifyDashboardSource } from '../dashboard-source-provenance.ts';
import {
  CONTEXT_LOG_DIR,
  TELEMETRY_TRACES_DIR,
  SYSTEM_WIDE_FILESYSTEM_METADATA,
  readWithCache,
  getDb,
  dbAvailable,
} from './helpers.ts';

// ─── Traces ───────────────────────────────────────────────────────────

export interface Trace {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'running' | 'completed' | 'error';
  attributes: Record<string, string>;
}

export interface TraceStats {
  totalTraces: number;
  avgDuration: number;
  errorRate: number;
  activeSpans: number;
}

export function getTraces(
  rangeMs?: number,
  tenantId = DEFAULT_TENANT_ID,
): {
  traces: Trace[];
  stats: TraceStats;
  sourceClassification: DashboardData['sourceClassification'];
} {
  const traces: Trace[] = [];
  const cutoff = rangeMs && rangeMs > 0 ? Date.now() - rangeMs : 0;

  // Try DB first
  if (dbAvailable()) {
    try {
      const db = getDb();
      const dbTraces = (
        cutoff > 0
          ? db
              .getDb()
              .prepare(
                'SELECT * FROM traces WHERE tenant_id = ? AND start_time >= ? ORDER BY start_time DESC LIMIT 200',
              )
              .all(tenantId, cutoff)
          : db
              .getDb()
              .prepare(
                'SELECT * FROM traces WHERE tenant_id = ? ORDER BY start_time DESC LIMIT 200',
              )
              .all(tenantId)
      ) as Array<{
        span_id: string;
        trace_id: string;
        parent_span_id: string | null;
        name: string;
        start_time: number;
        end_time: number | null;
        duration: number | null;
        status: string;
        model: string | null;
        input_tokens: number;
        output_tokens: number;
        cost: number;
        session_id: string | null;
        attributes: string | null;
      }>;

      // Enrich spans lacking a model with the session's most recent model from token_transactions.
      const sessionModels = new Map<string, string>();
      try {
        const rows = db
          .getDb()
          .prepare(
            "SELECT session_id, model FROM token_transactions WHERE tenant_id = ? AND session_id IS NOT NULL AND model IS NOT NULL AND model != '' ORDER BY created_at DESC LIMIT 500",
          )
          .all(tenantId) as Array<{ session_id: string; model: string }>;
        for (const r of rows) {
          if (!sessionModels.has(r.session_id)) sessionModels.set(r.session_id, r.model);
        }
      } catch {
        // enrichment is best-effort
      }

      for (const t of dbTraces) {
        traces.push({
          traceId: t.trace_id,
          spanId: t.span_id,
          parentSpanId: t.parent_span_id ?? undefined,
          name: t.name,
          startTime: t.start_time,
          endTime: t.end_time ?? undefined,
          duration: t.duration ?? undefined,
          status: (t.status === 'error'
            ? 'error'
            : t.status === 'completed'
              ? 'completed'
              : 'running') as Trace['status'],
          attributes: {
            model: t.model || sessionModels.get(t.session_id ?? '') || '',
            inputTokens: String(t.input_tokens),
            outputTokens: String(t.output_tokens),
            cost: String(t.cost),
            sessionId: t.session_id ?? '',
          },
        });
      }
    } catch {
      // fallback to JSON
    }
  }

  // If no traces from DB, try context-log
  if (traces.length === 0 && !dbAvailable()) {
    try {
      if (existsSync(CONTEXT_LOG_DIR)) {
        const dirs = readdirSync(CONTEXT_LOG_DIR, { withFileTypes: true });
        for (const d of dirs) {
          if (!d.isDirectory()) continue;
          const stateFile = join(CONTEXT_LOG_DIR, d.name, '.state.json');
          if (!existsSync(stateFile)) continue;
          const state = JSON.parse(readWithCache(stateFile)) as {
            sessionId?: string;
            model?: string;
            turns?: Array<{
              label?: string;
              timestamp?: string;
              inputTokens?: number;
              outputTokens?: number;
              totalTokens?: number;
              cost?: number;
              contextChars?: number;
            }>;
          };
          if (!state || !state.turns) continue;

          const sessionId = state.sessionId || d.name;
          const model = state.model || 'unknown';

          for (let i = 0; i < state.turns.length; i++) {
            const turn = state.turns[i];
            const startTime = turn.timestamp ? new Date(turn.timestamp).getTime() : Date.now();
            traces.push({
              traceId: sessionId,
              spanId: `${sessionId}-turn-${i + 1}`,
              parentSpanId: i > 0 ? `${sessionId}-turn-${i}` : sessionId,
              name: turn.label || `Turn ${i + 1}`,
              startTime,
              endTime: turn.totalTokens ? startTime + turn.totalTokens : undefined,
              duration: turn.totalTokens || 0,
              status: 'completed',
              attributes: {
                model,
                inputTokens: String(turn.inputTokens || 0),
                outputTokens: String(turn.outputTokens || 0),
                cost: String(turn.cost || 0),
                contextChars: String(turn.contextChars || 0),
                sessionId,
              },
            });
          }
        }
      }
    } catch {
      /* best-effort */
    }
  }

  // If still no traces, fall back to OTLP spans in .telemetry/traces/*.jsonl
  if (traces.length === 0 && !dbAvailable()) {
    try {
      if (existsSync(TELEMETRY_TRACES_DIR)) {
        const files = readdirSync(TELEMETRY_TRACES_DIR).filter((f) => f.endsWith('.jsonl'));
        const otlpTraces: Trace[] = [];
        for (const file of files) {
          const lines = readFileSync(join(TELEMETRY_TRACES_DIR, file), 'utf-8')
            .split('\n')
            .filter((l) => l.trim());
          for (const line of lines) {
            try {
              const span = JSON.parse(line) as {
                spanId?: string;
                traceId?: string;
                parentSpanId?: string;
                name?: string;
                startTimeUnixNano?: string | number;
                endTimeUnixNano?: string | number;
                status?: { code?: string };
                attributes?: Array<{ key?: string; value?: { stringValue?: string } }> | null;
              };
              if (!span || !span.spanId) continue;
              // Skip session-start spans: they track session lifetime (days), not
              // operation latency — they would flood the tracing waterfall.
              if (span.name === 'session-start') continue;
              const startTime = Number(span.startTimeUnixNano || 0) / 1e6;
              const endTime = Number(span.endTimeUnixNano || 0) / 1e6;
              // Skip spans with invalid timestamps (would skew avgDuration)
              if (startTime <= 0 || (endTime > 0 && endTime < startTime)) continue;
              const attrs: Record<string, string> = {};
              if (Array.isArray(span.attributes)) {
                for (const a of span.attributes) {
                  if (a.key && a.value?.stringValue !== undefined) {
                    attrs[a.key] = a.value.stringValue;
                  }
                }
              }
              otlpTraces.push({
                traceId: span.traceId || file,
                spanId: span.spanId,
                parentSpanId: span.parentSpanId || undefined,
                name: span.name || 'span',
                startTime,
                endTime: endTime > 0 ? endTime : undefined,
                duration: endTime > 0 && startTime > 0 ? Math.round(endTime - startTime) : 0,
                status:
                  span.status?.code === 'STATUS_CODE_ERROR'
                    ? 'error'
                    : span.status?.code === 'STATUS_CODE_OK'
                      ? 'completed'
                      : 'running',
                attributes: {
                  model: attrs['model'] ?? attrs['llm.model'] ?? 'unknown',
                  sessionId: attrs['sessionId'] ?? attrs['session_id'] ?? '',
                  ...attrs,
                },
              });
            } catch {
              /* skip malformed line */
            }
          }
        }
        // Most recent spans first, cap at 200 to protect the frontend
        otlpTraces.sort((a, b) => b.startTime - a.startTime);
        traces.push(...otlpTraces.slice(0, 200));
      }
    } catch {
      /* best-effort */
    }
  }

  const activeSpans = traces.filter((t) => Date.now() - t.startTime < 3600000).length;
  // Exclude session-start spans (session lifetime, not operation latency) and
  // outliers > 1h from the average — they skew the operational latency metric.
  const durations = traces
    .filter(
      (t): t is typeof t & { duration: number } =>
        t.duration !== undefined && t.name !== 'session-start' && t.duration <= 3600000,
    )
    .map((t) => t.duration);
  const avgDuration =
    durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

  return {
    traces,
    sourceClassification: classifyDashboardSource({
      source: dbAvailable() ? 'database' : 'filesystem',
      tenantId: dbAvailable() ? tenantId : undefined,
      filesystemMetadata: SYSTEM_WIDE_FILESYSTEM_METADATA,
    }),
    stats: {
      totalTraces: traces.length,
      avgDuration,
      errorRate:
        traces.length > 0 ? traces.filter((t) => t.status === 'error').length / traces.length : 0,
      activeSpans,
    },
  };
}
