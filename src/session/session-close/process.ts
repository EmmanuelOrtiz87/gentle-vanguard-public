import { runSync } from '../../core/run-command.js';

export interface KillTarget {
  name: string;
  matcher: string;
  /** Required daemons are started by session-autostart and MUST be running at close. */
  required: boolean;
}

/**
 * Stack process inventory (verified 2026-09-16 against 7 live node PIDs):
 * - PID 3484  → src/ops/dashboard-ws-autostart.ts  (Dashboard WS watchdog)
 * - PID 4824  → src/integrations/codegraph-mcp-server-start.ts
 * - PID 12236 → apps/web-dashboard/server/websocket-server.ts
 * - PID 15308 → @colbymchenry/codegraph dist/bin/codegraph.js serve --mcp
 * - PID 18400 → AmazonQ LSP (NOT in scope — editor-owned, never kill)
 * - PID 21172 → scripts/mcp/skill-server.ts
 * - PID 21964 → apps/command-center/server.ts (manual start)
 *
 * Conservative scope: only node/tsx processes whose CommandLine references
 * the gentle-vanguard workspace. NEVER touches VS Code, MiniMax Code,
 * WhatsApp, AmazonQ LSP, Chrome (the user closes it themselves).
 */
export const KILL_TARGETS: KillTarget[] = [
  // ─── Original daemons (unchanged) ────────────────────────────────────
  { name: 'CodeGraph MCP', matcher: 'codegraph.*mcp', required: true },
  // Dashboard WS persists between sessions; the standalone Command Center
  // (apps/command-center) owns app lifecycle — see DAEMON_CLASSES.
  { name: 'Timeout Daemon', matcher: 'timeout-monitor.*daemon', required: true },
  // Optional daemon: the token-ingest --watch loop survives the close today and
  // keeps appending to .runtime/token-ingest.log. Not required → SKIP if it was
  // never started; never FAILs (avoids false positives in the close report).
  { name: 'Token Ingest', matcher: 'token-ingest', required: false },

  // ─── Stack daemons added 2026-09-16 (Fase 2 — ventanas fantasma) ─────
  // Command Center (the user can start/stop it via gv.ts cc). Optional so a
  // never-started CC doesn't fail the close report.
  {
    name: 'Command Center',
    matcher: 'gentle-vanguard.apps.command-center.server',
    required: false,
  },
  // Dashboard Vite + WebSocket server. Optional.
  {
    name: 'Dashboard WS Server',
    matcher: 'gentle-vanguard.apps.web-dashboard.server.websocket-server',
    required: false,
  },
  // Dashboard WS watchdog (detached, --watch mode). Optional.
  {
    name: 'Dashboard WS Watchdog',
    matcher: 'gentle-vanguard.src.ops.dashboard-ws-autostart',
    required: false,
  },
  // Vite HMR watchdog (separate from WS). Optional.
  {
    name: 'Dashboard Vite Watchdog',
    matcher: 'gentle-vanguard.src.ops.dashboard-vite-watchdog',
    required: false,
  },
  // CodeGraph MCP server (detached wrapper that boots the colbymchenry bin).
  {
    name: 'CodeGraph MCP Server',
    matcher: 'gentle-vanguard.src.integrations.codegraph-mcp-server-start',
    required: false,
  },
  // CodeGraph workspace sync autostart.
  {
    name: 'CodeGraph Sync Autostart',
    matcher: 'gentle-vanguard.src.integrations.codegraph-sync-autostart',
    required: false,
  },
  // Skill Server (MCP, scripts/mcp/skill-server.ts).
  {
    name: 'Skill Server',
    matcher: 'gentle-vanguard.scripts.mcp.skill-server',
    required: false,
  },
  // Watchtower autoheal autostart.
  {
    name: 'Watchtower Autoheal',
    matcher: 'gentle-vanguard.src.ops.watchtower-autoheal',
    required: false,
  },
  // Apps Keepalive (cron-like task that can revive apps via CC every 15 min).
  // Killing it prevents it from spawning fresh nodes mid-close.
  {
    name: 'Apps Keepalive',
    matcher: 'gentle-vanguard.src.ops.apps-keepalive',
    required: false,
  },
  // ─── Generic app daemons (apps/<name>/server/* and Vite HMR) ────────
  // Each app in apps/ (academy-crm, academy-web, archify, command-center,
  // content-cms, design-hub, gv-music, gv-analytics, prompt-studio, web-dashboard)
  // spawns at least 2 processes: the server (tsx server/index.ts or
  // server.ts) and a Vite dev server (apps/<name>/node_modules/vite/bin/vite.js).
  // apps-keepalive can revive any of them, so we kill by generic path patterns.
  // NOTE: these matchers run as .NET regex (PowerShell -match) — a literal
  // backslash needs \\ in the regex, i.e. \\\\ in this TS string. The previous
  // single-\\ escaping made \a a bell character and silently never matched.
  {
    name: 'Apps Server',
    matcher: 'gentle-vanguard[\\\\/]apps[\\\\/][^\\\\/]+[\\\\/]server[\\\\/]',
    required: false,
  },
  {
    name: 'Apps Vite HMR',
    matcher: 'gentle-vanguard[\\\\/]apps[\\\\/][^\\\\/]+[\\\\/]node_modules[\\\\/]vite[\\\\/]bin[\\\\/]vite',
    required: false,
  },
  // ─── Sandbox de demos (apps/sandbox-gv) — added 2026-09-25 ────────────
  // GUI de demos (:4000, apps/sandbox-gv/src/server.ts via tsx) y el bot de
  // cliente arrancado por el sandbox (:3000, apps/wpp-bot/dist/index.js via
  // npm). El matcher genérico 'Apps Server' no los cubre (busca apps\<x>\server\;
  // el bot corre desde dist\ y la GUI desde src\server.ts) — sin esto quedaban
  // vivos tras el cierre de sesión.
  {
    name: 'Sandbox GUI',
    matcher: 'gentle-vanguard[\\\\/]apps[\\\\/]sandbox-gv[\\\\/](src|dist)[\\\\/]server\\.(ts|js)',
    required: false,
  },
  {
    name: 'Sandbox wpp-bot',
    matcher: 'gentle-vanguard[\\\\/]apps[\\\\/]wpp-bot[\\\\/](dist[\\\\/]index\\.js|src[\\\\/]index\\.ts)',
    required: false,
  },
];

/** True if at least one process (node/tsx) matches the command-line matcher. */
export function isProcessRunning(matcher: string): boolean {
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
export function isStartupClose(reason: string): boolean {
  return reason === 'autostart-close' || reason === 'startup-cleanup';
}

export function waitForProcess(matcher: string, timeoutMs: number): boolean {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isProcessRunning(matcher)) return true;
    // Synchronous ~500ms sleep (Atomics.wait on a shared buffer).
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  return isProcessRunning(matcher);
}

export function killProcessByCommandLine(matcher: string): boolean {
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
