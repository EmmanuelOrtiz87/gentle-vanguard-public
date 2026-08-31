#!/usr/bin/env node
/**
 * timeout-monitor.ts — Timeout & Performance Monitoring System
 *
 * Monitors timeout violations, measures execution times, tracks performance
 * metrics, and emits alerts when thresholds are exceeded.
 *
 * Integrates with:
 *   - config/timeout-config.json   (centralized timeouts)
 *   - config/dashboard-alerts.json (alert rules)
 *   - .session/metrics/            (persistent metrics store)
 *
 * Usage:
 *   import { trackExecution, reportTimeoutViolation } from './core/timeout-monitor';
 *   const stop = trackExecution('health-check');
 *   // ... do work ...
 *   stop();  // Records duration
 *
 * CLI:
 *   npx tsx src/core/timeout-monitor.ts --status    # Show current metrics
 *   npx tsx src/core/timeout-monitor.ts --alerts    # Check for active alerts
 *   npx tsx src/core/timeout-monitor.ts --daemon    # Continuous monitoring loop
 */

import * as fs from 'fs';
import { resolve } from 'path';
import * as path from 'path';
import { getTimeout, getMonitoringTimeouts, getActiveEnvironment } from './timeout-config';

const ROOT = resolve(process.cwd());

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutionRecord {
  operation: string;
  category: string;
  startTime: string;
  durationMs: number;
  success: boolean;
  timeoutMs: number;
  violated: boolean;
  timestamp: string;
}

export interface TimeoutAlert {
  id: string;
  rule: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  metric: string;
  value: number;
  threshold: number;
  timestamp: string;
  acknowledged: boolean;
}

export interface MonitorState {
  version: string;
  environment: string;
  startedAt: string;
  executions: ExecutionRecord[];
  violations: ExecutionRecord[];
  alerts: TimeoutAlert[];
  p95LatencyMs: number;
  p99LatencyMs: number;
  avgLatencyMs: number;
  totalExecutions: number;
  totalViolations: number;
  activeAlerts: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const METRICS_DIR = path.join(ROOT, '.session', 'metrics');
const METRICS_FILE = path.join(METRICS_DIR, 'timeout-monitor.json');
const ALERTS_FILE = path.join(METRICS_DIR, 'timeout-alerts.jsonl');
const PID_FILE = path.join(ROOT, '.runtime', 'monitor-daemon.pid');
const MAX_RECORDS = 10000;
const ALERT_COOLDOWN_MS = 300000; // 5 min between same alerts

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _records: ExecutionRecord[] = [];
let _violations: ExecutionRecord[] = [];
let _alerts: TimeoutAlert[] = [];
const _lastAlertTimestamps: Map<string, number> = new Map();
let _daemonTimer: ReturnType<typeof setInterval> | null = null;

export function writeDaemonPidFile(pidFile = PID_FILE, pid = process.pid): void {
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(pidFile, String(pid), 'utf-8');
}

export function removeDaemonPidFile(pidFile = PID_FILE, pid = process.pid): void {
  try {
    if (parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10) === pid) fs.rmSync(pidFile);
  } catch {}
}

// ---------------------------------------------------------------------------
// Ensure metrics directory exists
// ---------------------------------------------------------------------------

function ensureDir() {
  if (!fs.existsSync(METRICS_DIR)) {
    fs.mkdirSync(METRICS_DIR, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function saveMetrics(): void {
  ensureDir();
  try {
    const state: MonitorState = {
      version: '1.0.0',
      environment: getActiveEnvironment(),
      startedAt: new Date().toISOString(),
      executions: _records.slice(-1000), // Keep last 1000 in file
      violations: _violations.slice(-100),
      alerts: _alerts.slice(-50),
      p95LatencyMs: calculatePercentile(
        _records.map((r) => r.durationMs),
        95,
      ),
      p99LatencyMs: calculatePercentile(
        _records.map((r) => r.durationMs),
        99,
      ),
      avgLatencyMs: calculateAvg(_records.map((r) => r.durationMs)),
      totalExecutions: _records.length,
      totalViolations: _violations.length,
      activeAlerts: _alerts.filter((a) => !a.acknowledged).length,
    };
    fs.writeFileSync(METRICS_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[TIMEOUT-MONITOR] Failed to save metrics:', (err as Error).message);
  }
}

function appendAlert(alert: TimeoutAlert): void {
  ensureDir();
  try {
    fs.appendFileSync(ALERTS_FILE, JSON.stringify(alert) + '\n', 'utf-8');
  } catch {
    /* silent */
  }
}

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------

function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

function calculateAvg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// ---------------------------------------------------------------------------
// Execution tracking
// ---------------------------------------------------------------------------

/**
 * Track an execution. Returns a stop function that records the duration.
 *
 * @param operation Name of the operation being tracked
 * @param category Category (e.g., 'http_server', 'process_execution', 'external_api')
 * @param timeoutMs Optional timeout threshold; if exceeded, records a violation
 * @returns A stop function to call when execution completes
 */
export function trackExecution(
  operation: string,
  category: string = 'process_execution',
  timeoutMs?: number,
): (success?: boolean) => ExecutionRecord {
  const startTime = Date.now();
  const startIso = new Date().toISOString();

  return (success: boolean = true): ExecutionRecord => {
    const durationMs = Date.now() - startTime;
    const threshold = timeoutMs ?? getTimeout(`${category}.script_default_ms`, 30000);
    const violated = durationMs > threshold;

    const record: ExecutionRecord = {
      operation,
      category,
      startTime: startIso,
      durationMs,
      success,
      timeoutMs: threshold,
      violated,
      timestamp: new Date().toISOString(),
    };

    _records.push(record);
    if (_records.length > MAX_RECORDS) _records.shift();

    if (violated) {
      _violations.push(record);
      if (_violations.length > 1000) _violations.shift();
      emitAlert({
        rule: 'timeout_violation',
        severity: durationMs > threshold * 2 ? 'error' : 'warning',
        message: `Timeout violation: ${operation} took ${durationMs}ms (threshold: ${threshold}ms)`,
        metric: `${category}.${operation}`,
        value: durationMs,
        threshold,
      });
    }

    // Save periodically (every 10 records)
    if (_records.length % 10 === 0) saveMetrics();

    return record;
  };
}

/**
 * Track an async operation with automatic timeout detection.
 * Returns a promise that resolves with the result or rejects on timeout.
 */
export async function trackAsync<T>(
  operation: string,
  category: string,
  promise: Promise<T>,
  timeoutMs?: number,
): Promise<T> {
  const stop = trackExecution(operation, category, timeoutMs);
  try {
    const result = await promise;
    stop(true);
    return result;
  } catch (err) {
    stop(false);
    throw err;
  }
}

/**
 * Report a timeout violation explicitly.
 */
export function reportTimeoutViolation(
  operation: string,
  category: string,
  durationMs: number,
  threshold: number,
  details?: string,
): void {
  const record: ExecutionRecord = {
    operation,
    category,
    startTime: new Date(Date.now() - durationMs).toISOString(),
    durationMs,
    success: false,
    timeoutMs: threshold,
    violated: true,
    timestamp: new Date().toISOString(),
  };

  _violations.push(record);
  _records.push(record);

  emitAlert({
    rule: 'explicit_timeout_violation',
    severity: durationMs > threshold * 2 ? 'critical' : 'error',
    message: details || `Timeout: ${operation} exceeded ${threshold}ms (took ${durationMs}ms)`,
    metric: `${category}.${operation}`,
    value: durationMs,
    threshold,
  });

  saveMetrics();
}

// ---------------------------------------------------------------------------
// Alert system
// ---------------------------------------------------------------------------

/**
 * Emit an alert with cooldown deduplication.
 */
function emitAlert(data: {
  rule: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  metric: string;
  value: number;
  threshold: number;
}): void {
  const alertKey = `${data.rule}:${data.metric}`;
  const lastEmit = _lastAlertTimestamps.get(alertKey) ?? 0;
  const cooldown = getMonitoringTimeouts().alert_cooldown_ms ?? ALERT_COOLDOWN_MS;

  // Deduplicate within cooldown window
  if (Date.now() - lastEmit < cooldown) return;
  _lastAlertTimestamps.set(alertKey, Date.now());

  const alert: TimeoutAlert = {
    id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...data,
    timestamp: new Date().toISOString(),
    acknowledged: false,
  };

  _alerts.push(alert);
  if (_alerts.length > 100) _alerts.shift();

  appendAlert(alert);

  // Console output for critical alerts
  const level =
    data.severity === 'critical'
      ? '\x1b[31m'
      : data.severity === 'error'
        ? '\x1b[33m'
        : data.severity === 'warning'
          ? '\x1b[93m'
          : '\x1b[36m';
  console.log(`${level}[ALERT][${data.severity.toUpperCase()}] ${data.message}\x1b[0m`);
}

/**
 * Get all active (non-acknowledged) alerts.
 */
export function getActiveAlerts(): TimeoutAlert[] {
  return _alerts.filter((a) => !a.acknowledged);
}

/**
 * Acknowledge an alert by ID.
 */
export function acknowledgeAlert(alertId: string): boolean {
  const alert = _alerts.find((a) => a.id === alertId);
  if (alert) {
    alert.acknowledged = true;
    saveMetrics();
    return true;
  }
  return false;
}

/**
 * Acknowledge all alerts.
 */
export function acknowledgeAllAlerts(): number {
  let count = 0;
  for (const alert of _alerts) {
    if (!alert.acknowledged) {
      alert.acknowledged = true;
      count++;
    }
  }
  if (count > 0) saveMetrics();
  return count;
}

// ---------------------------------------------------------------------------
// Metrics queries
// ---------------------------------------------------------------------------

/**
 * Get current performance metrics summary.
 */
export function getPerformanceMetrics(): {
  p95Ms: number;
  p99Ms: number;
  avgMs: number;
  totalExecutions: number;
  totalViolations: number;
  violationRate: number;
  activeAlerts: number;
  topSlowest: ExecutionRecord[];
} {
  const durations = _records.map((r) => r.durationMs);
  const sortedByDuration = [..._records].sort((a, b) => b.durationMs - a.durationMs);

  return {
    p95Ms: calculatePercentile(durations, 95),
    p99Ms: calculatePercentile(durations, 99),
    avgMs: calculateAvg(durations),
    totalExecutions: _records.length,
    totalViolations: _violations.length,
    violationRate: _records.length > 0 ? _violations.length / _records.length : 0,
    activeAlerts: _alerts.filter((a) => !a.acknowledged).length,
    topSlowest: sortedByDuration.slice(0, 10),
  };
}

/**
 * Get violation records for a specific category.
 */
export function getViolations(category?: string): ExecutionRecord[] {
  if (category) return _violations.filter((v) => v.category === category);
  return [..._violations];
}

/**
 * Get execution records for a specific operation.
 */
export function getExecutions(operation: string): ExecutionRecord[] {
  return _records.filter((r) => r.operation === operation);
}

// ---------------------------------------------------------------------------
// Daemon mode
// ---------------------------------------------------------------------------

/**
 * Start continuous monitoring daemon that periodically checks and logs metrics.
 */
export function startMonitorDaemon(intervalMs?: number): void {
  if (_daemonTimer) {
    console.warn('[TIMEOUT-MONITOR] Daemon already running');
    return;
  }

  const interval = intervalMs ?? 30000; // default 30s
  writeDaemonPidFile();
  console.log(`[TIMEOUT-MONITOR] Starting monitoring daemon (interval: ${interval}ms)`);

  const run = () => {
    const metrics = getPerformanceMetrics();
    console.log(
      `[TIMEOUT-MONITOR] Status: ${metrics.totalExecutions} exec | ` +
        `${metrics.totalViolations} violations | ${metrics.activeAlerts} alerts | ` +
        `p95: ${metrics.p95Ms}ms | avg: ${metrics.avgMs}ms`,
    );

    saveMetrics();
  };

  _daemonTimer = setInterval(run, interval);
  run(); // First run immediately
}

/**
 * Stop the monitoring daemon.
 */
export function stopMonitorDaemon(): void {
  if (_daemonTimer) {
    clearInterval(_daemonTimer);
    _daemonTimer = null;
    saveMetrics();
    console.log('[TIMEOUT-MONITOR] Daemon stopped');
  }
}

// ---------------------------------------------------------------------------
// Load previous state from disk
// ---------------------------------------------------------------------------

function loadPreviousState(): void {
  try {
    if (fs.existsSync(METRICS_FILE)) {
      const data = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf-8')) as MonitorState;
      if (data.executions) _records = data.executions;
      if (data.violations) _violations = data.violations;
      if (data.alerts) _alerts = data.alerts;
    }
  } catch {
    /* silent — fresh start */
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printStatus() {
  const m = getPerformanceMetrics();
  console.log(`\n\x1b[36m═══════════════════════════════════════\x1b[0m`);
  console.log(`  \x1b[1mTimeout & Performance Monitor\x1b[0m`);
  console.log(`  Environment: \x1b[33m${getActiveEnvironment()}\x1b[0m`);
  console.log(`\x1b[36m═══════════════════════════════════════\x1b[0m`);
  console.log(`\n  \x1b[1mPerformance Metrics\x1b[0m`);
  console.log(`  Total Executions : ${m.totalExecutions}`);
  console.log(`  Total Violations : ${m.totalViolations}`);
  console.log(`  Violation Rate   : ${(m.violationRate * 100).toFixed(1)}%`);
  console.log(`  Active Alerts    : ${m.activeAlerts}`);
  console.log(`  p95 Latency      : \x1b[33m${m.p95Ms}ms\x1b[0m`);
  console.log(`  p99 Latency      : \x1b[33m${m.p99Ms}ms\x1b[0m`);
  console.log(`  Avg Latency      : ${m.avgMs}ms`);

  if (m.topSlowest.length > 0) {
    console.log(`\n  \x1b[1mTop 10 Slowest Operations\x1b[0m`);
    for (const r of m.topSlowest) {
      const icon = r.violated ? '\x1b[31m⚠\x1b[0m' : ' ';
      console.log(
        `  ${icon} ${r.operation.padEnd(30)} ${r.durationMs}ms (threshold: ${r.timeoutMs}ms)`,
      );
    }
  }

  if (m.activeAlerts > 0) {
    console.log(`\n  \x1b[1mActive Alerts\x1b[0m`);
    for (const a of getActiveAlerts()) {
      const sev =
        a.severity === 'critical' ? '\x1b[31m' : a.severity === 'error' ? '\x1b[33m' : '\x1b[93m';
      console.log(`  ${sev}[${a.severity.toUpperCase()}]\x1b[0m ${a.message}`);
    }
  }
  console.log();
}

function cliMain() {
  const args = process.argv.slice(2);

  if (args.includes('--status') || args.includes('-s')) {
    printStatus();
  } else if (args.includes('--alerts') || args.includes('-a')) {
    const active = getActiveAlerts();
    if (active.length === 0) {
      console.log('\x1b[32m✓ No active alerts\x1b[0m');
    } else {
      console.log(`\n\x1b[33m${active.length} active alert(s):\x1b[0m\n`);
      for (const a of active) {
        console.log(`  [${a.severity.toUpperCase()}] ${a.message}`);
        console.log(`  ${a.id} — ${a.timestamp}`);
        console.log();
      }
    }
  } else if (args.includes('--ack') || args.includes('-k')) {
    const count = acknowledgeAllAlerts();
    console.log(`\x1b[32m✓ ${count} alert(s) acknowledged\x1b[0m`);
  } else if (args.includes('--daemon') || args.includes('-d')) {
    const intervalIdx = args.indexOf('--interval');
    const interval = intervalIdx !== -1 ? parseInt(args[intervalIdx + 1], 10) || 30000 : 30000;
    startMonitorDaemon(interval);
    console.log('[TIMEOUT-MONITOR] Daemon running. Press Ctrl+C to stop.');
  } else {
    // Default: print status
    printStatus();
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

loadPreviousState();

// Auto-run if executed directly
if (
  process.argv[1] &&
  (process.argv[1].endsWith('timeout-monitor.ts') || process.argv[1].endsWith('timeout-monitor.js'))
) {
  cliMain();
}

// Graceful stop
process.on('SIGINT', () => {
  stopMonitorDaemon();
  removeDaemonPidFile();
  saveMetrics();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stopMonitorDaemon();
  removeDaemonPidFile();
  saveMetrics();
});
process.on('exit', () => removeDaemonPidFile());
