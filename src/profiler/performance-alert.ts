#!/usr/bin/env node
/**
 * Performance Alert System
 * Monitors performance metrics and generates alerts on regression
 * Fully native, no external dependencies
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { join, resolve } from 'path';

interface PerformanceAlert {
  id: string;
  timestamp: string;
  type: 'REGRESSION' | 'IMPROVEMENT' | 'STABLE';
  metric: string;
  currentValue: number;
  baselineValue: number;
  deltaPct: number;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  message: string;
  acknowledged: boolean;
}

const ALERT_DIR = join(resolve(process.cwd()), '.runtime', 'alerts');
const ALERT_LOG = join(ALERT_DIR, 'performance-alerts.jsonl');

// Severity thresholds
const THRESHOLDS = {
  CRITICAL: 50, // >50% regression
  WARNING: 20, // >20% regression
  INFO: 10, // >10% regression
};

function ensureDirs(): void {
  mkdirSync(ALERT_DIR, { recursive: true });
}

function loadBaseline(): Record<string, { duration_ms: number }> | null {
  const baselinePath = join(resolve(process.cwd()), '.runtime', 'profiler', 'baseline.json');
  if (!existsSync(baselinePath)) return null;

  try {
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf-8'));
    return baseline.benchmarks;
  } catch {
    return null;
  }
}

function loadCurrentResults(): Record<string, { duration_ms: number }> | null {
  const resultsPath = join(resolve(process.cwd()), '.runtime', 'profiler', 'results.jsonl');
  if (!existsSync(resultsPath)) return null;

  try {
    const lines = readFileSync(resultsPath, 'utf-8')
      .split('\n')
      .filter((l) => l.trim());
    const results: Record<string, { duration_ms: number }> = {};

    for (const line of lines.slice(-5)) {
      // Last 5 entries
      try {
        const result = JSON.parse(line);
        results[result.name] = { duration_ms: result.duration_ms };
      } catch {
        // Skip invalid lines
      }
    }

    return results;
  } catch {
    return null;
  }
}

function calculateSeverity(deltaPct: number): 'CRITICAL' | 'WARNING' | 'INFO' {
  const absDelta = Math.abs(deltaPct);
  if (absDelta >= THRESHOLDS.CRITICAL) return 'CRITICAL';
  if (absDelta >= THRESHOLDS.WARNING) return 'WARNING';
  if (absDelta >= THRESHOLDS.INFO) return 'INFO';
  return 'INFO';
}

function generateAlert(metric: string, current: number, baseline: number): PerformanceAlert | null {
  const delta = ((current - baseline) / baseline) * 100;
  const absDelta = Math.abs(delta);

  // Only alert on significant changes (>10%)
  if (absDelta < THRESHOLDS.INFO) return null;

  const severity = calculateSeverity(delta);
  const type = delta > 0 ? 'REGRESSION' : 'IMPROVEMENT';

  const id = `perf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  return {
    id,
    timestamp: new Date().toISOString(),
    type,
    metric,
    currentValue: current,
    baselineValue: baseline,
    deltaPct: Math.round(delta * 100) / 100,
    severity,
    message: `${metric}: ${type} detected (${delta > 0 ? '+' : ''}${delta.toFixed(1)}%)`,
    acknowledged: false,
  };
}

function saveAlert(alert: PerformanceAlert): void {
  ensureDirs();
  appendFileSync(ALERT_LOG, JSON.stringify(alert) + '\n', 'utf-8');
}

function loadActiveAlerts(): PerformanceAlert[] {
  if (!existsSync(ALERT_LOG)) return [];

  const lines = readFileSync(ALERT_LOG, 'utf-8')
    .split('\n')
    .filter((l) => l.trim());

  return lines
    .map((line) => {
      try {
        return JSON.parse(line) as PerformanceAlert;
      } catch {
        return null;
      }
    })
    .filter((a): a is PerformanceAlert => a !== null && !a.acknowledged);
}

// Check performance and generate alerts
export function checkPerformance(): PerformanceAlert[] {
  const baseline = loadBaseline();
  const current = loadCurrentResults();

  if (!baseline || !current) {
    console.log('❌ No baseline or current results found');
    console.log('   Run: npm run perf:baseline && npm run perf:run');
    return [];
  }

  const alerts: PerformanceAlert[] = [];

  console.log('\n=== Performance Alert Check ===\n');

  for (const [metric, baselineData] of Object.entries(baseline)) {
    const currentData = current[metric];

    if (!currentData) {
      console.log(`⚠️  ${metric}: No current data`);
      continue;
    }

    const alert = generateAlert(metric, currentData.duration_ms, baselineData.duration_ms);

    if (alert) {
      alerts.push(alert);
      saveAlert(alert);

      const icon = alert.type === 'REGRESSION' ? '🔴' : '🟢';
      console.log(`${icon} ${alert.message}`);
      console.log(`   Current: ${currentData.duration_ms.toFixed(2)}ms`);
      console.log(`   Baseline: ${baselineData.duration_ms.toFixed(2)}ms`);
      console.log(`   Severity: ${alert.severity}`);
      console.log();
    } else {
      const delta =
        ((currentData.duration_ms - baselineData.duration_ms) / baselineData.duration_ms) * 100;
      console.log(`✅ ${metric}: Stable (${delta > 0 ? '+' : ''}${delta.toFixed(1)}%)`);
    }
  }

  // Summary
  const critical = alerts.filter((a) => a.severity === 'CRITICAL').length;
  const warnings = alerts.filter((a) => a.severity === 'WARNING').length;
  const info = alerts.filter((a) => a.severity === 'INFO').length;

  console.log('=== Summary ===');
  console.log(`Total alerts: ${alerts.length}`);
  if (critical > 0) console.log(`🔴 Critical: ${critical}`);
  if (warnings > 0) console.log(`🟡 Warnings: ${warnings}`);
  if (info > 0) console.log(`ℹ️  Info: ${info}`);
  if (alerts.length === 0) console.log('✅ No performance alerts');

  return alerts;
}

// Acknowledge alerts
export function acknowledgeAlert(alertId?: string): void {
  ensureDirs();

  if (!existsSync(ALERT_LOG)) {
    console.log('No alerts to acknowledge');
    return;
  }

  const lines = readFileSync(ALERT_LOG, 'utf-8')
    .split('\n')
    .filter((l) => l.trim());
  const updated: string[] = [];
  let acknowledged = 0;

  for (const line of lines) {
    try {
      const alert = JSON.parse(line) as PerformanceAlert;

      if (!alert.acknowledged && (!alertId || alert.id === alertId)) {
        alert.acknowledged = true;
        acknowledged++;
      }

      updated.push(JSON.stringify(alert));
    } catch {
      updated.push(line);
    }
  }

  writeFileSync(ALERT_LOG, updated.join('\n') + '\n', 'utf-8');
  console.log(`✅ Acknowledged ${acknowledged} alert(s)`);
}

// Show active alerts
export function showActiveAlerts(): void {
  const alerts = loadActiveAlerts();

  console.log('\n=== Active Performance Alerts ===\n');

  if (alerts.length === 0) {
    console.log('✅ No active alerts');
    return;
  }

  const bySeverity = {
    CRITICAL: alerts.filter((a) => a.severity === 'CRITICAL'),
    WARNING: alerts.filter((a) => a.severity === 'WARNING'),
    INFO: alerts.filter((a) => a.severity === 'INFO'),
  };

  for (const [severity, sevAlerts] of Object.entries(bySeverity)) {
    if (sevAlerts.length === 0) continue;

    console.log(`${severity} (${sevAlerts.length}):`);
    for (const alert of sevAlerts) {
      console.log(`  • ${alert.metric}: ${alert.deltaPct > 0 ? '+' : ''}${alert.deltaPct}%`);
      console.log(`    ${alert.message}`);
      console.log(`    ID: ${alert.id}`);
    }
    console.log();
  }
}

// CLI
if (process.argv[1]?.includes('performance-alert.ts')) {
  const command = process.argv[2];

  switch (command) {
    case 'check':
      checkPerformance();
      break;
    case 'ack':
      acknowledgeAlert(process.argv[3]);
      break;
    case 'status':
      showActiveAlerts();
      break;
    default:
      console.log('Performance Alert System\n');
      console.log('Usage:');
      console.log('  npx tsx src/profiler/performance-alert.ts [command]\n');
      console.log('Commands:');
      console.log('  check          - Check performance and generate alerts');
      console.log('  ack [alertId]  - Acknowledge alert(s)');
      console.log('  status         - Show active alerts');
      process.exit(1);
  }
}
