// Dashboard WS + GV Analytics checks (F2.5 split).
// Extracted verbatim from src/core/maintenance-watchtower.ts — no logic changes.

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { addResult, quiet, ROOT, RUNTIME_DIR } from './context';
import { fileExists, readJson, testHttp, testPort, getPidByPort } from './helpers';
const logger = log('CORE-WATCHTOWER-CHECKS-DASHBOARD');
import { log } from '../../utils/logger.js';

// ─── Component: Dashboard WS ────────────────────────────────────────────────

export async function checkDashboardWs() {
  if (!quiet) logger.info('  [Dashboard WS] Checking...');

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
    httpOk = await testHttp(`http://127.0.0.1:${port}/api/health`);
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

// ─── Component: GV Analytics ─────────────────────────────────────────────────

export async function checkGvAnalytics() {
  if (!quiet) logger.info('  [GV Analytics] Checking...');

  const apiPort = Number(process.env.GV_ANALYTICS_PORT || 4754);
  const apiPidFile = join(RUNTIME_DIR, 'gv-analytics-api.pid');
  const vitePidFile = join(RUNTIME_DIR, 'gv-analytics-vite.pid');
  const appDir = join(ROOT, 'apps/gv-analytics');

  // 1. Build artifact present?
  addResult(
    'gv-analytics',
    'build (dist/index.html)',
    fileExists(join(appDir, 'dist/index.html')) ? 'PASS' : 'WARN',
    fileExists(join(appDir, 'dist/index.html'))
      ? ''
      : 'Run: pnpm --filter @gentle-vanguard/gv-analytics build',
    'ok',
  );

  // 2. API HTTP health (best-effort, 4 checks: status, connection, reports, mcp config)
  const apiOk = await testHttp(`http://127.0.0.1:${apiPort}/api/connection/status`);
  addResult(
    'gv-analytics',
    `API HTTP (port ${apiPort})`,
    apiOk ? 'PASS' : 'WARN',
    apiOk ? 'Responding' : 'Not running — start with: npm run analytics:start',
    apiOk ? 'ok' : 'start',
  );

  // 3. API process via pidfile
  if (fileExists(apiPidFile)) {
    const pid = readFileSync(apiPidFile, 'utf-8').trim();
    try {
      process.kill(parseInt(pid, 10), 0);
      addResult('gv-analytics', 'API process', 'PASS', `PID ${pid} running`, 'ok');
    } catch {
      addResult('gv-analytics', 'API process', 'WARN', `PID ${pid} stale`, 'verify');
    }
  } else if (apiOk) {
    addResult('gv-analytics', 'API process', 'PASS', 'Running (no pidfile)', 'ok');
  } else {
    addResult('gv-analytics', 'API process', 'WARN', 'No pidfile, API not responding', 'start');
  }

  // 4. Vite dev server (optional, dev mode)
  if (fileExists(vitePidFile)) {
    const pid = readFileSync(vitePidFile, 'utf-8').trim();
    try {
      process.kill(parseInt(pid, 10), 0);
      addResult('gv-analytics', 'Vite dev server', 'PASS', `PID ${pid} running`, 'ok');
    } catch {
      addResult('gv-analytics', 'Vite dev server', 'WARN', `PID ${pid} stale`, 'verify');
    }
  } else {
    addResult(
      'gv-analytics',
      'Vite dev server',
      'PASS',
      'Not in dev mode (use built artifacts)',
      'ok',
    );
  }

  // 5. MCP server registered
  const mcpRegistry = join(ROOT, 'config/mcp-registry.json');
  if (fileExists(mcpRegistry)) {
    try {
      const reg = JSON.parse(readFileSync(mcpRegistry, 'utf-8'));
      const found = (reg.servers || []).some(
        (s: { name?: string }) => s.name === 'gv-analytics-atlassian',
      );
      addResult(
        'gv-analytics',
        'MCP registration (mcp-registry.json)',
        found ? 'PASS' : 'FAIL',
        found ? 'gv-analytics-atlassian registered' : 'Missing gv-analytics-atlassian entry',
        found ? 'ok' : 'verify',
      );
    } catch {
      addResult(
        'gv-analytics',
        'MCP registration (mcp-registry.json)',
        'FAIL',
        'Invalid JSON',
        'verify',
      );
    }
  } else {
    addResult(
      'gv-analytics',
      'MCP registration (mcp-registry.json)',
      'WARN',
      'Registry not found',
      'verify',
    );
  }

  // 6. OpenCode config integration
  const opencodeCfg = join(ROOT, 'opencode.json');
  if (fileExists(opencodeCfg)) {
    try {
      const cfg = JSON.parse(readFileSync(opencodeCfg, 'utf-8'));
      const found = Boolean(cfg?.mcp?.['gv-analytics-atlassian']);
      addResult(
        'gv-analytics',
        'OpenCode MCP wire (opencode.json)',
        found ? 'PASS' : 'WARN',
        found
          ? 'gv-analytics-atlassian enabled'
          : 'Add gv-analytics-atlassian to opencode.json#mcp',
        found ? 'ok' : 'verify',
      );
    } catch {
      addResult(
        'gv-analytics',
        'OpenCode MCP wire (opencode.json)',
        'FAIL',
        'Invalid JSON',
        'verify',
      );
    }
  }
}
