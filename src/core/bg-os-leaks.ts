// OS-level background-leak detection — fuente compartida (fix ráfaga 2026-10-02).
//
// El matcher original contaba CUALQUIER node/tsx con uptime > 60s como "leak",
// incluyendo los daemons legítimos del propio stack (stack-mcp-server,
// command-center, web-dashboard, timeout-monitor, token-ingest...). Resultado:
// el watchtower gritaba FAIL con falsos positivos → ráfaga de falsas "ventanas
// fantasma" y alarma-fatiga (el FAIL real se perdía entre el ruido).
//
// Ahora un proceso es leak SOLO si:
//   a) no figura como pid dueño de ningún .runtime/*.pid (daemon gestionado), y
//   b) su commandline no matchea los patrones de servicios gestionados.
//
// Consumidores: src/core/watchtower/checks-bg-tasks.ts (check) +
// scripts/utilities/background-tasks.ts (helper --list/--drain-hint/--reap-os).

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..', '..');
const RUNTIME_DIR = join(ROOT, '.runtime');

export interface OsCandidate {
  pid: number;
  ppid: number;
  cmd: string;
  ageSec: number;
}

// Servicios gestionados del stack (patrones sobre CommandLine). Espejo de
// DAEMON_CLASSES (src/core/process-hygiene.ts) + infra compartida multi-sesión.
const MANAGED_PATTERNS: RegExp[] = [
  /stack-mcp-server\.ts/, // MCP server del stack (sirve tools a ZCode/hosts)
  /timeout-monitor\.ts.*--daemon/,
  /token-ingest\.ts/,
  /apps-keepalive\.ts/,
  /session-autostart/,
  /session-close/,
  /maintenance-watchtower\.ts/,
  /command-center[\\/]server\.ts/,
  /web-dashboard[\\/](server|src[\\/]server)/,
  /dashboard-ws-autostart\.ts/,
  /sandbox-gv[\\/](server|src[\\/]server|start\.ts)/,
  /apps[\\/]academy(-|web|crm|landing|portal)?[\\/].*(server|http)/,
  /design-hub[\\/].*(server|start)/,
  /gv-analytics[\\/].*server/,
  /content-cms[\\/].*server/,
  /graphify.*--watch/,
  /codegraph-sync/,
  /@modelcontextprotocol/,
  /chrome-devtools/,
  /codegraph[\\/]/,
  /engram/,
];

function collectManagedPids(): Set<number> {
  const pids = new Set<number>();
  try {
    for (const f of readdirSync(RUNTIME_DIR)) {
      if (!f.endsWith('.pid')) continue;
      try {
        const raw = readFileSync(join(RUNTIME_DIR, f), 'utf8').trim();
        const pid = parseInt(raw.split(/\s+/)[0] ?? '', 10);
        if (Number.isFinite(pid) && pid > 0) pids.add(pid);
      } catch {
        /* pidfile ilegible: ignorar */
      }
    }
  } catch {
    /* .runtime ausente: no hay daemons gestionados registrados */
  }
  return pids;
}

export function isManagedDaemon(cmd: string, pid: number, managedPids?: Set<number>): boolean {
  const pids = managedPids ?? collectManagedPids();
  if (pids.has(pid)) return true;
  return MANAGED_PATTERNS.some((re) => re.test(cmd));
}

/** node/tsx con uptime > 60s que NO son daemons gestionados = fugas reales. */
export function listOsLeakCandidates(): OsCandidate[] {
  const ps = [
    'Get-CimInstance Win32_Process -Filter "Name like \'node%\'"',
    "  | Where-Object { $_.CreationDate -lt (Get-Date).AddSeconds(-60) }",
    '  | ForEach-Object {',
    '      $age = ((Get-Date) - $_.CreationDate).TotalSeconds;',
    '      [PSCustomObject]@{',
    '        pid = $_.ProcessId;',
    '        ppid = $_.ParentProcessId;',
    '        cmd = ($_.CommandLine -replace "`r`n"," ").Substring(0, [Math]::Min(240, $_.CommandLine.Length));',
    "        ageSec = [int]$age;",
    "        tsx = ($_.CommandLine -match 'tsx')",
    '      }',
    '    }',
    '  | ConvertTo-Json -Depth 3 -Compress',
  ].join(' ');
  const result = spawnSync('powershell', ['-NoProfile', '-Command', ps], {
    encoding: 'utf-8',
    timeout: 20_000,
  });
  if (result.status !== 0 || !result.stdout) return [];
  let all: Array<{ pid: number; ppid: number; cmd: string; ageSec: number }> = [];
  try {
    const parsed = JSON.parse(result.stdout);
    all = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
  const byPid = new Map<number, { ppid: number; cmd: string }>();
  const children = new Map<number, number[]>();
  for (const p of all) {
    if (!p || !Number.isFinite(p.pid)) continue;
    byPid.set(p.pid, { ppid: p.ppid, cmd: p.cmd ?? '' });
    const list = children.get(p.ppid) ?? [];
    list.push(p.pid);
    children.set(p.ppid, list);
  }

  const managedPids = collectManagedPids();
  const isManaged = (pid: number): boolean => {
    const info = byPid.get(pid);
    if (isManagedDaemon(info?.cmd ?? '', pid, managedPids)) return true;
    // subir la cadena de ancestros (máx 8 saltos): un hijo de un daemon
    // gestionado (loader/preflight de tsx, workers) NO es una fuga.
    let cur = info?.ppid;
    for (let hops = 0; cur && hops < 8; hops++) {
      if (managedPids.has(cur)) return true;
      const parent = byPid.get(cur);
      if (!parent) break;
      if (MANAGED_PATTERNS.some((re) => re.test(parent.cmd))) return true;
      cur = parent.ppid;
    }
    // walk-down 1 nivel: un launcher (npx/npm wrapper) cuyo hijo directo es un
    // servicio gestionado es infra del host, no una fuga.
    for (const childPid of children.get(pid) ?? []) {
      const child = byPid.get(childPid);
      if (child && MANAGED_PATTERNS.some((re) => re.test(child.cmd))) return true;
    }
    return false;
  };

  return all
    .filter((p) => p && Number.isFinite(p.pid) && p.ageSec > 60)
    .filter((p) => !isManaged(p.pid))
    .map((p) => ({ pid: p.pid, ppid: p.ppid, cmd: p.cmd ?? '', ageSec: p.ageSec }));
}
