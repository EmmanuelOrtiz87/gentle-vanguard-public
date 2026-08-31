#!/usr/bin/env node
/**
 * Post-Mortem Trigger — runs automated analysis after watchtower auto-heal events.
 * Logs incidents to audit pipeline, captures system state, and triggers self-diagnosis.
 *
 * Usage:
 *   npx tsx src/post-mortem-trigger.ts                    # Standard run
 *   npx tsx src/post-mortem-trigger.ts --after-heal       # Called after watchtower auto-heal
 *   npx tsx src/post-mortem-trigger.ts --json              # JSON output
 *   npx tsx src/post-mortem-trigger.ts --incident "DB down" --severity critical
 */

import { runSync } from '../core/run-command.js';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';
import { pathToFileURL } from 'url';

export interface PostMortemResult {
  timestamp: string;
  trigger: 'auto-heal' | 'manual' | 'scheduled';
  incident?: string;
  severity: 'info' | 'warning' | 'critical';
  diagnosis: {
    state: string;
    profile: string;
    turnCount: number;
    recommendations: string[];
  };
  healResults: HealEntry[];
  systemState: SystemState;
  nexusRecorded: boolean;
  auditLogged: boolean;
}

interface HealEntry {
  component: string;
  action: string;
  status: string;
  message: string;
}

interface SystemState {
  memory: { processMb: number; heapMb: number };
  uptime: number;
  nodeVersion: string;
  platform: string;
  recentErrors: string[];
}

const POSTMORTEM_DIR = '.runtime/post-mortem';
const INCIDENTS_FILE = '.runtime/incidents.jsonl';
const MAX_RECENT_ERRORS = 5;

function parseArgs(): {
  trigger: 'auto-heal' | 'manual' | 'scheduled';
  incident: string;
  severity: string;
  json: boolean;
  afterHeal: boolean;
} {
  const raw = process.argv.slice(2);
  const triggerVal: 'auto-heal' | 'manual' = raw.includes('--after-heal') ? 'auto-heal' : 'manual';
  return {
    trigger: triggerVal,
    incident: extractArg(raw, '--incident') || '',
    severity: extractArg(raw, '--severity') || 'warning',
    json: raw.includes('--json'),
    afterHeal: raw.includes('--after-heal'),
  };
}

function extractArg(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

function runSelfDiagnosis(): Record<string, unknown> {
  try {
    const result = runSync(
      process.execPath,
      [
        '--experimental-specifier-resolution=node',
        '--loader',
        'tsx',
        resolve(process.cwd(), 'src/self-diagnosis.ts'),
        '--json',
      ],
      { timeout: 15000 },
    );
    if (result.status === 0) {
      return JSON.parse(result.stdout);
    }
  } catch {
    /* fallback */
  }
  return { state: 'UNKNOWN', recommendations: ['Self-diagnosis failed'] };
}

function readHealResults(): HealEntry[] {
  try {
    // Read watchtower results from runtime
    const wtDir = resolve(process.cwd(), '.runtime');
    if (existsSync(wtDir)) {
      const files = readdirSync(wtDir).filter(
        (f: string) => f.startsWith('watchtower-') && f.endsWith('.json'),
      );
      if (files.length > 0) {
        const latest = files.sort().reverse()[0];
        const data = JSON.parse(readFileSync(join(wtDir, latest), 'utf8'));
        return data.results || data.checks || [];
      }
    }
  } catch {
    /* no results */
  }
  return [];
}

function getSystemState(): SystemState {
  const mem = process.memoryUsage();
  const recentErrors: string[] = [];

  // Check recent error logs
  try {
    const logDir = resolve(process.cwd(), '.runtime/errors');
    if (existsSync(logDir)) {
      const files = readdirSync(logDir)
        .filter((f: string) => f.endsWith('.log'))
        .sort()
        .reverse()
        .slice(0, 3);
      for (const f of files) {
        const content = readFileSync(join(logDir, f), 'utf8');
        const lines = content
          .split('\n')
          .filter((l) => l.includes('[ERROR]'))
          .slice(0, MAX_RECENT_ERRORS);
        recentErrors.push(...lines);
      }
    }
  } catch {
    /* no errors dir */
  }

  return {
    memory: {
      processMb: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
      heapMb: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
    },
    uptime: Math.round(process.uptime()),
    nodeVersion: process.version,
    platform: process.platform,
    recentErrors,
  };
}

function recordToNexus(result: PostMortemResult): boolean {
  try {
    const managerPath = resolve(process.cwd(), 'apps/web-dashboard/server/database/manager.ts');
    if (existsSync(managerPath)) {
      const mod = require(managerPath) as {
        DatabaseManager: {
          getInstance: () => { insertMetricSnapshot: (d: Record<string, unknown>) => void };
        };
      };
      const db = mod.DatabaseManager.getInstance();
      db.insertMetricSnapshot({
        tokens_used: 0,
        latency_avg: 0,
        latency_p95: 0,
        health_status:
          result.severity === 'critical' ? 'degraded' : result.diagnosis.state.toLowerCase(),
        mcp_calls: result.healResults.length,
      });
      return true;
    }
  } catch {
    /* Nexus unavailable */
  }
  return false;
}

function logToAudit(result: PostMortemResult): boolean {
  try {
    const auditDir = resolve(process.cwd(), '.session/audit/logs');
    mkdirSync(auditDir, { recursive: true });
    const today = new Date().toISOString().split('T')[0];
    const auditFile = join(auditDir, `audit-${today}.jsonl`);

    const entry = {
      timestamp: result.timestamp,
      type: 'post-mortem',
      trigger: result.trigger,
      severity: result.severity,
      diagnosis: result.diagnosis.state,
      healedCount: result.healResults.filter((h) => h.status === 'PASS').length,
      failedCount: result.healResults.filter((h) => h.status !== 'PASS').length,
    };
    writeFileSync(auditFile, JSON.stringify(entry) + '\n', { flag: 'a' });
    return true;
  } catch {
    /* audit unavailable */
  }
  return false;
}

function recordIncident(result: PostMortemResult): void {
  if (result.severity !== 'critical') return;
  try {
    const filePath = resolve(process.cwd(), INCIDENTS_FILE);
    mkdirSync(resolve(process.cwd(), '.runtime'), { recursive: true });
    const entry = {
      timestamp: result.timestamp,
      type: 'incident',
      severity: 'critical',
      diagnosis: result.diagnosis.state,
      healResults: result.healResults.filter((h) => h.status !== 'PASS'),
      incident: result.incident || 'Unspecified auto-heal failure',
    };
    writeFileSync(filePath, JSON.stringify(entry) + '\n', { flag: 'a' });
  } catch {
    /* ignore */
  }
}

/** Library entry: build the post-mortem result without process-level side effects. */
export function runPostMortem(
  overrides: {
    trigger?: 'auto-heal' | 'manual' | 'scheduled';
    incident?: string;
  } = {},
  options: { json?: boolean; exit?: boolean } = {},
): PostMortemResult {
  const args = { ...parseArgs(), ...overrides };

  const healResults = readHealResults();
  const diagnosis = runSelfDiagnosis();
  const systemState = getSystemState();

  const failedHeals = healResults.filter((h) => h.status !== 'PASS');
  const severity: PostMortemResult['severity'] =
    args.severity === 'critical'
      ? 'critical'
      : failedHeals.length > 0 || String(diagnosis.state || '') === 'STUCK'
        ? 'warning'
        : 'info';

  // Build result object first (no circular refs)
  const result: PostMortemResult = {
    timestamp: new Date().toISOString(),
    trigger: args.trigger,
    incident: args.incident || undefined,
    severity,
    diagnosis: {
      state: String(diagnosis.state || 'UNKNOWN'),
      profile: String(diagnosis.profile || 'ultra'),
      turnCount: Number(diagnosis.turnCount || 0),
      recommendations: (diagnosis.recommendations as string[]) || [],
    },
    healResults,
    systemState,
    nexusRecorded: false,
    auditLogged: false,
  };

  // Record to Nexus and audit (result already fully defined)
  result.nexusRecorded = recordToNexus(result);
  result.auditLogged = logToAudit(result);

  // Record incident for critical failures
  if (result.severity === 'critical') {
    recordIncident(result);
  }

  // Save report
  const reportDir = resolve(process.cwd(), POSTMORTEM_DIR);
  mkdirSync(reportDir, { recursive: true });
  const reportFile = join(reportDir, `post-mortem-${Date.now()}.json`);
  writeFileSync(reportFile, JSON.stringify(result, null, 2));

  if (options.json || args.json) {
    console.log(JSON.stringify(result, null, 2));
    if (options.exit !== false) {
      process.exit(result.severity === 'critical' ? 2 : result.severity === 'warning' ? 1 : 0);
    }
    return result;
  }

  // Pretty output
  const icon = result.severity === 'critical' ? '🛑' : result.severity === 'warning' ? '⚠️' : '✅';
  console.log(`\n${icon} Post-Mortem Report [${result.trigger}]`);
  console.log(`  Severity: ${result.severity}`);
  console.log(`  Diagnosis: ${result.diagnosis.state}`);
  console.log(`  Heal Results: ${healResults.length} total, ${failedHeals.length} failed`);
  console.log(
    `  System: ${result.systemState.memory.processMb}MB RSS, up ${Math.floor(result.systemState.uptime / 60)}m`,
  );
  console.log(
    `  Nexus: ${result.nexusRecorded ? '✅' : '❌'} | Audit: ${result.auditLogged ? '✅' : '❌'}`,
  );
  console.log(`  Report: ${reportFile}`);

  if (failedHeals.length > 0) {
    console.error(`\n  Failed Heals:`);
    for (const h of failedHeals) {
      console.error(`    ❌ ${h.component}: ${h.message}`);
    }
  }

  if (result.diagnosis.recommendations.length > 0) {
    console.log(`\n  Recommendations:`);
    for (const r of result.diagnosis.recommendations) {
      console.log(`    → ${r}`);
    }
  }

  return result;
}

// CLI entry — guard keeps imports side-effect free when loaded as a library.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

function main(): void {
  const result = runPostMortem();
  process.exit(result.severity === 'critical' ? 2 : result.severity === 'warning' ? 1 : 0);
}
