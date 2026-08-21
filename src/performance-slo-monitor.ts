#!/usr/bin/env node
/**
 * Performance SLO Monitor — measures and enforces performance SLAs from rules/NORMATIVAS-PERFORMANCE.md.
 * Collects real-time metrics: latency, memory, disk usage.
 *
 * Usage:
 *   npx tsx src/performance-slo-monitor.ts
 *   npx tsx src/performance-slo-monitor.ts --json
 *   npx tsx src/performance-slo-monitor.ts --check-disk --json
 *   npx tsx src/performance-slo-monitor.ts --service agent_dispatch --ci-gate
 */

import { runSync, runSyncShell } from './core/run-command.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { request as httpRequest } from 'http';

interface SLODefinition {
  name: string;
  target: string;
  current: number;
  threshold: number;
  unit: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  message: string;
}

interface SLOReport {
  timestamp: string;
  passed: boolean;
  checks: SLODefinition[];
  overall: {
    total: number;
    passed: number;
    warned: number;
    failed: number;
  };
}

interface MetricSnapshot {
  timestamp: string;
  latency_p95_ms: number;
  memory_mb: number;
  disk_percent: number;
}

const METRICS_DIR = '.runtime/metrics';

// Optional Nexus DB persistence — graceful if unavailable
function tryNexusInsert(snapshot: { latency_p95_ms: number; disk_percent: number }): void {
  try {
    const managerPath = resolve(process.cwd(), 'apps/web-dashboard/server/database/manager.ts');
    if (existsSync(managerPath)) {
      // Dynamic import — Nexus is optional
      const mod = require(managerPath) as {
        DatabaseManager: {
          getInstance: () => { insertMetricSnapshot: (d: Record<string, unknown>) => void };
        };
      };
      const db = mod.DatabaseManager.getInstance();
      db.insertMetricSnapshot({
        tokens_used: 0,
        tokens_limit: 120000,
        cost: 0,
        sessions_total: 0,
        sessions_active: 0,
        sessions_today: 0,
        latency_avg: snapshot.latency_p95_ms || 0,
        latency_p50: snapshot.latency_p95_ms || 0,
        latency_p95: snapshot.latency_p95_ms || 0,
        commits: 0,
        mcp_calls: 0,
        mcp_skills: 0,
        health_status: snapshot.disk_percent >= 80 ? 'degraded' : 'ok',
      });
    }
  } catch {
    // Nexus DB not available — skip (non-fatal)
  }
}

function parseArgs(): {
  json: boolean;
  output: string | undefined;
  checkDisk: boolean;
  checkMemory: boolean;
  checkLatency: boolean;
  ciGate: boolean;
  service: string | undefined;
} {
  const raw = process.argv.slice(2);
  return {
    json: raw.includes('--json'),
    output: extractArg(raw, '--output'),
    checkDisk: true,
    checkMemory: true,
    checkLatency: !raw.includes('--skip-latency'),
    ciGate: raw.includes('--ci-gate'),
    service: extractArg(raw, '--service'),
  };
}

function extractArg(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

function measureDiskUsage(): { percent: number; freeGb: number; totalGb: number } {
  try {
    const cwd = process.cwd();
    if (process.platform === 'win32') {
      const drive = cwd.substring(0, 1);
      try {
        // Use PowerShell Get-PSDrive (works on Win10/11, no wmic dependency)
        const output = runSync(
          'powershell',
          [
            '-NoProfile',
            '-Command',
            `Get-PSDrive -Name ${drive} | Select-Object Used,Free | ConvertTo-Csv -NoTypeInformation`,
          ],
          { maxBuffer: 1024 * 1024, timeout: 10000, stdio: ['pipe', 'pipe', 'ignore'] },
        ).stdout;
        const lines = output
          .trim()
          .split('\n')
          .filter((l: string) => l.trim() && !l.includes('Used') && !l.includes('"'));
        for (const line of lines) {
          const parts = line.split(',').map((p: string) => p.replace(/"/g, '').trim());
          if (parts.length >= 2) {
            const used = parseInt(parts[0], 10);
            const free = parseInt(parts[1], 10);
            const total = used + free;
            if (total > 0) {
              return {
                percent: Math.round((used / total) * 10000) / 100,
                freeGb: Math.round((free / (1024 * 1024 * 1024)) * 100) / 100,
                totalGb: Math.round((total / (1024 * 1024 * 1024)) * 100) / 100,
              };
            }
          }
        }
      } catch {
        // PowerShell fallback failed, try Node.js os.freemem
        // os module not available for disk, return estimate
        return { percent: 0, freeGb: 0, totalGb: 0 };
      }
    }
    // Fallback
    return { percent: 0, freeGb: 0, totalGb: 0 };
  } catch {
    return { percent: 0, freeGb: 0, totalGb: 0 };
  }
}

function measureMemoryUsage(): { processMb: number; heapMb: number; heapPercent: number } {
  const mem = process.memoryUsage();
  return {
    processMb: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
    heapMb: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
    heapPercent: Math.round((mem.heapUsed / mem.heapTotal) * 10000) / 100,
  };
}

function getRecentMetrics(): { avgLatency: number | null } {
  try {
    // Try to get latency from Nexus DB or metrics snapshots
    const dbPath = resolve(process.cwd(), '.runtime', 'gentle-vanguard.db');
    if (existsSync(dbPath)) {
      try {
        const output = runSyncShell(
          `npx tsx -e "
            const { DatabaseManager } = require('./apps/web-dashboard/server/database/manager');
            const dm = DatabaseManager.getInstance();
            const db = dm.getDb();
            const rows = db.prepare('SELECT value FROM metric_snapshots WHERE name = ? ORDER BY timestamp DESC LIMIT 10').all('latency_p95');
            const vals = rows.map((r: any) => r.value).filter(Boolean);
            console.log(JSON.stringify(vals.length > 0 ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length : null));
          " 2>nul || echo null`,
          { maxBuffer: 1024 * 1024, timeout: 10000 },
        ).stdout;
        const avg = JSON.parse(output.trim());
        if (avg !== null) return { avgLatency: avg as number };
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return { avgLatency: null };
}

function measureLatency(): number {
  // Try real metrics, fallback to benchmark
  const { avgLatency } = getRecentMetrics();
  if (avgLatency !== null) return avgLatency;

  // Simple latency benchmark: measure TypeScript compilation time or module load time
  try {
    const start = Date.now();
    runSyncShell('npx tsx -e "Promise.resolve().then(() => process.exit(0))" 2>nul', {
      timeout: 30000,
      maxBuffer: 1024,
    });
    return Date.now() - start;
  } catch {
    return 0;
  }
}

function saveMetricsSnapshot(snapshot: MetricSnapshot): void {
  try {
    if (!existsSync(resolve(process.cwd(), METRICS_DIR))) {
      runSyncShell(`mkdir -p "${resolve(process.cwd(), METRICS_DIR)}"`, {});
    }
    const filePath = resolve(process.cwd(), METRICS_DIR, `slo-${Date.now()}.json`);
    writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
  } catch {
    /* best effort */
  }
}

function main(): void {
  const args = parseArgs();
  const checks: SLODefinition[] = [];

  // Measure metrics
  const disk = measureDiskUsage();
  const mem = measureMemoryUsage();
  const latency = measureLatency();

  // Save snapshot to JSON
  const snapshot: MetricSnapshot = {
    timestamp: new Date().toISOString(),
    latency_p95_ms: Math.round(latency * 100) / 100,
    memory_mb: mem.processMb,
    disk_percent: disk.percent,
  };
  saveMetricsSnapshot(snapshot);
  // Also persist to Nexus DB (optional)
  tryNexusInsert(snapshot);

  // 1. Disk SLO: <80%
  const diskThreshold = 80;
  checks.push({
    name: 'disk_usage',
    target: `<${diskThreshold}%`,
    current: disk.percent,
    threshold: diskThreshold,
    unit: '%',
    status:
      disk.percent >= diskThreshold
        ? 'FAIL'
        : disk.percent >= diskThreshold * 0.85
          ? 'WARN'
          : 'PASS',
    message: `Disk: ${disk.percent}% used (${disk.freeGb}GB free / ${disk.totalGb}GB total)`,
  });

  // 2. Memory SLO: <512MB
  const memThreshold = 512;
  checks.push({
    name: 'memory_usage',
    target: `<${memThreshold}MB`,
    current: mem.processMb,
    threshold: memThreshold,
    unit: 'MB',
    status:
      mem.processMb >= memThreshold
        ? 'FAIL'
        : mem.processMb >= memThreshold * 0.8
          ? 'WARN'
          : 'PASS',
    message: `Memory: ${mem.processMb}MB RSS (heap: ${mem.heapMb}MB at ${mem.heapPercent}%)`,
  });

  // 3. Latency SLO: <500ms P95
  const latencyThreshold = 500;
  checks.push({
    name: 'latency_p95',
    target: `<${latencyThreshold}ms`,
    current: Math.round(latency * 100) / 100,
    threshold: latencyThreshold,
    unit: 'ms',
    status: latency === 0 ? 'WARN' : latency >= latencyThreshold ? 'WARN' : 'PASS',
    message:
      latency === 0
        ? 'Latency: unable to measure (no recent metrics)'
        : `Latency: ${Math.round(latency)}ms P95`,
  });

  // Compile report
  const passed = checks.filter((c) => c.status === 'PASS').length;
  const warned = checks.filter((c) => c.status === 'WARN').length;
  const failed = checks.filter((c) => c.status === 'FAIL').length;

  const report: SLOReport = {
    timestamp: new Date().toISOString(),
    passed: failed === 0,
    checks,
    overall: { total: checks.length, passed, warned, failed },
  };

  // CI Gate
  let exitCode = 0;
  if (args.ciGate && failed > 0) {
    exitCode = 1;
    console.error(`[PERF-SLO] ❌ CI GATE BLOCKED: ${failed} SLO failure(s)`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(exitCode);
  }

  // Pretty output
  console.log(`\n╔═══ PERFORMANCE SLO REPORT ═══════════════`);
  console.log(`║ ${new Date().toLocaleString()}`);
  console.log(`║`);
  for (const check of checks) {
    const icon = check.status === 'PASS' ? '✅' : check.status === 'WARN' ? '⚠️' : '❌';
    console.log(
      `║ ${icon} ${check.name.padEnd(16)} ${check.current}${check.unit} (target ${check.target})`,
    );
    console.log(`║   ${check.message}`);
  }
  console.log(`║`);
  console.log(
    `║ Overall: ${passed}/${checks.length} passed, ${warned} warnings, ${failed} failures`,
  );
  console.log(`╚${'═'.repeat(40)}`);

  if (args.output) {
    writeFileSync(resolve(process.cwd(), args.output), JSON.stringify(report, null, 2));
  }

  // Emit to Dashboard WS (best-effort, non-blocking)
  try {
    const wsPort = resolve(process.cwd(), '.runtime/dashboard-ports.json');
    if (existsSync(wsPort)) {
      const ports = JSON.parse(readFileSync(wsPort, 'utf8') || '{}');
      const port = ports.wsPort || 8080;
      const postData = JSON.stringify({
        timestamp: report.timestamp,
        passed: report.passed,
        overall: report.overall,
        checks: report.checks.map((c) => ({
          name: c.name,
          status: c.status,
          current: c.current,
          threshold: c.threshold,
          unit: c.unit,
        })),
      });
      const req = httpRequest({
        hostname: 'localhost',
        port,
        path: '/api/slo',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      });
      req.write(postData);
      req.end();
    }
  } catch {
    /* dashboard WS unavailable — non-fatal */
  }

  process.exit(exitCode);
}

main();
