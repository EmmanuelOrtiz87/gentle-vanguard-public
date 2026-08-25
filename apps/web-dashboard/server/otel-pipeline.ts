/**
 * OTel Pipeline — unified orchestrator for the dashboard's telemetry flow.
 *
 * Coordinates the two existing engines behind one lifecycle:
 *   1. Spans:   .telemetry/spans/*.jsonl → Nexus `traces` (telemetry-ingest)
 *   2. Metrics: snapshot collection      → Nexus `metric_snapshots` (MetricsWriter)
 *
 * Also exposes pipeline stats so the Prometheus export can report the health
 * of the pipeline itself (spans ingested, last run age, write counts).
 *
 * Usage (websocket-server):
 *   const otel = getOtelPipeline();
 *   otel.start();        // replaces inline setInterval blocks
 *   otel.stop();         // graceful shutdown
 *   getOtelPipelineStats();
 */
import { ingestTelemetrySpans, type IngestResult } from './telemetry-ingest.ts';
import { MetricsWriter } from './database/metrics-writer.ts';

export interface OtelPipelineStats {
  running: boolean;
  spansIngestedTotal: number;
  lastIngest: IngestResult | null;
  lastIngestAt: string | null;
  ingestErrors: number;
  metricsWriterStarted: boolean;
}

class OtelPipeline {
  private metricsWriter = new MetricsWriter();
  private ingestTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private spansTotal = 0;
  private lastIngest: IngestResult | null = null;
  private lastIngestAt: string | null = null;
  private ingestErrors = 0;

  /** Run one ingest pass and record its outcome. */
  ingestOnce(): IngestResult {
    try {
      const result = ingestTelemetrySpans();
      this.spansTotal += result.spansIngested;
      this.lastIngest = result;
      this.lastIngestAt = new Date().toISOString();
      return result;
    } catch (err) {
      this.ingestErrors++;
      throw err;
    }
  }

  start(ingestIntervalMs = 60_000): void {
    if (this.running) return;
    this.running = true;

    // Initial ingest at startup (best-effort; interval retries on failure).
    try {
      const first = this.ingestOnce();
      if (first.spansIngested > 0) {
        console.log(
          `[OTEL] Ingested ${first.spansIngested} spans from ${first.filesScanned} file(s)`,
        );
      }
    } catch {
      /* retried by interval */
    }

    this.ingestTimer = setInterval(() => {
      try {
        this.ingestOnce();
      } catch {
        /* next cycle */
      }
    }, ingestIntervalMs);

    this.metricsWriter.start(30_000);
    console.log('[OTEL] Pipeline started (spans ingest + metrics writer)');
  }

  stop(): void {
    if (!this.running) return;
    if (this.ingestTimer) clearInterval(this.ingestTimer);
    this.ingestTimer = null;
    this.metricsWriter.stop();
    this.running = false;
    console.log('[OTEL] Pipeline stopped');
  }

  getStats(): OtelPipelineStats {
    return {
      running: this.running,
      spansIngestedTotal: this.spansTotal,
      lastIngest: this.lastIngest,
      lastIngestAt: this.lastIngestAt,
      ingestErrors: this.ingestErrors,
      metricsWriterStarted: this.running,
    };
  }
}

let singleton: OtelPipeline | null = null;

export function getOtelPipeline(): OtelPipeline {
  if (!singleton) singleton = new OtelPipeline();
  return singleton;
}
