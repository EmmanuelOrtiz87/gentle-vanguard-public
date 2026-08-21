#!/usr/bin/env node
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { runNpxTsxSync } from './core/run-command.js';
import { SessionContextLog } from './core/session-context-log.js';

const ROOT = resolve(process.cwd());

// Try to load centralized timeout config, fallback to hardcoded values
function getTimeout(key: string, fallback: number): number {
  try {
    const cfgPath = join(ROOT, 'config', 'timeout-config.json');
    if (existsSync(cfgPath)) {
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
      const parts = key.split('.');
      let val: Record<string, unknown> = cfg;
      for (const p of parts) {
        if (val && typeof val === 'object' && p in val) val = val[p] as Record<string, unknown>;
        else return fallback;
      }
      return typeof val === 'number' ? val : fallback;
    }
  } catch {
    /* fallback to default */
  }
  return fallback;
}

const DEFAULT_TIMEOUT = getTimeout('process_execution.script_default_ms', 30000);
const LONG_TIMEOUT = getTimeout('process_execution.script_long_running_ms', 120000);

function log(msg: string) {
  console.log(`[CLEANUP] ${msg}`);
}
function ok(msg: string) {
  console.log(`[CLEANUP] ${msg}`);
}
function warn(msg: string) {
  console.warn(`[CLEANUP] WARN: ${msg}`);
}

function removeStaleSessions(sessionDir: string): void {
  if (!existsSync(sessionDir)) return;
  const cutoff = Date.now() - 8 * 3600000;
  const today = new Date().toISOString().slice(0, 10);
  for (const f of readdirSync(sessionDir).filter((f) => f.endsWith('.json'))) {
    const fp = join(sessionDir, f);
    if (statSync(fp).mtimeMs < cutoff && !f.includes(today)) {
      rmSync(fp, { force: true });
      ok(`Removed stale: ${f}`);
    }
  }
}

// Initialize session data - ALWAYS called regardless of skip flags
function initSessionData(): { sid: string; sessionData: Record<string, unknown> } {
  const sessionDir = join(ROOT, '.session');
  mkdirSync(sessionDir, { recursive: true });

  const sid = `session-${new Date().toISOString().slice(0, 16).replace(/[:-]/g, '')}`;
  const sessionData = {
    sessionId: sid,
    id: sid,
    startTime: new Date().toISOString(),
    timestamp: new Date().toISOString(),
    messages: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    totalContextChars: 0,
    messageCount: 0,
    timezone: 'America/Argentina/Buenos_Aires',
    timeZone: 'America/Argentina/Buenos_Aires',
    peakStart: 9,
    peak_start: 9,
    peakEnd: 15,
    peak_end: 15,
    region: 'Argentina',
    status: 'active',
    toolCalls: 0,
    filesRead: 0,
    filesEdited: 0,
    skillsUsed: [],
    errors: 0,
    warnings: 0,
    cacheHits: 0,
    cacheMisses: 0,
    qualityScore: 100,
  };

  // Create session-current.json for downstream components - ALWAYS
  const currentSessionFile = join(sessionDir, 'session-current.json');
  writeFileSync(currentSessionFile, JSON.stringify(sessionData, null, 2));
  ok(`Session file created: session-current.json`);

  // Also create dated session file
  const dateStr = new Date().toISOString().slice(0, 10);
  const datedSessionFile = join(sessionDir, `session-${dateStr}-01.json`);
  writeFileSync(datedSessionFile, JSON.stringify(sessionData, null, 2));
  ok(`Dated session file created: session-${dateStr}-01.json`);

  return { sid, sessionData };
}

function flushCaches(sessionDir: string, sessionData: Record<string, unknown>): void {
  const targets = [
    { path: join(sessionDir, 'normativa-cache'), type: 'dir' as const },
    { path: join(sessionDir, 'preprocess-response-cache.json'), type: 'file' as const },
    { path: join(sessionDir, 'token-usage.json'), type: 'file' as const },
    { path: join(sessionDir, 'prompt-cache'), type: 'dir' as const },
  ];
  let flushed = 0;
  for (const t of targets) {
    if (existsSync(t.path)) {
      if (t.type === 'dir') {
        rmSync(t.path, { recursive: true, force: true });
        mkdirSync(t.path, { recursive: true });
      } else {
        rmSync(t.path, { force: true });
      }
      flushed++;
    }
  }
  for (const d of ['normativa-cache', 'prompt-cache']) {
    const fp = join(sessionDir, d);
    if (!existsSync(fp)) mkdirSync(fp, { recursive: true });
  }
  ok(`Flushed ${flushed} cache targets`);

  // Reset token tracking with current session data
  const tokenFile = join(sessionDir, 'token-usage.json');
  writeFileSync(tokenFile, JSON.stringify(sessionData, null, 2));
  ok(`Token tracking reset for ${sessionData.sessionId}`);

  // Guardar en context-log (sistema unificado - dashboard source of truth)
  const ctxLog = new SessionContextLog({
    sessionId: sessionData.sessionId as string,
    agent: 'orchestrator',
    status: 'active',
    totalTokens: 0,
    totalCost: 0,
    messageCount: 0,
    metadata: {
      toolCalls: 0,
      filesRead: 0,
      filesEdited: 0,
      skillsUsed: [],
      errors: 0,
      warnings: 0,
      cacheHits: 0,
      cacheMisses: 0,
      qualityScore: 100,
      region: 'Argentina',
      timezone: 'America/Argentina/Buenos_Aires',
    },
  });
  ctxLog.save();
  console.log(`[CLEANUP] Session saved to context-log: ${sessionData.sessionId}`);
}

export function runCleanup(
  opts: {
    workspaceRoot?: string;
    skipOrphanCleanup?: boolean;
    skipCacheFlush?: boolean;
    skipCompression?: boolean;
    skipSessionInit?: boolean;
    quiet?: boolean;
  } = {},
): boolean {
  const repoRoot = opts.workspaceRoot ?? ROOT;
  const sessionDir = join(repoRoot, '.session');
  const sessionDir2 = join(repoRoot, 'session');
  const skipSessionInit = opts.skipSessionInit ?? false;
  let sessionData: Record<string, unknown> | null = null;

  // Initialize session data - ALWAYS unless the caller requests a pure cleanup
  // pass (skipSessionInit). The lazy autostart `session-cleanup` step uses this
  // so it never regenerates the session that the phase-0 session-manager step
  // already created (which would change the sessionId mid-pipeline and reset
  // the token caches the token-ingest daemon is writing).
  if (!skipSessionInit) {
    log('Initializing session...');
    const init = initSessionData();
    sessionData = init.sessionData;
    ok(`Session initialized: ${init.sid}`);
  }

  if (!opts.skipOrphanCleanup) {
    log('Closing orphaned sessions...');
    removeStaleSessions(sessionDir);
    removeStaleSessions(sessionDir2);
    ok('Orphan cleanup done');
  }

  if (!skipSessionInit && !opts.skipCacheFlush && sessionData) {
    log('Flushing session caches...');
    flushCaches(sessionDir, sessionData);
  }

  if (!opts.skipCompression) {
    log('Skipping compression (semantic-compression.ps1 removed during cleanup)');
  }

  if (!skipSessionInit) {
    log('Closing session tracing span...');
    const spanDir = join(repoRoot, '.telemetry', 'spans');
  if (existsSync(spanDir)) {
    const spans = readdirSync(spanDir)
      .filter((f) => f.startsWith('spans-') && f.endsWith('.jsonl'))
      .sort()
      .reverse();
    if (spans.length > 0) {
      const content = readFileSync(join(spanDir, spans[0]), 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());
      for (const line of lines) {
        try {
          const span = JSON.parse(line);
          if (span.name === 'session-start') {
            const tracingScript = join(repoRoot, 'src/tracing-instrument.ts');
            if (existsSync(tracingScript)) {
              const result = runNpxTsxSync(
                tracingScript,
                [
                  '-Action',
                  'end',
                  '-TraceId',
                  span.traceId,
                  '-SpanId',
                  span.spanId,
                  '-SpanName',
                  'session-start',
                  '-Attributes',
                  JSON.stringify({ startTimeUnixNano: span.startTimeUnixNano }),
                  '-Quiet',
                ],
                { cwd: repoRoot, stdio: 'pipe', timeout: DEFAULT_TIMEOUT },
              );
              if (result.status === 0) {
                ok('Tracing span closed');
              } else {
                warn('Tracing span close failed (non-fatal)');
              }
            } else {
              warn('Tracing script not found, span not closed');
            }
            break;
          }
        } catch {
          /* skip */
        }
      }
    }
  }
  }

  log('Pruning old checkpoints...');
  const ckptMgr = join(ROOT, 'src/checkpoint-manager.ts');
  if (existsSync(ckptMgr)) {
    runNpxTsxSync(ckptMgr, ['prune'], { cwd: ROOT, stdio: 'pipe', timeout: LONG_TIMEOUT });
    ok('Checkpoint prune done');
  }

  if (!skipSessionInit) {
    log('Logging session end to audit...');
    const auditScript = join(ROOT, 'src/audit-pipeline.ts');
  if (existsSync(auditScript)) {
    runNpxTsxSync(
      auditScript,
      [
        'log',
        '-EventType',
        'session.end',
        '-Component',
        'system',
        '-Operation',
        'cleanup',
        '-Actor',
        'system',
        '-Status',
        'success',
        '-Message',
        'Session cleanup completed',
        '-Quiet',
      ],
      { cwd: ROOT, stdio: 'pipe', timeout: DEFAULT_TIMEOUT },
    );
    ok('Audit session-end logged');
  }
  }

  if (!skipSessionInit) {
    log('Recording session-close event...');
  const evtStore = join(ROOT, 'src/event-sourcing.ts');
  if (existsSync(evtStore)) {
    const aggId = `session-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
    runNpxTsxSync(
      evtStore,
      [
        '-Action',
        'append',
        '-AggregateId',
        aggId,
        '-EventType',
        'session.ended',
        '-EventData',
        '{"duration":"cleanup"}',
        '-Quiet',
      ],
      { cwd: ROOT, stdio: 'pipe', timeout: DEFAULT_TIMEOUT },
    );
    ok('Session end event recorded');
  }
  }

  ok('Session cleanup complete');
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opts: Parameters<typeof runCleanup>[0] = {};
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '-WorkspaceRoot':
        opts.workspaceRoot = args[++i];
        break;
      case '-SkipOrphanCleanup':
        opts.skipOrphanCleanup = true;
        break;
      case '-SkipCacheFlush':
        opts.skipCacheFlush = true;
        break;
      case '-SkipSessionInit':
        opts.skipSessionInit = true;
        break;
      case '-SkipCompression':
        opts.skipCompression = true;
        break;
      case '-Quiet':
        opts.quiet = true;
        break;
    }
  }
  runCleanup(opts);
}
