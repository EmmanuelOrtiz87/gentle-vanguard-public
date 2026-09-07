#!/usr/bin/env node
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  existsSync,
  writeFileSync,
  unlinkSync,
  statSync,
} from 'fs';
import { join, resolve } from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { runSync, run, runNpxTsx, runNpxTsxSync, type RunOptions } from './run-command.js';
import { getPipelineTimeouts } from './timeout-config';
import { log as createLogger } from '../utils/logger.js';
import { printBanner } from '../cli/banner.js';
import { newAuditEvent, saveAuditEvent } from '../infrastructure/audit-pipeline.js';
import { sessionStart } from '../knowledge/engram-session-bridge.js';
import { ProcessLock } from './process-lock-manager.js';
import { getConfigService } from '../config/config-service.js';
import {
  healStepScriptPaths as healScriptPathsCore,
  indexScriptPaths,
  resolveScriptPath as resolveScriptPathCore,
} from './script-path-heal.js';

const LOG = createLogger('SESSION-AUTOSTART');

// ─── Loop-Guard soft check (ADR-0022, F4.1) ─────────────────────────────────
async function checkLoopGuardSoft(): Promise<void> {
  try {
    const r = runSync('npx', ['tsx', 'src/core/orchestrator-loop-guard.ts'], {
      timeout: 5000,
      cwd: ROOT,
    });
    const out = (r.stdout ?? '').toString();
    if (out.includes('intent-loop') || out.includes('"break": true')) {
      LOG.info('[LOOP-GUARD] Soft check: intent-loop detection works (self-test PASS)');
    } else {
      LOG.warn('[LOOP-GUARD] Soft check: unexpected self-test output — verify guard');
    }
  } catch {
    LOG.warn('[LOOP-GUARD] Soft check: self-test failed to run — verify guard module');
  }
}

// ─── Auto-Checkpoint Helper ──────────────────────────────────────────────
async function createAutoCheckpoint(): Promise<void> {
  try {
    const r = runNpxTsxSync(
      'src/ops/checkpoint-manager.ts',
      ['create', '--label', 'auto-session-start'],
      {
        timeout: 30000,
      },
    );
    if (r.status !== 0) throw r.error ?? new Error(`checkpoint exited ${r.status}`);
    auditLog(
      'checkpoint.create',
      'session-autostart',
      'auto_checkpoint',
      'success',
      'Auto-checkpoint created on session start',
    );
    LOG.info('[CHECKPOINT] Auto-checkpoint created successfully');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    auditLog(
      'checkpoint.error',
      'session-autostart',
      'auto_checkpoint',
      'failure',
      `Auto-checkpoint failed: ${msg}`,
    );
    LOG.warn(`[CHECKPOINT] Auto-checkpoint creation failed: ${msg}`);
  }
}

// ─── Audit Logging Helper ────────────────────────────────────────────────
function auditLog(
  eventType: string,
  component: string,
  operation: string,
  status: string,
  message: string,
  metadata?: Record<string, unknown>,
): void {
  try {
    const event = newAuditEvent({
      eventType,
      component,
      operation,
      actor: 'session-autostart',
      target: component,
      status,
      message,
      metadata: metadata || {},
    });
    saveAuditEvent(event);
  } catch (err) {
    LOG.warn(`[AUDIT] Failed to log event: ${err}`);
  }
}

// ─── Optional output redirection ──────────────────────────────────────────
// The detached launcher (session-autostart-detached.ts) sets AUTOSTART_LOG_FILE
// so the pipeline run is observable even though nothing is written to the
// caller's pipe. We redirect ALL console output to that file natively (no
// reliance on cmd.exe `>` redirection, which breaks under detached process
// groups on Windows). Uses appendFileSync (synchronous) so every line survives
// the final `process.exit(0)` — an async stream would lose buffered lines.
const AUTOSTART_LOG_FILE = process.env.AUTOSTART_LOG_FILE;
if (AUTOSTART_LOG_FILE) {
  const mirror = (...args: unknown[]): void => {
    try {
      appendFileSync(AUTOSTART_LOG_FILE, args.map(String).join(' ') + '\n', 'utf-8');
    } catch {
      /* best-effort */
    }
  };
  console.log = (...args: unknown[]) => mirror(...args);
  console.warn = (...args: unknown[]) => mirror(...args);
  console.error = (...args: unknown[]) => mirror(...args);
}

// ─── Lock file: reuse a recent bootstrap across chat turns ───────────

const LOCK_FILE = join(resolve(process.cwd()), '.runtime', 'session-autostart.lock');
const SESSION_REUSE_WINDOW_MS = 30 * 60 * 1000;

/**
 * Robust lock-owner liveness check.
 *
 * `process.kill(pid, 0)` only verifies that SOME process exists with that PID.
 * On Windows, an orphaned `conhost.exe` (console host of a previously detached
 * run) or a recycled PID can keep that check true and block the pipeline with
 * a spurious "[LOCK] already running" skip.
 *
 * This verifies the PID actually belongs to a `node` process whose command
 * line references `session-autostart` before treating the lock as live.
 * Any ambiguity resolves to "stale" (proceed), matching the lock's intent of
 * preventing accidental duplicates while never wedging the pipeline. A
 * recent lock also acts as the chat-turn reuse marker; pass --force when a
 * real recovery/reinitialization is required.
 */
function isLockOwnerAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0); // signal 0 = test existence
  } catch {
    return false; // no such process -> stale
  }
  // PID exists; on Windows confirm it is a node process running session-autostart.
  if (process.platform === 'win32') {
    try {
      const psCmd = `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`;
      const r = runSync('powershell', ['-NoProfile', '-Command', psCmd], {
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const cmd = r.stdout.trim();
      if (!cmd) return false; // no command line info -> treat as stale
      return /node(\.exe)?/i.test(cmd) && /session-autostart/i.test(cmd);
    } catch {
      return false; // powershell unavailable/failed -> treat as stale (safe to proceed)
    }
  }
  return true; // non-Windows: plain existence check is sufficient
}

function criticalServicesHealthy(): boolean {
  if (process.platform !== 'win32') return true;
  try {
    const probe =
      '(Test-NetConnection localhost -Port 8080 -WarningAction SilentlyContinue).TcpTestSucceeded -and ' +
      '(Test-NetConnection localhost -Port 3000 -WarningAction SilentlyContinue).TcpTestSucceeded';
    const result = runSync('powershell', ['-NoProfile', '-Command', probe], {
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return result.stdout.trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

function checkLock(): boolean {
  try {
    const force =
      process.argv.includes('--force') || process.env.GENTLE_VANGUARD_AUTOSTART_FORCE === '1';
    if (existsSync(LOCK_FILE)) {
      // The CLI is invoked by multiple tools for every user turn. Reuse a
      // recent completed bootstrap instead of replaying 29 steps + 77 lazy
      // launches. Explicit --force remains available for recovery/maintenance.
      const ageMs = Date.now() - statSync(LOCK_FILE).mtimeMs;
      const recoverIfUnhealthy = process.env.GENTLE_VANGUARD_RECOVER_IF_UNHEALTHY === '1';
      if (
        !force &&
        ageMs >= 0 &&
        ageMs < SESSION_REUSE_WINDOW_MS &&
        (!recoverIfUnhealthy || criticalServicesHealthy())
      ) {
        LOG.info(
          `[LOCK] Recent session bootstrap is active (${Math.floor(ageMs / 1000)}s old). Skipping duplicate.`,
        );
        return false;
      }
      const pid = parseInt(readFileSync(LOCK_FILE, 'utf-8').trim(), 10);
      if (isLockOwnerAlive(pid)) {
        LOG.info(`[LOCK] Session-autostart already running (PID ${pid}). Skipping duplicate.`);
        return false;
      }
      // Owner is dead or not a real session-autostart process — lockfile is stale, remove it
      try {
        unlinkSync(LOCK_FILE);
      } catch {
        /* ignore */
      }
    }
    writeFileSync(LOCK_FILE, String(process.pid), 'utf-8');
    return true;
  } catch {
    return true; // If lock fails, proceed anyway
  }
}

// ─── Types ────────────────────────────────────────────────────────────

interface PipelineStep {
  id: string;
  script: string;
  args?: string;
  required?: boolean;
  phase?: number;
  lazy?: boolean;
  enabled?: boolean;
  description?: string;
}

interface PipelineConfig {
  pipeline: {
    steps: PipelineStep[];
  };
}

const ROOT = resolve(process.cwd());
const CONFIG_PATH = join(ROOT, 'config', 'session-autostart.config.json');
const LOG_DIR = join(ROOT, 'logs');
const LAZY_LOG_PATH = join(LOG_DIR, 'session-autostart-lazy.log');

// Max concurrent lazy steps to prevent spawning 56 processes at once.
// Lowered 5 -> 2 to avoid CPU saturation spikes (77 lazy steps in batches
// of 5 created ~17 simultaneous node processes on Windows).
const MAX_LAZY_CONCURRENCY = 2;

function loadConfig(): PipelineConfig {
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    LOG.error(`[SESSION-AUTOSTART] Failed to load config: ${msg}`);
    return { pipeline: { steps: [] } };
  }
}

/** Human-readable command recorded in the lazy-step audit log. */
function buildStepCommand(step: PipelineStep): string {
  const scriptPath = join(ROOT, step.script);
  let cmd: string;
  if (scriptPath.endsWith('.ps1')) {
    cmd = `pwsh -NoProfile -File "${scriptPath}"`;
  } else if (scriptPath.endsWith('.ts')) {
    cmd = `npx tsx "${scriptPath}"`;
  } else {
    cmd = `"${scriptPath}"`;
  }
  if (step.args) cmd += ` ${step.args}`;
  return cmd;
}

/** Preserve simple pipeline arguments without invoking a command shell. */
function parseStepArgs(args?: string): string[] {
  if (!args?.trim()) return [];
  // Linear-time tokenizer (no nested quantifiers → no ReDoS): quoted
  // segments stay together, unquoted tokens split on whitespace.
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(args)) !== null) {
    out.push(m[1] ?? m[2] ?? '');
  }
  return out;
}

function killProcessTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      cwd: ROOT,
      stdio: 'ignore',
      windowsHide: true, // ✅ hide taskkill window
    });
    return;
  }
  child.kill('SIGTERM');
}

// ─── Script-path AUTO-HEAL (self-improvement) ────────────────────────────────
// Core logic lives in ./script-path-heal.ts (pure, unit-testable). This wrapper
// owns the cached basename index and the audit/log reporting. The pipeline
// resolves and PERSISTS corrected paths so a healed config never warns again.

let scriptPathIndex: Map<string, string> | null = null;

function getScriptPathIndex(): Map<string, string> {
  if (!scriptPathIndex) scriptPathIndex = indexScriptPaths(ROOT, join(ROOT, 'src'));
  return scriptPathIndex;
}

/** Resolve a configured script path, falling back to a basename lookup. */
function resolveScriptPath(script: string): string {
  return resolveScriptPathCore(ROOT, script, getScriptPathIndex());
}

/**
 * Auto-heal every enabled step whose script path is missing — resolving the
 * real file by basename, persisting the correction (with .bak backup + audit)
 * and reporting any unresolved paths for watchtower monitoring.
 */
function healStepScriptPaths(config: PipelineConfig): void {
  const result = healScriptPathsCore(
    ROOT,
    config as Parameters<typeof healScriptPathsCore>[1],
    {
      index: getScriptPathIndex(),
      configPath: CONFIG_PATH,
      reportPath: join(ROOT, '.runtime', 'autostart-missing-scripts.json'),
    },
  );

  for (const p of result.patches) {
    LOG.warn(`[AUTO-HEAL] Script path corrected: ${p.from} → ${p.to} (step: ${p.id})`);
  }
  if (result.persisted > 0) {
    auditLog(
      'config.autoheal',
      'session-autostart',
      'script_paths',
      'success',
      `Auto-healed ${result.persisted} script path(s) in session-autostart config`,
      {
        steps: result.patches.map((p) => `${p.id}:${p.from}→${p.to}`),
        backup: `${CONFIG_PATH}.bak`,
      },
    );
    LOG.info(`[AUTO-HEAL] Persisted ${result.persisted} script path correction(s) to ${CONFIG_PATH}`);
  }
  if (result.stillMissing.length > 0) {
    LOG.warn(
      `[AUTO-HEAL] Unresolved script paths remain (${result.stillMissing
        .map((m) => m.id)
        .join(', ')}) → .runtime/autostart-missing-scripts.json`,
    );
  }
}

function executeStep(
  step: PipelineStep,
  timeoutMs: number,
): Promise<{ success: boolean; error?: string }> {
  const scriptPath = join(ROOT, resolveScriptPath(step.script));

  if (!existsSync(scriptPath)) {
    return Promise.resolve({ success: false, error: `Script not found: ${step.script}` });
  }

  return new Promise((resolvePromise) => {
    const spawnOptions: RunOptions = {
      cwd: ROOT,
      stdio: 'inherit', // show output in parent console
      windowsHide: true, // ✅ CRITICAL: hide window on Windows
    };
    const args = parseStepArgs(step.args);
    const child = scriptPath.endsWith('.ts')
      ? runNpxTsx(scriptPath, args, spawnOptions)
      : scriptPath.endsWith('.ps1')
        ? run('pwsh', ['-NoProfile', '-File', scriptPath, ...args], spawnOptions)
        : run(scriptPath, args, spawnOptions);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessTree(child);
      resolvePromise({ success: false, error: `Timeout after ${timeoutMs}ms` });
    }, timeoutMs);

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ success: code === 0 });
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ success: false, error: err.message });
    });
  });
}

// Cache of running scripts, populated ONCE per run (avoids 75x PowerShell calls).
let runningScriptsCache: Set<string> | null = null;

/**
 * Collect all running node script basenames with a SINGLE PowerShell query.
 * Populated lazily on first use and reused for the whole run — this avoids
 * one PowerShell spawn per lazy step (~1s each), which previously ballooned
 * the pipeline from ~40s to ~100s with 75 lazy steps.
 */
function getRunningScripts(): Set<string> {
  if (runningScriptsCache) return runningScriptsCache;
  runningScriptsCache = new Set<string>();
  try {
    if (process.platform === 'win32') {
      const psCmd =
        `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ` +
        `Where-Object { $_.CommandLine } | ForEach-Object { $_.CommandLine }`;
      const r = runSync('powershell', ['-NoProfile', '-Command', psCmd], {
        timeout: 8000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      for (const line of r.stdout.split(/\r?\n/)) {
        const m = line.match(/[\\/]([A-Za-z0-9_\-]+\.ts)\b/);
        if (m) runningScriptsCache.add(m[1]);
      }
    } else {
      const r = runSync('pgrep', ['-af', '\\.ts'], {
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      for (const line of r.stdout.split(/\r?\n/)) {
        const m = line.match(/([A-Za-z0-9_\-]+\.ts)/);
        if (m) runningScriptsCache.add(m[1]);
      }
    }
  } catch {
    /* empty cache on failure — safe default */
  }
  return runningScriptsCache;
}

/**
 * Check whether a process for the given script is already running.
 *
 * Repeated session-autostart runs were accumulating duplicate lazy daemons
 * (e.g. 3x token-ingest, 3x codegraph-mcp-server-start) because each run
 * spawned its own set without killing the previous ones. We skip launching
 * a lazy step whose script is already alive — the daemon is still healthy.
 */
function isScriptRunning(scriptPath: string): boolean {
  const scriptName = scriptPath.split(/[\\/]/).pop() ?? '';
  if (!scriptName) return false;
  return getRunningScripts().has(scriptName);
}

/**
 * Start a lazy step with windowsHide:true.
 * Lazy steps are batched to avoid spawning 56 processes simultaneously.
 * ROBUST DEDUPE: Uses file-based locking with PID validation.
 */
function startLazyStep(step: PipelineStep): { success: boolean; error?: string } {
  const scriptPath = join(ROOT, resolveScriptPath(step.script));
  if (!existsSync(scriptPath)) {
    return { success: false, error: `Script not found: ${step.script}` };
  }

  // ROBUST DEDUPE: Try to acquire lock before starting
  const lockName = `lazy-${step.id}`;
  const lock = new ProcessLock(lockName);

  // Primary dedupe: check with old method (fast)
  if (isScriptRunning(scriptPath)) {
    LOG.info(`[DEDUPE] ${step.id} already running — skipping duplicate launch`);
    return { success: true, error: 'skipped-duplicate' };
  }

  // Secondary dedupe: try to acquire file lock
  if (!lock.acquire()) {
    const holderPid = lock.getHolderPid();
    LOG.info(`[DEDUPE-LOCK] ${step.id} already running (PID ${holderPid}) — skipping`);
    return { success: true, error: 'skipped-duplicate-lock' };
  }

  // Success: we acquired the lock, proceed to start
  LOG.info(`[DEDUPE-LOCK] ${step.id}: Lock acquired, proceeding`);

  mkdirSync(LOG_DIR, { recursive: true });
  appendFileSync(
    LAZY_LOG_PATH,
    `[${new Date().toISOString()}] starting ${step.id}: ${buildStepCommand(step)}\n`,
    'utf-8',
  );

  const args = parseStepArgs(step.args);
  const child = scriptPath.endsWith('.ts')
    ? runNpxTsx(scriptPath, args, {
        cwd: ROOT,
        stdio: 'ignore',
        windowsHide: true,
        detached: true,
      })
    : scriptPath.endsWith('.ps1')
      ? run('pwsh', ['-NoProfile', '-File', scriptPath, ...args], {
          cwd: ROOT,
          stdio: 'ignore',
          windowsHide: true,
          detached: true,
        })
      : run(scriptPath, args, {
          cwd: ROOT,
          stdio: 'ignore',
          windowsHide: true,
          detached: true,
        });
  // The lock will auto-release when the child process exits
  // We don't need to maintain our lock - the child will have its own
  lock.release();

  child.unref();
  return { success: true };
}

// ─── Progress File Helper (GAP-004) ─────────────────────────────────────────
// Writes a lightweight JSON progress file to .runtime/autostart-progress.json
// so that any observer (CLI, health-check, watchtower) can poll the pipeline
// state without reading the detached log file.
const PROGRESS_PATH = join(resolve(process.cwd()), '.runtime', 'autostart-progress.json');

interface AutostartProgress {
  pid: number;
  startedAt: string;
  updatedAt: string;
  status: 'running' | 'done' | 'failed';
  currentPhase: number;
  currentStep: string;
  stepNum: number;
  totalSteps: number;
  lazyTotal: number;
  lazyLaunched: number;
  failed: string[];
  requiredFailed: string[];
  durationMs?: number;
}

let _progressBase: Partial<AutostartProgress> = {};

function writeProgress(patch: Partial<AutostartProgress>): void {
  try {
    _progressBase = { ..._progressBase, ...patch, updatedAt: new Date().toISOString() };
    writeFileSync(PROGRESS_PATH, JSON.stringify(_progressBase, null, 2), 'utf-8');
  } catch {
    /* best-effort — never block the pipeline */
  }
}

async function main() {
  const sessionStartTime = new Date().toISOString();

  // Loop-guard soft check (ADR-0022): runs before lock so every turn gets a signal,
  // but never blocks the pipeline — soft WARN only.
  await checkLoopGuardSoft();

  // ─── Session Validation (NEW) ───────────────────────────────────────────────
  // Smart validation before proceeding: detect existing sessions, nested starts, etc.
  let sessionValidationResult: { valid: boolean; recommendation: string; message: string } | null =
    null;
  try {
    const { validateSession } = await import('../session/session-validator.js');
    sessionValidationResult = await validateSession();

    LOG.info(`[SESSION-VALIDATOR] ${sessionValidationResult.message}`);

    // Handle different scenarios
    if (sessionValidationResult.recommendation === 'reuse') {
      LOG.info('[SESSION-VALIDATOR] Reusing existing session - lightweight init only');
      // For reuse: just update timestamp, don't run full pipeline
    } else if (sessionValidationResult.recommendation === 'cleanup-first') {
      LOG.warn(`[SESSION-VALIDATOR] ${sessionValidationResult.message} - running cleanup first`);
      // Run cleanup before proceeding
      runNpxTsxSync('src/session/session-cleanup-start.ts', ['-Quiet'], { timeout: 60000 });
    }
    // 'proceed' = normal startup
  } catch (err) {
    LOG.warn(`[SESSION-VALIDATOR] Validation failed (non-blocking): ${err}`);
    sessionValidationResult = null; // Allow startup to continue
  }

  // Pre-start checkpoint: create checkpoint BEFORE pipeline runs (for rollback capability)
  try {
    const { registerResource } = await import('../session/session-validator.js');
    const r = runNpxTsxSync(
      'src/ops/checkpoint-manager.ts',
      ['create', '--label', 'pre-session-start'],
      { timeout: 30000 },
    );
    if (r.status === 0) {
      registerResource('checkpoint', 'pre-session-start');
      LOG.info('[CHECKPOINT] Pre-start checkpoint created for rollback safety');
    }
  } catch (err) {
    LOG.warn(`[CHECKPOINT] Pre-start checkpoint failed (non-blocking): ${err}`);
  }

  // Lock check: only run once per OS user session
  if (!checkLock()) {
    auditLog(
      'session.skip',
      'session-autostart',
      'lock_check',
      'skipped',
      'Session autostart skipped - lock active',
    );
    // Imports initialize lightweight observers; terminate the fast path so
    // a repeated per-turn invocation cannot keep the shell alive.
    process.exit(0);
  }

  // Log session start event
  auditLog(
    'session.start',
    'session-autostart',
    'initialize',
    'success',
    `Session autostart initiated at ${sessionStartTime}`,
    {
      pid: process.pid,
      platform: process.platform,
      nodeVersion: process.version,
    },
  );

  if (!process.env.GV_QUIET) printBanner('Session Autostart');

  // Config validation (F2.6): typed zod check of startup-critical env vars.
  // Local-first (ADR-0017): missing optional vars NEVER hard-fail here —
  // only malformed values (bad types) produce a WARN summary.
  try {
    const result = getConfigService().validate({ mode: 'local' });
    if (result.ok) {
      LOG.info(`[CONFIG] ${result.summary}`);
    } else {
      LOG.warn(`[CONFIG] ${result.summary}`);
    }
  } catch (err) {
    LOG.warn(
      `[CONFIG] validation could not run: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Iniciar sesión explícitamente (funciona en TODAS las herramientas, no depende del plugin automático)
  const sessionId = `session-${sessionStartTime.replace(/[:.]/g, '-').slice(0, 19)}`;
  // Propagate the canonical session identity to every child step and token
  // tracker. Without this, token-status reports "unknown" and usage is
  // attributed to ad-hoc sessions.
  process.env.SESSION_ID = sessionId;
  process.env.GENTLE_VANGUARD_SESSION_ID = sessionId;
  mkdirSync(join(ROOT, '.session'), { recursive: true });
  // Single canonical session state file (plan P1: one authority). Merge with
  // any existing state so richer data from other pipeline steps survives.
  const canonicalSessionFile = join(ROOT, '.session', 'session-current.json');
  let sessionState: Record<string, unknown> = {};
  try {
    sessionState = JSON.parse(readFileSync(canonicalSessionFile, 'utf-8')) as Record<
      string,
      unknown
    >;
  } catch {
    /* no prior state — start fresh */
  }
  writeFileSync(
    canonicalSessionFile,
    JSON.stringify(
      { ...sessionState, sessionId, id: sessionId, startedAt: sessionStartTime, status: 'active' },
      null,
      2,
    ),
    'utf-8',
  );
  const engramSession = sessionStart(sessionId);
  if (engramSession.success) {
    LOG.info(`[ENGRAM] Session started explicitly: ${engramSession.sessionId}`);
  } else {
    LOG.warn(
      `[ENGRAM] Session start warning: ${engramSession.error || 'Unknown error'} (continuing without Engram)`,
    );
  }

  LOG.info(`[SESSION-AUTOSTART] Loading pipeline from ${CONFIG_PATH}\n`);

  const timeoutConfig = getPipelineTimeouts();
  const config = loadConfig();

  // Self-heal (auto-evaluación/auto-mejora): resolve+persist any step whose
  // configured script path is missing before the pipeline executes.
  healStepScriptPaths(config);

  const allSteps = config.pipeline.steps.filter((s) => s.enabled === true);
  const steps = allSteps.filter((s) => !s.lazy);
  const lazySteps = allSteps.filter((s) => s.lazy);

  const totalSteps = steps.length;
  let stepNum = 0;
  const failed: string[] = [];
  const requiredFailed: string[] = [];

  LOG.info(`[INFO] Pipeline steps: ${totalSteps} enabled (phased parallel)`);
  if (lazySteps.length > 0) {
    LOG.info(`[INFO] ${lazySteps.length} lazy steps deferred to background\n`);
  }

  // Initialize progress file so observers can poll status immediately.
  writeProgress({
    pid: process.pid,
    startedAt: sessionStartTime,
    status: 'running',
    currentPhase: 0,
    currentStep: 'initializing',
    stepNum: 0,
    totalSteps,
    lazyTotal: lazySteps.length,
    lazyLaunched: 0,
    failed: [],
    requiredFailed: [],
  });

  // Log pipeline configuration
  auditLog(
    'config.load',
    'session-autostart',
    'load_config',
    'success',
    `Loaded ${totalSteps} steps + ${lazySteps.length} lazy`,
    {
      totalSteps,
      lazySteps: lazySteps.length,
      phases: [...new Set(steps.map((s) => s.phase ?? 1))].length,
    },
  );

  const phaseMap = new Map<number, PipelineStep[]>();
  for (const step of steps) {
    const phase = step.phase ?? 1;
    if (!phaseMap.has(phase)) phaseMap.set(phase, []);
    phaseMap.get(phase)?.push(step);
  }

  const sortedPhases = [...phaseMap.entries()].sort(([a], [b]) => a - b);

  for (const [phaseNum, phaseSteps] of sortedPhases) {
    if (phaseNum === 0) {
      for (const step of phaseSteps) {
        stepNum++;
        writeProgress({
          currentPhase: phaseNum,
          currentStep: step.id,
          stepNum,
          failed,
          requiredFailed,
        });
        const isRequired = step.required === true;
        const timeoutMs = isRequired
          ? (timeoutConfig.required_step_ms ?? timeoutConfig.session_autostart_step_ms)
          : timeoutConfig.session_autostart_step_ms;
        const result = await executeStep(step, timeoutMs);
        if (result.success) {
          LOG.info(`[${stepNum}/${totalSteps}] [OK] ${step.id} completed`);
        } else {
          const errMsg = result.error || 'Failed';
          LOG.info(`[${stepNum}/${totalSteps}] [WARNING] ${step.id}: ${errMsg}`);
          failed.push(step.id);
          if (isRequired) requiredFailed.push(step.id);
        }
        writeProgress({ stepNum, failed: [...failed], requiredFailed: [...requiredFailed] });
        if (isRequired && !result.success) break;
      }
    } else {
      LOG.info(`--- Phase ${phaseNum} (${phaseSteps.length} steps in parallel) ---`);
      writeProgress({ currentPhase: phaseNum, currentStep: `phase-${phaseNum}` });
      for (const step of phaseSteps) {
        stepNum++;
        LOG.info(`[${stepNum}/${totalSteps}] ${step.id}...`);
      }

      const results = await Promise.allSettled(
        phaseSteps.map((step) => {
          const timeoutMs =
            step.required === true
              ? (timeoutConfig.required_step_ms ?? timeoutConfig.session_autostart_step_ms)
              : timeoutConfig.session_autostart_step_ms;
          return executeStep(step, timeoutMs);
        }),
      );

      for (let i = 0; i < phaseSteps.length; i++) {
        const step = phaseSteps[i];
        const result = results[i];
        const isRequired = step.required === true;
        if (result.status === 'fulfilled' && result.value.success) {
          LOG.info(`  [OK] ${step.id} completed`);
        } else {
          const errMsg =
            result.status === 'rejected'
              ? result.reason?.message || 'Rejected'
              : result.value?.error || 'Failed';
          LOG.info(`  [WARNING] ${step.id}: ${errMsg}`);
          failed.push(step.id);
          if (isRequired) requiredFailed.push(step.id);
        }
      }
    }

    if (requiredFailed.length > 0) break;
  }

  if (lazySteps.length > 0) {
    LOG.info(`\n=== Starting Lazy Steps (batch=${MAX_LAZY_CONCURRENCY}) ===`);
    let launched = 0;
    let deduped = 0;
    for (let i = 0; i < lazySteps.length; i += MAX_LAZY_CONCURRENCY) {
      const batch = lazySteps.slice(i, i + MAX_LAZY_CONCURRENCY);
      for (const step of batch) {
        const result = startLazyStep(step);
        if (result.error === 'skipped-duplicate') {
          deduped++;
          LOG.info(`  [SKIP] ${step.id} (already running)`);
        } else if (result.success) {
          launched++;
          LOG.info(`  [OK] ${step.id} (lazy started)`);
          // Register this lazy step in session inventory for selective close
          try {
            const { registerResource } = await import('../session/session-validator.js');
            registerResource('lazyStep', step.id);
          } catch (err) {
            LOG.warn(`[INVENTORY] Failed to register lazyStep ${step.id}: ${err}`);
          }
        } else {
          LOG.info(`  [WARN] ${step.id} (lazy): ${result.error || 'Failed'}`);
        }
      }
      writeProgress({
        currentStep: `lazy-batch-${Math.floor(i / MAX_LAZY_CONCURRENCY) + 1}`,
        lazyLaunched: launched,
      });
      // Small delay between batches to avoid overwhelming the OS
      if (i + MAX_LAZY_CONCURRENCY < lazySteps.length) {
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    LOG.info(`[INFO] Lazy step launch log: ${LAZY_LOG_PATH}`);
    LOG.info(
      `[INFO] Launched ${launched}/${lazySteps.length} lazy steps in batches of ${MAX_LAZY_CONCURRENCY}` +
        (deduped > 0 ? ` (${deduped} deduped, already running)` : ''),
    );
  }

  LOG.info(`\n=== Session Autostart Summary ===`);
  LOG.info(`Steps executed: ${stepNum}`);
  LOG.info(`Lazy steps:     ${lazySteps.length}`);
  LOG.info(`Steps failed:   ${failed.length}`);
  LOG.info(`Required fails: ${requiredFailed.length}`);

  const finalStatus = requiredFailed.length > 0 ? 'failed' : 'done';
  writeProgress({
    status: finalStatus,
    currentStep: 'complete',
    stepNum,
    failed: [...failed],
    requiredFailed: [...requiredFailed],
    durationMs: Date.now() - new Date(sessionStartTime).getTime(),
  });

  if (requiredFailed.length > 0) {
    LOG.error(`[ERROR] Required steps failed: ${requiredFailed.join(', ')}`);
    LOG.info(`[ACTION] Fix the issues above and re-run session autostart.`);
    process.exit(1);
  }

  if (failed.length > 0) {
    LOG.info(`[WARNING] Non-required steps with issues: ${failed.join(', ')}`);
  }

  // Log completion
  const totalLazyLaunched = lazySteps.length;
  const status = requiredFailed.length > 0 ? 'failure' : failed.length > 0 ? 'warning' : 'success';

  auditLog(
    'session.complete',
    'session-autostart',
    'finish',
    status,
    `Session autostart completed: ${stepNum} steps, ${failed.length} failed, ${requiredFailed.length} required failed`,
    {
      executed: stepNum,
      failed: failed.length,
      requiredFailed: requiredFailed.length,
      lazySteps: totalLazyLaunched,
      duration: Date.now() - new Date(sessionStartTime).getTime(),
    },
  );

  if (requiredFailed.length > 0) {
    auditLog(
      'session.error',
      'session-autostart',
      'required_failure',
      'failure',
      `Required steps failed: ${requiredFailed.join(', ')}`,
      {
        failedSteps: requiredFailed,
      },
    );
  }

  LOG.info(`[READY] Workspace ready for operations`);

  // Create auto-checkpoint on successful session start
  if (requiredFailed.length === 0) {
    LOG.info('[CHECKPOINT] Creating auto-checkpoint...');
    await createAutoCheckpoint();
  }

  // CRITICAL: Force explicit exit. Lazy steps are fire-and-forget background
  // processes; on Windows (shell:true) their grandchildren can inherit stdout
  // handles, keeping this process alive and blocking callers (CI, hooks, shells).
  // Exiting explicitly releases the pipe and avoids artificial timeouts.
  process.exit(requiredFailed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  LOG.error('[SESSION-AUTOSTART] Fatal error:', err);
  process.exit(1);
});
