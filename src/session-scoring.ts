#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { db } from './database/db.js';

const ROOT = resolve(process.cwd());

export interface DelegationType {
  total: number;
  successes: number;
  failures: number;
  avg_duration: number;
  last_event: string | null;
}

export interface CorrectionEntry {
  timestamp: string;
  detail: string;
  resolved: boolean;
}

export interface MetricsSummary {
  total_delegations: number;
  success_rate: number;
  uptime_seconds: number;
  total_corrections: number;
  total_proactive_suggestions: number;
  total_cloud_calls: number;
  total_checkpoints: number;
  total_tracing_spans: number;
  total_audit_events: number;
  quality_score: number;
}

export interface MetricsData {
  agents: Record<string, unknown>;
  summary: MetricsSummary;
  delegations: Record<string, DelegationType>;
  corrections: CorrectionEntry[];
  proactive_hits: number;
  proactive_misses: number;
  timestamp: string;
}

function ensureDir(filePath: string) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function getDefaultMetrics(): MetricsData {
  return {
    agents: {},
    summary: {
      total_delegations: 0,
      success_rate: 100,
      uptime_seconds: 0,
      total_corrections: 0,
      total_proactive_suggestions: 0,
      total_cloud_calls: 0,
      total_checkpoints: 0,
      total_tracing_spans: 0,
      total_audit_events: 0,
      quality_score: 100,
    },
    delegations: {},
    corrections: [],
    proactive_hits: 0,
    proactive_misses: 0,
    timestamp: new Date().toISOString(),
  };
}

export function getMetricsData(root: string = ROOT): MetricsData {
  // Try SQLite first (Wave 37 E)
  try {
    const mgr = db();
    const row = mgr.getSessionScoring('latest');
    const scoringRow = row as { summary_json?: string } | undefined;
    if (row && scoringRow?.summary_json) {
      const parsed = JSON.parse(scoringRow.summary_json);
      return { ...getDefaultMetrics(), ...parsed, timestamp: new Date().toISOString() };
    }
  } catch {
    // Fall through to JSON
  }

  // Fallback to JSON
  const p = join(root, '.session', 'metrics-report.json');
  if (!existsSync(p)) return getDefaultMetrics();
  try {
    const raw = readFileSync(p, 'utf-8');
    return JSON.parse(raw) as MetricsData;
  } catch {
    return getDefaultMetrics();
  }
}

export function saveMetricsData(data: MetricsData, root: string = ROOT): void {
  const p = join(root, '.session', 'metrics-report.json');
  ensureDir(p);
  data.timestamp = new Date().toISOString();
  writeFileSync(p, JSON.stringify(data, null, 2));

  // Dual-write to SQLite (Wave 37 E)
  try {
    const mgr = db();
    const sessionId = `session-${new Date().toISOString().slice(0, 10)}`;
    mgr.saveSessionScoring({
      sessionId,
      qualityScore: data.summary.quality_score,
      successRate: data.summary.success_rate,
      totalDelegations: data.summary.total_delegations,
      totalCorrections: data.summary.total_corrections,
      totalProactive: data.summary.total_proactive_suggestions,
      proactiveHits: data.proactive_hits,
      totalCloudCalls: data.summary.total_cloud_calls,
      totalCheckpoints: data.summary.total_checkpoints,
      totalTracingSpans: data.summary.total_tracing_spans,
      totalAuditEvents: data.summary.total_audit_events,
      summaryJson: JSON.stringify(data),
    });
  } catch {
    // Non-fatal — JSON persistence still works
  }
}

export function calcQualityScore(summary: MetricsSummary, proactiveHits: number): number {
  const correctionPenalty = summary.total_corrections * 5;
  const proactiveBonus = proactiveHits * 3;
  const failPenalty =
    (summary.total_delegations - (summary.total_delegations * summary.success_rate) / 100) * 10;
  const cloudBonus = summary.total_cloud_calls * 0.5;
  const checkpointBonus = summary.total_checkpoints * 1;
  const tracingBonus = summary.total_tracing_spans * 0.3;
  const auditBonus = summary.total_audit_events * 0.2;
  const raw =
    100 -
    correctionPenalty -
    failPenalty +
    proactiveBonus +
    cloudBonus +
    checkpointBonus +
    tracingBonus +
    auditBonus;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export function initMetrics(root: string = ROOT): void {
  const data = getDefaultMetrics();
  saveMetricsData(data, root);
  console.log('[SCORE] Metrics initialized');
}

export function recordEvent(
  root: string,
  opts: {
    eventType: string;
    detail: string;
    success: boolean;
    durationSeconds: number;
  },
): void {
  const data = getMetricsData(root);
  if (!data.summary) data.summary = getDefaultMetrics().summary;

  const now = new Date().toISOString();

  if (!data.delegations[opts.eventType]) {
    data.delegations[opts.eventType] = {
      total: 0,
      successes: 0,
      failures: 0,
      avg_duration: 0,
      last_event: null,
    };
  }
  const agent = data.delegations[opts.eventType];
  agent.total++;
  if (opts.success) agent.successes++;
  else agent.failures++;
  agent.avg_duration = Math.round(
    (agent.avg_duration * (agent.total - 1) + opts.durationSeconds) / agent.total,
  );
  agent.last_event = now;

  const all = Object.values(data.delegations);
  data.summary.total_delegations = all.reduce((s, d) => s + d.total, 0);
  const totalSuccess = all.reduce((s, d) => s + d.successes, 0);
  data.summary.success_rate =
    data.summary.total_delegations > 0
      ? Math.round((totalSuccess / data.summary.total_delegations) * 100)
      : 100;

  data.summary.quality_score = calcQualityScore(data.summary, data.proactive_hits);
  data.summary.uptime_seconds = 0;

  if (opts.eventType === 'correction') {
    data.summary.total_corrections++;
    data.corrections.push({ timestamp: now, detail: opts.detail, resolved: opts.success });
  }
  if (opts.eventType === 'proactive') {
    data.summary.total_proactive_suggestions++;
    if (opts.success) data.proactive_hits++;
    else data.proactive_misses++;
  }
  if (opts.eventType === 'cloud') data.summary.total_cloud_calls++;
  if (opts.eventType === 'checkpoint') data.summary.total_checkpoints++;
  if (opts.eventType === 'tracing') data.summary.total_tracing_spans++;
  if (opts.eventType === 'audit') data.summary.total_audit_events++;

  saveMetricsData(data, root);
  console.log(
    `[SCORE] Recorded ${opts.eventType} (success=${opts.success}, dur=${opts.durationSeconds}s)`,
  );
}

export function getReport(root: string = ROOT): MetricsData {
  const data = getMetricsData(root);
  const s = data.summary;
  const color =
    s.quality_score >= 80 ? '\x1b[32m' : s.quality_score >= 50 ? '\x1b[33m' : '\x1b[31m';
  console.log(`\n=== SESSION SCORING REPORT ===`);
  console.log(`Quality Score: ${color}${s.quality_score}/100\x1b[0m`);
  console.log(`Delegations: ${s.total_delegations} | Success Rate: ${s.success_rate}%`);
  console.log(
    `Corrections: ${s.total_corrections} | Proactive: ${s.total_proactive_suggestions} (hits: ${data.proactive_hits}, misses: ${data.proactive_misses})`,
  );
  console.log(
    `Cloud: ${s.total_cloud_calls} | Checkpoints: ${s.total_checkpoints} | Tracing: ${s.total_tracing_spans} | Audit: ${s.total_audit_events}`,
  );
  if (Object.keys(data.delegations).length > 0) {
    console.log(`\n--- Per-Type Breakdown ---`);
    for (const [type, a] of Object.entries(data.delegations).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const rate = a.total > 0 ? Math.round((a.successes / a.total) * 100) : 0;
      console.log(`  ${type} : ${a.total} calls, ${rate}% success, avg ${a.avg_duration}s`);
    }
  }
  return data;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  let action = 'report';
  let eventType = '';
  let detail = '';
  let success = true;
  let duration = 0;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '-Action':
        action = args[++i] ?? 'report';
        break;
      case '-EventType':
        eventType = args[++i] ?? '';
        break;
      case '-Detail':
        detail = args[++i] ?? '';
        break;
      case '-Success':
        success = true;
        break;
      case '-Failure':
        success = false;
        break;
      case '-DurationSeconds':
        duration = parseInt(args[++i] ?? '0', 10);
        break;
      default:
        if (!args[i].startsWith('-')) action = args[i];
        break;
    }
  }

  switch (action) {
    case 'init':
      initMetrics();
      break;
    case 'record':
      recordEvent(ROOT, { eventType, detail, success, durationSeconds: duration });
      break;
    case 'report':
      getReport();
      break;
    default:
      console.error(`Unknown action: ${action}`);
  }
}
