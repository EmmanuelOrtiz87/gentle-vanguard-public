#!/usr/bin/env node
/**
 * Session Close Orchestrator
 *
 * Orquesta el protocolo completo de cierre de sesión en 6 fases:
 *   PRE-CLOSE → PERSIST → BACKUP → AUDIT → CLEANUP → VERIFY
 *
 * 100% autónomo. Se ejecuta automáticamente al detectar fin de sesión
 * o a demanda vía CLI.
 *
 * Uso:
 *   npx tsx src/session-close-orchestrator.ts
 *   npx tsx src/session-close-orchestrator.ts --reason "maintenance"
 *   npx tsx src/session-close-orchestrator.ts --verify
 *   npx tsx src/session-close-orchestrator.ts --validate --deep
 *   npx tsx src/session-close-orchestrator.ts --validate --full --auto-fix
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  unlinkSync,
} from 'fs';
import { join, resolve, relative } from 'path';
import { runSync, runNpxTsxSync } from './core/run-command.js';
import { pathToFileURL } from 'url';
import { sessionEnd } from './engram-session-bridge.js';

// ─── Guardian Protection ────────────────────────────────────────────────────────
// Importa protección contra cierres informales
import { guardianCheck, learnFromMistake } from './session-close-guardian.js';

const ROOT = resolve(process.cwd());
const SESSION_DIR = join(ROOT, '.session');
const RUNTIME_DIR = join(ROOT, '.runtime');

type PhaseResult = { phase: string; status: 'PASS' | 'FAIL' | 'SKIP'; detail: string };

// ─── Helpers ────────────────────────────────────────────────────────────────────

import { log as createLogger } from './utils/logger.js';

const LOG = createLogger('CLOSE');

function log(msg: string) {
  LOG.info(msg);
}
function ok(msg: string) {
  LOG.info(`✅ ${msg}`);
}
function warn(msg: string) {
  LOG.warn(msg);
}

function getSessionFile(): string {
  return join(SESSION_DIR, 'session-current.json');
}

function readSessionData(): Record<string, unknown> {
  const fp = getSessionFile();
  if (!existsSync(fp)) return {};
  try {
    return JSON.parse(readFileSync(fp, 'utf-8'));
  } catch {
    return {};
  }
}

function writeSessionData(data: Record<string, unknown>): void {
  mkdirSync(SESSION_DIR, { recursive: true });
  writeFileSync(getSessionFile(), JSON.stringify(data, null, 2));
  // Also create dated copy
  const dateStr = new Date().toISOString().slice(0, 10);
  const datedFile = join(SESSION_DIR, `session-${dateStr}-01.json`);
  writeFileSync(datedFile, JSON.stringify(data, null, 2));
}

function runScript(
  script: string,
  args: string[],
  timeout = 60000,
): { status: number; stdout: string } {
  const fullPath = join(ROOT, script);
  if (!existsSync(fullPath)) return { status: -1, stdout: '' };
  try {
    const r = runNpxTsxSync(fullPath, args, {
      cwd: ROOT,
      stdio: 'pipe',
      timeout,
      maxBuffer: 1024 * 1024,
    });
    return { status: r.status ?? -1, stdout: r.stdout };
  } catch {
    return { status: -1, stdout: '' };
  }
}

function runCmd(cmd: string, args: string[], timeout = 30000): { status: number; stdout: string } {
  try {
    const r = runSync(cmd, args, { cwd: ROOT, stdio: 'pipe', timeout, maxBuffer: 1024 * 1024 });
    return { status: r.status ?? -1, stdout: r.stdout };
  } catch {
    return { status: -1, stdout: '' };
  }
}

// ─── Fases ──────────────────────────────────────────────────────────────────────

function phasePreClose(reason: string): PhaseResult[] {
  const results: PhaseResult[] = [];
  log('=== FASE 1: PRE-CLOSE ===');

  // 1.1 Update session data with close timestamp
  try {
    const data = readSessionData();
    data.closeTime = new Date().toISOString();
    data.closeReason = reason;
    data.status = 'closed';
    writeSessionData(data);
    results.push({
      phase: 'pre-close-timestamp',
      status: 'PASS',
      detail: `Session closed at ${data.closeTime}`,
    });
    ok('Session timestamp recorded');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    results.push({ phase: 'pre-close-timestamp', status: 'FAIL', detail: msg });
    warn(`Timestamp write failed: ${msg}`);
  }

  // 1.2 Detect previous informal close attempt marker (.informal-close-attempt)
  const informalMarker = join(SESSION_DIR, '.informal-close-attempt');
  if (existsSync(informalMarker)) {
    let detail = 'Informal close marker found: sesión previa cerrada fuera del protocolo oficial';
    try {
      const markerData = JSON.parse(readFileSync(informalMarker, 'utf-8')) as Record<
        string,
        unknown
      >;
      if (markerData.reason) detail += ` (reason: ${String(markerData.reason)})`;
    } catch {
      /* keep generic detail if marker is not valid JSON */
    }
    results.push({ phase: 'informal-close-attempt', status: 'SKIP', detail });
    warn(
      `Informal close attempt marker detected at ${informalMarker} — review guardian-warnings.log`,
    );
  } else {
    results.push({
      phase: 'informal-close-attempt',
      status: 'PASS',
      detail: 'No informal close marker found',
    });
  }

  // 1.3 Close tracing span (resilient — find any .jsonl span file)
  const spanDir = join(ROOT, '.telemetry', 'spans');
  if (existsSync(spanDir)) {
    try {
      // Find all JSONL span files in the directory
      const spanFiles = readdirSync(spanDir).filter((f) => f.endsWith('.jsonl'));
      if (spanFiles.length > 0) {
        // Use the first available span file
        const spanFile = join(spanDir, spanFiles[0]);
        const spanContent = readFileSync(spanFile, 'utf-8');
        const spans = spanContent.split('\n').filter((l) => l.trim());
        for (const line of spans.reverse()) {
          try {
            const span = JSON.parse(line);
            if (span.name === 'session-start') {
              const r = runScript(
                'src/tracing-instrument.ts',
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
                  JSON.stringify({ closeReason: reason, closeTime: new Date().toISOString() }),
                  '-Quiet',
                ],
                15000,
              );
              const st = r.status === 0 ? 'PASS' : 'FAIL';
              results.push({
                phase: 'tracing-close',
                status: st,
                detail: st === 'PASS' ? 'Span closed' : 'Span close returned non-zero',
              });
              break;
            }
          } catch {
            /* skip malformed lines */
          }
        }
      } else {
        results.push({
          phase: 'tracing-close',
          status: 'SKIP',
          detail: 'No span files found in .telemetry/spans/',
        });
      }
    } catch (e: unknown) {
      results.push({
        phase: 'tracing-close',
        status: 'SKIP',
        detail: e instanceof Error ? e.message : 'Span read error',
      });
    }
  } else {
    results.push({ phase: 'tracing-close', status: 'SKIP', detail: '.telemetry/spans/ not found' });
  }

  return results;
}

// ─── Pre-Validation (Capa 1) ─────────────────────────────────────────────────

function getAllFiles(dir: string, ext: string): string[] {
  const result: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          result.push(...getAllFiles(full, ext));
        }
      } else if (entry.name.endsWith(ext)) {
        result.push(full);
      }
    }
  } catch {
    /* skip unreadable */
  }
  return result;
}

function getChangedFiles(): Set<string> {
  try {
    const r = runSync('git', ['diff', '--name-only', 'HEAD'], {
      cwd: ROOT,
      stdio: 'pipe',
      timeout: 10000,
    });
    if (r.status === 0) {
      return new Set(
        r.stdout
          .split('\n')
          .filter((l) => l.trim())
          .map((l) => l.trim()),
      );
    }
  } catch {
    /* fallback */
  }
  return new Set();
}

function phasePreValidate(): PhaseResult[] {
  const results: PhaseResult[] = [];
  log('=== FASE 1b: PRE-VALIDATION (Capa 1) ===');

  // 1b.1 Lightweight cross-reference scan (grep for broken imports in src/)
  try {
    const srcFiles = getAllFiles(join(ROOT, 'src'), '.ts');
    let brokenImports = 0;
    let totalImports = 0;

    for (const file of srcFiles) {
      const content = readFileSync(file, 'utf-8');
      // Strip comments AND template literals to avoid false positives
      const codeOnly = content
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/`[\s\S]*?`/g, ''); // Remove template literals (includes import strings)
      // Only match actual ES6 import statements at line start
      const importRegex = /^\s*import\s+.*?\s+from\s+['"](\.[^'"]+)['"];?\s*$/gm;
      let match: RegExpExecArray | null;

      while ((match = importRegex.exec(codeOnly)) !== null) {
        totalImports++;
        const importPath = match[1];
        const dir = file.substring(0, Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')));
        const resolved = resolve(join(dir, importPath)).replace(/\\/g, '/');
        const basePath = resolved.replace(/\.(js|mjs)$/, '');

        const canExist = [
          resolved,
          resolved + '.ts',
          resolved + '.tsx',
          resolved + '.js',
          resolved + '.jsx',
          resolved + '.mjs',
          resolved + '.json',
          basePath + '.ts',
          basePath + '.tsx',
          join(resolved, 'index.ts'),
          join(resolved, 'index.tsx'),
          join(resolved, 'index.js'),
          join(basePath, 'index.ts'),
          join(basePath, 'index.tsx'),
        ];

        if (!canExist.some((p) => existsSync(p))) {
          brokenImports++;
        }
      }
    }

    if (brokenImports > 0) {
      results.push({
        phase: 'cross-ref-scan',
        status: 'FAIL',
        detail: `${brokenImports} broken imports in ${totalImports} scanned`,
      });
      warn(`Pre-validation: ${brokenImports} broken imports found`);
    } else {
      results.push({
        phase: 'cross-ref-scan',
        status: 'PASS',
        detail: `${totalImports} imports ok`,
      });
    }
  } catch (e: unknown) {
    results.push({
      phase: 'cross-ref-scan',
      status: 'SKIP',
      detail: e instanceof Error ? e.message : 'Scan error',
    });
  }

  // 1b.2 Temp file check (via temp-file-registry import — inline fallback)
  try {
    const registryPath = join(ROOT, '.session', 'temp-file-registry.json');
    if (existsSync(registryPath)) {
      const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
      const entries = registry.entries || [];
      const authorizedPending = entries.filter(
        (e: { status: string }) => e.status === 'authorized-pending',
      );
      const temporary = entries.filter((e: { status: string }) => e.status === 'temporary');

      if (authorizedPending.length > 0) {
        results.push({
          phase: 'temp-pending',
          status: 'SKIP',
          detail: `${authorizedPending.length} file(s) pending integration`,
        });
        warn(`${authorizedPending.length} authorized-pending temp files — integrate or archive`);
      }

      if (temporary.length > 0) {
        results.push({
          phase: 'temp-temporary',
          status: 'SKIP',
          detail: `${temporary.length} temp file(s) not yet authorized`,
        });
        warn(`${temporary.length} temporary files awaiting authorization`);
      }

      results.push({
        phase: 'temp-registry',
        status: 'PASS',
        detail: `${entries.length} total tracked files`,
      });
    } else {
      // No registry file means no temp files were created this session — a
      // clean state, not a skipped step. Report PASS so the close report is
      // honest (no false SKIPs for a healthy condition).
      results.push({
        phase: 'temp-registry',
        status: 'PASS',
        detail: 'No temp files tracked — clean state',
      });
    }
  } catch (e: unknown) {
    results.push({
      phase: 'temp-registry',
      status: 'SKIP',
      detail: e instanceof Error ? e.message : 'Registry read error',
    });
  }

  // 1b.3 Error/warning scan on changed files
  try {
    const changedFiles = getChangedFiles();
    const tsFiles = Array.from(changedFiles).filter((f) => f.endsWith('.ts'));
    let todoCount = 0,
      fixmeCount = 0,
      tsIgnoreCount = 0;

    for (const file of tsFiles) {
      // The close orchestrator/validator contain the detection strings themselves
      // (e.g. `content.includes('TODO:')`); scanning them would self-match and
      // produce false-positive SKIPs. Exclude the scanners from the scan.
      if (file.includes('session-close-orchestrator') || file.includes('session-close-validator')) {
        continue;
      }
      const fullPath = join(ROOT, file);
      if (!existsSync(fullPath)) continue;
      const content = readFileSync(fullPath, 'utf-8');
      // Comment-aware detection: only count TODO/FIXME that appear in actual
      // comments (not inside string literals such as the scanner's own code).
      if (/\/\/\s*TODO:|(\/\*|\*)\s*TODO:/m.test(content)) todoCount++;
      if (/\/\/\s*FIXME|(\/\*|\*)\s*FIXME/m.test(content)) fixmeCount++;
      // Compiler directives (ts-expect-error / ts-ignore) are detected only as
      // real annotations on their own line, not inside string literals.
      if (/^\s*\/\/\s*@ts-(?:expect-error|ignore)/m.test(content)) tsIgnoreCount++;
    }

    if (todoCount > 0 || fixmeCount > 0 || tsIgnoreCount > 0) {
      const detail = `${todoCount} TODO / ${fixmeCount} FIXME / ${tsIgnoreCount} @ts-ignore in changed files`;
      results.push({ phase: 'error-warning-scan', status: 'SKIP', detail });
      if (fixmeCount > 0 || tsIgnoreCount > 0) warn(`Pre-validation: ${detail}`);
    } else {
      results.push({
        phase: 'error-warning-scan',
        status: 'PASS',
        detail: 'No errors/warnings in changed files',
      });
    }
  } catch (e: unknown) {
    results.push({
      phase: 'error-warning-scan',
      status: 'SKIP',
      detail: e instanceof Error ? e.message : 'Scan error',
    });
  }

  return results;
}

async function phasePersist(reason: string): Promise<PhaseResult[]> {
  const results: PhaseResult[] = [];
  log('=== FASE 2: PERSIST ===');

  // 2.1 Save engram session summary — UNIFIED BRIDGE (MCP + HTTP fallback).
  // Funciona en TODAS las herramientas (OpenCode, Claude, Cline, Cursor, etc.)
  // NO depende del plugin OpenCode automático — usa llamadas MCP explícitas
  const sessionData = readSessionData();
  const sessionId = String(sessionData.sessionId || sessionData.id || 'unknown');

  const summary = {
    goal: sessionData.goal ? String(sessionData.goal) : `Session completed with reason: ${reason}`,
    discoveries: Array.isArray(sessionData.discoveries)
      ? sessionData.discoveries.map((d: unknown) => String(d))
      : ['Session completed'],
    accomplished: Array.isArray(sessionData.accomplished)
      ? sessionData.accomplished.map((a: unknown) => String(a))
      : [`Session ${reason} completed`],
    nextSteps: [
      'Review session artifacts in .session/',
      'Verify Nexus DB health with npm run db:health',
    ],
  };

  try {
    // Usar bridge unificado que intenta MCP primero, luego HTTP fallback
    const engramResult = await sessionEnd(sessionId, summary);

    if (engramResult.mcpSuccess) {
      results.push({
        phase: 'engram-summary',
        status: 'PASS',
        detail: `Session closed via MCP (MCP: ${engramResult.mcpSuccess}, HTTP: ${engramResult.httpSuccess})`,
      });
      ok('Engram session closed successfully');
    } else if (engramResult.httpSuccess) {
      results.push({
        phase: 'engram-summary',
        status: 'PASS',
        detail: `Session closed via HTTP fallback`,
      });
      ok('Engram session closed via HTTP');
    } else {
      results.push({
        phase: 'engram-summary',
        status: 'SKIP',
        detail: `Engram not reachable: ${engramResult.error || 'Unknown error'} (non-blocking)`,
      });
      warn(`Engram session close skipped: ${engramResult.error || 'Unknown'}`);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    results.push({ phase: 'engram-summary', status: 'SKIP', detail: msg });
    warn(`Engram session close error: ${msg}`);
  }

  // 2.2 Save session scoring
  const sr = runScript(
    'src/session-scoring.ts',
    [
      '-Action',
      'record',
      '-EventType',
      'session',
      '-Detail',
      'session-close',
      ...(reason === 'verify' ? [] : ['-Success']),
    ],
    30000,
  );
  results.push({
    phase: 'session-scoring',
    status: sr.status === 0 ? 'PASS' : 'FAIL',
    detail: sr.status === 0 ? 'Scoring recorded' : `Exit: ${sr.status}`,
  });

  // 2.3 Save event to event sourcing
  const aggId = `session-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
  const er = runScript(
    'src/event-sourcing.ts',
    [
      '-Action',
      'append',
      '-AggregateId',
      aggId,
      '-EventType',
      'session.ended',
      '-EventData',
      JSON.stringify({ reason, closeTime: new Date().toISOString() }),
      '-Quiet',
    ],
    15000,
  );
  results.push({
    phase: 'event-store',
    status: er.status === 0 ? 'PASS' : 'FAIL',
    detail: er.status === 0 ? 'Event recorded' : `Exit: ${er.status}`,
  });

  // 2.4 Save final token metrics (close summary with segmented totals)
  const closeTokenArgs = [
    '--action',
    'close',
    '--session-id',
    String(sessionData.sessionId || sessionData.id || 'unknown'),
  ];
  const tm = runScript('src/tokens/token-metrics-store.ts', closeTokenArgs, 15000);
  const closeSummaryFile = join(SESSION_DIR, 'token-close-summary.json');
  if (existsSync(closeSummaryFile)) {
    try {
      const summary = JSON.parse(readFileSync(closeSummaryFile, 'utf-8')) as Record<
        string,
        unknown
      >;
      const seg = `in=${summary.input_tokens} out=${summary.output_tokens} total=${summary.total_tokens} cost=$${Number(summary.cost_usd ?? 0).toFixed(4)} (${summary.source})`;
      results.push({
        phase: 'token-metrics',
        status: tm.status === 0 ? 'PASS' : 'SKIP',
        detail: `Metrics stored — ${seg}`,
      });
      console.log('');
      console.log('══════════════════════════════════════════════════════');
      console.log('  SESSION TOKEN SUMMARY');
      console.log('══════════════════════════════════════════════════════');
      console.log(`  Session:    ${summary.session_id}`);
      console.log(`  Input:      ${Number(summary.input_tokens ?? 0).toLocaleString()} tokens`);
      console.log(`  Output:     ${Number(summary.output_tokens ?? 0).toLocaleString()} tokens`);
      console.log(`  Total:      ${Number(summary.total_tokens ?? 0).toLocaleString()} tokens`);
      console.log(`  Cost:       $${Number(summary.cost_usd ?? 0).toFixed(4)} USD`);
      console.log(`  Source:     ${summary.source}`);
      console.log('══════════════════════════════════════════════════════');
      console.log('');
    } catch {
      results.push({
        phase: 'token-metrics',
        status: tm.status === 0 ? 'PASS' : 'SKIP',
        detail: tm.status === 0 ? 'Metrics stored' : 'Token metrics store skipped',
      });
    }
  } else {
    results.push({
      phase: 'token-metrics',
      status: tm.status === 0 ? 'PASS' : 'SKIP',
      detail: tm.status === 0 ? 'Metrics stored' : 'Token metrics store skipped',
    });
  }

  return results;
}

function phaseBackup(): PhaseResult[] {
  const results: PhaseResult[] = [];
  log('=== FASE 3: BACKUP ===');

  // 3.1 Create checkpoint
  const cp = runScript(
    'src/checkpoint-manager.ts',
    ['create', '--label', `session-close-${new Date().toISOString().slice(0, 16)}`],
    30000,
  );
  results.push({
    phase: 'checkpoint-create',
    status: cp.status === 0 ? 'PASS' : 'FAIL',
    detail: cp.status === 0 ? 'Checkpoint created' : `Exit: ${cp.status}`,
  });

  // 3.2 Backup Nexus DB
  const dbBackupScript = join(ROOT, 'scripts', 'database', 'db-backup.ts');
  if (existsSync(dbBackupScript)) {
    const br = runScript('scripts/database/db-backup.ts', ['backup', '--quiet'], 30000);
    results.push({
      phase: 'nexus-backup',
      status: br.status === 0 ? 'PASS' : 'FAIL',
      detail: br.status === 0 ? 'Nexus DB backed up' : `Exit: ${br.status}`,
    });
  } else {
    // Fallback: use npm run db:backup
    try {
      const br = runCmd(
        'npx',
        ['tsx', 'scripts/database/db-backup.ts', 'backup', '--quiet'],
        30000,
      );
      results.push({
        phase: 'nexus-backup',
        status: br.status === 0 ? 'PASS' : 'FAIL',
        detail: br.status === 0 ? 'Nexus DB backed up' : `Exit: ${br.status}`,
      });
    } catch {
      results.push({ phase: 'nexus-backup', status: 'FAIL', detail: 'Backup script not found' });
    }
  }

  // 3.3 Backup Engram
  const eb = runScript('src/backup-engram.ts', ['--mode', 'backup', '--quiet'], 30000);
  results.push({
    phase: 'engram-backup',
    status: eb.status === 0 ? 'PASS' : 'SKIP',
    detail: eb.status === 0 ? 'Engram backed up' : 'Engram backup script skipped',
  });

  // 3.4 Prune old checkpoints
  const pp = runScript('src/checkpoint-manager.ts', ['prune'], 15000);
  results.push({
    phase: 'checkpoint-prune',
    status: pp.status === 0 ? 'PASS' : 'SKIP',
    detail: pp.status === 0 ? 'Old checkpoints pruned' : 'Prune skipped',
  });

  return results;
}

function phaseAudit(): PhaseResult[] {
  const results: PhaseResult[] = [];
  log('=== FASE 4: AUDIT ===');

  // 4.1 Audit pipeline log
  const ar = runScript(
    'src/infrastructure/audit-pipeline.ts',
    [
      'log',
      '-EventType',
      'session.end',
      '-Component',
      'system',
      '-Operation',
      'session-close-orchestrator',
      '-Actor',
      'system',
      '-Status',
      'success',
      '-Message',
      `Session closed via orchestrator`,
      '-Quiet',
    ],
    15000,
  );
  results.push({
    phase: 'audit-log',
    status: ar.status === 0 ? 'PASS' : 'FAIL',
    detail: ar.status === 0 ? 'Audit logged' : `Exit: ${ar.status}`,
  });

  // 4.2 CodeGraph sync (if there were file changes)
  const cg = runScript('src/codegraph-sync-autostart.ts', [], 30000);
  results.push({
    phase: 'codegraph-sync',
    status: cg.status === 0 ? 'PASS' : 'SKIP',
    detail: cg.status === 0 ? 'CodeGraph synced' : 'Sync skipped',
  });

  return results;
}

// ─── Process Killer ────────────────────────────────────────────────────────────

interface KillTarget {
  name: string;
  matcher: string;
  /** Required daemons are started by session-autostart and MUST be running at close. */
  required: boolean;
}

const KILL_TARGETS: KillTarget[] = [
  { name: 'CodeGraph MCP', matcher: 'codegraph.*mcp', required: true },
  { name: 'Dashboard WS', matcher: 'websocket-server', required: false },
  { name: 'Timeout Daemon', matcher: 'timeout-monitor.*daemon', required: true },
  // Optional daemon: the token-ingest --watch loop survives the close today and
  // keeps appending to .runtime/token-ingest.log. Not required → SKIP if it was
  // never started; never FAILs (avoids false positives in the close report).
  { name: 'Token Ingest', matcher: 'token-ingest', required: false },
];

/** True if at least one process (node/tsx) matches the command-line matcher. */
function isProcessRunning(matcher: string): boolean {
  const isWin = process.platform === 'win32';
  try {
    if (isWin) {
      const psCmd = `@(@(Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='tsx.exe'" | Where-Object { $_.CommandLine -match '${matcher}' -and $_.ProcessId -ne ${process.pid} -and $_.CommandLine -notmatch 'session-close-orchestrator' })).Count`;
      const r = runSync('powershell', ['-NoProfile', '-Command', psCmd], {
        timeout: 10000,
        stdio: 'pipe',
      });
      const count = parseInt((r.stdout ?? '').trim(), 10);
      return !isNaN(count) && count > 0;
    }
    // Array form: matcher may contain spaces/quotes — shell quoting is unreliable.
    const r = runSync('pgrep', ['-f', matcher], { timeout: 5000 });
    return r.status === 0;
  } catch {
    return false;
  }
}

/**
 * Poll for a matching process to appear, up to timeoutMs. The daemons are
 * started lazily by session-autostart and can still be booting if the session
 * closes quickly, so we give them a short window before deciding they're down.
 */
/**
 * True when the close protocol is running at SESSION STARTUP rather than at a
 * real session end. The autostart pipeline launches this orchestrator with
 * --reason autostart-close (and the lightweight mode uses 'startup-cleanup').
 * In those cases the daemons (codegraph, timeout, dashboard WS) were JUST
 * started by the autostart, so the daemon-kill phase must be skipped.
 */
function isStartupClose(reason: string): boolean {
  return reason === 'autostart-close' || reason === 'startup-cleanup';
}

function waitForProcess(matcher: string, timeoutMs: number): boolean {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isProcessRunning(matcher)) return true;
    // Synchronous ~500ms sleep (Atomics.wait on a shared buffer).
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  return isProcessRunning(matcher);
}

function killProcessByCommandLine(matcher: string): boolean {
  const isWin = process.platform === 'win32';
  try {
    if (isWin) {
      // Windows: use CIM to find and kill processes matching command line.
      // Safety: NEVER kill the orchestrator itself or its ancestors. Exclude:
      //   - the current PID
      //   - the parent PID (npx/cmd wrapper that spawned tsx)
      //   - any process whose CommandLine references this script by name
      //     (protects the whole process tree: npx → tsx → orchestrator)
      const selfName = 'session-close-orchestrator';
      const psCmd = `Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='tsx.exe'" | Where-Object { $_.CommandLine -match '${matcher}' -and $_.ProcessId -ne ${process.pid} -and $_.ProcessId -ne ${process.ppid ?? -1} -and $_.CommandLine -notmatch '${selfName}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Output "Killed PID $($_.ProcessId)" }`;
      const r = runSync('powershell', ['-NoProfile', '-Command', psCmd], {
        timeout: 15000,
        stdio: 'pipe',
      });
      const out = r.stdout.trim();
      return out.length > 0; // true if at least one process was killed
    } else {
      // Unix: use pkill -f, excluding the current process
      runSync('pkill', ['-f', matcher], { timeout: 10000, stdio: 'pipe' });
      // Verify if any matching processes (other than self) were killed
      const pgrep = runSync('pgrep', ['-f', matcher], { timeout: 5000 });
      return pgrep.status !== 0;
    }
  } catch {
    return false;
  }
}

function phaseCleanup(skipDaemonKill = false): PhaseResult[] {
  const results: PhaseResult[] = [];
  log('=== FASE 5: CLEANUP ===');

  // 5.1 Kill child processes (CodeGraph MCP, Dashboard WS, Timeout Daemon).
  // When running at SESSION STARTUP (reason 'autostart-close' / 'startup-cleanup')
  // this MUST be skipped: the daemons were just started by the autostart pipeline
  // and killing them would defeat the purpose of the session (see close reports
  // with reason=autostart-close that killed the freshly-booted codegraph daemon).
  if (!skipDaemonKill) {
    // 5.1 Kill child processes (CodeGraph MCP, Dashboard WS, Timeout Daemon)
    const DAEMON_WAIT_MS = 10000; // give lazy daemons time to finish booting
    for (const target of KILL_TARGETS) {
      const phase = `kill-${target.name.toLowerCase().replace(/\s+/g, '-')}`;
      try {
        // Wait for the daemon to be up (it's started lazily at session start and
        // may still be booting if the session closed quickly).
        const appeared = waitForProcess(target.matcher, DAEMON_WAIT_MS);
        if (appeared) {
          const killed = killProcessByCommandLine(target.matcher);
          results.push({
            phase,
            status: killed ? 'PASS' : 'FAIL',
            detail: killed
              ? `${target.name} terminated`
              : `${target.name} found but could not be terminated`,
          });
          if (killed) ok(`${target.name} process killed`);
        } else if (target.required) {
          // A required daemon should have been running all session. Its absence
          // is a real problem — surface it instead of hiding it as a SKIP.
          results.push({
            phase,
            status: 'FAIL',
            detail: `${target.name} was not running at session close (expected a running daemon)`,
          });
          warn(`${target.name} was not running at session close`);
        } else {
          // Optional daemon (e.g. Dashboard WS) legitimately not started.
          results.push({
            phase,
            status: 'PASS',
            detail: `${target.name} not running (optional, not started)`,
          });
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Unknown error';
        results.push({
          phase,
          status: 'FAIL',
          detail: msg,
        });
      }
    }

    // 5.2 Clean the session-persistence marker (`.active-session.json`). This
    // file tells smart-autostart / gv.ts that a session is alive; it must not
    // outlive a real close. At SESSION STARTUP (skipDaemonKill) it is left
    // untouched — the daemons just booted and the marker may belong to the
    // fresh session.
    try {
      const activeSessionPath = join(SESSION_DIR, '.active-session.json');
      if (existsSync(activeSessionPath)) {
        unlinkSync(activeSessionPath);
        results.push({
          phase: 'cleanup-active-session',
          status: 'PASS',
          detail: '.active-session.json removed',
        });
        ok('.active-session.json removed');
      } else {
        results.push({
          phase: 'cleanup-active-session',
          status: 'PASS',
          detail: '.active-session.json not present (clean state)',
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      results.push({ phase: 'cleanup-active-session', status: 'FAIL', detail: msg });
      warn(`Active-session cleanup failed: ${msg}`);
    }
  } // end if (!skipDaemonKill)

  // 5.3 Also kill any orphan session daemon processes (metrics tracker, cleanup daemons).
  // NOTE: matcher is deliberately specific — it must NOT match this orchestrator
  // (session-close-orchestrator.ts) or its wrapper, otherwise we kill ourselves
  // mid-run and never write the close report. See killProcessByCommandLine self-exclusion.
  try {
    const orphanKilled = killProcessByCommandLine(
      'session-(metrics-tracker|cleanup-start|metrics-memory)',
    );
    if (orphanKilled) {
      results.push({
        phase: 'kill-orphan-session',
        status: 'PASS',
        detail: 'Orphan session daemons killed',
      });
      ok('Orphan session processes cleaned');
    }
  } catch {
    /* skip silently */
  }

  // 5.4 Clean temp files (unregistered + stale registry entries)
  try {
    const registryPath = join(ROOT, '.session', 'temp-file-registry.json');
    if (existsSync(registryPath)) {
      // Clean unregistered temp files
      const tempDirs = ['.session/tmp/', '.session/cache/', '.temp/', 'tmp/'];
      let cleanedCount = 0;
      for (const dir of tempDirs) {
        const fullDir = join(ROOT, dir);
        if (!existsSync(fullDir)) continue;
        try {
          const entries = readdirSync(fullDir, { withFileTypes: true });
          for (const entry of entries) {
            const full = join(fullDir, entry.name);
            if (entry.isFile() && !entry.name.endsWith('.gitkeep')) {
              // Check if registered
              const relPath = relative(ROOT, full).replace(/\\/g, '/');
              const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
              const isRegistered = (registry.entries || []).some(
                (e: { path: string }) => e.path === relPath,
              );
              if (!isRegistered) {
                rmSync(full, { force: true });
                cleanedCount++;
              }
            }
          }
        } catch {
          /* skip */
        }
      }
      if (cleanedCount > 0) {
        results.push({
          phase: 'temp-cleanup',
          status: 'PASS',
          detail: `Cleaned ${cleanedCount} unregistered temp files`,
        });
        ok(`Temp cleanup: removed ${cleanedCount} unregistered files`);
      } else {
        // Clean state — nothing to remove. PASS, not SKIP.
        results.push({
          phase: 'temp-cleanup',
          status: 'PASS',
          detail: 'No temp files to clean — clean state',
        });
      }
    } else {
      // No registry file => no temp files were created this session. Clean.
      results.push({
        phase: 'temp-cleanup',
        status: 'PASS',
        detail: 'No temp registry — clean state',
      });
    }
  } catch (e: unknown) {
    results.push({
      phase: 'temp-cleanup',
      status: 'SKIP',
      detail: e instanceof Error ? e.message : 'Cleanup error',
    });
  }

  // 5.5 Flush caches and reset
  const cr = runScript('src/session-cleanup-start.ts', ['-SkipOrphanCleanup', '-Quiet'], 60000);
  results.push({
    phase: 'cache-flush',
    status: cr.status === 0 ? 'PASS' : 'FAIL',
    detail: cr.status === 0 ? 'Caches flushed' : `Exit: ${cr.status}`,
  });

  return results;
}

function phaseVerify(): PhaseResult[] {
  const results: PhaseResult[] = [];
  log('=== FASE 6: VERIFY ===');

  // 6.1 Verify session file exists
  const sessionFile = getSessionFile();
  results.push({
    phase: 'session-file',
    status: existsSync(sessionFile) ? 'PASS' : 'FAIL',
    detail: existsSync(sessionFile) ? sessionFile : 'session-current.json not found',
  });

  // 6.2 Verify Nexus DB health
  const dh = runScript('scripts/database/db-health.ts', [], 15000);
  const healthy =
    dh.stdout.includes('healthy') || dh.stdout.includes('HEALTHY') || dh.stdout.includes('[ OK ]');
  results.push({
    phase: 'nexus-health',
    status: healthy ? 'PASS' : 'FAIL',
    detail: healthy ? 'Nexus DB healthy' : 'Nexus DB may have issues',
  });

  // 6.3 Verify checkpoint exists (ckpt-* are directories, not .json files)
  const ckptDir = join(SESSION_DIR, 'checkpoints');
  const ckpts: string[] = [];
  if (existsSync(ckptDir)) {
    const entries = readdirSync(ckptDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('ckpt-')) {
        ckpts.push(entry.name);
      }
    }
  }
  results.push({
    phase: 'checkpoint-exists',
    status: ckpts.length > 0 ? 'PASS' : 'SKIP',
    detail: ckpts.length > 0 ? `${ckpts.length} checkpoint(s) found` : 'No checkpoints',
  });

  // 6.4 Verify backup exists
  const backupDir = join(RUNTIME_DIR, 'backups');
  const backups = existsSync(backupDir) ? readdirSync(backupDir) : [];
  results.push({
    phase: 'backup-exists',
    status: backups.length > 0 ? 'PASS' : 'SKIP',
    detail: backups.length > 0 ? `${backups.length} backup(s) found` : 'No backups',
  });

  return results;
}

// ─── Orchestrator ───────────────────────────────────────────────────────────────

export interface CloseReport {
  timestamp: string;
  reason: string;
  totalPhases: number;
  passed: number;
  failed: number;
  skipped: number;
  phases: {
    preClose: PhaseResult[];
    preValidate: PhaseResult[];
    persist: PhaseResult[];
    backup: PhaseResult[];
    audit: PhaseResult[];
    cleanup: PhaseResult[];
    verify: PhaseResult[];
  };
  validationScore?: number;
  overall: 'PASS' | 'PASS_WITH_WARNINGS' | 'FAIL';
}

export async function runCloseOrchestrator(reason = 'session-end'): Promise<CloseReport> {
  log('═══════════════════════════════════════════');
  log('  SESSION CLOSE ORCHESTRATOR v2.0');
  log(`  Reason: ${reason}`);
  log('═══════════════════════════════════════════');

  // Run pre-validation (Capa 1 — always)
  const preValidateResults = phasePreValidate();

  const isStartup = isStartupClose(reason);
  if (isStartup) log('[STARTUP] Skipping daemon-kill phase (autostart-close)');

  const phases = {
    preClose: phasePreClose(reason),
    preValidate: preValidateResults,
    persist: await phasePersist(reason),
    backup: phaseBackup(),
    audit: phaseAudit(),
    cleanup: phaseCleanup(isStartup),
    verify: phaseVerify(),
  };

  const allResults = [
    ...phases.preClose,
    ...phases.preValidate,
    ...phases.persist,
    ...phases.backup,
    ...phases.audit,
    ...phases.cleanup,
    ...phases.verify,
  ];

  const passed = allResults.filter((r) => r.status === 'PASS').length;
  const failed = allResults.filter((r) => r.status === 'FAIL').length;
  const skipped = allResults.filter((r) => r.status === 'SKIP').length;

  let overall: CloseReport['overall'] = 'PASS';
  if (failed > 0) overall = 'FAIL';
  else if (skipped > 0 && passed > 0) overall = 'PASS_WITH_WARNINGS';

  // Calculate validation score (0-100) from pre-validate results
  const validationScore =
    preValidateResults.length > 0
      ? Math.round(
          (preValidateResults.filter((r) => r.status === 'PASS').length /
            preValidateResults.length) *
            100,
        )
      : undefined;

  log('═══════════════════════════════════════════');
  log(`  RESULTS: ${passed} PASS / ${failed} FAIL / ${skipped} SKIP`);
  log(`  VALIDATION: ${validationScore !== undefined ? `${validationScore}/100` : 'N/A'}`);
  log(`  OVERALL: ${overall}`);
  log('═══════════════════════════════════════════');

  for (const r of allResults) {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⏭️';
    console.log(`  ${icon} [${r.phase}] ${r.detail}`);
  }

  if (overall === 'FAIL') {
    warn('Some phases failed. Review the details above.');
  }

  return {
    timestamp: new Date().toISOString(),
    reason,
    totalPhases: allResults.length,
    passed,
    failed,
    skipped,
    phases,
    validationScore,
    overall,
  };
}

// ─── CLI ────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // ─── Guardian Protection ────────────────────────────────────────────────────
  // Detect previous informal close attempts before proceeding with the official
  // close protocol. If a prior informal attempt is detected, record the learning
  // so the pattern is registered for future sessions.
  const guardian = guardianCheck();
  if (!guardian.passed) {
    learnFromMistake(
      `Orchestrator invoked after informal close attempt: ${guardian.warning || 'unknown reason'}`,
    );
  }

  // Lightweight mode for session-start cleanup (skip pre-validate, backup, audit, verify)
  if (args.includes('--lightweight') || args.includes('-l')) {
    let reason = 'startup-cleanup';
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--reason' && i + 1 < args.length) reason = args[++i];
    }
    // Run only the essential startup-cleanup phases
    phasePreClose(reason);
    await phasePersist(reason);
    const cleanupResults = phaseCleanup(isStartupClose(reason));
    const passed = cleanupResults.filter((r) => r.status === 'PASS').length;
    const failed = cleanupResults.filter((r) => r.status === 'FAIL').length;
    ok(`Lightweight cleanup: ${passed} pass, ${failed} fail`);
    process.exit(failed > 0 ? 1 : 0);
  }

  if (args.includes('--verify') || args.includes('-v')) {
    log('Running verification-only mode...');
    const verifyResults = phaseVerify();
    log('═══════════════════════════════════════════');
    log('  VERIFICATION RESULTS');
    log('═══════════════════════════════════════════');
    for (const r of verifyResults) {
      const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⏭️';
      LOG.info(`  ${icon} [${r.phase}] ${r.detail}`);
    }
    const allPass = verifyResults.every((r) => r.status === 'PASS');
    LOG.info(`\n  Overall: ${allPass ? '✅ ALL PASS' : '❌ SOME FAILURES'}`);
    process.exit(allPass ? 0 : 1);
  }

  let reason = 'session-end';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--reason' && i + 1 < args.length) reason = args[++i];
  }

  const report = await runCloseOrchestrator(reason);

  // Write report
  mkdirSync(SESSION_DIR, { recursive: true });
  const reportFile = join(
    SESSION_DIR,
    `close-report-${new Date().toISOString().slice(0, 16).replace(/[:-]/g, '')}.json`,
  );
  writeFileSync(reportFile, JSON.stringify(report, null, 2));
  ok(`Report written to ${reportFile}`);

  // If --validate, run deep validator as spawned process (non-blocking if lazy)
  if (args.includes('--validate')) {
    const validateMode = args.includes('--deep')
      ? 'deep'
      : args.includes('--full')
        ? 'full'
        : 'quick';
    const dryRun = args.includes('--dry-run');
    const autoFix = args.includes('--auto-fix');
    log(`Invoking session-close-validator (mode: ${validateMode})...`);
    const vr = runScript(
      'src/session-close-validator.ts',
      [
        '--mode',
        validateMode,
        ...(dryRun ? ['--dry-run'] : []),
        ...(autoFix ? ['--auto-fix'] : []),
        '--report',
      ],
      120000,
    );
    if (vr.status === 0) ok('Deep validation passed');
    else warn(`Deep validation finished with exit code ${vr.status}`);
  }

  process.exit(report.overall === 'FAIL' ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    LOG.error('FATAL: ' + e.message);
    process.exit(1);
  });
}
