#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

interface TraceEntry {
  SpanType?: string;
  Duration?: number;
  Status?: string;
  Name?: string;
  StartTime?: string;
  ErrorMessage?: string;
}

interface DispatchEntry extends TraceEntry {
  Status: string;
  Duration: number;
  Name: string;
}

interface ReportFile {
  Name: string;
  Path: string;
  Created: Date;
  Modified: Date;
  Size: number;
}

function getDateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function loadTraces(tracesDir: string, dateStr: string): TraceEntry[] {
  const allTraces: TraceEntry[] = [];
  const dir = tracesDir;
  if (!existsSync(dir)) return allTraces;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return allTraces;
  }

  for (const entry of entries) {
    if (entry.includes(`-traces-${dateStr}.jsonl`)) {
      const content = readFileSync(join(dir, entry), 'utf-8');
      const lines = content.split(/\r?\n/).filter((l) => l.trim());
      for (const line of lines) {
        try {
          allTraces.push(JSON.parse(line));
        } catch {
          /* skip malformed */
        }
      }
    }
  }
  return allTraces;
}

function loadMetrics(metricsDir: string, dateStr: string): Record<string, unknown>[] {
  const allMetrics: Record<string, unknown>[] = [];
  const dir = metricsDir;
  if (!existsSync(dir)) return allMetrics;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return allMetrics;
  }

  for (const entry of entries) {
    if (entry.includes(`metrics-${dateStr}.json`)) {
      try {
        const data = JSON.parse(readFileSync(join(dir, entry), 'utf-8'));
        if (data.Metrics) allMetrics.push(data.Metrics);
      } catch {
        /* skip malformed */
      }
    }
  }
  return allMetrics;
}

function generateDailyReport(date: Date, outputPath: string, _sessionId?: string): string {
  const dateStr = getDateStr(date);
  const reportDir = resolve(outputPath);
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
  const reportFile = join(reportDir, `daily-summary-${dateStr}.md`);

  const tracesDir = '.telemetry/traces';
  const metricsDir = '.telemetry/metrics';
  const allTraces = loadTraces(tracesDir, dateStr);
  const allMetrics = loadMetrics(metricsDir, dateStr);

  let report = `# Daily Telemetry Report - ${dateStr}

## Executive Summary

- **Report Date**: ${dateStr}
- **Generated**: ${new Date().toISOString()}
- **Total Traces**: ${allTraces.length}
- **Total Metrics**: ${allMetrics.length}

## Trace Statistics

`;

  const tracesByType = new Map<string, TraceEntry[]>();
  for (const t of allTraces) {
    const type = t.SpanType || 'unknown';
    if (!tracesByType.has(type)) tracesByType.set(type, []);
    tracesByType.get(type)!.push(t);
  }

  report += '### Traces by Type\n\n';
  report += '| Type | Count | Avg Duration (ms) |\n';
  report += '|------|-------|-------------------|\n';

  for (const [type, entries] of tracesByType) {
    const avg = entries.reduce((sum, e) => sum + (e.Duration || 0), 0) / entries.length;
    report += `| ${type} | ${entries.length} | ${Math.round(avg * 100) / 100} |\n`;
  }

  const statusBreakdown = new Map<string, number>();
  for (const t of allTraces) {
    const status = t.Status || 'unknown';
    statusBreakdown.set(status, (statusBreakdown.get(status) || 0) + 1);
  }

  report += '\n### Traces by Status\n\n';
  report += '| Status | Count | Percentage |\n';
  report += '|--------|-------|------------|\n';

  for (const [status, count] of statusBreakdown) {
    const pct = allTraces.length > 0 ? Math.round((count / allTraces.length) * 10000) / 100 : 0;
    report += `| ${status} | ${count} | ${pct}% |\n`;
  }

  report += '\n## Performance Metrics\n\n';

  if (allTraces.length > 0) {
    const durations = allTraces.map((t) => t.Duration || 0);
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    const max = Math.max(...durations);
    const min = Math.min(...durations);
    report += `- **Average Span Duration**: ${Math.round(avg * 100) / 100} ms\n`;
    report += `- **Max Span Duration**: ${Math.round(max * 100) / 100} ms\n`;
    report += `- **Min Span Duration**: ${Math.round(min * 100) / 100} ms\n`;
  }

  const errorTraces = allTraces.filter((t) => t.Status === 'error');
  if (errorTraces.length > 0) {
    report += '\n## Error Analysis\n\n';
    report += `- **Total Errors**: ${errorTraces.length}\n`;
    const errorRate = allTraces.length > 0 ? (errorTraces.length / allTraces.length) * 100 : 0;
    report += `- **Error Rate**: ${Math.round(errorRate * 100) / 100}%\n\n`;
    report += '### Error Details\n\n';

    const errorsByName = new Map<string, number>();
    for (const e of errorTraces) {
      const name = e.Name || 'unknown';
      errorsByName.set(name, (errorsByName.get(name) || 0) + 1);
    }
    for (const [name, count] of errorsByName) {
      report += `- **${name}**: ${count} errors\n`;
    }
  }

  report += '\n---\nGenerated by Distributed Tracing System\n';
  writeFileSync(reportFile, report, 'utf-8');
  console.log(`\x1b[32m[REPORT] Daily report generated: ${reportFile}\x1b[0m`);
  return reportFile;
}

function generatePerformanceAnalysis(date: Date, outputPath: string, topN = 10): string {
  const dateStr = getDateStr(date);
  const reportDir = resolve(outputPath);
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
  const reportFile = join(reportDir, `performance-analysis-${dateStr}.md`);

  const tracesDir = '.telemetry/traces';
  const allTraces = loadTraces(tracesDir, dateStr);

  let report = `# Performance Analysis Report - ${dateStr}

## Overview

- **Report Date**: ${dateStr}
- **Generated**: ${new Date().toISOString()}
- **Total Spans Analyzed**: ${allTraces.length}

## Top ${topN} Slowest Operations

`;

  const sorted = [...allTraces]
    .sort((a, b) => (b.Duration || 0) - (a.Duration || 0))
    .slice(0, topN);
  report += '| Rank | Operation | Duration (ms) | Status |\n';
  report += '|------|-----------|---------------|--------|\n';

  for (let i = 0; i < sorted.length; i++) {
    report += `| ${i + 1} | ${sorted[i].Name || 'unknown'} | ${Math.round((sorted[i].Duration || 0) * 100) / 100} | ${sorted[i].Status || 'unknown'} |\n`;
  }

  report += '\n## Throughput Analysis\n\n';
  const successTraces = allTraces.filter((t) => t.Status === 'success');
  const errorTraces = allTraces.filter((t) => t.Status === 'error');
  report += `- **Successful Operations**: ${successTraces.length}\n`;
  report += `- **Failed Operations**: ${errorTraces.length}\n`;
  const successRate = allTraces.length > 0 ? (successTraces.length / allTraces.length) * 100 : 0;
  report += `- **Success Rate**: ${Math.round(successRate * 100) / 100}%\n`;

  report += '\n## Bottleneck Analysis\n\n';
  const nameGroups = new Map<string, { count: number; totalDuration: number }>();
  for (const t of allTraces) {
    const name = t.Name || 'unknown';
    if (!nameGroups.has(name)) nameGroups.set(name, { count: 0, totalDuration: 0 });
    const g = nameGroups.get(name)!;
    g.count++;
    g.totalDuration += t.Duration || 0;
  }

  const bottlenecks = [...nameGroups.entries()]
    .map(([name, g]) => ({ Name: name, Count: g.count, AvgDuration: g.totalDuration / g.count }))
    .sort((a, b) => b.AvgDuration - a.AvgDuration)
    .slice(0, 5);

  report += '| Operation | Frequency | Avg Duration (ms) |\n';
  report += '|-----------|-----------|-------------------|\n';
  for (const b of bottlenecks) {
    report += `| ${b.Name} | ${b.Count} | ${Math.round(b.AvgDuration * 100) / 100} |\n`;
  }

  report += '\n---\nGenerated by Distributed Tracing System\n';
  writeFileSync(reportFile, report, 'utf-8');
  console.log(`\x1b[32m[REPORT] Performance analysis generated: ${reportFile}\x1b[0m`);
  return reportFile;
}

function generateErrorAnalysis(date: Date, outputPath: string): string {
  const dateStr = getDateStr(date);
  const reportDir = resolve(outputPath);
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
  const reportFile = join(reportDir, `error-analysis-${dateStr}.md`);

  const tracesDir = '.telemetry/traces';
  const allTraces = loadTraces(tracesDir, dateStr);
  const errorTraces = allTraces.filter((t) => t.Status === 'error');

  let report = `# Error Analysis Report - ${dateStr}

## Summary

- **Report Date**: ${dateStr}
- **Generated**: ${new Date().toISOString()}
- **Total Errors**: ${errorTraces.length}

`;

  if (errorTraces.length === 0) {
    report += '**Status**: No errors detected\n';
  } else {
    report += '## Errors by Operation Type\n\n';
    const errorsByType = new Map<string, number>();
    for (const e of errorTraces) {
      const type = e.SpanType || 'unknown';
      errorsByType.set(type, (errorsByType.get(type) || 0) + 1);
    }
    report += '| Type | Count |\n|------|-------|\n';
    for (const [type, count] of errorsByType) {
      report += `| ${type} | ${count} |\n`;
    }

    report += '\n## Errors by Operation\n\n';
    const errorsByName = new Map<string, number>();
    for (const e of errorTraces) {
      const name = e.Name || 'unknown';
      errorsByName.set(name, (errorsByName.get(name) || 0) + 1);
    }
    const sortedByName = [...errorsByName.entries()].sort((a, b) => b[1] - a[1]);
    report += '| Operation | Count |\n|-----------|-------|\n';
    for (const [name, count] of sortedByName) {
      report += `| ${name} | ${count} |\n`;
    }

    report += '\n## Error Details\n\n';
    for (const error of errorTraces.slice(0, 20)) {
      report += `### ${error.Name || 'unknown'}\n`;
      report += `- **Time**: ${error.StartTime || 'unknown'}\n`;
      report += `- **Duration**: ${Math.round((error.Duration || 0) * 100) / 100} ms\n`;
      if (error.ErrorMessage) report += `- **Message**: ${error.ErrorMessage}\n`;
      report += '\n';
    }
  }

  report += '\n---\nGenerated by Distributed Tracing System\n';
  writeFileSync(reportFile, report, 'utf-8');
  console.log(`\x1b[32m[REPORT] Error analysis generated: ${reportFile}\x1b[0m`);
  return reportFile;
}

function generateDispatchMetricsReport(date: Date, outputPath: string): string {
  const dateStr = getDateStr(date);
  const reportDir = resolve(outputPath);
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
  const reportFile = join(reportDir, `dispatch-metrics-${dateStr}.md`);

  const tracesDir = '.telemetry/traces';
  const dispatchTraces: DispatchEntry[] = [];

  const dispatchFile = join(tracesDir, `dispatch-traces-${dateStr}.jsonl`);
  if (existsSync(dispatchFile)) {
    const content = readFileSync(dispatchFile, 'utf-8');
    const lines = content.split(/\r?\n/).filter((l) => l.trim());
    for (const line of lines) {
      try {
        dispatchTraces.push(JSON.parse(line));
      } catch {
        /* skip malformed */
      }
    }
  }

  let report = `# Dispatch Metrics Report - ${dateStr}

## Summary

- **Report Date**: ${dateStr}
- **Generated**: ${new Date().toISOString()}
- **Total Dispatches**: ${dispatchTraces.length}

`;

  if (dispatchTraces.length > 0) {
    const successCount = dispatchTraces.filter((d) => d.Status === 'success').length;
    const errorCount = dispatchTraces.filter((d) => d.Status === 'error').length;
    const avgDuration =
      dispatchTraces.reduce((sum, d) => sum + (d.Duration || 0), 0) / dispatchTraces.length;

    report += `- **Successful Dispatches**: ${successCount}\n`;
    report += `- **Failed Dispatches**: ${errorCount}\n`;
    report += `- **Success Rate**: ${Math.round((successCount / dispatchTraces.length) * 10000) / 100}%\n`;
    report += `- **Average Duration**: ${Math.round(avgDuration * 100) / 100} ms\n\n`;

    report += '## Dispatch Breakdown\n\n';
    const dispatchByName = new Map<string, DispatchEntry[]>();
    for (const d of dispatchTraces) {
      const name = d.Name || 'unknown';
      if (!dispatchByName.has(name)) dispatchByName.set(name, []);
      dispatchByName.get(name)!.push(d);
    }

    report += '| Dispatch Type | Count | Avg Duration (ms) | Success Rate |\n';
    report += '|---------------|-------|-------------------|--------------|\n';
    for (const [name, entries] of dispatchByName) {
      const avg = entries.reduce((sum, e) => sum + e.Duration, 0) / entries.length;
      const groupSuccess = entries.filter((e) => e.Status === 'success').length;
      const groupRate = Math.round((groupSuccess / entries.length) * 10000) / 100;
      report += `| ${name} | ${entries.length} | ${Math.round(avg * 100) / 100} | ${groupRate}% |\n`;
    }
  }

  report += '\n---\nGenerated by Distributed Tracing System\n';
  writeFileSync(reportFile, report, 'utf-8');
  console.log(`\x1b[32m[REPORT] Dispatch metrics report generated: ${reportFile}\x1b[0m`);
  return reportFile;
}

function generateAllReports(date: Date, outputPath: string): string[] {
  console.log(`\x1b[36m[REPORT] Generating all reports for ${getDateStr(date)}...\x1b[0m`);
  const reports: string[] = [];
  reports.push(generateDailyReport(date, outputPath));
  reports.push(generatePerformanceAnalysis(date, outputPath));
  reports.push(generateErrorAnalysis(date, outputPath));
  reports.push(generateDispatchMetricsReport(date, outputPath));
  console.log(`\x1b[32m[REPORT] All reports generated successfully\x1b[0m`);
  return reports;
}

function getReportIndex(outputPath: string): ReportFile[] {
  const reports: ReportFile[] = [];
  const dir = resolve(outputPath);
  if (existsSync(dir)) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return reports;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue;
      const full = join(dir, entry);
      try {
        const s = statSync(full);
        reports.push({
          Name: entry,
          Path: full,
          Created: s.birthtime,
          Modified: s.mtime,
          Size: s.size,
        });
      } catch {
        /* */
      }
    }
  }
  reports.sort((a, b) => b.Modified.getTime() - a.Modified.getTime());
  return reports;
}

function showReportIndex(outputPath: string): void {
  const reports = getReportIndex(outputPath);
  console.log(`\n\x1b[36m=== Available Reports ===\x1b[0m`);
  console.log(`\x1b[90mLocation: ${outputPath}\x1b[0m\n`);

  if (reports.length === 0) {
    console.log('\x1b[33mNo reports found.\x1b[0m');
  } else {
    for (const r of reports) {
      const modified = r.Modified.toISOString().slice(0, 19).replace('T', ' ');
      const sizeKB = Math.round((r.Size / 1024) * 100) / 100;
      console.log(`  ${r.Name.padEnd(50)} ${modified}  ${sizeKB} KB`);
    }
  }
  console.log('');
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: report-generator.ts <action> [options]');
    console.log('Actions: daily, performance, errors, dispatch, all, index, show');
    process.exit(0);
  }

  const action = args[0];
  let date = new Date();
  let outputPath = '.telemetry/reports';
  let topN = 10;
  let sessionId: string | undefined;

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case '--date':
        date = new Date(args[++i]);
        break;
      case '--output':
        outputPath = args[++i];
        break;
      case '--top':
        topN = parseInt(args[++i], 10);
        break;
      case '--session':
        sessionId = args[++i];
        break;
    }
  }

  switch (action) {
    case 'daily':
      generateDailyReport(date, outputPath, sessionId);
      break;
    case 'performance':
      generatePerformanceAnalysis(date, outputPath, topN);
      break;
    case 'errors':
      generateErrorAnalysis(date, outputPath);
      break;
    case 'dispatch':
      generateDispatchMetricsReport(date, outputPath);
      break;
    case 'all':
      generateAllReports(date, outputPath);
      break;
    case 'index':
      console.log(JSON.stringify(getReportIndex(outputPath), null, 2));
      break;
    case 'show':
      showReportIndex(outputPath);
      break;
    default:
      console.error(`Unknown action: ${action}`);
      process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
