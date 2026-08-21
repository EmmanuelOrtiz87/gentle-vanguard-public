#!/usr/bin/env node

import { readFileSync, existsSync, readdirSync, writeFileSync, statSync } from 'fs';
import { join, resolve, basename, relative } from 'path';
import { spawn, execFileSync } from 'child_process';
import { runSync } from './run-command';
import { createConnection } from 'net';
import {
  getEffectiveProcessTimeout,
  getHttpServerTimeouts,
  getExternalApiTimeouts,
} from './timeout-config';
import { witr, ensureWitrInstalled } from '../witr-wrapper';

const ROOT = resolve(process.cwd());
const RUNTIME_DIR = join(ROOT, '.runtime');
const SESSION_DIR = join(ROOT, '.session');

// Default port for the CodeGraph MCP server (overridable via CODEGRAPH_PORT env).
// Note: `codegraph serve --mcp` runs as a stdio MCP server, so the process table
// and PID file are the primary liveness signals; the port probe is a fallback.
const CODEGRAPH_PORT = parseInt(process.env.CODEGRAPH_PORT ?? '3000', 10) || 3000;

interface CheckResult {
  component: string;
  check: string;
  status: 'PASS' | 'WARN' | 'FAIL' | 'SKIP';
  detail: string;
  action: string;
  timestamp: string;
}

const results: CheckResult[] = [];
let quiet = false;
let exitCode = 0;

function addResult(
  component: string,
  check: string,
  status: CheckResult['status'],
  detail: string,
  action = 'ok',
  critical = false,
) {
  results.push({
    component,
    check,
    status,
    detail,
    action,
    timestamp: new Date().toISOString(),
  });
  if (!quiet || status !== 'PASS') {
    const icons: Record<string, string> = { PASS: '  ', WARN: '  ', FAIL: '  ', SKIP: '  ' };
    console.log(
      `${icons[status]}[${component}] ${check}: ${status}${detail ? ' - ' + detail : ''}`,
    );
  }
  if (status === 'FAIL' && critical) exitCode++;
}

function getFileAgeHours(filePath: string): number {
  try {
    const stats = statSync(filePath);
    return (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
  } catch {
    return -1;
  }
}

function testPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection(port, '127.0.0.1', () => {
      sock.destroy();
      resolve(true);
    });
    sock.on('error', () => resolve(false));
    sock.setTimeout(getEffectiveProcessTimeout('health_check'));
    sock.on('timeout', () => {
      sock.destroy();
      resolve(false);
    });
  });
}

/** Resolve the real PID listening on a TCP port (Windows via netstat, Unix via lsof/ss) */
async function getPidByPort(port: number): Promise<number | null> {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], {
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true,
      });
      for (const line of out.split(/\r?\n/)) {
        if (!line.includes(`:${port}`) || !line.includes('LISTENING')) continue;
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(pid)) return pid;
      }
    } else {
      const out = execFileSync('lsof', ['-ti', `:${port}`], {
        encoding: 'utf-8',
        timeout: 5000,
      });
      const pid = parseInt(out.trim().split('\n')[0], 10);
      if (!isNaN(pid)) return pid;
    }
  } catch {
    // not found or error
  }
  return null;
}

/**
 * Detect a running `codegraph serve --mcp` MCP server via the process table.
 * The server runs as a node process (`...codegraph.js serve --mcp`), so a plain
 * process-name scan misses it. On Windows we use CIM (wmic is deprecated), on
 * Unix `ps -ef`. The querying process itself is excluded via `$PID`.
 */
function isCodeGraphProcessRunning(): boolean {
  try {
    if (process.platform === 'win32') {
      const r = runSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "@(@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne `$PID -and $_.CommandLine -match 'codegraph\\.js' -and $_.CommandLine -match 'serve' -and $_.CommandLine -match '--mcp' })).Count",
        ],
        { timeout: 15000 },
      );
      const count = parseInt((r.stdout ?? '').trim(), 10);
      return !isNaN(count) && count > 0;
    }
    const r = runSync('ps', ['-ef'], { timeout: 15000 });
    return /codegraph\.js.*(serve|--mcp)/i.test(r.stdout ?? '');
  } catch {
    return false;
  }
}

function testHttp(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const client = createConnection(parseInt(new URL(url).port, 10) || 8080, '127.0.0.1', () => {
      client.write(
        `GET ${new URL(url).pathname} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`,
      );
    });
    let data = '';
    client.on('data', (chunk: Buffer) => {
      data += chunk.toString();
    });
    client.on('end', () =>
      resolve(
        data.includes('200 OK') || data.includes('HTTP/1.1 200') || data.includes('HTTP/1.0 200'),
      ),
    );
    client.on('error', () => resolve(false));
    client.setTimeout(getHttpServerTimeouts().socket_timeout_ms);
    client.on('timeout', () => {
      client.destroy();
      resolve(false);
    });
  });
}

function fileExists(p: string): boolean {
  return existsSync(p);
}

function readJson(p: string): Record<string, unknown> {
  return JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>;
}

function payloadFileOk(
  component: string,
  label: string,
  filePath: string,
  onFailAction = 'manual',
  critical = false,
): boolean {
  if (!fileExists(filePath)) {
    addResult(component, label, 'WARN', 'Not found', onFailAction);
    return false;
  }
  if (filePath.endsWith('.json')) {
    try {
      readJson(filePath);
      addResult(component, label, 'PASS', '', 'ok');
      return true;
    } catch {
      addResult(component, label, 'FAIL', 'Invalid JSON', onFailAction, critical);
      return false;
    }
  } else {
    addResult(component, label, 'PASS', '', 'ok');
    return true;
  }
}

// ─── Component: Dashboard WS ────────────────────────────────────────────────

async function checkDashboardWs() {
  if (!quiet) console.log('  [Dashboard WS] Checking...');

  let wsPort = 8080;
  const portsFile = join(RUNTIME_DIR, 'dashboard-ports.json');
  if (fileExists(portsFile)) {
    try {
      const ports = readJson(portsFile);
      wsPort = typeof ports.wsPort === 'number' ? ports.wsPort : 8080;
    } catch {
      addResult('dashboard-ws', 'ports.json', 'FAIL', 'Invalid JSON', 'verify');
    }
  }

  // Try configured port first, then fallback to common ports
  const portsToTry = [wsPort, 8080, 8082].filter((p, i, arr) => arr.indexOf(p) === i);
  let httpOk = false;
  let respondingPort = wsPort;
  for (const port of portsToTry) {
    httpOk = await testHttp(`http://127.0.0.1:${port}/api/metrics`);
    if (httpOk) {
      respondingPort = port;
      break;
    }
  }
  const running = !httpOk && (await testPort(wsPort));

  if (httpOk) {
    addResult('dashboard-ws', `HTTP API (port ${respondingPort})`, 'PASS', 'Responding', 'ok');
  } else if (running) {
    addResult(
      'dashboard-ws',
      `HTTP API (port ${wsPort})`,
      'WARN',
      'Port open but HTTP not responding',
      'verify',
    );
  } else {
    addResult('dashboard-ws', `HTTP API (port ${wsPort})`, 'FAIL', 'Not responding', 'restart');
  }

  const wPidFile = join(RUNTIME_DIR, 'dashboard-ws-watchdog.pid');
  if (fileExists(wPidFile)) {
    const watchdogPid = readFileSync(wPidFile, 'utf-8').trim();
    try {
      process.kill(parseInt(watchdogPid, 10), 0);
      addResult('dashboard-ws', 'watchdog process', 'PASS', `PID ${watchdogPid} running`, 'ok');
    } catch {
      // Watchdog is a fire-and-forget launcher — dead PID is expected when WS is healthy
      if (httpOk || running) {
        addResult(
          'dashboard-ws',
          'watchdog process',
          'PASS',
          'WS running, watchdog one-shot (ok)',
          'ok',
        );
      } else {
        addResult(
          'dashboard-ws',
          'watchdog process',
          'FAIL',
          `PID ${watchdogPid} not running`,
          'restart',
        );
      }
    }
  } else if (httpOk || running) {
    addResult('dashboard-ws', 'watchdog process', 'PASS', 'WS running standalone', 'ok');
  } else {
    addResult('dashboard-ws', 'watchdog process', 'WARN', 'WS down and no watchdog', 'start');
  }

  const pidFile = join(RUNTIME_DIR, 'dashboard-ws.pid');
  if (httpOk) {
    // WS is alive and responding — the PID file may be stale (points to a dead
    // cmd.exe wrapper). Treat HTTP as source of truth and self-heal the file
    // with the real PID listening on the port.
    let pidDetail = 'Responding (PID file stale)';
    const realPid = await getPidByPort(respondingPort);
    if (realPid) {
      pidDetail = `PID ${realPid} running`;
      try {
        writeFileSync(pidFile, String(realPid), 'utf-8');
      } catch {
        /* non-fatal */
      }
    }
    addResult('dashboard-ws', 'WS server process', 'PASS', pidDetail, 'ok');
  } else if (fileExists(pidFile)) {
    const wsPid = readFileSync(pidFile, 'utf-8').trim();
    try {
      process.kill(parseInt(wsPid, 10), 0);
      addResult('dashboard-ws', 'WS server process', 'PASS', `PID ${wsPid} running`, 'ok');
    } catch {
      addResult('dashboard-ws', 'WS server process', 'FAIL', `PID ${wsPid} not running`, 'restart');
    }
  } else {
    addResult('dashboard-ws', 'WS server process', 'WARN', 'No PID file', 'start');
  }

  addResult(
    'dashboard-ws',
    'build (dist/index.html)',
    fileExists(join(ROOT, 'apps/web-dashboard/dist/index.html')) ? 'PASS' : 'FAIL',
    '',
    'ok',
  );
}

// ─── Component: CodeGraph ───────────────────────────────────────────────────

async function checkCodeGraph() {
  if (!quiet) console.log('  [CodeGraph] Checking...');

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

/**
 * True when the codegraph daemon may still be booting: the PID file was written
 * recently, or the current session is younger than the boot window. This does
 * NOT depend on session-current.json existing (it can be absent while the
 * pipeline is still initializing, which previously made the boot tolerance
 * silently fail and let the autoheal spawn a competing codegraph instance).
 */
function isCodeGraphRecentlyBooted(): boolean {
  const pidFile = join(RUNTIME_DIR, 'codegraph-mcp-server.pid');
  if (fileExists(pidFile)) {
    try {
      const ageMs = Date.now() - statSync(pidFile).mtimeMs;
      if (ageMs < 90000) return true; // PID file touched in last 90s
    } catch {
      /* fall through */
    }
  }
  return getSessionAgeSeconds() < 60;
}

/** Age of the current session in seconds (0 if unknown / no session file). */
function getSessionAgeSeconds(): number {
  try {
    const sf = join(SESSION_DIR, 'session-current.json');
    if (!fileExists(sf)) return Number.MAX_SAFE_INTEGER;
    const data = readJson(sf) as { startTime?: string; timestamp?: string };
    const t = new Date(data.startTime ?? data.timestamp ?? 0).getTime();
    if (isNaN(t) || t === 0) return Number.MAX_SAFE_INTEGER;
    return Math.floor((Date.now() - t) / 1000);
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

// ─── Component: Timeout Daemon ────────────────────────────────────────────────

async function checkTimeoutDaemon() {
  if (!quiet) console.log('  [Timeout Daemon] Checking...');

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

// ─── Component: ML Embeddings ────────────────────────────────────────────────

async function checkMlEmbeddings() {
  if (!quiet) console.log('  [ML Embeddings] Checking...');

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

  const scripts = ['src/skills/skill-embedder.ts', 'src/ml-router.ts'];
  for (const s of scripts) {
    const name = basename(s);
    addResult('ml-embeddings', name, fileExists(join(ROOT, s)) ? 'PASS' : 'FAIL', '', 'manual');
  }

  if (fileExists(mlIndex)) {
    try {
      const idx = readJson(mlIndex);
      const cnt = Object.keys(idx).length;
      addResult('ml-embeddings', 'index parseable', 'PASS', `${cnt} skills`, 'ok');
    } catch {
      addResult('ml-embeddings', 'index parseable', 'FAIL', 'Parse error', 'rebuild', true);
    }
  }
}

// ─── Component: Engram ───────────────────────────────────────────────────────

async function checkEngram() {
  if (!quiet) console.log('  [Engram] Checking...');

  const ragReindexTs = join(ROOT, 'src', 'engram-rag-reindex.ts');
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

async function checkMcp() {
  if (!quiet) console.log('  [MCP] Checking...');

  payloadFileOk('mcp', 'skill-server.js', join(ROOT, 'dist/scripts/mcp/skill-server.js'), 'build');
  payloadFileOk('mcp', 'skill-server.ts', join(ROOT, 'scripts/mcp/skill-server.ts'), 'manual');
  payloadFileOk('mcp', 'mcp-bridge.ts', join(ROOT, 'src/mcp-bridge.ts'), 'manual');
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

// ─── Component: Session Pipeline ────────────────────────────────────────────

async function checkSessionPipeline() {
  if (!quiet) console.log('  [Session] Checking...');

  const scripts = [
    'src/session-start-optimized.ts',
    'src/session-manager.ts',
    'src/pre-process-input.ts',
    'src/session-start-optimized.ts',
    'src/session-cleanup-start.ts',
  ];
  for (const s of scripts) {
    const name = basename(s);
    addResult('session', name, fileExists(join(ROOT, s)) ? 'PASS' : 'FAIL', '', 'manual');
  }

  addResult(
    'session',
    'autostart config',
    fileExists(join(ROOT, 'config/session-autostart.config.json')) ? 'PASS' : 'FAIL',
    '',
    'manual',
  );
}

// ─── Component: Git Hooks ───────────────────────────────────────────────────

async function checkHooks() {
  if (!quiet) console.log('  [Hooks] Checking...');

  addResult(
    'hooks',
    '.lefthook.yml',
    fileExists(join(ROOT, '.lefthook.yml')) ? 'PASS' : 'FAIL',
    '',
    'manual',
  );

  try {
    const r = runSync('lefthook', ['validate'], {
      cwd: ROOT,
      timeout: getEffectiveProcessTimeout('default'),
    });
    addResult(
      'hooks',
      'lefthook validate',
      r.status === 0 ? 'PASS' : 'FAIL',
      r.stderr ?? '',
      'manual',
    );
  } catch {
    addResult('hooks', 'lefthook validate', 'FAIL', 'Not installed or invalid', 'manual');
  }
}

// ─── Component: Configs ─────────────────────────────────────────────────────

async function checkConfigs() {
  if (!quiet) console.log('  [Configs] Checking...');

  const configs = [
    'config/orchestrator.json',
    'config/auto-delegation.json',
    'config/session-autostart.config.json',
    'config/security-policy.json',
    'config/trusted-users-policy.json',
    'config/security-privacy.json',
    'config/sre-error-budgets.json',
    'config/dashboard-alerts.json',
    'opencode.json',
    'renovate.json',
  ];
  for (const cfg of configs) {
    payloadFileOk('configs', cfg, join(ROOT, cfg), 'fix', true);
  }
}

// ─── Component: Tool Configs ────────────────────────────────────────────────

async function checkToolConfigs() {
  if (!quiet) console.log('  [Tool Configs] Checking...');

  const files = [
    'CLAUDE.md',
    'AGENTS.md',
    '.clinerules',
    '.cursorrules',
    'SECURITY.md',
    '.nvmrc',
    '.node-version',
  ];
  for (const f of files) {
    addResult('tool-configs', f, fileExists(join(ROOT, f)) ? 'PASS' : 'WARN', '', 'manual');
  }

  const windsurfCfg = join(ROOT, '.windsurf/config.json');
  if (fileExists(windsurfCfg)) {
    payloadFileOk('tool-configs', '.windsurf/config.json', windsurfCfg, 'fix');
  } else {
    addResult('tool-configs', '.windsurf/config.json', 'WARN', 'Not found', 'manual');
  }
}

// ─── Component: Security ────────────────────────────────────────────────────

async function checkSecurity() {
  if (!quiet) console.log('  [Security] Checking...');

  const secFiles = [
    'config/owner-auth.json.enc',
    'config/owner-auth.json.integrity',
    'src/security/privacy-gateway.ts',
    'src/security/security-orchestrator.ts',
    'SECURITY.md',
    '.github/CODEOWNERS',
    '.github/dependabot.yml',
  ];
  for (const f of secFiles) {
    addResult('security', f, fileExists(join(ROOT, f)) ? 'PASS' : 'WARN', '', 'manual');
  }
}

// ─── Component: Secret Scanner (absorbed knowledge, ADR-010) ─────────────────

async function checkSecretScanner() {
  if (!quiet) console.log('  [Secret Scanner] Checking...');

  const scannerSrc = join(ROOT, 'src', 'secret-scanner.ts');
  const scannerCli = join(ROOT, 'src', 'secret-scanner-cli.ts');
  const scannerCfg = join(ROOT, 'config', 'secret-scanner.json');
  const scannerTest = join(ROOT, 'tests', 'unit', 'secret-scanner.test.ts');

  payloadFileOk('secret-scanner', 'module (src/secret-scanner.ts)', scannerSrc, 'manual', true);
  payloadFileOk('secret-scanner', 'CLI (src/secret-scanner-cli.ts)', scannerCli, 'manual', true);
  payloadFileOk('secret-scanner', 'config (config/secret-scanner.json)', scannerCfg, 'manual', true);
  payloadFileOk('secret-scanner', 'tests (tests/unit/secret-scanner.test.ts)', scannerTest, 'manual', true);

  // Verify pattern catalog size from config (patterns: builtin|all)
  if (fileExists(scannerCfg)) {
    try {
      const cfg = readJson(scannerCfg) as { patterns?: string };
      if (cfg.patterns === 'builtin' || cfg.patterns === 'all') {
        addResult('secret-scanner', 'patterns mode', 'PASS', `patterns=${cfg.patterns}`, 'ok');
      } else {
        addResult('secret-scanner', 'patterns mode', 'WARN', `Unexpected patterns value: ${String(cfg.patterns)}`, 'manual');
      }
    } catch {
      addResult('secret-scanner', 'patterns mode', 'FAIL', 'Invalid config JSON', 'manual');
    }
  }
}

// ─── Component: CLI Guard (Windows pathToFileURL) ────────────────────────────

async function checkCliGuard() {
  if (!quiet) console.log('  [CLI Guard] Checking...');

  // Detecta el patrón roto `import.meta.url === \`file://${process.argv[1]}\``
  // que NO normaliza rutas Windows (backslashes) → main() nunca se ejecuta.
  // El patrón correcto usa pathToFileURL(process.argv[1]).href.
  const brokenPattern = /import\.meta\.url\s*===\s*`file:\/\/\$\{process\.argv\[1\]\}`/;
  const srcDir = join(ROOT, 'src');
  let brokenCount = 0;
  const brokenFiles: string[] = [];

  const walk = (dir: string): void => {
    let dirEntries: import('fs').Dirent[];
    try {
      dirEntries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of dirEntries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.ts')) {
        try {
          const content = readFileSync(full, 'utf8');
          if (brokenPattern.test(content)) {
            brokenCount++;
            brokenFiles.push(relative(ROOT, full));
          }
        } catch {
          // skip unreadable
        }
      }
    }
  };
  walk(srcDir);

  if (brokenCount === 0) {
    addResult('cli-guard', 'pathToFileURL guard', 'PASS', 'No broken CLI guards found', 'ok');
  } else {
    addResult(
      'cli-guard',
      'pathToFileURL guard',
      'FAIL',
      `${brokenCount} file(s) with broken guard: ${brokenFiles.join(', ')}`,
      'manual',
    );
  }
}

// ─── Component: Cloud Connectors ────────────────────────────────────────────
// NOTE: Cloud connectors deprecated - stack operates in local-only mode
// This check now verifies local execution mode without cloud dependencies

async function checkCloudConnectors() {
  if (!quiet) console.log('  [Cloud Connectors] Checking...');

  // Stack operates in local-only mode - no cloud dependencies
  addResult('cloud-connectors', 'mode', 'PASS', 'Local-only mode (no cloud dependencies)', 'ok');

  // Verify local execution is working
  const localMetrics = join(SESSION_DIR, 'token-budget.json');
  if (fileExists(localMetrics)) {
    addResult('cloud-connectors', 'local metrics', 'PASS', 'Token budget tracking active', 'ok');
  } else {
    addResult(
      'cloud-connectors',
      'local metrics',
      'PASS',
      'No local metrics yet (will be created on first use)',
      'ok',
    );
  }

  // Cloud scripts intentionally removed - stack is local-only
  addResult(
    'cloud-connectors',
    'cloud scripts',
    'PASS',
    'Cloud scripts removed (local-only stack)',
    'ok',
  );
}

// ─── Component: Web Crawler (Firecrawl) ──────────────────────────────────────

async function checkWebCrawler() {
  if (!quiet) console.log('  [Web Crawler] Checking...');

  const cfgPath = join(ROOT, 'config', 'web-crawler.json');
  if (!fileExists(cfgPath)) {
    addResult('web-crawler', 'config file', 'WARN', 'Not found', 'manual');
    return;
  }
  payloadFileOk('web-crawler', 'config file', cfgPath, 'manual', true);

  const healthFile = join(RUNTIME_DIR, 'web-crawler-health.json');
  if (fileExists(healthFile)) {
    try {
      const health = readJson(healthFile);
      const apiKeySet = !!health.apiKeyConfigured;
      const fallbackActive = !!health.fallbackActive;
      const cacheReady = !!health.cacheDir;
      addResult(
        'web-crawler',
        'provider ready',
        apiKeySet || fallbackActive ? 'PASS' : 'WARN',
        apiKeySet
          ? 'Firecrawl configured'
          : fallbackActive
            ? 'Fallback activo (Jina Reader + DDG HTML + Bing RSS), sin API key'
            : 'No provider configured',
        'manual',
      );
      addResult(
        'web-crawler',
        'cache directory',
        cacheReady ? 'PASS' : 'WARN',
        cacheReady ? 'Ready' : 'Missing',
        'manual',
      );
    } catch {
      addResult('web-crawler', 'health snapshot', 'FAIL', 'Invalid JSON', 'manual');
    }
  } else {
    addResult('web-crawler', 'health snapshot', 'WARN', 'Not generated yet', 'manual');
  }
}

// ─── Component: Tracing ──────────────────────────────────────────────────────

async function checkTracing() {
  if (!quiet) console.log('  [Tracing] Checking...');

  const telemetryDir = join(ROOT, '.telemetry');
  const tracesDir = join(telemetryDir, 'traces');
  const metricsDir = join(telemetryDir, 'metrics');

  if (fileExists(tracesDir)) {
    const traceFiles = readdirSync(tracesDir).filter((f) => f.endsWith('.jsonl')).length;
    addResult('tracing', 'trace files', 'PASS', `${traceFiles} trace file(s)`, 'ok');
  } else {
    addResult('tracing', 'trace files', 'WARN', 'No traces directory', 'ok');
  }

  if (fileExists(metricsDir)) {
    const promFile = join(metricsDir, 'prometheus-metrics.prom');
    if (fileExists(promFile)) {
      const age = getFileAgeHours(promFile);
      const status: CheckResult['status'] = age < 24 ? 'PASS' : age < 72 ? 'WARN' : 'FAIL';
      addResult(
        'tracing',
        'prometheus metrics',
        status,
        `last export ${age.toFixed(1)} hrs ago`,
        'ok',
      );
    } else {
      addResult('tracing', 'prometheus metrics', 'WARN', 'No prometheus export', 'ok');
    }
  } else {
    addResult('tracing', 'metrics directory', 'WARN', 'Not initialized', 'ok');
  }

  addResult(
    'tracing',
    'instrumentation script',
    fileExists(join(ROOT, 'src/tracing-instrument.ts')) ? 'PASS' : 'FAIL',
    '',
    'verify',
  );
}

// ─── Component: State Persistence ────────────────────────────────────────────

async function checkStatePersistence() {
  if (!quiet) console.log('  [State Persistence] Checking...');

  const checkpointDir = join(SESSION_DIR, 'checkpoints');
  const manifestDir = join(SESSION_DIR, 'manifests');
  const snapshotDir = join(SESSION_DIR, 'snapshots');

  if (fileExists(checkpointDir)) {
    const ckpts = readdirSync(checkpointDir).filter((f) =>
      statSync(join(checkpointDir, f)).isDirectory(),
    ).length;
    addResult('state-persistence', 'checkpoints', 'PASS', `${ckpts} checkpoint(s)`, 'ok');
    const dirs = readdirSync(checkpointDir)
      .filter((f) => statSync(join(checkpointDir, f)).isDirectory())
      .map((f) => ({ name: f, mtime: statSync(join(checkpointDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (dirs.length > 0) {
      const latestAge = (Date.now() - dirs[0].mtime) / (1000 * 60 * 60);
      if (latestAge > 72) {
        addResult(
          'state-persistence',
          'latest checkpoint',
          'WARN',
          `${latestAge.toFixed(1)}hrs old`,
          'verify',
        );
      }
    }
  } else {
    addResult('state-persistence', 'checkpoints', 'WARN', 'No checkpoints directory', 'ok');
  }

  if (fileExists(manifestDir)) {
    const manifests = readdirSync(manifestDir).filter((f) => f.endsWith('.json')).length;
    addResult('state-persistence', 'manifests', 'PASS', `${manifests} manifest(s)`, 'ok');
  } else {
    addResult('state-persistence', 'manifests', 'WARN', 'No manifests', 'ok');
  }

  if (fileExists(snapshotDir)) {
    const snaps = readdirSync(snapshotDir).filter((f) => f.endsWith('.json')).length;
    addResult('state-persistence', 'snapshots', 'PASS', `${snaps} snapshot(s)`, 'ok');
  } else {
    addResult('state-persistence', 'snapshots', 'WARN', 'No snapshots', 'ok');
  }

  const ckptMgr = join(ROOT, 'src/checkpoint-manager.ts');
  const rollbackOrch = join(ROOT, 'src/rollback-orchestrator.ts');
  const snapMgr = join(ROOT, 'src/snapshot-manager.ts');
  const allScripts = fileExists(ckptMgr) && fileExists(rollbackOrch) && fileExists(snapMgr);
  addResult(
    'state-persistence',
    'scripts',
    allScripts ? 'PASS' : 'FAIL',
    allScripts ? 'All 3 scripts present' : 'Missing scripts',
    'verify',
  );
}

// ─── Component: gentle-vanguard-db ───────────────────────────────────────────

async function checkGentleVanguardDb() {
  if (!quiet) console.log('  [gentle-vanguard-db] Checking...');

  const dbPath = join(RUNTIME_DIR, 'gentle-vanguard.db');
  const dbExists = fileExists(dbPath);
  addResult(
    'gentle-vanguard-db',
    'database file',
    dbExists ? 'PASS' : 'FAIL',
    dbExists ? `${(statSync(dbPath).size / 1024 / 1024).toFixed(2)} MB` : 'Not found',
    'init',
  );

  if (dbExists) {
    // Check WAL size — auto-checkpoint if WAL > DB size or > 5MB
    const walPath = dbPath + '-wal';
    if (fileExists(walPath)) {
      const walBytes = statSync(walPath).size;
      const walMB = walBytes / 1024 / 1024;
      const dbBytes = statSync(dbPath).size;
      const walRatio = dbBytes > 0 ? walBytes / dbBytes : 0;
      const needsCheckpoint = walMB > 5 || walRatio > 1.5;
      if (needsCheckpoint) {
        try {
          const cmd = process.platform === 'win32' ? 'sqlite3.exe' : 'sqlite3';
          runSync(cmd, [dbPath, 'PRAGMA wal_checkpoint(TRUNCATE);'], { timeout: 30000 });
          const newWalBytes = existsSync(walPath) ? statSync(walPath).size : 0;
          addResult(
            'gentle-vanguard-db',
            'WAL auto-checkpoint',
            'PASS',
            `${walMB.toFixed(2)} MB → ${(newWalBytes / 1024 / 1024).toFixed(2)} MB (ratio ${walRatio.toFixed(1)}x)`,
            'auto-healed',
          );
        } catch {
          addResult(
            'gentle-vanguard-db',
            'WAL file',
            'WARN',
            `${walMB.toFixed(2)} MB (checkpoint failed)`,
            'manual',
          );
        }
      } else {
        addResult('gentle-vanguard-db', 'WAL file', 'PASS', `${walMB.toFixed(2)} MB`, 'ok');
      }
    } else {
      addResult('gentle-vanguard-db', 'WAL file', 'PASS', 'No WAL (journal mode)');
    }

    // Try integrity check via sqlite3 CLI
    try {
      const cmd = process.platform === 'win32' ? 'sqlite3.exe' : 'sqlite3';
      const r = runSync(cmd, [dbPath, 'PRAGMA integrity_check;'], {
        timeout: getEffectiveProcessTimeout('default'),
      });
      const output = (r.stdout ?? '').trim();
      const stderr = (r.stderr ?? '').trim();
      const processFailed = r.error || (r.status !== null && r.status !== 0);
      const isTransient =
        processFailed || output === '' || /locked|busy|no such|Error/i.test(stderr);
      const integrityOk = output === 'ok';

      let status: 'PASS' | 'WARN' | 'FAIL';
      let action: string;
      if (integrityOk) {
        status = 'PASS';
        action = 'ok';
      } else if (isTransient) {
        // Transient: DB locked by another process or CLI unavailable — not corruption
        status = 'WARN';
        action = 'retry';
      } else {
        status = 'FAIL';
        action = 'restore';
      }

      const detail = integrityOk
        ? 'ok'
        : isTransient
          ? `Transient (${output.substring(0, 40) || stderr.substring(0, 40) || 'process error'})`
          : output.substring(0, 80);
      addResult('gentle-vanguard-db', 'integrity check', status, detail, action);

      // Get table and row counts (only on PASS)
      if (integrityOk) {
        try {
          const tablesOut = runSync(cmd, [dbPath, '.tables'], { timeout: 5000 }).stdout.trim();
          const tables = tablesOut.split(/\s+/).filter((t) => t.length > 0 && !t.startsWith('_'));
          let totalRows = 0;
          for (const t of tables) {
            try {
              const row = runSync(cmd, [dbPath, `SELECT COUNT(*) FROM [${t}];`], {
                timeout: 3000,
              }).stdout.trim();
              totalRows += parseInt(row, 10) || 0;
            } catch {
              /* skip */
            }
          }
          addResult(
            'gentle-vanguard-db',
            'size',
            'PASS',
            `${tables.length} tables, ${totalRows} rows`,
            'ok',
          );
        } catch {
          addResult('gentle-vanguard-db', 'size', 'WARN', 'Could not enumerate tables');
        }
      }
    } catch {
      addResult(
        'gentle-vanguard-db',
        'integrity check',
        'WARN',
        'sqlite3 CLI not available',
        'manual',
      );
    }
  }
}

// ─── Component: Model Provider Health ────────────────────────────────────────

async function checkModelHealth() {
  if (!quiet) console.log('  [model-provider-health] Checking...');

  const statePath = join(RUNTIME_DIR, 'model-health.json');
  const configPath = join(ROOT, 'config', 'model-health.json');
  const activePath = join(RUNTIME_DIR, 'model-active.json');

  if (!fileExists(configPath)) {
    addResult(
      'model-provider-health',
      'config',
      'FAIL',
      'config/model-health.json not found',
      'verify',
    );
    return;
  }
  addResult('model-provider-health', 'config', 'PASS', 'model-health.json present', 'ok');

  let activeModel = 'unknown';
  if (fileExists(activePath)) {
    try {
      const active = JSON.parse(readFileSync(activePath, 'utf-8'));
      activeModel = active.model || active.activeModel || 'unknown';
    } catch {
      /* ignore */
    }
  }

  if (!fileExists(statePath)) {
    addResult('model-provider-health', 'state', 'PASS', `No unhealthy models tracked`, 'ok');
    addResult('model-provider-health', 'active model', 'PASS', activeModel, 'ok');
    return;
  }

  try {
    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    const models = (state.models ?? {}) as Record<
      string,
      { status?: string; reason?: string; cooldownUntil?: string }
    >;
    const now = Date.now();
    const unhealthy = Object.entries(models).filter(
      ([, m]) =>
        m.status === 'unhealthy' && m.cooldownUntil && new Date(m.cooldownUntil).getTime() > now,
    );
    const healthy = Object.entries(models).filter(([, m]) => m.status === 'healthy');

    if (unhealthy.length > 0) {
      for (const [name, m] of unhealthy) {
        addResult(
          'model-provider-health',
          `model ${name}`,
          'WARN',
          `unhealthy (${m.reason?.slice(0, 60) ?? 'unknown reason'})`,
          'switch-to-fallback',
        );
      }
    }
    if (healthy.length > 0) {
      for (const [name, m] of healthy) {
        addResult('model-provider-health', `model ${name}`, 'PASS', m.reason ?? 'healthy', 'ok');
      }
    }
    if (unhealthy.length === 0 && healthy.length === 0) {
      addResult('model-provider-health', 'state', 'PASS', 'No models tracked', 'ok');
    }
    addResult(
      'model-provider-health',
      'active model',
      activeModel === 'unknown' ? 'WARN' : 'PASS',
      activeModel,
      'ok',
    );
  } catch {
    addResult(
      'model-provider-health',
      'state',
      'WARN',
      'Could not parse model-health.json',
      'verify',
    );
  }
}

// ─── Component: Audit Pipeline ───────────────────────────────────────────────

async function checkAuditPipeline() {
  if (!quiet) console.log('  [Audit Pipeline] Checking...');

  const auditDir = join(SESSION_DIR, 'audit');
  const logDir = join(auditDir, 'logs');
  const indexFile = join(auditDir, 'index.json');

  if (fileExists(logDir)) {
    const logFiles = readdirSync(logDir).filter((f) => f.endsWith('.jsonl'));
    let totalEvents = 0;
    for (const f of logFiles) {
      const content = readFileSync(join(logDir, f), 'utf-8').trim();
      if (content) totalEvents += content.split('\n').length;
    }
    addResult(
      'audit',
      'log files',
      'PASS',
      `${logFiles.length} file(s), ${totalEvents} events`,
      'ok',
    );
  } else {
    addResult('audit', 'log files', 'WARN', 'No audit logs yet', 'ok');
  }

  if (fileExists(indexFile)) {
    addResult('audit', 'index', 'PASS', 'Available', 'ok');
  } else if (fileExists(logDir) && readdirSync(logDir).some((f) => f.endsWith('.jsonl'))) {
    // Events exist but the index is missing — real inconsistency worth flagging.
    addResult('audit', 'index', 'WARN', 'No index (events present)', 'ok');
  } else {
    // No audit events yet — index is legitimately absent until the first event
    // is recorded (saveAuditEvent creates it). Initial state is not a warning.
    addResult('audit', 'index', 'PASS', 'No events yet (index pending)', 'ok');
  }

  addResult(
    'audit',
    'pipeline script',
    fileExists(join(ROOT, 'src/infrastructure/audit-pipeline.ts')) ? 'PASS' : 'FAIL',
    '',
    'verify',
  );

  const rbacPath = join(ROOT, 'config/rbac-policy.json');
  const cspPath = join(ROOT, 'config/security-csp.json');
  const secConfigs = fileExists(rbacPath) && fileExists(cspPath);
  addResult(
    'audit',
    'security configs',
    secConfigs ? 'PASS' : 'FAIL',
    secConfigs ? 'RBAC + CSP present' : 'Missing configs',
    'verify',
  );
}

// ─── Component: Governance ──────────────────────────────────────────────────

async function checkGovernance() {
  if (!quiet) console.log('  [Governance] Checking...');

  const govFiles = [
    'rules/NORMATIVAS-PERFORMANCE.md',
    'rules/SDD-STRICT-TDD.md',
    'rules/PER-PHASE-MODEL-ROUTING.md',
    'openspec/config.yaml',
    'rules/NORMATIVA-PNPM-SECURITY.md',
  ];
  for (const f of govFiles) {
    addResult('governance', f, fileExists(join(ROOT, f)) ? 'PASS' : 'WARN', '', 'manual');
  }

  // Pester check removed — all checks migrated to TypeScript, no PowerShell tests remain
}

// ─── Rebuild Actions ────────────────────────────────────────────────────────

async function rebuildMlEmbeddings() {
  if (!quiet) console.log('  [Rebuild] ML Embeddings...');
  const skillEmbedder = join(ROOT, 'src/skills/skill-embedder.ts');
  if (fileExists(skillEmbedder)) {
    try {
      const r = runSync('npx', ['tsx', 'src/skills/skill-embedder.ts'], {
        cwd: ROOT,
        stdio: 'pipe',
        timeout: getEffectiveProcessTimeout('long_running'),
      });
      addResult('ml-embeddings', 'rebuild', r.status === 0 ? 'PASS' : 'FAIL', 'Completed', 'ok');
    } catch (e: unknown) {
      addResult(
        'ml-embeddings',
        'rebuild',
        'FAIL',
        `Error: ${e instanceof Error ? e.message : String(e)}`,
        'manual',
        true,
      );
    }
  } else {
    addResult('ml-embeddings', 'rebuild', 'SKIP', 'Not found', 'manual');
  }
}

async function reindexEngramRag() {
  if (!quiet) console.log('  [Rebuild] Engram RAG...');
  const ragReindexTs = join(ROOT, 'src', 'engram-rag-reindex.ts');
  const ragReindexPs1 = join(ROOT, 'src/engram-rag-reindex.ts');
  const hasTs = fileExists(ragReindexTs);
  if (hasTs || fileExists(ragReindexPs1)) {
    try {
      let r: { status: number | null };
      if (hasTs) {
        r = runSync('npx', ['tsx', ragReindexTs], {
          cwd: ROOT,
          stdio: 'pipe',
          timeout: getEffectiveProcessTimeout('long_running'),
        });
      } else {
        r = runSync('pwsh', ['-NoProfile', '-File', ragReindexPs1], {
          cwd: ROOT,
          stdio: 'pipe',
          timeout: getEffectiveProcessTimeout('long_running'),
        });
      }
      addResult('engram', 'reindex', r.status === 0 ? 'PASS' : 'FAIL', 'Completed', 'ok');
    } catch (e: unknown) {
      addResult(
        'engram',
        'reindex',
        'FAIL',
        `Error: ${e instanceof Error ? e.message : String(e)}`,
        'manual',
        true,
      );
    }
  } else {
    addResult('engram', 'reindex', 'SKIP', 'Not found', 'manual');
  }
}

// ─── Auto-Heal ──────────────────────────────────────────────────────────────

async function autoHeal() {
  if (!quiet) console.log('\n  -- Auto-Heal Phase --');

  const needsRestart = results.filter((r) => r.action === 'restart' && r.status !== 'PASS');
  const needsStart = results.filter((r) => r.action === 'start' && r.status !== 'PASS');

  let healed = 0;
  let failed = 0;

  if (needsRestart.length === 0 && needsStart.length === 0) {
    if (!quiet) console.log('  No components need healing');
    return;
  }

  // Dashboard WS server restart
  const dashFail = [...needsRestart, ...needsStart].filter((r) => r.component === 'dashboard-ws');
  if (dashFail.length > 0) {
    let wsPort = 8080;
    const portsFile = join(RUNTIME_DIR, 'dashboard-ports.json');
    if (fileExists(portsFile)) {
      try {
        const ports = readJson(portsFile);
        wsPort = typeof ports.wsPort === 'number' ? ports.wsPort : 8080;
      } catch {
        /* port file parse error, use default */
      }
    }

    const wsRunning = await testPort(wsPort);
    const wsAutostart = join(ROOT, 'src', 'dashboard-ws-autostart.ts');

    if (wsRunning) {
      if (!quiet)
        console.log(`  [Heal] WS alive on port ${wsPort}, no action needed (watchdog optional)`);
      addResult('dashboard-ws', 'autoheal', 'PASS', 'WS alive, watchdog skipped', 'ok');
      healed++;
    } else if (wsAutostart.endsWith('.ts')) {
      // Use TS wrapper for reliable Windows process launching
      const wrapperTs = join(ROOT, 'src', 'dashboard-ws-launcher.ts');
      if (!quiet) console.log('  [Heal] Restarting Dashboard WS server via wrapper...');
      try {
        // Launch via TS wrapper - creates truly detached process
        const child = spawn(
          process.platform === 'win32' ? 'npx.cmd' : 'npx',
          ['tsx', wrapperTs, '--quiet'],
          {
            cwd: ROOT,
            stdio: 'ignore',
            windowsHide: true,
            detached: true,
            shell: true,
          },
        );
        child.unref();

        // Wait for process to start and check if port is up
        await new Promise((resolve) => setTimeout(resolve, 8000));

        // Verify by checking if port is now responding
        const isPortUp = await testPort(wsPort);
        if (isPortUp) {
          addResult(
            'dashboard-ws',
            'autoheal',
            'PASS',
            `Restarted (port ${wsPort} responding)`,
            'ok',
          );
          healed++;
        } else {
          // Try fallback to direct tsx launch
          if (!quiet) console.log('  [Heal] Wrapper launch incomplete, trying direct spawn...');
          const fallback = spawn('npx', ['tsx', wsAutostart, '--quiet'], {
            cwd: ROOT,
            stdio: 'ignore',
            detached: true,
            windowsHide: true,
            shell: true,
          });
          fallback.unref();
          await new Promise((resolve) => setTimeout(resolve, 10000));

          const fallbackCheck = await testPort(wsPort);
          if (fallbackCheck) {
            addResult(
              'dashboard-ws',
              'autoheal',
              'PASS',
              `Restarted via fallback (port ${wsPort} responding)`,
              'ok',
            );
            healed++;
          } else {
            addResult(
              'dashboard-ws',
              'autoheal',
              'FAIL',
              'Restart failed - port not responding',
              'manual',
              true,
            );
            failed++;
          }
        }
      } catch (e: unknown) {
        addResult(
          'dashboard-ws',
          'autoheal',
          'FAIL',
          `Error: ${e instanceof Error ? e.message : String(e)}`,
          'manual',
          true,
        );
        failed++;
      }
    } else {
      if (!quiet) console.log('    No dashboard-ws-autostart script found');
      addResult('dashboard-ws', 'autoheal', 'FAIL', 'No autostart script found', 'manual', true);
      failed++;
    }
  }

  // CodeGraph server restart
  const cgFail = needsRestart.filter((r) => r.component === 'codegraph');
  if (cgFail.length > 0) {
    if (!quiet) console.log('  [Heal] Restarting CodeGraph serve...');
    try {
      // Delegate to the canonical daemon script (src/codegraph-mcp-server-start.ts).
      // It spawns `node codegraph.js serve --mcp` with an OPEN stdin pipe (keeping
      // the stdio MCP server alive) and writes the real server PID itself.
      //
      // IMPORTANT: spawning `codegraph serve --mcp` directly with stdio:'ignore'
      // would close stdin -> the server exits instantly, and a second instance
      // competing for the codegraph index lock can kill an already-running
      // daemon. Delegating to the daemon script avoids both failure modes.
      const child = spawn('npx.cmd', ['tsx', join(ROOT, 'src', 'codegraph-mcp-server-start.ts')], {
        cwd: ROOT,
        stdio: 'ignore',
        detached: true,
        windowsHide: true,
        shell: true,
      });
      child.unref();
      // Give the daemon time to boot (npx+tsx resolution + server start).
      // The stdio MCP server does NOT open a TCP port, so liveness must be
      // determined by the process table and the PID file written by the
      // daemon script. A single 6s probe is racy (spawn + npx+tsx resolution
      // can exceed it), so poll with retries up to ~20s.
      let up = false;
      for (let attempt = 0; attempt < 5 && !up; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        up = isCodeGraphProcessRunning();
        if (!up) {
          // The daemon script writes the real server PID; trust it as a
          // secondary signal even if the process-table scan is still racing.
          const pidFile = join(RUNTIME_DIR, 'codegraph-mcp-server.pid');
          if (fileExists(pidFile)) {
            try {
              const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
              if (!isNaN(pid)) {
                try {
                  process.kill(pid, 0);
                  up = true;
                } catch {
                  /* PID not alive yet */
                }
              }
            } catch {
              /* unreadable PID file */
            }
          }
        }
      }
      if (up) {
        addResult('codegraph', 'autoheal', 'PASS', `Restarted (PID ${child.pid})`, 'ok');
        healed++;
      } else {
        addResult(
          'codegraph',
          'autoheal',
          'FAIL',
          'Restart failed - no server process detected after 20s',
          'manual',
          true,
        );
        failed++;
      }
    } catch {
      failed++;
    }
  }

  if (!quiet) console.log(`  Healed: ${healed} | Failed: ${failed}`);
}

// ─── Summary ────────────────────────────────────────────────────────────────

function generateReport(outputPath?: string) {
  const pass = results.filter((r) => r.status === 'PASS').length;
  const warn = results.filter((r) => r.status === 'WARN').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const skip = results.filter((r) => r.status === 'SKIP').length;
  const total = results.length;

  const byComponentMap = new Map<
    string,
    { pass: number; warn: number; fail: number; skip: number }
  >();
  for (const r of results) {
    if (!byComponentMap.has(r.component))
      byComponentMap.set(r.component, { pass: 0, warn: 0, fail: 0, skip: 0 });
    const c = byComponentMap.get(r.component) ?? { pass: 0, warn: 0, fail: 0, skip: 0 };
    c[r.status.toLowerCase() as keyof typeof c]++;
  }
  const byComponent = Array.from(byComponentMap.entries()).map(([name, counts]) => ({
    component: name,
    status: counts.fail > 0 ? 'ISSUES' : ('OK' as const),
    fails: counts.fail,
    pass: counts.pass,
    warn: counts.warn,
    skip: counts.skip,
  }));

  const report = {
    watchtowerVersion: '2.0.0',
    timestamp: new Date().toISOString(),
    summary: { pass, warn, fail, skip, total },
    byComponent,
    findings: results,
  };

  console.log(`\n=======================================`);
  console.log(`  PASS: ${pass} | WARN: ${warn} | FAIL: ${fail} | SKIP: ${skip} | Total: ${total}`);

  for (const c of byComponent) {
    const icon = c.status === 'OK' ? '  ' : '  ';
    console.log(`    ${icon}${c.component}: ${c.status}`);
  }

  if (outputPath) {
    writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`  Report: ${outputPath}`);
  }

  console.log(`=======================================`);

  return report;
}

// ─── Main ───────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const flags: Record<string, string | boolean | number> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-Action' || args[i] === '--action') {
      flags.action = (args[++i] || 'health').toLowerCase();
    } else if (args[i] === '-Quiet' || args[i] === '--quiet') {
      flags.quiet = true;
    } else if (args[i] === '-OutputFile' || args[i] === '--output') {
      flags.output = args[++i];
    } else if (args[i] === '-Interval' || args[i] === '--interval') {
      flags.interval = parseInt(args[++i], 10) || 60;
    } else if (args[i] === '-Force' || args[i] === '--force') {
      flags.force = true;
    }
  }

  return {
    action: (flags.action as string) || 'health',
    quiet: !!flags.quiet,
    output: flags.output as string | undefined,
    interval: (flags.interval as number) || 60,
    force: !!flags.force,
  };
}

async function runAllChecks() {
  const checks = [
    checkDashboardWs,
    checkCodeGraph,
    checkTimeoutDaemon,
    checkMlEmbeddings,
    checkEngram,
    checkMcp,
    checkSessionPipeline,
    checkHooks,
    checkConfigs,
    checkToolConfigs,
    checkSecurity,
    checkSecretScanner,
    checkCliGuard,
    checkCloudConnectors,
    checkTracing,
    checkStatePersistence,
    checkAuditPipeline,
    checkGovernance,
    checkGentleVanguardDb,
    checkModelHealth,
    checkWebCrawler,
  ];
  // Parallelized with Promise.allSettled — each check is I/O-bound (file reads, HTTP, DB)
  const results = await Promise.allSettled(
    checks.map(async (check) => {
      try {
        await check();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        addResult('system', check.name, 'FAIL', `Check failed: ${msg}`, 'manual');
      }
    }),
  );
  const rejected = results.filter((r) => r.status === 'rejected');
  if (rejected.length > 0 && !quiet) {
    console.log(`  [WARN] ${rejected.length} check(s) threw unhandled rejection`);
  }
}

// ─── Witr Trace Integration ──────────────────────────────────────────────────

/** Well-known ports per component, used when a component reports FAIL/WARN. */
const COMPONENT_PORTS: Record<string, number[]> = {
  'dashboard-ws': [8080],
  codegraph: [3000],
};

/**
 * After all checks run, use witr to trace the causal chain of any FAIL/WARN
 * finding back to its root process. Best-effort: witr is auto-installed on
 * first use; if it is unavailable the run degrades gracefully.
 */
async function traceFindings() {
  if (quiet) return;
  const findings = results.filter((r) => r.status === 'FAIL' || r.status === 'WARN');
  if (findings.length === 0) return;

  if (!ensureWitrInstalled()) {
    console.log(
      '  [witr] not available — run scripts/utilities/maintenance/witr-installer.ps1 to enable tracing',
    );
    return;
  }

  const ports = new Set<number>();
  for (const f of findings) {
    // Ports named explicitly in the check/detail text (e.g. "HTTP API (port 8080)")
    const text = `${f.component} ${f.check} ${f.detail}`;
    const matches = text.matchAll(/port\s+(\d+)/g);
    for (const m of matches) {
      const p = parseInt(m[1], 10);
      if (p > 0 && p <= 65535) ports.add(p);
    }
    // Well-known component ports
    for (const p of COMPONENT_PORTS[f.component] ?? []) ports.add(p);
  }

  if (ports.size === 0) return;
  console.log('\n  [witr] tracing causal chain for failing components...');
  for (const port of ports) {
    try {
      const chain = await witr.tracePort(port);
      const names = chain.causalChain
        .map((link) => `${link.name} (pid ${link.pid})`)
        .join(' \u2192 ');
      console.log(`  [witr] port ${port} \u2192 ${names}`);
    } catch (e) {
      if (!quiet) {
        console.log(
          `  [witr] trace port ${port} failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }
}

async function main() {
  const opts = parseArgs();
  quiet = opts.quiet;

  console.log(`===============================================`);
  console.log(` [MW] Maintenance Watchtower (v2.0.0)`);
  console.log(`    Action: ${opts.action} | Force: ${opts.force} | Interval: ${opts.interval}s`);
  console.log(`===============================================`);

  switch (opts.action) {
    case 'health':
      await runAllChecks();
      await traceFindings();
      generateReport(opts.output);
      break;

    case 'rebuild':
      await runAllChecks();
      await traceFindings();
      if (!quiet) console.log('\n  -- Auto-Rebuild Phase --');
      {
        const needsRebuild = results.filter(
          (r) => ['rebuild', 'reindex'].includes(r.action) && r.status !== 'PASS',
        );
        if (needsRebuild.length === 0 && !opts.force) {
          if (!quiet) console.log('  Everything fresh');
        } else {
          if (opts.force && !quiet) console.log('  Force rebuild');
          else if (!quiet) console.log(`  ${needsRebuild.length} component(s) need rebuild`);
          if (
            opts.force ||
            results.some(
              (r) =>
                r.component === 'ml-embeddings' && r.action === 'rebuild' && r.status !== 'PASS',
            )
          ) {
            await rebuildMlEmbeddings();
          }
          if (
            opts.force ||
            results.some(
              (r) => r.component === 'engram' && r.action === 'reindex' && r.status !== 'PASS',
            )
          ) {
            await reindexEngramRag();
          }
        }
      }
      generateReport(opts.output);
      break;

    case 'autoheal':
      await runAllChecks();
      await traceFindings();
      await autoHeal();
      generateReport(opts.output);
      break;

    case 'all':
      await runAllChecks();
      await traceFindings();
      await autoHeal();
      if (!quiet) console.log('\n  -- Rebuild Phase --');
      if (
        opts.force ||
        results.some(
          (r) => r.component === 'ml-embeddings' && r.action === 'rebuild' && r.status !== 'PASS',
        )
      ) {
        await rebuildMlEmbeddings();
      }
      if (
        opts.force ||
        results.some(
          (r) => r.component === 'engram' && r.action === 'reindex' && r.status !== 'PASS',
        )
      ) {
        await reindexEngramRag();
      }
      generateReport(opts.output);
      break;

    case 'continuous': {
      if (!quiet) console.log(`Continuous mode: Interval=${opts.interval}s (Ctrl+C to stop)`);
      let cycle = 0;
      const loop = async () => {
        cycle++;
        if (!quiet) console.log(`\n=== Cycle ${cycle} (${new Date().toLocaleTimeString()}) ===`);
        results.length = 0;
        await runAllChecks();
        await traceFindings();
        await autoHeal();
        generateReport();
        if (!quiet) console.log(`  Next cycle in ${opts.interval}s...`);
        setTimeout(loop, opts.interval * 1000);
      };
      void loop().catch((err) => {
        console.error('Watchtower continuous loop error:', err);
        process.exit(1);
      });
      break;
    }

    case 'report':
      await runAllChecks();
      await traceFindings();
      generateReport(opts.output);
      break;

    default:
      console.error(`Unknown action: ${opts.action}`);
      process.exit(1);
  }

  if (opts.action !== 'continuous') {
    console.log(`===============================================`);
  }

  if (exitCode > 0) process.exit(Math.min(exitCode, 255));
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
