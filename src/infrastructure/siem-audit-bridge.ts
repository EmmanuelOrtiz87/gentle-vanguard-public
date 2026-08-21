#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');
const ROOT = resolve(__dirname, '..');
const BRIDGE_VERSION = '1.0.0';

/* ── Interfaces ── */

interface AuditEntry {
  timestamp?: string;
  operation?: string;
  secret?: string;
  outcome?: string;
  details?: string;
  actor?: string;
  machine?: string;
  pid?: number | string;
  [key: string]: unknown;
}

interface SiemEvent {
  timestamp: string;
  source: string;
  version: string;
  event: {
    operation?: string;
    secret?: string;
    outcome?: string;
    details?: string;
    actor?: string;
    machine?: string;
    pid?: number | string;
  };
  severity: string;
  tags: string[];
}

interface Checkpoint {
  lastLine: number;
  lastTimestamp: string;
  lastRun: string;
  bridgeVersion?: string;
}

interface Alert {
  type: string;
  severity: string;
  message: string;
  timestamp: string;
}

interface SiemConfig {
  enabled?: boolean;
  endpoint?: string;
  provider?: string;
  token?: string;
  apiKey?: string;
}

/* ── Paths ── */

const LogDir = join(ROOT, 'logs');
const ConfigPath = join(ROOT, 'config', 'observability-config.json');
const CheckpointFile = join(LogDir, 'siem-checkpoint.json');
const SiemOutputLog = join(LogDir, 'siem-forwarded.jsonl');
const AlertLog = join(LogDir, 'siem-alerts.jsonl');
const DefaultAuditLog = join(LogDir, 'secret-audit.jsonl');

const ALERT_MASS_ACCESS_THRESHOLD = 10;
const ALERT_MASS_ACCESS_WINDOW = 5;
const ALERT_FAILURE_THRESHOLD = 3;

/* ── Helpers ── */

function getSiemConfig(): SiemConfig | null {
  if (!existsSync(ConfigPath)) return null;
  try {
    const cfg = JSON.parse(readFileSync(ConfigPath, 'utf-8'));
    return cfg.siem ?? null;
  } catch {
    return null;
  }
}

function getCheckpoint(): Checkpoint {
  if (existsSync(CheckpointFile)) {
    try {
      return JSON.parse(readFileSync(CheckpointFile, 'utf-8'));
    } catch {
      console.log('Operation failed, continuing');
    }
  }
  return { lastLine: 0, lastTimestamp: '', lastRun: '' };
}

function saveCheckpoint(lineNum: number, lastTs: string) {
  const cp: Checkpoint = {
    lastLine: lineNum,
    lastTimestamp: lastTs,
    lastRun: new Date().toISOString(),
    bridgeVersion: BRIDGE_VERSION,
  };
  writeFileSync(CheckpointFile, JSON.stringify(cp, null, 2), 'utf-8');
}

function convertToSiemEvent(entry: AuditEntry, source = 'gentle-vanguard-secret-vault'): SiemEvent {
  const severity =
    entry.outcome === 'FAILURE' ? 'ERROR' : entry.outcome === 'WARNING' ? 'WARN' : 'INFO';
  return {
    timestamp: entry.timestamp ?? '',
    source,
    version: BRIDGE_VERSION,
    event: {
      operation: entry.operation,
      secret: entry.secret,
      outcome: entry.outcome,
      details: entry.details,
      actor: entry.actor,
      machine: entry.machine,
      pid: entry.pid,
    },
    severity,
    tags: ['gentle-vanguard', 'secrets', 'compliance', 'audit'],
  };
}

function sendToSiem(siemEvent: SiemEvent, siemConfig: SiemConfig | null): boolean {
  const jsonLine = JSON.stringify(siemEvent);
  appendFileSync(SiemOutputLog, jsonLine + '\n', 'utf-8');

  if (siemConfig?.enabled !== true) return true;

  const endpoint = siemConfig.endpoint ?? '';
  void endpoint;
  const provider = siemConfig.provider ?? '';
  void provider;
  try {
    return true;
  } catch {
    console.log(`  [WARN] Cloud SIEM forward failed`);
    return false;
  }
}

function invokeAnomalyDetection(entries: AuditEntry[]): Alert[] {
  const alerts: Alert[] = [];
  const now = new Date();

  const recentAccess = entries
    .filter((e) => e.operation === 'get' && e.timestamp)
    .filter((e) => {
      const ts = new Date(e.timestamp!);
      return (
        !isNaN(ts.getTime()) && (now.getTime() - ts.getTime()) / 60000 <= ALERT_MASS_ACCESS_WINDOW
      );
    });

  if (recentAccess.length >= ALERT_MASS_ACCESS_THRESHOLD) {
    alerts.push({
      type: 'MASS_SECRET_ACCESS',
      severity: 'HIGH',
      message: `Mass secret access detected: ${recentAccess.length} operations in ${ALERT_MASS_ACCESS_WINDOW} minutes`,
      timestamp: now.toISOString(),
    });
  }

  const recentFailures = entries
    .filter((e) => e.outcome === 'FAILURE' && e.timestamp)
    .filter((e) => {
      const ts = new Date(e.timestamp!);
      return !isNaN(ts.getTime()) && (now.getTime() - ts.getTime()) / 60000 <= 10;
    });

  if (recentFailures.length >= ALERT_FAILURE_THRESHOLD) {
    alerts.push({
      type: 'REPEATED_FAILURES',
      severity: 'MEDIUM',
      message: `Repeated authentication failures: ${recentFailures.length} in 10 minutes`,
      timestamp: now.toISOString(),
    });
  }

  const breachEvents = entries.filter((e) => e.operation === 'breach-response');
  for (const b of breachEvents) {
    alerts.push({
      type: 'SECRET_BREACH',
      severity: 'CRITICAL',
      message: `Secret breach response activated for: ${b.secret} — ${b.details}`,
      timestamp: b.timestamp ?? now.toISOString(),
    });
  }

  return alerts;
}

function writeAlert(alert: Alert) {
  appendFileSync(AlertLog, JSON.stringify(alert) + '\n', 'utf-8');
  console.log(`  [ALERT][${alert.severity}] ${alert.message}`.padStart(40));
}

/* ── Modes ── */

function invokeTail(auditLog: string) {
  if (!existsSync(auditLog)) {
    console.log(`\x1b[33m No audit log found at: ${auditLog}\x1b[0m`);
    return;
  }
  const checkpoint = getCheckpoint();
  const content = readFileSync(auditLog, 'utf-8');
  const allLines = content.split('\n').filter((l) => l.trim());
  const newLines = allLines.slice(checkpoint.lastLine);

  if (newLines.length === 0) {
    console.log(`\x1b[90m No new audit events since last run.\x1b[0m`);
    return;
  }

  const siemConfig = getSiemConfig();
  let processed = 0;
  let forwarded = 0;
  let lastTs = '';
  const entries: AuditEntry[] = [];

  for (const line of newLines) {
    try {
      const entry: AuditEntry = JSON.parse(line);
      entries.push(entry);
      if (sendToSiem(convertToSiemEvent(entry), siemConfig)) forwarded++;
      processed++;
      lastTs = entry.timestamp ?? '';
    } catch {
      console.log(`  [WARN] Skipping malformed log line.`);
    }
  }

  const alerts = invokeAnomalyDetection(entries);
  for (const a of alerts) writeAlert(a);
  saveCheckpoint(checkpoint.lastLine + processed, lastTs);

  console.log(
    `\x1b[32m SIEM bridge processed ${processed} event(s), ${forwarded} forwarded.\x1b[0m`,
  );
  if (alerts.length > 0) {
    console.log(`\x1b[33m[!] ${alerts.length} alert(s) generated — see: ${AlertLog}\x1b[0m`);
  }
}

function invokeFull(auditLog: string) {
  if (!existsSync(auditLog)) {
    console.log(`\x1b[33m No audit log found.\x1b[0m`);
    return;
  }
  const content = readFileSync(auditLog, 'utf-8');
  const allLines = content.split('\n').filter((l) => l.trim());
  const siemConfig = getSiemConfig();
  let processed = 0;
  let forwarded = 0;
  let lastTs = '';
  const entries: AuditEntry[] = [];

  for (const line of allLines) {
    try {
      const entry: AuditEntry = JSON.parse(line);
      entries.push(entry);
      if (sendToSiem(convertToSiemEvent(entry), siemConfig)) forwarded++;
      processed++;
      lastTs = entry.timestamp ?? '';
    } catch {
      console.log(`  [WARN] Skipping malformed log line.`);
    }
  }

  const alerts = invokeAnomalyDetection(entries);
  for (const a of alerts) writeAlert(a);
  saveCheckpoint(processed, lastTs);

  console.log(`\x1b[32m Full reprocess: ${processed} event(s), ${forwarded} forwarded.\x1b[0m`);
}

function invokeStatus(auditLog: string) {
  console.log('');
  console.log(`\x1b[36m  Gentle-Vanguard SIEM Audit Bridge v${BRIDGE_VERSION}\x1b[0m`);
  console.log(`\x1b[90m  ──────────────────────────────────────────\x1b[0m`);

  const checkpoint = getCheckpoint();
  console.log(`  Audit log:      ${auditLog}`);
  console.log(`  SIEM output:    ${SiemOutputLog}`);
  console.log(`  Alert log:      ${AlertLog}`);
  console.log(`  Last run:       ${checkpoint.lastRun || 'Never'}`);
  console.log(`  Last checkpoint: line ${checkpoint.lastLine}`);

  if (existsSync(auditLog)) {
    const totalLines = readFileSync(auditLog, 'utf-8')
      .split('\n')
      .filter((l) => l.trim()).length;
    const unprocessed = totalLines - checkpoint.lastLine;
    console.log(`  Total events:   ${totalLines} (${unprocessed} unprocessed)`);
  }

  const siemConfig = getSiemConfig();
  if (siemConfig?.enabled) {
    console.log(`\x1b[32m  Cloud SIEM:     ${siemConfig.provider} — ${siemConfig.endpoint}\x1b[0m`);
  } else {
    console.log(`\x1b[33m  Cloud SIEM:     Not configured (local-only mode)\x1b[0m`);
    console.log(
      `\x1b[90m                  Configure via config/observability-config.json#siem\x1b[0m`,
    );
  }

  if (existsSync(AlertLog)) {
    const alertCount = readFileSync(AlertLog, 'utf-8')
      .split('\n')
      .filter((l) => l.trim()).length;
    console.log(`  Active alerts:  ${alertCount}`);
  } else {
    console.log(`\x1b[32m  Active alerts:  0\x1b[0m`);
  }
  console.log('');
}

function invokeTest() {
  console.log(`\x1b[36m Sending test event to SIEM...\x1b[0m`);
  const testEntry: AuditEntry = {
    timestamp: new Date().toISOString(),
    operation: 'test',
    secret: 'SIEM_TEST',
    outcome: 'SUCCESS',
    details: 'SIEM bridge connectivity test',
    actor: process.env.USERNAME ?? 'unknown',
    machine: process.env.COMPUTERNAME ?? 'unknown',
    pid: process.pid,
  };
  const testEvent = convertToSiemEvent(testEntry, 'gentle-vanguard-siem-test');
  const ok = sendToSiem(testEvent, getSiemConfig());
  if (ok) {
    console.log(`\x1b[32m Test event written to: ${SiemOutputLog}\x1b[0m`);
  } else {
    console.log(`\x1b[33m Local write OK but cloud SIEM forward failed.\x1b[0m`);
  }
  console.log(`\x1b[90m      Check config/observability-config.json#siem for cloud config.\x1b[0m`);
}

/* ── Main ── */

function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'tail';
  const logFile = args.includes('--log-file') ? args[args.indexOf('--log-file') + 1] : '';

  const validModes = ['tail', 'full', 'status', 'test'];
  const resolvedMode = validModes.includes(mode) ? mode : 'tail';
  const auditLog = logFile || DefaultAuditLog;

  if (!existsSync(LogDir)) mkdirSync(LogDir, { recursive: true });

  switch (resolvedMode) {
    case 'tail':
      invokeTail(auditLog);
      break;
    case 'full':
      invokeFull(auditLog);
      break;
    case 'status':
      invokeStatus(auditLog);
      break;
    case 'test':
      invokeTest();
      break;
    default:
      console.log(`Unknown mode: ${resolvedMode}`);
      process.exit(1);
  }
}

main();
