#!/usr/bin/env node
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  appendFileSync,
  renameSync,
  unlinkSync,
  statSync,
} from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { createHash } from 'crypto';

const ROOT = resolve(process.cwd());

export interface AuditEvent {
  id: string;
  timestamp: string;
  type: string;
  component: string;
  operation: string;
  actor: string;
  target: string;
  status: string;
  message: string;
  metadata: Record<string, unknown>;
  severity: string;
  sessionId: string;
  hash: string;
}

export interface AuditStats {
  totalEvents: number;
  byType: Record<string, number>;
  lastEvent: AuditEvent | null;
  logFiles: { name: string; count: number; size: number }[];
  totalSize: number;
  totalSizeFormatted: string;
}

const AUDIT_DIR = join(ROOT, '.session', 'audit');
const LOG_DIR = join(AUDIT_DIR, 'logs');
const ARCHIVE_DIR = join(AUDIT_DIR, 'archive');
const INDEX_FILE = join(AUDIT_DIR, 'index.json');

const SEVERITY_MAP: Record<string, string> = {
  'config.change': 'info',
  'session.start': 'info',
  'session.end': 'info',
  'skill.exec': 'info',
  'auth.attempt': 'warn',
  delegation: 'info',
  rollback: 'warn',
  correction: 'info',
  'api.access': 'debug',
};

function ensureDirs() {
  for (const d of [AUDIT_DIR, LOG_DIR, ARCHIVE_DIR]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

function log(msg: string, level = 'INFO') {
  const t = new Date().toISOString().slice(0, 19).replace('T', ' ');
  console.log(`[${t}] [AUDIT] [${level}] ${msg}`);
}

export function newAuditEvent(opts: {
  eventType: string;
  component: string;
  operation: string;
  actor: string;
  target?: string;
  status?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}): AuditEvent {
  const hex = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  const ts = new Date().toISOString();
  const dateStr = ts.slice(0, 10).replace(/-/g, '');
  const timeStr = ts.slice(11, 19).replace(/:/g, '');
  const id = `aud-${dateStr}-${timeStr}-${hex}`;

  const event: AuditEvent = {
    id,
    timestamp: ts,
    type: opts.eventType,
    component: opts.component,
    operation: opts.operation,
    actor: opts.actor,
    target: opts.target ?? '',
    status: opts.status ?? 'success',
    message: opts.message ?? '',
    metadata: opts.metadata ?? {},
    severity: SEVERITY_MAP[opts.eventType] ?? 'info',
    sessionId: process.env.SESSION_ID ?? '',
    hash: '',
  };

  const jsonStr = JSON.stringify(event);
  event.hash = createHash('sha256').update(jsonStr).digest('hex');
  return event;
}

export function saveAuditEvent(event: AuditEvent): void {
  ensureDirs();
  const dateStr = event.timestamp.slice(0, 10);
  const logFile = join(LOG_DIR, `audit-${dateStr}.jsonl`);
  appendFileSync(logFile, JSON.stringify(event) + '\n');

  const index = loadIndex();
  index.events.push({
    id: event.id,
    type: event.type,
    timestamp: event.timestamp,
    severity: event.severity,
    status: event.status,
    logFile: `audit-${dateStr}.jsonl`,
  });
  writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
}

function loadIndex(): {
  events: {
    id: string;
    type: string;
    timestamp: string;
    severity: string;
    status: string;
    logFile: string;
  }[];
} {
  if (existsSync(INDEX_FILE)) {
    try {
      return JSON.parse(readFileSync(INDEX_FILE, 'utf-8'));
    } catch {
      /* ignore */
    }
  }
  return { events: [] };
}

export function queryEvents(filters: {
  eventType?: string;
  component?: string;
  operation?: string;
  actor?: string;
  status?: string;
  queryFilter?: string;
}): AuditEvent[] {
  const results: AuditEvent[] = [];
  if (!existsSync(LOG_DIR)) return results;
  const files = readdirSync(LOG_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .reverse()
    .slice(0, 30);
  for (const file of files) {
    const lines = readFileSync(join(LOG_DIR, file), 'utf-8')
      .split('\n')
      .filter((l) => l.trim());
    for (const line of lines) {
      try {
        const evt: AuditEvent = JSON.parse(line);
        if (filters.eventType && evt.type !== filters.eventType) continue;
        if (filters.component && evt.component !== filters.component) continue;
        if (filters.operation && evt.operation !== filters.operation) continue;
        if (filters.actor && evt.actor !== filters.actor) continue;
        if (filters.status && evt.status !== filters.status) continue;
        if (filters.queryFilter && !line.toLowerCase().includes(filters.queryFilter.toLowerCase()))
          continue;
        results.push(evt);
      } catch {
        /* skip malformed */
      }
    }
  }
  return results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function exportEvents(retentionDays: number): { file: string; count: number } {
  ensureDirs();
  const events: AuditEvent[] = [];
  if (existsSync(LOG_DIR)) {
    for (const file of readdirSync(LOG_DIR)
      .filter((f) => f.endsWith('.jsonl'))
      .sort()) {
      for (const line of readFileSync(join(LOG_DIR, file), 'utf-8')
        .split('\n')
        .filter((l) => l.trim())) {
        try {
          events.push(JSON.parse(line));
        } catch {
          /* skip */
        }
      }
    }
  }
  const ts = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const exportFile = join(ARCHIVE_DIR, `audit-export-${ts}.json`);
  writeFileSync(
    exportFile,
    JSON.stringify(
      { exportedAt: new Date().toISOString(), total: events.length, retentionDays, events },
      null,
      2,
    ),
  );
  log(`Exported ${events.length} events to ${exportFile}`, 'SUCCESS');
  return { file: exportFile, count: events.length };
}

export function rotateLogs(retentionDays: number): { archived: number; removed: number } {
  ensureDirs();
  let archived = 0,
    removed = 0;
  const cutoff = Date.now() - retentionDays * 86400000;
  if (existsSync(LOG_DIR)) {
    for (const f of readdirSync(LOG_DIR).filter((f) => f.endsWith('.jsonl'))) {
      const fp = join(LOG_DIR, f);
      if (statSync(fp).mtimeMs < cutoff) {
        renameSync(fp, join(ARCHIVE_DIR, f));
        archived++;
      }
    }
  }
  const archiveCutoff = Date.now() - (retentionDays + 30) * 86400000;
  if (existsSync(ARCHIVE_DIR)) {
    for (const f of readdirSync(ARCHIVE_DIR).filter((f) => f.endsWith('.jsonl'))) {
      if (statSync(join(ARCHIVE_DIR, f)).mtimeMs < archiveCutoff) {
        unlinkSync(join(ARCHIVE_DIR, f));
        removed++;
      }
    }
  }
  log(
    `Rotation: ${archived} archived, ${removed} deleted (retention: ${retentionDays}d)`,
    'SUCCESS',
  );
  return { archived, removed };
}

export function getStatus(): AuditStats {
  const stats: AuditStats = {
    totalEvents: 0,
    byType: {},
    lastEvent: null,
    logFiles: [],
    totalSize: 0,
    totalSizeFormatted: '',
  };
  if (existsSync(LOG_DIR)) {
    for (const f of readdirSync(LOG_DIR)
      .filter((f) => f.endsWith('.jsonl'))
      .sort()) {
      const fp = join(LOG_DIR, f);
      const content = readFileSync(fp, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());
      const size = statSync(fp).size;
      stats.totalEvents += lines.length;
      stats.totalSize += size;
      stats.logFiles.push({ name: f, count: lines.length, size });
      for (const line of lines) {
        try {
          const evt: AuditEvent = JSON.parse(line);
          stats.byType[evt.type] = (stats.byType[evt.type] ?? 0) + 1;
          stats.lastEvent = evt;
        } catch {
          /* skip */
        }
      }
    }
  }
  if (stats.totalSize > 1048576)
    stats.totalSizeFormatted = `${(stats.totalSize / 1048576).toFixed(1)} MB`;
  else if (stats.totalSize > 1024)
    stats.totalSizeFormatted = `${(stats.totalSize / 1024).toFixed(1)} KB`;
  else stats.totalSizeFormatted = `${stats.totalSize} B`;
  return stats;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  let action = '',
    eventType = '',
    component = '',
    operation = '',
    actor = '',
    target = '';
  let status = 'success',
    message = '',
    queryFilter = '',
    retentionDays = 90,
    quiet = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '-Action':
        action = args[++i] ?? '';
        break;
      case '-EventType':
        eventType = args[++i] ?? '';
        break;
      case '-Component':
        component = args[++i] ?? '';
        break;
      case '-Operation':
        operation = args[++i] ?? '';
        break;
      case '-Actor':
        actor = args[++i] ?? '';
        break;
      case '-Target':
        target = args[++i] ?? '';
        break;
      case '-Status':
        status = args[++i] ?? 'success';
        break;
      case '-Message':
        message = args[++i] ?? '';
        break;
      case '-QueryFilter':
        queryFilter = args[++i] ?? '';
        break;
      case '-RetentionDays':
        retentionDays = parseInt(args[++i] ?? '90', 10);
        break;
      case '-Quiet':
        quiet = true;
        break;
      default:
        if (!args[i].startsWith('-')) action = args[i];
        break;
    }
  }

  ensureDirs();

  switch (action) {
    case 'log': {
      const event = newAuditEvent({
        eventType,
        component,
        operation,
        actor,
        target,
        status,
        message,
      });
      saveAuditEvent(event);
      if (!quiet) log(`${eventType} | ${component}/${operation} | ${status}`);
      console.log(JSON.stringify(event));
      break;
    }
    case 'query': {
      const results = queryEvents({ eventType, component, operation, actor, status, queryFilter });
      log(`Query returned ${results.length} results`);
      console.log(JSON.stringify(results, null, 2));
      break;
    }
    case 'export': {
      const r = exportEvents(retentionDays);
      console.log(JSON.stringify(r));
      break;
    }
    case 'rotate': {
      const r = rotateLogs(retentionDays);
      console.log(JSON.stringify(r));
      break;
    }
    case 'status': {
      const s = getStatus();
      console.log(JSON.stringify(s, null, 2));
      break;
    }
    default:
      console.error(`Unknown action: ${action}`);
      process.exit(1);
  }
}
