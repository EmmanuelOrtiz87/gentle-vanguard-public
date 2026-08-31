/**
 * TracingPort — hexagonal port for tracing/telemetry export (STACK-EVOLUTION-PLAN F3.3).
 *
 * Contract: startSpan/endSpan with attributes, events on a span, and an
 * explicit flush() for shutdown. Errors are captured via recordException on
 * the span handle.
 *
 * Adapters:
 *   - NoopTracingPort → default (zero cost, no I/O)
 *   - OtelTracingPort  → thin OTLP/JSON-over-HTTP exporter (localhost:4318/v1/traces
 *     by default, standard OTEL_EXPORTER_OTLP_ENDPOINT). There is no importable
 *     OTel SDK in src/ today (src/monitor/tracing-instrument.ts is a CLI that
 *     writes raw files under .telemetry/), so this adapter implements the OTLP
 *     JSON wire format directly — no new dependency. Enabled via GV_TRACING=otel.
 *
 * Future: swap for the official @opentelemetry/sdk-trace-base adapter behind
 * the same interface. See ADR-0024.
 */

export interface SpanHandle {
  readonly id: string;
  /** Attach a key/value attribute to the span. */
  setAttribute(key: string, value: string | number | boolean): this;
  /** Record a timestamped event on the span. */
  event(name: string, attributes?: Record<string, string | number | boolean>): this;
  /** Record an exception (error) on the span. */
  recordException(error: unknown): this;
  /** End the span. Idempotent. */
  end(): void;
}

export interface SpanOptions {
  /** ISO timestamp; defaults to now. */
  startTime?: string;
  attributes?: Record<string, string | number | boolean>;
}

export interface TracingPort {
  startSpan(name: string, opts?: SpanOptions): SpanHandle;
  /** Force-deliver buffered spans. Resolves when export completed or failed. */
  flush(): Promise<void>;
}

function randomHex(bytes: number): string {
  const hex = '0123456789abcdef';
  let id = '';
  for (let i = 0; i < bytes * 2; i++) id += hex[Math.floor(Math.random() * 16)];
  return id;
}

// ─── Noop adapter (default) ────────────────────────────────────────────────

class NoopSpan implements SpanHandle {
  constructor(readonly id: string) {}
  setAttribute(): this {
    return this;
  }
  event(): this {
    return this;
  }
  recordException(): this {
    return this;
  }
  end(): void {
    /* noop */
  }
}

export class NoopTracingPort implements TracingPort {
  startSpan(_name: string, _opts?: SpanOptions): SpanHandle {
    return new NoopSpan(randomHex(8));
  }
  async flush(): Promise<void> {
    /* noop */
  }
}

// ─── OTLP/JSON-over-HTTP adapter (opt-in) ──────────────────────────────────

import { request } from 'http';
import { request as requestSecure } from 'https';

interface RecordedSpan {
  traceId: string;
  spanId: string;
  name: string;
  startTime: string;
  endTime?: string;
  attributes: Record<string, string | number | boolean>;
  events: { name: string; timestamp: string; attributes?: Record<string, string | number | boolean> }[];
  status: { code: 'UNSET' | 'OK' | 'ERROR'; message?: string };
}

export interface OtelTracingPortOptions {
  /** OTLP HTTP endpoint; defaults to http://localhost:4318/v1/traces */
  endpoint?: string;
  /** Max spans buffered before flush. Default 64. */
  bufferSize?: number;
  /** Flush timeout handled by the caller via flush(). */
}

class OtelSpan implements SpanHandle {
  constructor(
    readonly id: string,
    private readonly span: RecordedSpan,
    private readonly sink: (s: RecordedSpan) => void,
  ) {}

  setAttribute(key: string, value: string | number | boolean): this {
    this.span.attributes[key] = value;
    return this;
  }

  event(name: string, attributes?: Record<string, string | number | boolean>): this {
    this.span.events.push({ name, timestamp: new Date().toISOString(), attributes });
    return this;
  }

  recordException(error: unknown): this {
    this.span.status = { code: 'ERROR', message: error instanceof Error ? error.message : String(error) };
    this.event('exception', { 'exception.type': error instanceof Error ? error.name : 'Unknown' });
    return this;
  }

  end(): void {
    if (this.span.endTime) return;
    this.span.endTime = new Date().toISOString();
    if (this.span.status.code === 'UNSET') this.span.status = { code: 'OK' };
    this.sink(this.span);
  }
}

export class OtelTracingPort implements TracingPort {
  private readonly endpoint: string;
  private readonly bufferSize: number;
  private readonly buffer: RecordedSpan[] = [];
  private readonly traceId = randomHex(16);

  constructor(opts: OtelTracingPortOptions = {}) {
    const base = opts.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/+$/, '');
    this.endpoint = base ? (base.endsWith('/v1/traces') ? base : `${base}/v1/traces`) : 'http://localhost:4318/v1/traces';
    this.bufferSize = opts.bufferSize ?? 64;
  }

  startSpan(name: string, opts: SpanOptions = {}): SpanHandle {
    const span: RecordedSpan = {
      traceId: this.traceId,
      spanId: randomHex(8),
      name,
      startTime: opts.startTime ?? new Date().toISOString(),
      attributes: { ...(opts.attributes ?? {}) },
      events: [],
      status: { code: 'UNSET' },
    };
    return new OtelSpan(span.spanId, span, (s) => {
      this.buffer.push(s);
      if (this.buffer.length >= this.bufferSize) void this.flush();
    });
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const spans = this.buffer.splice(0, this.buffer.length);
    const body = JSON.stringify({
      resourceSpans: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'gentle-vanguard' } }] },
          scopeSpans: [{ spans: spans.map(toOtlpSpan) }],
        },
      ],
    });
    await this.post(body);
  }

  private post(body: string): Promise<void> {
    return new Promise((resolve) => {
      const url = new URL(this.endpoint);
      const mod = url.protocol === 'https:' ? requestSecure : request;
      const req = mod(
        url,
        { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: 5_000 },
        (res) => {
          res.resume();
          res.on('end', () => resolve());
        },
      );
      req.on('error', () => resolve()); // tracing must never break the caller
      req.on('timeout', () => {
        req.destroy();
        resolve();
      });
      req.end(body);
    });
  }
}

function toOtlpSpan(s: RecordedSpan): Record<string, unknown> {
  return {
    traceId: s.traceId,
    spanId: s.spanId,
    name: s.name,
    kind: 'SPAN_KIND_INTERNAL',
    startTimeUnixNano: String(Date.parse(s.startTime) * 1e6),
    ...(s.endTime ? { endTimeUnixNano: String(Date.parse(s.endTime) * 1e6) } : {}),
    attributes: Object.entries(s.attributes).map(([key, value]) => ({ key, value: { stringValue: String(value) } })),
    events: s.events.map((e) => ({
      name: e.name,
      timeUnixNano: String(Date.parse(e.timestamp) * 1e6),
      attributes: e.attributes ? Object.entries(e.attributes).map(([key, v]) => ({ key, value: { stringValue: String(v) } })) : [],
    })),
    status: { code: s.status.code, ...(s.status.message ? { message: s.status.message } : {}) },
  };
}
