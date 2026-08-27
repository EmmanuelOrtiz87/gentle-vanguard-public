#!/usr/bin/env node
/**
 * Tracing Instrumentation — Wraps skill/agent execution with OpenTelemetry tracing.
 *
 * Sends OTLP spans to the OpenTelemetry Collector for distributed tracing.
 * Supports nested spans, error tagging, and correlation ID propagation.
 * Integrates with Jaeger (visualization) and Prometheus (metrics).
 *
 * Migrated from: scripts/utilities/ops/TRACING/tracing-instrument.ps1
 * Requires OpenTelemetry Collector running on localhost:4317
 */

import {
  existsSync,
  readFileSync,
  appendFileSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import http from 'http';

const ROOT = resolve(process.cwd());
const TRACES_DIR = join(ROOT, '.telemetry', 'traces');
const METRICS_DIR = join(ROOT, '.telemetry', 'metrics');
const SPAN_DIR = join(ROOT, '.telemetry', 'spans');

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

[TRACES_DIR, METRICS_DIR, SPAN_DIR].forEach(ensureDir);

let quiet = false;

function log(msg: string, level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS' = 'INFO') {
  if (quiet) return;
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const colors: Record<string, string> = {
    INFO: '\x1b[36m',
    WARN: '\x1b[33m',
    ERROR: '\x1b[31m',
    SUCCESS: '\x1b[32m',
  };
  console.log(`${colors[level] ?? ''}[${ts}] [TRACING] [${level}] ${msg}\x1b[0m`);
}

function newTraceId(): string {
  const hex = '0123456789abcdef';
  let id = '';
  for (let i = 0; i < 32; i++) id += hex[Math.floor(Math.random() * 16)];
  return id;
}

function newSpanId(): string {
  const hex = '0123456789abcdef';
  let id = '';
  for (let i = 0; i < 16; i++) id += hex[Math.floor(Math.random() * 16)];
  return id;
}

function getTimestampNs(): bigint {
  const epoch = new Date('1970-01-01T00:00:00Z').getTime();
  return BigInt(Date.now() - epoch) * BigInt(1_000_000);
}

interface SpanAttributes {
  [key: string]: string;
}

interface SpanEvent {
  name: string;
  timeUnixNano: string;
  attributes: { key: string; value: { stringValue: string } }[];
}

interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano?: string;
  status: { code: string; message?: string };
  attributes: { key: string; value: { stringValue: string } }[];
  events: SpanEvent[];
}

/**
 * Recover the true start time of a span by reading back its 'start' record
 * from today's span files. Callers often forget to pass startTimeUnixNano
 * as an attribute on 'end' — relying on that produced multi-billion ns
 * durations (clock-skew poison). Self-healing: read what we wrote.
 */
function recoverStartNs(traceId: string, spanId: string, endNs: bigint): bigint | null {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const candidates = [
    join(SPAN_DIR, `spans-${today}.jsonl`),
    join(TRACES_DIR, `traces-${today}.jsonl`),
  ];
  for (const file of candidates) {
    try {
      if (!existsSync(file)) continue;
      const lines = readFileSync(file, 'utf-8').split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line || !line.includes(spanId)) continue;
        try {
          const rec = JSON.parse(line) as { spanId?: string; startTimeUnixNano?: string };
          if (rec.spanId !== spanId || !rec.startTimeUnixNano) continue;
          const ns = BigInt(rec.startTimeUnixNano);
          // Valid only if it precedes the end and is within a sane window (24h).
          if (ns > 0n && ns <= endNs && endNs - ns <= BigInt(24 * 3600 * 1_000_000_000)) return ns;
        } catch {
          /* skip malformed line */
        }
      }
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

function newOtlpSpan(params: {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeUnixNano: bigint;
  endTimeUnixNano?: bigint;
  statusCode?: string;
  errorMessage?: string;
  attributes: SpanAttributes;
  events?: SpanEvent[];
}): OtlpSpan {
  const attrs = Object.entries(params.attributes).map(([key, value]) => ({
    key,
    value: { stringValue: String(value) },
  }));

  const status = params.errorMessage
    ? { code: 'STATUS_CODE_ERROR', message: params.errorMessage }
    : { code: params.statusCode ?? 'STATUS_CODE_OK' };

  return {
    traceId: params.traceId,
    spanId: params.spanId,
    parentSpanId: params.parentSpanId,
    name: params.name,
    kind: 2,
    startTimeUnixNano: params.startTimeUnixNano.toString(),
    ...(params.endTimeUnixNano !== undefined
      ? { endTimeUnixNano: params.endTimeUnixNano.toString() }
      : {}),
    status,
    attributes: attrs,
    events: params.events ?? [],
  };
}

function exportSpanToFile(span: OtlpSpan): void {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const spanLine = JSON.stringify(span, (_key, val) =>
    typeof val === 'bigint' ? val.toString() : val,
  );
  appendFileSync(join(SPAN_DIR, `spans-${today}.jsonl`), spanLine + '\n');
  appendFileSync(join(TRACES_DIR, `traces-${today}.jsonl`), spanLine + '\n');
  log(`Span exported: ${span.name} [${span.spanId}]`);
}

function sendOtlpSpan(span: OtlpSpan, serviceName: string): void {
  try {
    const body = JSON.stringify({
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: serviceName } },
              { key: 'deployment.environment', value: { stringValue: 'production' } },
            ],
          },
          scopeSpans: [
            {
              scope: { name: 'gentle-vanguard-instrumentation', version: '1.0.0' },
              spans: [span],
            },
          ],
        },
      ],
    });

    const url = new URL('http://localhost:4318/v1/traces');
    const transport = http;
    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      () => {
        log('OTLP export successful', 'SUCCESS');
      },
    );
    req.on('error', () => log('OTLP export failed (collector may not be running)', 'WARN'));
    req.write(body);
    req.end();
  } catch {
    log('OTLP export failed (collector may not be running)', 'WARN');
  }
}

function recordSpanMetrics(name: string, durationNs: bigint, isError: boolean): void {
  const metricsFile = join(
    METRICS_DIR,
    `span-metrics-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`,
  );
  let metrics: {
    spans: Array<{
      name: string;
      durationNs: string;
      durationMs: number;
      isError: boolean;
      timestamp: string;
    }>;
  } = { spans: [] };
  if (existsSync(metricsFile)) {
    try {
      metrics = JSON.parse(readFileSync(metricsFile, 'utf-8'));
    } catch {
      /* fresh file */
    }
  }
  metrics.spans.push({
    name,
    durationNs: durationNs.toString(),
    durationMs: Number(durationNs) / 1e6,
    isError,
    timestamp: new Date().toISOString(),
  });
  writeFileSync(metricsFile, JSON.stringify(metrics, null, 2));
}

function getPrometheusMetrics(
  name: string,
  durationMs: number,
  isError: boolean,
  serviceName: string,
): void {
  const promFile = join(METRICS_DIR, 'prometheus-metrics.prom');
  const timestamp = Math.floor(Date.now() / 1000);
  const status = isError ? 'error' : 'ok';
  const lines = [
    `# HELP gentle_vanguard_span_duration_ms Span duration in milliseconds`,
    `# TYPE gentle_vanguard_span_duration_ms gauge`,
    `gentle_vanguard_span_duration_ms{span="${name}",service="${serviceName}"} ${durationMs} ${timestamp}`,
    `# HELP gentle_vanguard_span_total Total spans count`,
    `# TYPE gentle_vanguard_span_total counter`,
    `gentle_vanguard_span_total{span="${name}",service="${serviceName}",status="${status}"} 1 ${timestamp}`,
  ];
  appendFileSync(promFile, lines.join('\n') + '\n');
}

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

// ===== MAIN =====

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv);
  const action = args['Action'] ?? 'start';
  quiet = args['Quiet'] === 'true';

  const traceId = args['TraceId'] ?? newTraceId();
  const spanId = args['SpanId'] ?? newSpanId();
  const parentSpanId = args['ParentSpanId'];
  const spanName = args['SpanName'] ?? 'unnamed';
  const serviceName = args['ServiceName'] ?? 'gentle-vanguard';
  const errorMessage = args['ErrorMessage'];
  const attributesRaw = args['Attributes'] ?? '{}';

  let attributes: SpanAttributes = {};
  try {
    attributes = JSON.parse(attributesRaw);
  } catch {
    /* empty */
  }

  switch (action) {
    case 'start': {
      const startNs = getTimestampNs();
      // No endTime: this is a running marker. Setting endTime = startTime
      // produced fake 0ms durations that dragged every average to zero.
      const span = newOtlpSpan({
        traceId,
        spanId,
        parentSpanId,
        name: spanName,
        startTimeUnixNano: startNs,
        attributes,
      });
      exportSpanToFile(span);
      getPrometheusMetrics(spanName, 0, false, serviceName);
      console.log(JSON.stringify({ traceId, spanId, startNs: startNs.toString(), parentSpanId }));
      break;
    }
    case 'end': {
      if (!args['TraceId'] || !args['SpanId']) {
        console.error('TraceId and SpanId required for end action');
        process.exit(1);
      }
      const endNs = getTimestampNs();
      // Recover the true start: span file first (self-healing), caller
      // attribute as fallback. Invalid (0 / future / >24h) → running span.
      const recovered = recoverStartNs(traceId, spanId, endNs);
      const attrStart = BigInt(attributes['startTimeUnixNano'] ?? '0');
      const startNs =
        recovered ??
        (attrStart > 0n &&
        attrStart <= endNs &&
        endNs - attrStart <= BigInt(24 * 3600 * 1_000_000_000)
          ? attrStart
          : null);
      const durationNs = startNs === null ? null : endNs - startNs;
      const durationMs =
        durationNs === null ? 0 : Math.round((Number(durationNs) / 1e6) * 100) / 100;
      const span = newOtlpSpan({
        traceId,
        spanId,
        parentSpanId,
        name: spanName,
        startTimeUnixNano: startNs ?? endNs,
        ...(startNs !== null ? { endTimeUnixNano: endNs } : {}),
        attributes,
      });
      exportSpanToFile(span);
      sendOtlpSpan(span, serviceName);
      if (durationNs !== null) recordSpanMetrics(spanName, durationNs, false);
      getPrometheusMetrics(spanName, durationMs, false, serviceName);
      log(
        startNs === null
          ? `Span ended (start unknown — kept running): ${spanName}`
          : `Span completed: ${spanName} (${durationMs}ms)`,
        'SUCCESS',
      );
      console.log(JSON.stringify({ traceId, spanId, durationMs }));
      break;
    }
    case 'error': {
      if (!args['TraceId'] || !args['SpanId']) {
        console.error('TraceId and SpanId required for error action');
        process.exit(1);
      }
      const endNs = getTimestampNs();
      // Same self-healing start recovery as the 'end' action.
      const recovered = recoverStartNs(traceId, spanId, endNs);
      const attrStart = BigInt(attributes['startTimeUnixNano'] ?? '0');
      const startNs =
        recovered ??
        (attrStart > 0n &&
        attrStart <= endNs &&
        endNs - attrStart <= BigInt(24 * 3600 * 1_000_000_000)
          ? attrStart
          : null);
      const durationNs = startNs === null ? null : endNs - startNs;
      const durationMs =
        durationNs === null ? 0 : Math.round((Number(durationNs) / 1e6) * 100) / 100;
      const span = newOtlpSpan({
        traceId,
        spanId,
        parentSpanId,
        name: spanName,
        startTimeUnixNano: startNs ?? endNs,
        ...(startNs !== null ? { endTimeUnixNano: endNs } : {}),
        statusCode: 'STATUS_CODE_ERROR',
        errorMessage,
        attributes,
      });
      exportSpanToFile(span);
      sendOtlpSpan(span, serviceName);
      if (durationNs !== null) recordSpanMetrics(spanName, durationNs, true);
      getPrometheusMetrics(spanName, durationMs, true, serviceName);
      log(`Span errored: ${spanName} — ${errorMessage}`, 'ERROR');
      console.log(JSON.stringify({ traceId, spanId, durationMs, error: errorMessage }));
      break;
    }
    case 'export': {
      log('Exporting all pending spans to OTLP...', 'INFO');
      let exported = 0;
      if (existsSync(SPAN_DIR)) {
        const files = readdirSync(SPAN_DIR)
          .filter((f) => f.endsWith('.jsonl'))
          .sort()
          .reverse();
        for (const file of files) {
          const content = readFileSync(join(SPAN_DIR, file), 'utf-8');
          for (const line of content.split('\n').filter((l) => l.trim())) {
            try {
              const span = JSON.parse(line) as OtlpSpan;
              sendOtlpSpan(span, serviceName);
              exported++;
            } catch {
              log(`Failed to export span from ${file}`, 'WARN');
            }
          }
        }
      }
      log(`Exported ${exported} spans to OTLP collector`, 'SUCCESS');
      console.log(JSON.stringify({ exported }));
      break;
    }
    default:
      console.error(`Unknown action: ${action}`);
      process.exit(1);
  }
}
