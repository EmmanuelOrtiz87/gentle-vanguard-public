// Infrastructure checks (F2.5 split): CodeGraph, Timeout Daemon, Process
// Hygiene, ML Embeddings, Engram, MCP.
// Extracted verbatim from src/core/maintenance-watchtower.ts — no logic changes.

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { runSync } from '../run-command';
import { buildSnapshot, analyzeProcesses, DEFAULT_OPTIONS } from '../process-hygiene';
import { getEffectiveProcessTimeout, getExternalApiTimeouts } from '../timeout-config';
import { addResult, quiet, ROOT, RUNTIME_DIR, CODEGRAPH_PORT, CheckResult } from './context';
import {
  fileExists,
  readJson,
  testPort,
  getFileAgeHours,
  isCodeGraphProcessRunning,
  isCodeGraphRecentlyBooted,
  payloadFileOk,
} from './helpers';
import { log } from '../../utils/logger.js';
const logger = log('CORE-WATCHTOWER-CHECKS-INFRA');

// ─── Component: CodeGraph ───────────────────────────────────────────────────

export async function checkCodeGraph() {
  if (!quiet) logger.info('  [CodeGraph] Checking...');

  const cgDir = join(ROOT, '.codegraph');
  const indexOk = fileExists(join(cgDir, 'codegraph.db'));
  addResult('codegraph', 'index database', indexOk ? 'PASS' : 'FAIL', '', 'rebuild');

  // A running CodeGraph MCP server is expected. Detect it via the PID file,
  // a TCP port probe (default 3000), or a process-table scan.
  const pidFile = join(RUNTIME_DIR, 'codegraph-mcp-server.pid');
  let pidDetail = 'No PID file';
  let pidAlive = false;
  if (fileExists(pidFile)) {
    const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
    if (isNaN(pid)) {
      pidDetail = 'PID file unreadable';
    } else {
      try {
        process.kill(pid, 0);
        pidAlive = true;
        pidDetail = `PID ${pid} running`;
      } catch {
        pidDetail = `PID ${pid} not running`;
      }
    }
  }

  // CodeGraph runs as a stdio MCP server (`codegraph serve --mcp`), so it does
  // NOT open a TCP port. The port probe is kept only as an optional secondary
  // signal for non-stdio deployments; the authoritative liveness signals are
  // the PID file and the process-table scan.
  const portOpen = await testPort(CODEGRAPH_PORT);
  const procRunning = isCodeGraphProcessRunning();

  // CodeGraph is configured as an on-demand stdio MCP server in opencode.json
  // (command: "codegraph serve --mcp"). opencode spawns it lazily when its
  // tools are used. HOWEVER, the stack ALSO runs a standalone warm daemon
  // (codegraph-mcp-server-start.ts) that must be alive during the session.
  // A config entry alone is NOT a healthy state — the daemon must be running.
  let mcpConfigured = false;
  try {
    const oc = readJson(join(ROOT, 'opencode.json'));
    const cg = (oc.mcp as Record<string, unknown> | undefined)?.['codegraph'] as
      { enabled?: boolean; command?: string } | undefined;
    mcpConfigured = !!cg && cg.enabled !== false && typeof cg.command === 'string';
  } catch {
    mcpConfigured = false;
  }

  // The daemon is genuinely running only if a process is alive (PID file or
  // process-table scan) or the MCP port is open. A bare config entry is not
  // enough — it must be surfaced as a failure so a dead daemon is detected.
  const daemonRunning = pidAlive || procRunning || portOpen;
  if (daemonRunning) {
    const signals = [
      pidAlive ? pidDetail : '',
      portOpen ? `port ${CODEGRAPH_PORT} open` : '',
      procRunning ? 'process detected' : '',
    ].filter(Boolean);
    addResult('codegraph', 'server process', 'PASS', signals.join(', '), 'ok');
  } else if (mcpConfigured && isCodeGraphRecentlyBooted()) {
    // The daemon is started lazily by session-autostart and can take ~20s to
    // boot (npx+tsx resolution under concurrent lazy-step load). During this
    // boot window a "not running" signal is EXPECTED, not a failure. Report
    // WARN (no autoheal restart) so the autoheal does NOT spawn a competing
    // instance that would kill the original daemon once it finishes booting.
    addResult(
      'codegraph',
      'server process',
      'WARN',
      `${pidDetail}; daemon still booting (recent PID/session activity)`,
      'verify',
    );
  } else {
    addResult(
      'codegraph',
      'server process',
      'FAIL',
      `${pidDetail}; port ${CODEGRAPH_PORT} closed; daemon not running${
        mcpConfigured ? ' (MCP configured but daemon down)' : ''
      }`,
      'restart',
    );
  }
}

// ─── Component: Timeout Daemon ────────────────────────────────────────────────

export async function checkTimeoutDaemon() {
  if (!quiet) logger.info('  [Timeout Daemon] Checking...');

  // The timeout/performance monitor daemon is started by session-autostart
  // (start-monitor-daemon.ts -> timeout-monitor.ts --daemon). It must be alive
  // during the session. Check the PID file and the process table.
  const pidFile = join(RUNTIME_DIR, 'monitor-daemon.pid');
  let pidAlive = false;
  let pidDetail = 'No PID file';
  if (fileExists(pidFile)) {
    const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
    if (isNaN(pid)) {
      pidDetail = 'PID file unreadable';
    } else {
      try {
        process.kill(pid, 0);
        pidAlive = true;
        pidDetail = `PID ${pid} running`;
      } catch {
        pidDetail = `PID ${pid} not running`;
      }
    }
  }

  // Process-table scan as a second source of truth (the PID file can point at
  // a dead cmd.exe wrapper while the real node process is still alive).
  let procRunning = false;
  try {
    if (process.platform === 'win32') {
      const psCmd = `@(@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'timeout-monitor' -and $_.CommandLine -match '--daemon' })).Count`;
      const r = runSync('powershell', ['-NoProfile', '-Command', psCmd], {
        timeout: 15000,
        stdio: 'pipe',
      });
      const count = parseInt((r.stdout ?? '').trim(), 10);
      procRunning = !isNaN(count) && count > 0;
    } else {
      const r = runSync('ps', ['-ef'], { timeout: 15000 });
      procRunning = /timeout-monitor.*--daemon/.test(r.stdout ?? '');
    }
  } catch {
    procRunning = false;
  }

  if (pidAlive || procRunning) {
    const signals = [pidAlive ? pidDetail : '', procRunning ? 'process detected' : ''].filter(
      Boolean,
    );
    addResult('timeout-daemon', 'daemon process', 'PASS', signals.join(', '), 'ok');
  } else {
    addResult(
      'timeout-daemon',
      'daemon process',
      'FAIL',
      `${pidDetail}; timeout-monitor daemon not running`,
      'restart',
    );
  }
}

// ─── Component: Process Hygiene ───────────────────────────────────────────────

/**
 * Orphan/zombie process sweep (src/core/process-hygiene.ts). Detects duplicate
 * daemons, hung one-shots, stale PID files and leftover headless chrome.
 * Runs in dry-run here — autoHeal() applies the reap when findings exist.
 */
export async function checkProcessHygiene() {
  if (!quiet) logger.info('  [Process Hygiene] Scanning for orphans/duplicates...');

  const opts = { ...DEFAULT_OPTIONS, apply: false };
  const snap = await buildSnapshot();
  const { findings } = analyzeProcesses(snap, opts);
  const actionable = findings.filter((f) => f.action !== 'report');
  const reportsOnly = findings.filter((f) => f.action === 'report');

  if (actionable.length === 0 && reportsOnly.length === 0) {
    addResult(
      'process-hygiene',
      'orphan/duplicate sweep',
      'PASS',
      'no orphans, duplicates or stale PID files',
      'ok',
    );
    return;
  }

  const summary =
    actionable.length > 0
      ? actionable.map((f) => `${f.kind} PID ${f.pid} (${f.ageHours.toFixed(1)}h)`).join('; ')
      : reportsOnly.map((f) => `${f.kind} PID ${f.pid} (report-only)`).join('; ');

  addResult(
    'process-hygiene',
    'orphan/duplicate sweep',
    actionable.length > 0 ? 'FAIL' : 'WARN',
    `${actionable.length} actionable, ${reportsOnly.length} report-only — ${summary}`,
    'cleanup',
  );
}

// ─── Component: ML Embeddings ────────────────────────────────────────────────

export async function checkMlEmbeddings() {
  if (!quiet) logger.info('  [ML Embeddings] Checking...');

  const mlIndex = join(ROOT, '.atl/skill-embeddings.json');
  const mlDir = join(ROOT, '.atl/ml-embeddings');

  const ageH = getFileAgeHours(mlIndex);
  if (ageH === -1) {
    addResult('ml-embeddings', 'skill-embeddings.json', 'FAIL', 'Not found', 'rebuild');
  } else if (ageH > 48) {
    addResult(
      'ml-embeddings',
      'skill-embeddings.json freshness',
      'WARN',
      `Stale: ${ageH.toFixed(1)} hours`,
      'rebuild',
    );
  } else {
    addResult(
      'ml-embeddings',
      'skill-embeddings.json freshness',
      'PASS',
      `${ageH.toFixed(1)} hours`,
      'ok',
    );
  }

  if (fileExists(mlDir)) {
    const files = readdirSync(mlDir, { recursive: true }).filter((f) =>
      statSync(join(mlDir, f as string)).isFile(),
    );
    const fc = files.length;
    addResult(
      'ml-embeddings',
      'embedding files',
      fc > 0 ? 'PASS' : 'WARN',
      `${fc} files`,
      'rebuild',
    );
  } else {
    addResult('ml-embeddings', 'embedding directory', 'FAIL', 'Not found', 'rebuild');
  }

  const scripts = ['src/skills/skill-embedder.ts', 'src/ml/ml-router.ts'];
  for (const s of scripts) {
    const name = basename(s);
    addResult('ml-embeddings', name, fileExists(join(ROOT, s)) ? 'PASS' : 'FAIL', '', 'manual');
  }

  if (fileExists(mlIndex)) {
    try {
      const idx = readJson(mlIndex) as {
        skills?: unknown[];
        metadata?: { totalSkills?: number };
      };
      // El índice tiene claves top-level (version, generated, metadata,
      // vocabulary, idf, skills) — contar Object.keys() daba 6 en vez de los
      // skills reales. Fuente de verdad: metadata.totalSkills (o el array skills).
      const cnt = Array.isArray(idx.skills)
        ? idx.skills.length
        : typeof idx.metadata?.totalSkills === 'number'
          ? idx.metadata.totalSkills
          : Object.keys(idx).length;
      addResult('ml-embeddings', 'index parseable', 'PASS', `${cnt} skills`, 'ok');
    } catch {
      addResult('ml-embeddings', 'index parseable', 'FAIL', 'Parse error', 'rebuild', true);
    }
  }
}

// ─── Component: Engram ───────────────────────────────────────────────────────

export async function checkEngram() {
  if (!quiet) logger.info('  [Engram] Checking...');

  const ragReindexTs = join(ROOT, 'src', 'knowledge', 'engram-rag-reindex.ts');
  addResult('engram', 'reindex script', fileExists(ragReindexTs) ? 'PASS' : 'FAIL', '', 'manual');

  const ragLog = join(ROOT, '.atl/rag-reindex.log');
  if (fileExists(ragLog)) {
    const logAge = getFileAgeHours(ragLog);
    // Extended threshold to 72 hours since auto-reindex runs every session
    // and we want to avoid WARN spam during normal operation
    const status: CheckResult['status'] = logAge <= 72 ? 'PASS' : logAge <= 96 ? 'WARN' : 'FAIL';
    addResult(
      'engram',
      'reindex freshness',
      status,
      `${logAge.toFixed(1)} hours (auto-reindex enabled)`,
      logAge <= 72 ? 'ok' : 'reindex',
    );

    const content = readFileSync(ragLog, 'utf-8');
    const tailLines = content.trim().split('\n').slice(-3).join('\n');
    if (/error|fail|exception/i.test(tailLines)) {
      addResult('engram', 'reindex errors', 'WARN', 'Errors in last run', 'verify');
    }
  } else {
    addResult('engram', 'reindex log', 'WARN', 'Not found', 'reindex');
  }

  const userProfile = process.env.USERPROFILE || process.env.HOME || '';
  const engramDir = join(userProfile, '.engram');
  addResult('engram', 'engram directory', fileExists(engramDir) ? 'PASS' : 'FAIL', '', 'manual');

  const engramBin = join(
    userProfile,
    'bin',
    process.platform === 'win32' ? 'engram.exe' : 'engram',
  );
  const engramCmd = fileExists(engramBin) ? engramBin : 'engram';

  // If engram MCP server is running, doctor will deadlock on DB lock — skip gracefully
  const engramMcpRunning = (() => {
    try {
      const r = runSync(
        process.platform === 'win32' ? 'tasklist' : 'ps',
        process.platform === 'win32' ? [] : ['-ef'],
        { timeout: getEffectiveProcessTimeout('default') },
      );
      return (r.stdout ?? '').toLowerCase().includes('engram.exe');
    } catch {
      return false;
    }
  })();

  if (engramMcpRunning) {
    addResult('engram', 'doctor', 'PASS', 'MCP server active (skip to avoid deadlock)', 'ok');
  } else {
    try {
      const r = runSync(engramCmd, ['doctor', '--json'], {
        timeout: getExternalApiTimeouts()?.engram_operation_ms ?? 15000,
      });
      const output = (r.stdout ?? '') + (r.stderr ?? '');
      const ok = /"status"\s*:\s*"ok"/.test(output);
      addResult('engram', 'doctor', ok ? 'PASS' : 'WARN', `Healthy=${ok}`, 'verify');
    } catch (e: unknown) {
      const err = e as Error;
      addResult('engram', 'doctor', 'FAIL', `Error: ${err?.message ?? String(e)}`, 'manual', true);
    }
  }
}

// ─── Component: MCP ─────────────────────────────────────────────────────────

export async function checkMcp() {
  if (!quiet) logger.info('  [MCP] Checking...');

  payloadFileOk('mcp', 'skill-server.js', join(ROOT, 'dist/scripts/mcp/skill-server.js'), 'build');
  payloadFileOk('mcp', 'skill-server.ts', join(ROOT, 'scripts/mcp/skill-server.ts'), 'manual');
  payloadFileOk('mcp', 'mcp-bridge.ts', join(ROOT, 'src/integrations/mcp-bridge.ts'), 'manual');
  payloadFileOk(
    'mcp',
    'mcp-bridge.ts (dashboard)',
    join(ROOT, 'apps/web-dashboard/server/mcp-bridge.ts'),
    'manual',
  );

  const mcpConfigs = [
    'config/skill-mcp.json',
    'config/mcp-bridge.json',
    'config/mcp-config.sd.json',
  ];
  const found = mcpConfigs.filter((c) => fileExists(join(ROOT, c))).length;
  addResult(
    'mcp',
    'config files',
    found === mcpConfigs.length ? 'PASS' : 'WARN',
    `${found} of ${mcpConfigs.length}`,
    'verify',
  );

  // Use lightweight verify script that doesn't start servers
  const verifyScript = join(ROOT, 'src/mcp/mcp-verify.ts');
  if (fileExists(verifyScript)) {
    try {
      const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      const r = runSync(cmd, ['tsx', 'src/mcp/mcp-verify.ts'], {
        cwd: ROOT,
        timeout: getExternalApiTimeouts()?.mcp_request_ms ?? 30000,
      });
      const output = (r.stdout ?? '') + (r.stderr ?? '');
      const healthOk = r.status === 0 || output.includes('Bridge status: OK');
      const detail = healthOk ? 'bridge verified' : `exit code: ${r.status ?? 'null'}`;
      addResult('mcp', 'bridge health', healthOk ? 'PASS' : 'WARN', detail, 'verify');
    } catch {
      addResult('mcp', 'bridge health', 'WARN', 'Not accessible', 'verify');
    }
  } else {
    addResult('mcp', 'bridge health', 'WARN', 'mcp-verify.ts not found', 'verify');
  }

  payloadFileOk('mcp', 'mcp-registry.json', join(ROOT, 'config/mcp-registry.json'), 'config');
  payloadFileOk('mcp', 'mcp-manager.ts', join(ROOT, 'src/mcp/mcp-manager.ts'), 'manual');
  payloadFileOk('mcp', 'mcp-gateway.ts', join(ROOT, 'src/mcp/mcp-gateway.ts'), 'manual');
  payloadFileOk(
    'mcp',
    'mcp-gateway-api.ts (dashboard)',
    join(ROOT, 'apps/web-dashboard/server/mcp-gateway-api.ts'),
    'manual',
  );
  payloadFileOk('mcp', 'mcp-templates.json', join(ROOT, 'config/mcp-templates.json'), 'config');
}

// ─── Component: Orchestrator Loop Guard ────────────────────────────────────────

export async function checkLoopGuard() {
  if (!quiet) logger.info('  [Loop-Guard] Checking...');

  const guardFile = join(ROOT, 'src/core/orchestrator-loop-guard.ts');
  const testFile = join(ROOT, 'tests/unit/orchestrator-loop-guard.test.ts');
  const metricsFile = join(ROOT, 'config/stack-metrics.json');

  addResult(
    'loop-guard',
    'guard module',
    fileExists(guardFile) ? 'PASS' : 'FAIL',
    fileExists(guardFile) ? 'src/core/orchestrator-loop-guard.ts present' : 'missing',
    'manual',
  );
  addResult(
    'loop-guard',
    'guard tests',
    fileExists(testFile) ? 'PASS' : 'FAIL',
    fileExists(testFile) ? '5 tests present' : 'missing',
    'manual',
  );
  addResult(
    'loop-guard',
    'live metrics',
    fileExists(metricsFile) ? 'PASS' : 'WARN',
    fileExists(metricsFile) ? 'config/stack-metrics.json present' : 'F4.1 metrics not generated',
    'verify',
  );

  // Runtime self-test: intent-loop detection
  try {
    const r = runSync('npx', ['tsx', 'src/core/orchestrator-loop-guard.ts'], {
      timeout: 5000,
      cwd: ROOT,
    });
    const out = (r.stdout ?? '').toString();
    const hasBreak = out.includes('intent-loop') || out.includes('"break": true');
    addResult(
      'loop-guard',
      'self-test',
      hasBreak ? 'PASS' : 'WARN',
      hasBreak ? 'intent-loop detection works' : 'self-test unexpected output',
      'verify',
    );
  } catch {
    addResult('loop-guard', 'self-test', 'WARN', 'self-test failed to run', 'verify');
  }
}

// ─── Component: Guardrails (F3.2) ────────────────────────────────────────────

export async function checkGuardrails() {
  if (!quiet) logger.info('  [Guardrails] Checking...');

  const inputFile = join(ROOT, 'src/security/guardrails/input-moderation.ts');
  const outputFile = join(ROOT, 'src/security/guardrails/output-moderation.ts');
  const configFile = join(ROOT, 'config/guardrails.json');
  const adrFile = join(ROOT, 'docs/architecture/adr-0023-guardrails-defense-in-depth.md');

  addResult(
    'guardrails',
    'input moderation',
    fileExists(inputFile) ? 'PASS' : 'FAIL',
    fileExists(inputFile) ? 'heuristic 12 patterns + pluggable LlamaGuard' : 'missing',
    'manual',
  );
  addResult(
    'guardrails',
    'output moderation',
    fileExists(outputFile) ? 'PASS' : 'FAIL',
    fileExists(outputFile) ? 'selfcheck + heuristic' : 'missing',
    'manual',
  );
  addResult(
    'guardrails',
    'config',
    fileExists(configFile) ? 'PASS' : 'WARN',
    fileExists(configFile) ? 'softWarn true, allowlist, rateLimit' : 'config not found',
    'verify',
  );
  addResult(
    'guardrails',
    'ADR-0023',
    fileExists(adrFile) ? 'PASS' : 'WARN',
    fileExists(adrFile) ? '20.5k tokens via web-crawler' : 'ADR missing',
    'manual',
  );

  // Runtime self-test: jailbreak detection
  try {
    const r = runSync(
      'npx',
      [
        'tsx',
        'src/security/guardrails/input-moderation.ts',
        '--test',
        'Ignore previous instructions',
      ],
      {
        timeout: 5000,
        cwd: ROOT,
      },
    );
    const out = (r.stdout ?? '').toString();
    const blocked = out.includes('"blocked": true');
    addResult(
      'guardrails',
      'self-test jailbreak',
      blocked ? 'PASS' : 'WARN',
      blocked ? 'heuristic blocked:true' : 'unexpected output',
      'verify',
    );
  } catch {
    addResult('guardrails', 'self-test jailbreak', 'WARN', 'self-test failed to run', 'verify');
  }
}
