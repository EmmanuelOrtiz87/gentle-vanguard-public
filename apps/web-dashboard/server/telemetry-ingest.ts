/**
 * Telemetry → Nexus ingest.
 *
 * The tracing pipeline (src/tracing-instrument.ts) writes OTLP-style spans as
 * JSONL under .telemetry/spans/. The dashboard's real-data pipeline reads the
 * Nexus `traces` table, but nothing bridged the two — leaving the
 * TracingDashboard empty. This module ingests those JSONL files into Nexus
 * incrementally (byte offsets persisted per file) so spans become queryable,
 * deduplicated (INSERT OR REPLACE by span_id) and visible in the dashboard.
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  statSync,
  openSync,
  readSync,
  closeSync,
} from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { DatabaseManager, DEFAULT_TENANT_ID } from './database/manager';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');
const ROOT = join(__dirname, '..', '..', '..');
const SPANS_DIR = join(ROOT, '.telemetry', 'spans');
const STATE_PATH = join(ROOT, '.runtime', 'telemetry-ingest-state.json');

interface RawSpan {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  status?: { code?: string };
  attributes?: Array<{
    key: string;
    value?: { stringValue?: string; intValue?: string; doubleValue?: number };
  }>;
}

interface IngestState {
  /** file name → byte offset already processed */
  offsets: Record<string, number>;
}

function loadState(): IngestState {
  try {
    if (existsSync(STATE_PATH)) return JSON.parse(readFileSync(STATE_PATH, 'utf-8')) as IngestState;
  } catch {
    /* corrupt state → re-ingest from zero (INSERT OR REPLACE keeps it safe) */
  }
  return { offsets: {} };
}

function saveState(state: IngestState): void {
  mkdirSync(join(ROOT, '.runtime'), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state), 'utf-8');
}

function attrValue(span: RawSpan, key: string): string | undefined {
  const a = span.attributes?.find((x) => x.key === key);
  return (
    a?.value?.stringValue ??
    a?.value?.intValue ??
    (a?.value?.doubleValue !== undefined ? String(a.value.doubleValue) : undefined)
  );
}

function nanoToMs(nano?: string): number | null {
  if (!nano) return null;
  const n = Number(nano);
  return Number.isFinite(n) ? Math.floor(n / 1e6) : null;
}

function mapStatus(code?: string): 'completed' | 'error' | 'running' {
  if (code === 'STATUS_CODE_OK') return 'completed';
  if (code === 'STATUS_CODE_ERROR') return 'error';
  return 'running';
}

export interface IngestResult {
  filesScanned: number;
  spansIngested: number;
  errors: number;
}

/** Incrementally ingest all span JSONL files into the Nexus traces table. */
export function ingestTelemetrySpans(): IngestResult {
  const result: IngestResult = { filesScanned: 0, spansIngested: 0, errors: 0 };
  if (!existsSync(SPANS_DIR)) return result;

  let db: DatabaseManager;
  try {
    db = DatabaseManager.getInstance();
  } catch {
    return result; // DB unavailable — skip silently, retried next cycle
  }

  const state = loadState();
  const files = readdirSync(SPANS_DIR).filter((f) => f.endsWith('.jsonl'));
  result.filesScanned = files.length;

  for (const file of files) {
    const fp = join(SPANS_DIR, file);
    let size = -1;
    try {
      size = statSync(fp).size;
    } catch {
      continue;
    }
    const prevOffset = state.offsets[file] ?? 0;
    if (size <= prevOffset) continue; // nothing new

    let content: string;
    try {
      // Read only the new tail; first partial line is discarded via offset math.
      const fd = openSync(fp, 'r');
      const buf = Buffer.alloc(size - prevOffset);
      readSync(fd, buf, 0, buf.length, prevOffset);
      closeSync(fd);
      content = buf.toString('utf-8');
    } catch {
      result.errors++;
      continue;
    }

    const lines = content.split('\n');
    // If the file grew mid-line, keep the remainder for next cycle.
    const completeLines = lines.slice(0, -1);
    const consumedChars = completeLines.reduce(
      (acc, l) => acc + Buffer.byteLength(l, 'utf-8') + 1,
      0,
    );

    for (const line of completeLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const span = JSON.parse(trimmed) as RawSpan;
        if (!span.spanId) continue;
        const startMs = nanoToMs(span.startTimeUnixNano) ?? Date.now();
        const rawEnd = nanoToMs(span.endTimeUnixNano);
        // Source spans can carry clock-skewed ends: endTime < startTime
        // (negative) or endTime absurdly in the future (multi-billion ms).
        // Both poison latency percentiles — treat as still-running.
        const MAX_SPAN_MS = 600_000; // 10 min sane ceiling for a single span
        const endMs =
          rawEnd !== null && rawEnd >= startMs && rawEnd - startMs <= MAX_SPAN_MS ? rawEnd : null;
        db.traces.insertTrace(DEFAULT_TENANT_ID, {
          span_id: span.spanId,
          trace_id: span.traceId ?? '',
          parent_span_id: span.parentSpanId ?? undefined,
          name: span.name ?? '',
          start_time: startMs,
          end_time: endMs ?? undefined,
          duration: endMs !== null ? endMs - startMs : undefined,
          status: mapStatus(span.status?.code),
          model: attrValue(span, 'model'),
          input_tokens:
            Number(attrValue(span, 'inputTokens') ?? attrValue(span, 'input.tokens') ?? 0) || 0,
          output_tokens:
            Number(attrValue(span, 'outputTokens') ?? attrValue(span, 'output.tokens') ?? 0) || 0,
          cost: Number(attrValue(span, 'cost') ?? 0) || 0,
          session_id: attrValue(span, 'sessionId'),
          attributes: span.attributes ? JSON.stringify(span.attributes) : undefined,
        });
        result.spansIngested++;
      } catch {
        result.errors++;
      }
    }

    state.offsets[file] = prevOffset + consumedChars;
  }

  if (result.spansIngested > 0 || result.errors > 0) saveState(state);
  return result;
}
