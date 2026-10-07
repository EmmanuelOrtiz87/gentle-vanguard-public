import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  mkdirSync,
} from 'fs';
import { join, resolve, relative } from 'path';
import { runHygiene } from '../../core/process-hygiene.js';
import { runNpxTsxSync } from '../../core/run-command.js';
import { sessionEnd } from '../../knowledge/engram-session-bridge.js';
import {
  ROOT,
  SESSION_DIR,
  RUNTIME_DIR,
  PhaseResult,
  log,
  ok,
  warn,
  getSessionFile,
  readSessionData,
  writeSessionData,
  runScript,
  runCmd,
  getAllFiles,
  getChangedFiles,
} from './helpers.js';
import { KILL_TARGETS, waitForProcess, killProcessByCommandLine } from './process.js';
import { runArtifactRetention } from '../artifact-retention.js';
import { generateReview4R, formatReview4R } from '../../rdd/rdd-4r-review.js';
import { captureOutcomeFeedback, OUTCOME_FEEDBACK_SOURCE } from '../outcome-feedback.js';
import { log as createLogger } from '../../utils/logger.js';
import { getSessionIntent } from '../session-intent-capture.js';
import { getInventory } from '../session-validator.js';
import { extractRealImports, findBrokenRelativeImports } from '../../tools/ast-import-parser.js';

const LOG_CLEANUP = createLogger('SESSION-CLEANUP');

/**
 * Closing marker — apps-keepalive y otros daemons periódicos lo consultan al
 * arrancar cada ciclo para evitar reviving apps mientras session-close está
 * matando daemons. Se crea al inicio de phasePreClose (la fase más temprana
 * del protocolo) y se borra al iniciar una nueva sesión (session-autostart).
 *
 * Creado: 2026-09-16 — fix ventanas fantasma (apps-keepalive race).
 */
const CLOSING_MARKER = resolve(SESSION_DIR, '.closing');

// Session retention - run after cleanup to maintain limits
function runSessionRetention(apply: boolean): { removed: number; kept: number } {
  try {
    const retentionScript = join(ROOT, 'src/session/session-retention.ts');
    if (existsSync(retentionScript)) {
      runNpxTsxSync(retentionScript, apply ? ['prune'] : ['status'], {
        cwd: ROOT,
        stdio: 'pipe',
        timeout: 30000,
      });
      // Return dummy values - actual stats are logged
      return { removed: 0, kept: 0 };
    }
  } catch {
    /* skip silently */
  }
  return { removed: 0, kept: 0 };
}
const logger = createLogger('SESSION-SESSION-CLOSE-PHASES');

// ─── Fases ──────────────────────────────────────────────────────────────────────

export function phasePreClose(reason: string): PhaseResult[] {
  const results: PhaseResult[] = [];
  log('=== FASE 1: PRE-CLOSE ===');

  // 1.0 Create closing marker FIRST — apps-keepalive checks this every cycle
  // (cron-like, 15 min) and must see it BEFORE we start killing daemons, so it
  // doesn't revive apps that the cleanup phase is about to stop.
  try {
    mkdirSync(SESSION_DIR, { recursive: true });
    writeFileSync(
      CLOSING_MARKER,
      JSON.stringify({
        createdAt: new Date().toISOString(),
        reason,
        pid: process.pid,
      }),
    );
    results.push({
      phase: 'closing-marker',
      status: 'PASS',
      detail: `Closing marker written to ${CLOSING_MARKER}`,
    });
    ok('Closing marker created (apps-keepalive will bail next cycle)');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    results.push({ phase: 'closing-marker', status: 'FAIL', detail: msg });
    warn(`Closing marker write failed: ${msg}`);
  }

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
                'src/monitor/tracing-instrument.ts',
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

export function phasePreValidate(): PhaseResult[] {
  const results: PhaseResult[] = [];
  log('=== FASE 1b: PRE-VALIDATION (Capa 1) ===');

  // OPTIMIZATION: Get changed files first for targeted scanning
  const changedFiles = getChangedFiles();
  const hasChanges = changedFiles.size > 0;

  // 1b.1 Lightweight cross-reference scan
  // OPTIMIZATION: Only scan changed files if there are changes,
  // otherwise do a quick sanity check on key files
  try {
    let srcFiles: string[];

    if (hasChanges) {
      // FAST PATH: Only scan changed .ts files
      srcFiles = Array.from(changedFiles)
        .filter((f) => f.endsWith('.ts'))
        .map((f) => join(ROOT, f));
    } else {
      // No changes - do a quick scan of recently modified files only
      // (not ALL files - that's too slow)
      srcFiles = getAllFiles(join(ROOT, 'src'), '.ts').slice(0, 50); // Limit to 50 files
    }

    const brokenImports: Array<{ file: string; path: string; line: number }> = [];
    let totalImports = 0;

    for (const file of srcFiles) {
      totalImports += extractRealImports(readFileSync(file, 'utf8'), file).filter((entry) =>
        entry.path.startsWith('.'),
      ).length;
      const fileImports = findBrokenRelativeImports(file);
      brokenImports.push(
        ...fileImports.map((entry) => ({
          file: relative(ROOT, file),
          path: entry.path,
          line: entry.line,
        })),
      );
    }

    if (brokenImports.length > 0) {
      const locations = brokenImports
        .slice(0, 5)
        .map((entry) => `${entry.file}:${entry.line} -> ${entry.path}`)
        .join(', ');
      results.push({
        phase: 'cross-ref-scan',
        status: 'FAIL',
        detail: `${brokenImports.length} broken imports: ${locations}`,
      });
      warn(`Pre-validation: ${brokenImports.length} broken imports found`);
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
      // Scanner implementations contain their own diagnostic patterns and must not self-match.
      const normalizedFile = file.replace(/\\/g, '/');
      if (
        normalizedFile.startsWith('src/session/session-close/') ||
        normalizedFile.endsWith('/session-close-orchestrator.ts') ||
        normalizedFile.endsWith('/session-close-validator.ts')
      ) {
        continue;
      }
      const fullPath = join(ROOT, file);
      if (!existsSync(fullPath)) continue;
      const content = readFileSync(fullPath, 'utf-8');
      // Comment-aware detection ignores matching text inside ordinary string literals.
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

export async function phasePersist(reason: string): Promise<PhaseResult[]> {
  const results: PhaseResult[] = [];
  log('=== FASE 2: PERSIST ===');

  // 2.1 Save engram session summary — UNIFIED BRIDGE (MCP + HTTP fallback).
  // Ahora usa intent capturado al inicio de la sesión para un resumen más útil
  const sessionData = readSessionData();
  const sessionId = String(sessionData.sessionId || sessionData.id || 'unknown');

  // Get captured intent for better summary
  const capturedIntent = getSessionIntent();

  const summary = {
    // Use captured goal from session start, not generic "Session completed"
    goal: capturedIntent?.goal
      ? capturedIntent.goal
      : sessionData.goal
        ? String(sessionData.goal)
        : `Session completed with reason: ${reason}`,
    discoveries: Array.isArray(sessionData.discoveries)
      ? sessionData.discoveries.map((d: unknown) => String(d))
      : capturedIntent
        ? [`Domain: ${capturedIntent.domain}`, `Intent: ${capturedIntent.intent}`]
        : ['Session completed'],
    accomplished: Array.isArray(sessionData.accomplished)
      ? sessionData.accomplished.map((a: unknown) => String(a))
      : [`Session ${reason} completed`],
    nextSteps: [
      capturedIntent ? `Session type: ${capturedIntent.intent} (${capturedIntent.domain})` : '',
      'Review session artifacts in .session/',
      'Verify Nexus DB health with npm run db:health',
    ].filter(Boolean),
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
    'src/session/session-scoring.ts',
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
    'src/tools/event-sourcing.ts',
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
      logger.info('');
      logger.info('══════════════════════════════════════════════════════');
      logger.info('  SESSION TOKEN SUMMARY');
      logger.info('══════════════════════════════════════════════════════');
      logger.info(`  Session:    ${summary.session_id}`);
      logger.info(`  Input:      ${Number(summary.input_tokens ?? 0).toLocaleString()} tokens`);
      logger.info(`  Output:     ${Number(summary.output_tokens ?? 0).toLocaleString()} tokens`);
      logger.info(`  Total:      ${Number(summary.total_tokens ?? 0).toLocaleString()} tokens`);
      logger.info(`  Cost:       $${Number(summary.cost_usd ?? 0).toFixed(4)} USD`);
      logger.info(`  Source:     ${summary.source}`);
      logger.info('══════════════════════════════════════════════════════');
      logger.info('');
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

  // 2.5 Derive outcome feedback (auto-outcome) from REAL session signals and
  // write it into the Nexus `feedback` table. Honest signals only: conclusive
  // positive/negative outcome → one row; inconclusive → nothing. Failure of
  // this step must never fail the close.
  try {
    const { createRequire } = await import('module');
    const req = createRequire(import.meta.url);
    const mod = req('../../database/nexus//manager') as {
      DatabaseManager: { getInstance: () => { getDb: () => import('better-sqlite3').Database } };
    };
    const db = mod.DatabaseManager.getInstance().getDb();
    const failedPhaseCount = results.filter((r) => r.status === 'FAIL').length;
    const fb = captureOutcomeFeedback(db, sessionId, { failedPhaseCount });
    results.push({
      phase: 'outcome-feedback',
      status: 'PASS',
      detail: fb.written
        ? `Auto feedback '${fb.type}' recorded (${OUTCOME_FEEDBACK_SOURCE}: ${fb.reason})`
        : `Feedback evaluated; no record needed (${fb.reason})`,
    });
    if (fb.written) ok(`Outcome feedback recorded: ${fb.type}`);
  } catch (e: unknown) {
    results.push({
      phase: 'outcome-feedback',
      status: 'SKIP',
      detail: `Outcome feedback skipped: ${e instanceof Error ? e.message : 'Unknown error'}`,
    });
    warn('Outcome feedback capture failed (non-blocking)');
  }

  return results;
}

export function phaseBackup(): PhaseResult[] {
  const results: PhaseResult[] = [];
  log('=== FASE 3: BACKUP ===');

  // 3.1 Create checkpoint
  const cp = runScript(
    'src/ops/checkpoint-manager.ts',
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
  const eb = runScript('src/ops/backup-engram.ts', ['--mode', 'backup', '--quiet'], 30000);
  results.push({
    phase: 'engram-backup',
    status: eb.status === 0 ? 'PASS' : 'SKIP',
    detail: eb.status === 0 ? 'Engram backed up' : 'Engram backup script skipped',
  });

  // 3.4 Prune old checkpoints
  const pp = runScript('src/ops/checkpoint-manager.ts', ['prune'], 15000);
  results.push({
    phase: 'checkpoint-prune',
    status: pp.status === 0 ? 'PASS' : 'SKIP',
    detail: pp.status === 0 ? 'Old checkpoints pruned' : 'Prune skipped',
  });

  return results;
}

export function phaseAudit(): PhaseResult[] {
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
  const cg = runScript('src/integrations/codegraph-sync-autostart.ts', [], 30000);
  results.push({
    phase: 'codegraph-sync',
    status: cg.status === 0 ? 'PASS' : 'SKIP',
    detail: cg.status === 0 ? 'CodeGraph synced' : 'Sync skipped',
  });

  // 4.3 RDD 4R review (Risk, Readability, Reliability, Resilience)
  // Auto-reviews changed code files for risk patterns before session close.
  try {
    const changedFiles = getChangedFiles();
    const review = generateReview4R(
      'session-close',
      [...changedFiles],
      'session-close-orchestrator',
    );
    const critical = review.riskFindings.filter((f) => f.severity === 'critical').length;
    const total =
      review.riskFindings.length +
      review.readabilityFindings.length +
      review.reliabilityFindings.length +
      review.resilienceFindings.length;
    results.push({
      phase: 'rdd-4r-review',
      status: critical === 0 ? 'PASS' : 'FAIL',
      detail:
        total === 0
          ? '4R review: no findings'
          : `4R review: ${total} finding(s), ${critical} critical (approved: ${review.approved})`,
    });
    if (total > 0) {
      log(formatReview4R(review));
    }
  } catch (err) {
    results.push({
      phase: 'rdd-4r-review',
      status: 'SKIP',
      detail: `4R review skipped: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return results;
}

export async function phaseCleanup(
  skipDaemonKill = false,
  retentionAuthorized = false,
): Promise<PhaseResult[]> {
  const results: PhaseResult[] = [];
  log('=== FASE 5: CLEANUP ===');

  // Get session inventory for selective close
  let inventory: ReturnType<typeof getInventory> = null;
  try {
    inventory = getInventory();
    if (inventory) {
      LOG_CLEANUP.info(`[INVENTORY] Resources to close: ${JSON.stringify(inventory)}`);
    }
  } catch (err) {
    LOG_CLEANUP.warn(`[INVENTORY] Could not load inventory: ${err}`);
  }

  // 5.1 Kill child processes (CodeGraph MCP and Timeout Daemon).
  // When running at SESSION STARTUP (reason 'autostart-close' / 'startup-cleanup')
  // this MUST be skipped: the daemons were just started by the autostart pipeline
  // and killing them would defeat the purpose of the session (see close reports
  // with reason=autostart-close that killed the freshly-booted codegraph daemon).
  if (!skipDaemonKill) {
    // 5.1 Kill child processes (CodeGraph MCP and Timeout Daemon). Dashboard WS
    // persists between sessions and is managed by the Apps Control Panel.
    const DAEMON_WAIT_MS = 10000; // give lazy daemons time to finish booting

    // Build list of targets: use inventory if available, otherwise fallback to KILL_TARGETS
    const targetsToKill =
      inventory?.daemonsStarted && inventory.daemonsStarted.length > 0
        ? KILL_TARGETS.filter((t) => inventory.daemonsStarted.includes(t.name) || t.required)
        : KILL_TARGETS;

    if (inventory?.daemonsStarted && inventory.daemonsStarted.length > 0) {
      log(`[INVENTORY] Selective close: targeting daemons ${inventory.daemonsStarted.join(', ')}`);
    }

    for (const target of targetsToKill) {
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
          // after a previous close or crash means the kill objective is already
          // met — PASS. Only surface as info (not FAIL) to keep close idempotent
          // across consecutive runs over the same lifecycle.
          results.push({
            phase,
            status: 'PASS',
            detail: `${target.name} not running at close (already terminated — kill objective met)`,
          });
          ok(`${target.name} was not running (already terminated)`);
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

  // 5.3b Native process-hygiene sweep — catches what the fixed matchers above
  // don't know: duplicate websocket-server/vite instances, hung one-shots
  // (e.g. ci-rollback-engine --action status), stale PID files and leftover
  // headless chrome. No aged-daemon recycling at close (next session start
  // does that); pure garbage collection only. Best-effort.
  if (!skipDaemonKill) {
    try {
      const hygiene = await runHygiene({ apply: true, recycleAged: false });
      if (hygiene.killed.length > 0 || hygiene.cleanedFiles.length > 0) {
        results.push({
          phase: 'process-hygiene',
          status: 'PASS',
          detail: `reaped ${hygiene.killed.length} process(es) [${hygiene.killed.join(', ')}], cleaned ${hygiene.cleanedFiles.length} stale pid file(s)`,
        });
        ok(
          `Process hygiene: ${hygiene.killed.length} reaped, ${hygiene.cleanedFiles.length} pid file(s) cleaned`,
        );
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      warn(`Process hygiene sweep failed (non-blocking): ${msg}`);
    }
  }

  try {
    const retention = runArtifactRetention({
      workspaceRoot: ROOT,
      apply: retentionAuthorized,
      authorizedAutomatedClose: retentionAuthorized,
    });
    results.push({
      phase: 'artifact-retention',
      status: 'PASS',
      detail: `${retention.mode}: ${retention.candidates.length} expired candidate(s), ${retention.deleted.length} deleted; audit ${retention.auditPath ?? 'not written'}`,
    });
  } catch (e: unknown) {
    results.push({
      phase: 'artifact-retention',
      status: 'FAIL',
      detail: e instanceof Error ? e.message : String(e),
    });
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
  const cr = runScript(
    'src/session/session-cleanup-start.ts',
    ['-SkipOrphanCleanup', '-Quiet'],
    60000,
  );
  results.push({
    phase: 'cache-flush',
    status: cr.status === 0 ? 'PASS' : 'FAIL',
    detail: cr.status === 0 ? 'Caches flushed' : `Exit: ${cr.status}`,
  });

  // 5.6 Session retention - prune old sessions, checkpoints, backups
  const retentionResult = runSessionRetention(true);
  results.push({
    phase: 'session-retention',
    status: 'PASS',
    detail:
      retentionResult.kept > 0
        ? `Retention: ${retentionResult.removed} removed, ${retentionResult.kept} kept`
        : 'Retention: no cleanup needed',
  });

  // 5.8 Rebuild the adaptive routing table so the session's recorded outcomes become
  // learning rather than raw rows. Found 2026-10-02: the loop was honest but starved.
  // `routing_rules` held exactly one row, created by a manual run seven weeks earlier,
  // because route-and-delegate.ts (the only caller of recordRoutingOutcome) has zero
  // callers itself. The build step that consumes those rows is already scheduled lazily
  // at session start, but rebuilding at close means the next session starts from the
  // previous session's evidence instead of the state it left behind.
  // Best-effort: never FAIL the close if it errors.
  try {
    const routingBuild = runNpxTsxSync(
      resolve(ROOT, 'src/orchestration/adaptive-router.ts'),
      ['--build', '--quiet'],
      { timeout: 60_000 },
    );
    results.push({
      phase: 'adaptive-router-rebuild',
      status: routingBuild.status === 0 ? 'PASS' : 'SKIP',
      detail:
        routingBuild.status === 0
          ? 'Routing table rebuilt from recorded outcomes'
          : `Routing rebuild exited ${routingBuild.status} (best-effort)`,
    });
  } catch (err) {
    results.push({
      phase: 'adaptive-router-rebuild',
      status: 'SKIP',
      detail: `Routing rebuild failed (best-effort): ${err}`,
    });
  }

  // 5.7 Background-task drain safety net ("ventanas fantasma" — 2026-10-01).
  // Calls scripts/utilities/background-tasks.ts to:
  //   1. read the runtime state file (.runtime/bg-tasks.json)
  //   2. reap any OS-level long-running tsx processes (auto-promoted leaks)
  // Best-effort: never FAIL the close if it errors — it's a safety net, not a gate.
  try {
    const bgDrain = runNpxTsxSync(
      resolve(ROOT, 'scripts/utilities/background-tasks.ts'),
      ['--list'],
      { timeout: 20_000 },
    );
    const hasPending =
      bgDrain.stdout.includes('PENDING') ||
      (bgDrain.status === 0 && Boolean(bgDrain.stdout.match(/\d+ bg task\(s\)/)?.[0]));
    results.push({
      phase: 'bg-tasks-drain',
      status: 'PASS',
      detail: hasPending
        ? `bg tasks listed — agent must drain via task_output/task_stop next turn (output: ${bgDrain.stdout.slice(0, 120).replace(/\n/g, ' ')})`
        : 'No lingering bg tasks in state file (runtime reminders drained separately by agent)',
    });
    // Also reap OS leaks (best-effort)
    const reap = runNpxTsxSync(
      resolve(ROOT, 'scripts/utilities/background-tasks.ts'),
      ['--reap-os', '--apply'],
      { timeout: 20_000 },
    );
    results.push({
      phase: 'bg-tasks-reap-os',
      status: 'PASS',
      detail: `OS reap exit=${reap.status} (output: ${reap.stdout.slice(0, 80).replace(/\n/g, ' ')})`,
    });
  } catch (e) {
    results.push({
      phase: 'bg-tasks-drain',
      status: 'SKIP',
      detail: e instanceof Error ? e.message : 'bg drain not available',
    });
  }

  return results;
}

export function phaseVerify(): PhaseResult[] {
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
