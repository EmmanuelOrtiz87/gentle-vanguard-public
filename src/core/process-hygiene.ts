#!/usr/bin/env node
/**
 * Process Hygiene — native orphan/zombie reaper for Gentle-Vanguard
 *
 * WHY THIS EXISTS: detached daemons intentionally survive their parents
 * (spawn detached + unref), so "parent dead" alone can NOT identify garbage.
 * Real garbage comes in four shapes:
 *
 *   1. DUPLICATE daemons  — two websocket-server under one watchdog, two
 *      vite instances, etc. Only the PID-file owner / port owner is legit.
 *   2. HUNG ONE-SHOTS     — repo scripts like `--action status` that never
 *      returned (parent dead + age > minAge).
 *   3. AGED daemons       — daemons adopted across sessions for days (e.g.
 *      a 3-day-old token-ingest --watch). Recycled only when the autostart
 *      pipeline will respawn them (respawn: 'autostart' | 'watchdog').
 *   4. STALE PID FILES    — .runtime/*.pid pointing at dead or PID-reused
 *      processes, plus leftover headless Chrome from screenshot exports.
 *
 * The module is pure-analyze / impure-act split: `analyzeProcesses()` is a
 * pure function over a process snapshot (unit-testable without PowerShell),
 * `scanProcesses()` builds the snapshot, `runHygiene()` acts on findings.
 *
 * CLI:
 *   node --import tsx src/core/process-hygiene.ts            # dry-run report
 *   node --import tsx src/core/process-hygiene.ts --apply    # reap
 *   npm run process:reap                                      # --apply alias
 *
 * Wired into: session-autostart (phase 1, before lazy daemons spawn),
 * maintenance-watchtower (check + autoheal) and session-close-orchestrator.
 */

import { fileURLToPath, pathToFileURL } from 'url';
import { basename, resolve, join } from 'path';
import { existsSync, readFileSync, writeFileSync, appendFileSync, unlinkSync, mkdirSync } from 'fs';
import { runSync } from './run-command.js';
import { getProcessIdByPort } from '../ops/dashboard-common.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProcessInfo {
  pid: number;
  ppid: number;
  name: string;
  /** ISO creation timestamp */
  created: string;
  cmdline: string;
}

export interface ProcessSnapshot {
  /** node/chrome processes whose command line references the repo */
  repoProcesses: ProcessInfo[];
  /** set of ALL live pids on the system (for parent-liveness checks) */
  livePids: Set<number>;
  /** PID -> resolved TCP listener (ports we care about) */
  portOwners: Map<number, number>;
  /** pidFile path -> file content (raw pid string) */
  pidFiles: Map<string, string>;
}

export type FindingAction = 'kill' | 'clean-pidfile' | 'recycle' | 'report';

export interface HygieneFinding {
  pid: number;
  name: string;
  kind:
    | 'duplicate-daemon'
    | 'hung-oneshot'
    | 'aged-daemon'
    | 'stale-pidfile'
    | 'headless-chrome'
    | 'unknown-repo-process';
  action: FindingAction;
  reason: string;
  ageHours: number;
  classId?: string;
  cmdline: string;
}

export interface HygieneOptions {
  /** actually kill/clean (default: dry-run report only) */
  apply: boolean;
  /** one-shots younger than this are spared (minutes) */
  minAgeMin: number;
  /** daemons older than this are recycled when respawnable (hours) */
  maxAgeHours: number;
  /** leftover headless chrome older than this is killed (minutes) */
  chromeMinAgeMin: number;
  /** enable aged-daemon recycling (session-start context) */
  recycleAged: boolean;
}

export interface HygieneResult {
  timestamp: string;
  mode: 'dry-run' | 'apply';
  scanned: number;
  findings: HygieneFinding[];
  killed: number[];
  cleanedFiles: string[];
  keptHealthy: { classId: string; pid: number; ageHours: number }[];
  /** core.bare corrupto reparado por el guard (BL-MW2IBHXM-777H) */
  gitConfigGuard?: boolean;
}

export const DEFAULT_OPTIONS: HygieneOptions = {
  apply: false,
  minAgeMin: 15,
  maxAgeHours: 24,
  chromeMinAgeMin: 30,
  recycleAged: true,
};

// ─── Daemon class registry ────────────────────────────────────────────────────

interface DaemonClass {
  id: string;
  label: string;
  match: RegExp;
  /**
   * Ambiguous cmdline shape (start.sh spawns with RELATIVE script paths and
   * cwd=app dir, so `server/server.ts` / `vite.js` look identical across
   * apps). A relativeMatch only claims the class when the process PID is the
   * content of the class pidFile — the pidfile decides which app it is.
   */
  relativeMatch?: RegExp;
  pidFile?: string;
  /**
   * Directorio `apps/<app>` que la clase cubre. Lo usa la clasificacion
   * GENERICA de servidores de app para no reclamar apps que ya tienen clase
   * estatica (el pidfile de esa app sigue siendo el que decide).
   */
  app?: string;
  /** which dashboard port marks the legit instance */
  port?: 'wsPort' | 'vitePort';
  /** how the keeper instance is chosen */
  keep: 'pidfile' | 'port' | 'newest';
  /** retain one instance per live parent for client-owned stdio servers */
  allowParallelParents?: boolean;
  /** what respawns this class if killed */
  respawn: 'autostart' | 'watchdog' | 'client' | 'manual';
  /** aged instances may be recycled (only when respawn is safe) */
  recycleAged: boolean;
}

const RUNTIME_DIR = resolve(fileURLToPath(new URL('../../.runtime', import.meta.url)));

/**
 * Ordered: first match wins — watchdogs MUST be tested before the servers
 * they supervise (a watchdog cmdline contains its server's script name).
 */
const DAEMON_CLASSES: DaemonClass[] = [
  {
    id: 'token-ingest-daemon',
    label: 'Token ingest daemon',
    match: /token-ingest\.ts.*--watch/,
    pidFile: join(RUNTIME_DIR, 'token-ingest.pid'),
    keep: 'newest',
    respawn: 'autostart',
    recycleAged: true,
  },
  {
    id: 'metrics-writer-daemon',
    label: 'Metrics Writer daemon',
    match: /metrics-writer-daemon\.ts.*--watch/,
    pidFile: join(RUNTIME_DIR, 'metrics-writer.pid'),
    keep: 'newest',
    respawn: 'autostart',
    recycleAged: true,
  },
  {
    id: 'spike-guard-daemon',
    label: 'Token Spike Guard daemon',
    match: /token-spike-guard-daemon\.ts/,
    pidFile: join(RUNTIME_DIR, 'spike-guard.pid'),
    keep: 'newest',
    respawn: 'autostart',
    recycleAged: true,
  },
  {
    id: 'command-center',
    label: 'Command Center daemon',
    match: /command-center[\\/]server\.ts/,
    pidFile: join(RUNTIME_DIR, 'command-center.pid'),
    keep: 'pidfile',
    respawn: 'autostart',
    recycleAged: true,
  },
  {
    id: 'ws-watchdog',
    label: 'Dashboard WS watchdog',
    match: /dashboard-ws-autostart\.ts/,
    pidFile: join(RUNTIME_DIR, 'dashboard-ws-watchdog.pid'),
    keep: 'pidfile',
    respawn: 'autostart',
    recycleAged: false,
  },
  {
    id: 'vite-watchdog',
    label: 'Dashboard Vite watchdog',
    match: /dashboard-vite-watchdog\.ts/,
    pidFile: join(RUNTIME_DIR, 'dashboard-vite-watchdog.pid'),
    keep: 'pidfile',
    respawn: 'autostart',
    recycleAged: true,
  },
  {
    id: 'websocket-server',
    label: 'Dashboard WS server',
    match: /websocket-server\.ts/,
    port: 'wsPort',
    pidFile: join(RUNTIME_DIR, 'dashboard-ws.pid'),
    keep: 'port',
    respawn: 'watchdog',
    recycleAged: false,
  },
  {
    id: 'timeout-monitor-daemon',
    label: 'Timeout monitor daemon',
    match: /timeout-monitor\.ts.*--daemon/,
    pidFile: join(RUNTIME_DIR, 'monitor-daemon.pid'),
    keep: 'pidfile',
    respawn: 'autostart',
    recycleAged: true,
  },
  {
    id: 'key-registry',
    label: 'Key Registry (loopback :3045)',
    // El launcher (key-registry-autostart.ts) es transitorio: solo el server
    // queda vivo (detached). El PID file decide cuál es el dueño legítimo.
    match: /key-registry-server\.ts/,
    pidFile: join(RUNTIME_DIR, 'key-registry.pid'),
    keep: 'pidfile',
    respawn: 'autostart',
    recycleAged: false,
  },
  {
    id: 'codegraph-mcp',
    label: 'CodeGraph MCP server',
    match: /codegraph-mcp-server-start\.ts/,
    pidFile: join(RUNTIME_DIR, 'codegraph-mcp-server.pid'),
    keep: 'newest',
    respawn: 'client',
    recycleAged: false,
  },
  {
    id: 'codegraph-serve',
    label: 'CodeGraph serve child',
    match: /@colbymchenry\+?codegraph[^\s"']*[\\/]dist[\\/]bin[\\/]codegraph\.js/,
    keep: 'newest',
    respawn: 'client',
    recycleAged: false,
  },
  {
    id: 'skill-server',
    label: 'Dashboard skills server',
    match: /skill-server/,
    keep: 'newest',
    allowParallelParents: true,
    respawn: 'watchdog',
    recycleAged: false,
  },
  {
    id: 'stack-mcp-server',
    label: 'Stack MCP server',
    // Older sessions may still expose an npx/tsx parent chain. Classify the
    // chain as one managed service so hygiene does not mislabel it as an
    // unknown leak while the launcher migration is completed.
    match: /stack-mcp-server\.ts/,
    keep: 'newest',
    respawn: 'client',
    recycleAged: false,
  },
  {
    id: 'gv-analytics-api',
    label: 'Gentle-Vanguard Analytics API',
    match: /apps[\\/]gv-analytics[\\/]server[\\/]index\.ts/,
    relativeMatch: /server[\\/]index\.ts/,
    app: 'gv-analytics',
    pidFile: join(RUNTIME_DIR, 'app-analytics-api.pid'),
    keep: 'pidfile',
    respawn: 'manual',
    recycleAged: false,
  },
  {
    id: 'gv-analytics-vite',
    label: 'Gentle-Vanguard Analytics Vite dev server',
    // Tolerates the npm bin shim path (`node_modules\.bin\..\vite\bin\vite.js`)
    // used when the dev server is started via npm script instead of the CC.
    match:
      /apps[\\/]gv-analytics[\\/](node_modules[\\/]\.bin[\\/]\.\.[\\/])?node_modules[\\/]vite[\\/]bin[\\/]vite\.js/,
    relativeMatch: /vite[\\/]bin[\\/]vite\.js/,
    app: 'gv-analytics',
    pidFile: join(RUNTIME_DIR, 'app-analytics-vite.pid'),
    keep: 'pidfile',
    respawn: 'manual',
    recycleAged: false,
  },
  {
    id: 'gv-analytics-mcp',
    label: 'Gentle-Vanguard Analytics Atlassian MCP',
    match: /apps[\\/]gv-analytics[\\/]server[\\/]mcp\.ts/,
    app: 'gv-analytics',
    keep: 'newest',
    respawn: 'client',
    recycleAged: false,
  },
  {
    id: 'cms-api',
    label: 'Content Studio API server',
    match: /apps[\\/]content-cms[\\/]server[\\/]server\.ts/,
    relativeMatch: /server[\\/]server\.ts/,
    app: 'content-cms',
    pidFile: join(RUNTIME_DIR, 'app-cms-api.pid'),
    keep: 'pidfile',
    respawn: 'client',
    recycleAged: false,
  },
  {
    id: 'cms-vite',
    label: 'Content Studio Vite dev server',
    // Tolerates the npm bin shim path (`node_modules\.bin\..\vite\bin\vite.js`)
    // used when the dev server is started via npm script instead of the CC.
    match:
      /apps[\\/]content-cms[\\/](node_modules[\\/]\.bin[\\/]\.\.[\\/])?node_modules[\\/]vite[\\/]bin[\\/]vite\.js/,
    relativeMatch: /vite[\\/]bin[\\/]vite\.js/,
    app: 'content-cms',
    pidFile: join(RUNTIME_DIR, 'app-cms-vite.pid'),
    keep: 'pidfile',
    respawn: 'client',
    recycleAged: false,
  },
  {
    id: 'prompts-api',
    label: 'Prompt Studio API server',
    match: /apps[\\/]prompt-studio[\\/]server[\\/]server\.ts/,
    relativeMatch: /server[\\/]server\.ts/,
    app: 'prompt-studio',
    pidFile: join(RUNTIME_DIR, 'app-prompts-api.pid'),
    keep: 'pidfile',
    respawn: 'client',
    recycleAged: false,
  },
  {
    id: 'prompts-vite',
    label: 'Prompt Studio Vite dev server',
    match:
      /apps[\\/]prompt-studio[\\/](node_modules[\\/]\.bin[\\/]\.\.[\\/])?node_modules[\\/]vite[\\/]bin[\\/]vite\.js/,
    relativeMatch: /vite[\\/]bin[\\/]vite\.js/,
    app: 'prompt-studio',
    pidFile: join(RUNTIME_DIR, 'app-prompts-vite.pid'),
    keep: 'pidfile',
    respawn: 'client',
    recycleAged: false,
  },
  {
    id: 'archify-api',
    label: 'Archify API server',
    match: /apps[\\/]archify[\\/]server[\\/]server\.ts/,
    relativeMatch: /server[\\/]server\.ts/,
    app: 'archify',
    pidFile: join(RUNTIME_DIR, 'app-archify-api.pid'),
    keep: 'pidfile',
    respawn: 'client',
    recycleAged: false,
  },
  {
    id: 'archify-vite',
    label: 'Archify Vite dev server',
    match:
      /apps[\\/]archify[\\/](node_modules[\\/]\.bin[\\/]\.\.[\\/])?node_modules[\\/]vite[\\/]bin[\\/]vite\.js/,
    relativeMatch: /vite[\\/]bin[\\/]vite\.js/,
    app: 'archify',
    pidFile: join(RUNTIME_DIR, 'app-archify-vite.pid'),
    keep: 'pidfile',
    respawn: 'client',
    recycleAged: false,
  },
  {
    id: 'app-academy-http',
    label: 'Academy static server (node serve-static :4173)',
    // Port is part of the cmdline in every spawn shape, so the port
    // disambiguates. Node shape: `node ...\tools\serve-static.mjs 4173 <root>`
    // (start.sh + CC desde 2026-10). La forma legacy python se mantiene para
    // clasificar procesos previos a la migración.
    match: /(?:serve-static\.mjs|http\.server)[ ]+4173\b/,
    pidFile: join(RUNTIME_DIR, 'app-academy-http.pid'),
    keep: 'pidfile',
    respawn: 'manual',
    recycleAged: false,
  },
  {
    id: 'app-design-hub-http',
    label: 'Design Hub static server (node serve-static :8095)',
    match: /(?:serve-static\.mjs|http\.server)[ ]+8095\b/,
    pidFile: join(RUNTIME_DIR, 'app-design-hub-http.pid'),
    keep: 'pidfile',
    respawn: 'manual',
    recycleAged: false,
  },
  {
    id: 'app-academy-crm-server',
    label: 'CRM Studio — API + UI estática (:4792)',
    match: /apps[\\/]academy-crm[\\/]server[\\/]server\.ts/,
    relativeMatch: /server[\\/]server\.ts/,
    pidFile: join(RUNTIME_DIR, 'app-academy-crm-server.pid'),
    keep: 'pidfile',
    respawn: 'client',
    recycleAged: false,
  },
  {
    id: 'app-academy-landing-http',
    label: 'Academy Landing static server (node serve-static :4174)',
    match: /(?:serve-static\.mjs|http\.server)[ ]+4174\b/,
    pidFile: join(RUNTIME_DIR, 'app-academy-landing-http.pid'),
    keep: 'pidfile',
    respawn: 'manual',
    recycleAged: false,
  },
  {
    id: 'sandbox-genesis-landing',
    label: 'Sandbox Genesis Landing daemon (:4181)',
    match: /apps[\\/]genesis-landing[\\/]server\.mjs/,
    pidFile: join(RUNTIME_DIR, 'sandbox-genesis-landing.pid'),
    keep: 'pidfile',
    respawn: 'manual',
    recycleAged: false,
  },
  {
    id: 'kairos-agenda',
    label: 'Kairós Agenda daemon (:4195, app de cliente)',
    match: /apps[\\/]kairos-agenda[\\/]server[\\/]server\.mjs/,
    pidFile: join(RUNTIME_DIR, 'kairos-agenda.pid'),
    keep: 'pidfile',
    respawn: 'manual',
    recycleAged: false,
  },
  {
    id: 'gv-agenda',
    label: 'GV Agenda daemon (:4196, app nativa)',
    match: /apps[\\/]gv-agenda[\\/]server[\\/]server\.mjs/,
    pidFile: join(RUNTIME_DIR, 'gv-agenda.pid'),
    keep: 'pidfile',
    respawn: 'manual',
    recycleAged: false,
  },
  {
    id: 'gv-music-vite',
    label: 'Gentle Music Vite server',
    // Tolerates the pnpm-exec shim path (`node_modules\.bin\..\vite\bin\vite.js`)
    // — the pre-fix start.sh launched it that way, and those instances must
    // still be classified instead of falling into hung-oneshot.
    match:
      /apps[\\/]gv-music[\\/]node_modules[\\/](?:\.bin[\\/]\.\.[\\/])?vite[\\/]bin[\\/]vite\.js/,
    relativeMatch: /vite[\\/]bin[\\/]vite\.js/,
    pidFile: join(RUNTIME_DIR, 'app-gv-music-ui.pid'),
    keep: 'pidfile',
    respawn: 'manual',
    recycleAged: false,
  },
  {
    id: 'sandbox-gv-gui',
    label: 'Sandbox GV Demo GUI (:4000)',
    match: /apps[\\/]sandbox-gv[\\/]/,
    relativeMatch: /sandbox-gv[\\/]/,
    pidFile: join(RUNTIME_DIR, 'sandbox-gv.pid'),
    keep: 'pidfile',
    respawn: 'manual',
    recycleAged: false,
  },
  {
    id: 'sandbox-wpp-bot',
    label: 'Sandbox wpp-bot daemon (:3000)',
    // npm start -> node dist/index.js; start:dev -> tsx src/index.ts.
    match: /apps[\\/]wpp-bot[\\/](dist[\\/]index\.js|src[\\/]index\.ts)/,
    pidFile: join(RUNTIME_DIR, 'sandbox-wpp-bot.pid'),
    keep: 'pidfile',
    respawn: 'manual',
    recycleAged: false,
  },
  {
    id: 'vite-server',
    label: 'Dashboard Vite dev server',
    // Dashboard-only: with one vite per app (analytics/cms/prompts have their
    // own classes above), a generic /vite[\/]bin[\/]vite/ match flagged the
    // other apps' vites as "duplicates" of the dashboard's.
    match: /web-dashboard[\\/]node_modules[\\/]vite[\\/]bin[\\/]vite\.js/,
    pidFile: join(RUNTIME_DIR, 'dashboard-vite.pid'),
    keep: 'pidfile',
    respawn: 'watchdog',
    recycleAged: true,
  },
];

/**
 * Clasificacion GENERICA de servidor de app.
 *
 * Por que existe (medido 2026-11-06): el registro por app (DAEMON_CLASSES)
 * cubre las apps con pidfile. Las apps que levantan su servidor SIN pidfile
 * caian en `unclassified` y el barrido las marcaba como `hung-oneshot`: un
 * FAIL PERMANENTE del gate que no correspondia a un proceso colgado, sino a
 * servidores legitimos (API de la app, Vite dev server, servidor estatico).
 * Medido: 11 procesos marcados asi (alexandria, academy-portal,
 * gv-knowledge-ops, gv-wifikeys, service-desk, gv-english-lab,
 * design-gallery, corporate-web, voice-studio).
 *
 * La FORMA del comando dice que es un servidor:
 *   apps/<app>/server/index.ts | server/server.ts | server/server.mjs
 *   apps/<app>/node_modules/vite/bin/vite.js
 *   tools/serve-static.mjs <port> <root>
 *
 * El id de clase se deriva del NOMBRE de la app: dos apps distintas no pueden
 * caerse la una como duplicado de la otra. Una app con clase estatica NUNCA
 * es reclamada por la generica (el pidfile de esa app sigue decidiendo).
 */
/** Nombre del directorio `apps/<app>` dentro del comando. */
const APP_DIR_RE = /apps[\\/]([^\\/"'\s]+)/i;

/** Apps con clase estatica: la clasificacion generica no las toca. */
const REGISTERED_APPS = new Set(
  DAEMON_CLASSES.map((c) => c.app).filter((a): a is string => Boolean(a)),
);

/**
 * La FORMA del comando dice que clase de servidor es:
 *   api    -> apps/<app>/server/index.ts | server/server.ts | server/server.mjs
 *   vite   -> apps/<app>/node_modules/vite/bin/vite.js
 *   static -> tools/serve-static.mjs <port> <root>
 * El TIPO va en el id: la API y el Vite de la misma app son dos instancias
 * legitimas, no dos duplicados.
 */
function classifyAppServer(cmdline: string): DaemonClass | null {
  let kind: string;
  let port = '';
  if (/apps[\\/][^\\/"'\s]+[\\/]server[\\/](?:index|server)\.(?:ts|mjs|js)/.test(cmdline)) {
    kind = 'api';
  } else if (/apps[\\/][^\\/"'\s]+[\\/]node_modules[\\/]vite[\\/]bin[\\/]vite\.js/.test(cmdline)) {
    kind = 'vite';
  } else if (/tools[\\/]serve-static\.mjs\b/.test(cmdline)) {
    kind = 'static';
    port = /serve-static\.mjs\s+(\d+)/.exec(cmdline)?.[1] ?? '?';
  } else {
    return null;
  }
  const app = APP_DIR_RE.exec(cmdline)?.[1]?.toLowerCase();
  if (!app) return null;
  if (REGISTERED_APPS.has(app)) return null;
  return {
    id: `app-server:${app}:${kind}${port ? `:${port}` : ''}`,
    label: `${app} ${kind} server`,
    // La forma generica ya se resolvio: este `match` nunca se usa para
    // clasificar (solo las clases estaticas se evaluan en el bucle).
    match: /$^/,
    keep: 'newest',
    respawn: 'manual',
    recycleAged: false,
  };
}

/** Known PID files (used for stale-file sweeps, not only per-class). */
const KNOWN_PID_FILES = [
  ...new Set(DAEMON_CLASSES.filter((c) => c.pidFile).map((c) => c.pidFile!)),
];

/** Repo one-shot scripts that legitimately run long — never reap by age. */
const LONG_RUN_ALLOWLIST: RegExp[] = [
  /process-hygiene\.ts/, // self
  /session-autostart(-detached)?\.ts/, // pipeline itself
  /maintenance-watchtower\.ts/, // health runs can take minutes
  /test-runner/,
  /graphify/,
  /dashboard-start\.ts/, // spawns watchdogs then exits (short-lived anyway)
];

/**
 * Servidores MCP stdio del repo (`src/integrations/<x>-cli.ts mcp`,
 * `src/mcp/<x>-mcp-server.ts`).
 *
 * Un servidor MCP stdio vive EXACTAMENTE mientras su cliente: no es un daemon
 * del stack (no se relanza solo) ni un one-shot (no debe morir). Medido
 * 2026-11-06: el MCP `rea` del repo vivia 6,9 h con su cliente vivo y el
 * barrido lo reportaba como `unknown-repo-process` — un WARN PERMANENTE que no
 * describia un problema (el servidor hacia su trabajo).
 *
 * Con padre VIVO: servidor conocido y supervisado -> sin hallazgo.
 * Con padre MUERTO: el huerfano es real -> lo captura la rama de one-shot
 * colgado (accionable), que es lo que corresponde.
 */
const REPO_MCP_SERVER_RE =
  /src[\\/](?:integrations[\\/][\w-]+-cli|mcp[\\/][\w-]+-mcp-server)\.ts\b/;

function isRepoMcpServer(cmdline: string): boolean {
  return REPO_MCP_SERVER_RE.test(cmdline);
}

// ─── Snapshot (impure) ────────────────────────────────────────────────────────

function repoRootPattern(): RegExp {
  // Escape each regex metacharacter (backslashes included) — do NOT
  // pre-double the backslashes, the escaper already handles them.
  const root = fileURLToPath(new URL('../../', import.meta.url));
  return new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Repo scope test. Many stack spawns use a RELATIVE script path
 * (`node --import tsx src/tokens/token-ingest.ts --watch` with cwd=repo),
 * so besides the absolute-root match we resolve any relative .ts path in the
 * command line against the repo root — if the file exists there, the process
 * belongs to this repo.
 */
function isRepoScoped(cmdline: string): boolean {
  if (repoRootPatternCache.test(cmdline)) return true;
  for (const m of cmdline.matchAll(/(?:^|["'\s=])([\w.@-]+[\\/][\w.\\/-]*\.ts)\b/g)) {
    const p = m[1];
    if (!/^[A-Za-z]:/.test(p) && existsSync(join(REPO_ROOT, p))) return true;
  }
  return false;
}

const repoRootPatternCache = repoRootPattern();

function hasExternalAbsoluteScriptPath(cmdline: string): boolean {
  for (const match of cmdline.matchAll(
    /(?:^|\s)"?((?:[A-Za-z]:[\\/]|\/|\\\\)[^"]+?\.(?:tsx?|[cm]?js|py))"?(?=\s|$)/gi,
  )) {
    if (!repoRootPatternCache.test(match[1])) return true;
  }
  return false;
}

/** Tab-delimited lines: pid \t ppid \t name \t createdIso \t cmdline */
/**
 * Pidfile lookup tolerant to path-separator differences (Windows `\` vs POSIX `/`)
 * and to absolute-vs-relative keys. Order: exact path → separator-normalized →
 * basename under .runtime.
 */
function pidValueFor(pidFiles: Map<string, string>, pidFile: string): string | undefined {
  const exact = pidFiles.get(pidFile);
  if (exact !== undefined) return exact;
  const norm = (p: string): string => p.replace(/\\/g, '/');
  const wanted = norm(pidFile);
  for (const [k, v] of pidFiles) {
    if (norm(k) === wanted || norm(k).endsWith('/' + basename(wanted))) return v;
  }
  return undefined;
}

export function parseWindowsProcessSnapshot(
  output: string,
  pidFiles: Map<string, string>,
): { repoProcesses: ProcessInfo[]; livePids: Set<number> } {
  const repoProcesses: ProcessInfo[] = [];
  const livePids = new Set<number>();

  for (const line of output.split(/\r?\n/)) {
    const parts = line.split('\t');
    if (parts.length < 5) continue;
    const pid = parseInt(parts[0], 10);
    if (isNaN(pid)) continue;
    livePids.add(pid);

    const cmdline = parts.slice(4).join('\t');
    const admitted =
      parts[2] === 'node.exe' || parts[2] === 'chrome.exe' || parts[2] === 'python.exe';
    if (!admitted) continue;
    if (isRepoScoped(cmdline) || classifyDaemon(cmdline, pid, pidFiles)) {
      repoProcesses.push({
        pid,
        ppid: parseInt(parts[1], 10) || 0,
        name: parts[2],
        created: parts[3],
        cmdline,
      });
    }
  }

  return { repoProcesses, livePids };
}

function scanProcesses(pidFiles: Map<string, string>): {
  repoProcesses: ProcessInfo[];
  livePids: Set<number>;
} {
  const repoProcesses: ProcessInfo[] = [];
  const livePids = new Set<number>();
  try {
    if (process.platform === 'win32') {
      // python.exe = legacy static app servers (http.server pre-migración a
      // node serve-static, 2026-10) + scripts python del repo (regen covers,
      // docs tools). Include all parent PIDs in liveness checks because MCP
      // stdio servers can be children of external clients such as Copilot.exe.
      const psCmd =
        `Get-CimInstance Win32_Process | ` +
        `ForEach-Object { "$($_.ProcessId)\`t$($_.ParentProcessId)\`t$($_.Name)\`t$($_.CreationDate.ToString('o'))\`t$($_.CommandLine)" }`;
      const r = runSync('powershell', ['-NoProfile', '-Command', psCmd], {
        timeout: 15000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const parsed = parseWindowsProcessSnapshot(r.stdout, pidFiles);
      repoProcesses.push(...parsed.repoProcesses);
      for (const pid of parsed.livePids) livePids.add(pid);
    } else {
      const r = runSync('ps', ['-eo', 'pid:10,ppid:10,etimes:10,comm:40,args:400'], {
        timeout: 10000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const rootPlain = fileURLToPath(new URL('../../', import.meta.url));
      for (const line of r.stdout.split('\n').slice(1)) {
        const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
        if (!m) continue;
        const pid = parseInt(m[1], 10);
        livePids.add(pid);
        if (m[4] !== 'node' && !m[4].includes('chrome') && !m[4].startsWith('python')) continue;
        if (!m[5].includes(rootPlain) && !classifyDaemon(m[5], pid, pidFiles)) continue;
        repoProcesses.push({
          pid,
          ppid: parseInt(m[2], 10),
          name: m[4],
          created: new Date(Date.now() - parseInt(m[3], 10) * 1000).toISOString(),
          cmdline: m[5],
        });
      }
    }
  } catch {
    // scan failure → empty snapshot, analyze() degrades to no-op
  }
  return { repoProcesses, livePids };
}

async function readPortOwners(): Promise<Map<number, number>> {
  const owners = new Map<number, number>();
  const portsFile = join(RUNTIME_DIR, 'dashboard-ports.json');
  const ports: { wsPort?: number; vitePort?: number } = existsSync(portsFile)
    ? JSON.parse(readFileSync(portsFile, 'utf-8'))
    : {};
  for (const p of [ports.wsPort, ports.vitePort]) {
    if (typeof p === 'number' && p > 0) {
      const owner = await getProcessIdByPort(p);
      if (owner) owners.set(p, owner);
    }
  }
  return owners;
}

function readPidFiles(): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of KNOWN_PID_FILES) {
    try {
      if (existsSync(f)) map.set(f, readFileSync(f, 'utf-8').trim());
    } catch {
      /* ignore */
    }
  }
  return map;
}

export async function buildSnapshot(): Promise<ProcessSnapshot> {
  // PID files first: class matching for relative-path cmdlines (app servers
  // spawned by start.sh) needs them to decide which app a process belongs to.
  const pidFiles = readPidFiles();
  const { repoProcesses, livePids } = scanProcesses(pidFiles);
  return {
    repoProcesses,
    livePids,
    portOwners: await readPortOwners(),
    pidFiles,
  };
}

// ─── Analysis (pure) ──────────────────────────────────────────────────────────

function ageHours(info: ProcessInfo, now = Date.now()): number {
  const t = new Date(info.created).getTime();
  if (isNaN(t)) return 0;
  return Math.max(0, (now - t) / 3_600_000);
}

function classifyDaemon(
  cmdline: string,
  pid: number,
  pidFiles: Map<string, string> = new Map(),
): DaemonClass | null {
  if (hasExternalAbsoluteScriptPath(cmdline)) return null;
  for (const c of DAEMON_CLASSES) {
    if (c.match.test(cmdline)) return c;
    // Ambiguous relative shape: only the pidfile owner may claim the class.
    if (c.relativeMatch?.test(cmdline) && c.pidFile) {
      const raw = pidValueFor(pidFiles, c.pidFile);
      if (raw && /^\d+$/.test(raw) && parseInt(raw, 10) === pid) return c;
    }
  }
  // Sin clase estatica: la FORMA del comando puede decir que es un servidor de
  // app (ver classifyAppServer). Si no lo es, es un one-shot y sigue su curso.
  return classifyAppServer(cmdline);
}

function pickKeeper(
  cls: DaemonClass,
  instances: ProcessInfo[],
  snap: ProcessSnapshot,
): ProcessInfo | null {
  if (instances.length === 0) return null;
  const portsFile = join(RUNTIME_DIR, 'dashboard-ports.json');
  let keeperByPort: ProcessInfo | undefined;
  if (cls.port) {
    try {
      const ports: { wsPort?: number; vitePort?: number } = JSON.parse(
        readFileSync(portsFile, 'utf-8'),
      );
      const port = ports[cls.port];
      if (typeof port === 'number' && port > 0) {
        const owner = snap.portOwners.get(port);
        keeperByPort = instances.find((i) => i.pid === owner);
      }
    } catch {
      /* no ports file → fall through */
    }
  }
  if (keeperByPort) return keeperByPort;

  if (cls.pidFile) {
    const raw = pidValueFor(snap.pidFiles, cls.pidFile);
    if (raw && /^\d+$/.test(raw)) {
      const byPid = instances.find((i) => i.pid === parseInt(raw, 10));
      if (byPid) return byPid;
      // The PID file may point at the daemon's child (e.g. the codegraph
      // serve process spawned by the wrapper) — fall through to newest.
    }
  }
  return instances.reduce((a, b) => (ageHours(a) <= ageHours(b) ? a : b));
}

/**
 * Pure classification of a snapshot into findings + healthy keepers.
 * No side effects — unit tests drive this directly with fake snapshots.
 */
export function analyzeProcesses(
  snap: ProcessSnapshot,
  opts: HygieneOptions = DEFAULT_OPTIONS,
  now = Date.now(),
): {
  findings: HygieneFinding[];
  keptHealthy: { classId: string; pid: number; ageHours: number }[];
} {
  const findings: HygieneFinding[] = [];
  const keptHealthy: { classId: string; pid: number; ageHours: number }[] = [];
  const selfPid = process.pid;

  const daemons = new Map<string, ProcessInfo[]>();
  const unclassified: ProcessInfo[] = [];
  const dynamicClasses = new Map<string, DaemonClass>();
  const staticClassIds = new Set(DAEMON_CLASSES.map((c) => c.id));

  for (const info of snap.repoProcesses) {
    if (info.pid === selfPid) continue;
    if (info.name === 'chrome.exe') continue; // handled separately below
    if (LONG_RUN_ALLOWLIST.some((re) => re.test(info.cmdline))) continue;
    const cls = classifyDaemon(info.cmdline, info.pid, snap.pidFiles);
    if (cls) {
      const list = daemons.get(cls.id) ?? [];
      list.push(info);
      daemons.set(cls.id, list);
      if (!staticClassIds.has(cls.id)) dynamicClasses.set(cls.id, cls);
    } else {
      unclassified.push(info);
    }
  }

  // 1+3. Daemon duplicates and aged daemons
  for (const cls of [...DAEMON_CLASSES, ...dynamicClasses.values()]) {
    const instances = daemons.get(cls.id) ?? [];
    if (instances.length === 0) continue;

    // Same-launch chains: a tsx CLI wrapper and the script child it spawned
    // are ONE logical instance. The keeper is chosen among CHAIN TOPS only —
    // killing a wrapper with /T would take its child (a possible keeper) down.
    const instancePids = new Set(instances.map((i) => i.pid));
    const chainTops = instances.filter((i) => !instancePids.has(i.ppid));

    const keeper = pickKeeper(cls, chainTops, snap);
    const keeperAge = keeper ? ageHours(keeper, now) : 0;

    if (opts.recycleAged && cls.recycleAged && keeperAge > opts.maxAgeHours) {
      // recycle the WHOLE class (keeper + duplicates): autostart/watchdog
      // will respawn a fresh instance at the next pipeline run.
      for (const inst of instances) {
        findings.push({
          pid: inst.pid,
          name: inst.name,
          kind: 'aged-daemon',
          action: 'recycle',
          reason: `${cls.label} running ${keeperAge.toFixed(1)}h (> ${opts.maxAgeHours}h), respawn=${cls.respawn}`,
          ageHours: ageHours(inst, now),
          classId: cls.id,
          cmdline: inst.cmdline.slice(0, 180),
        });
      }
      continue;
    }

    if (keeper) keptHealthy.push({ classId: cls.id, pid: keeper.pid, ageHours: keeperAge });
    const parallelKeepers = new Set<number>();
    if (cls.allowParallelParents) {
      const parentPids = new Set(
        chainTops
          .filter((instance) => instance.ppid !== keeper?.ppid && snap.livePids.has(instance.ppid))
          .map((instance) => instance.ppid),
      );
      for (const parentPid of parentPids) {
        const parentInstances = chainTops.filter((instance) => instance.ppid === parentPid);
        const parentKeeper = parentInstances.reduce((newest, instance) =>
          Date.parse(instance.created) > Date.parse(newest.created) ? instance : newest,
        );
        parallelKeepers.add(parentKeeper.pid);
        keptHealthy.push({
          classId: cls.id,
          pid: parentKeeper.pid,
          ageHours: ageHours(parentKeeper, now),
        });
      }
    }
    for (const inst of chainTops) {
      if (inst === keeper || parallelKeepers.has(inst.pid)) continue;
      // Una clase GENERICA de app no conoce la politica de la app: se REPORTA
      // en vez de matar. Matar un servidor legitimo de una app que el owner
      // quiere arriba es un dano irreversible; un aviso no lo es.
      const isDynamic = dynamicClasses.has(cls.id);
      findings.push({
        pid: inst.pid,
        name: inst.name,
        kind: 'duplicate-daemon',
        action: isDynamic ? 'report' : 'kill',
        reason: `duplicate ${cls.label}; keeper is PID ${keeper?.pid ?? '?'} (pidfile/port owner)${
          isDynamic ? ' [clase generica: solo aviso, no se mata]' : ''
        }`,
        ageHours: ageHours(inst, now),
        classId: cls.id,
        cmdline: inst.cmdline.slice(0, 180),
      });
    }
  }

  // 2. Hung one-shots: repo scripts with no daemon class, dead parent, stale
  const daemonPids = new Set(
    snap.repoProcesses
      .filter((i) => classifyDaemon(i.cmdline, i.pid, snap.pidFiles))
      .map((i) => i.pid),
  );
  for (const info of unclassified) {
    const age = ageHours(info, now);
    const parentAlive = snap.livePids.has(info.ppid);
    const parentIsDaemon = daemonPids.has(info.ppid);
    if (!parentAlive || parentIsDaemon) {
      if (age * 60 >= opts.minAgeMin) {
        findings.push({
          pid: info.pid,
          name: info.name,
          kind: 'hung-oneshot',
          action: 'kill',
          reason: `repo one-shot alive ${age.toFixed(1)}h with ${parentAlive ? 'daemon parent' : 'dead parent'} (expected minutes)`,
          ageHours: age,
          cmdline: info.cmdline.slice(0, 180),
        });
      }
    } else if (age > 1) {
      // Servidor MCP stdio del repo con cliente VIVO: conocido y supervisado.
      // No es un hallazgo: esta haciendo su trabajo mientras el cliente viva.
      if (isRepoMcpServer(info.cmdline)) continue;
      // unknown but actively supervised by a live non-daemon parent (e.g. an
      // agent running a long task) — report only, never kill
      findings.push({
        pid: info.pid,
        name: info.name,
        kind: 'unknown-repo-process',
        action: 'report',
        reason: `repo process alive ${age.toFixed(1)}h with live parent ${info.ppid} — not a known daemon class`,
        ageHours: age,
        cmdline: info.cmdline.slice(0, 180),
      });
    }
  }

  // 4a. Stale PID files (dead PIDs only — see note inside the loop)
  for (const [file, raw] of snap.pidFiles) {
    if (!/^\d+$/.test(raw)) {
      findings.push({
        pid: 0,
        name: 'pidfile',
        kind: 'stale-pidfile',
        action: 'clean-pidfile',
        reason: `${file} content is not a PID: "${raw.slice(0, 20)}"`,
        ageHours: 0,
        cmdline: file,
      });
      continue;
    }
    const pid = parseInt(raw, 10);
    // Only clean genuinely dead PIDs. A live PID that is not a repo node
    // process may be a legit daemon child running from a global path (e.g.
    // the codegraph serve binary) — PID-reuse cleaning would false-positive.
    if (!snap.livePids.has(pid)) {
      findings.push({
        pid,
        name: 'pidfile',
        kind: 'stale-pidfile',
        action: 'clean-pidfile',
        reason: `${file} → PID ${pid} is not running`,
        ageHours: 0,
        cmdline: file,
      });
    }
  }

  // 4b. Leftover headless Chrome (screenshot/export residue)
  for (const info of snap.repoProcesses) {
    if (info.name !== 'chrome.exe') continue;
    if (!/headless/i.test(info.cmdline)) continue;
    const age = ageHours(info, now);
    if (age * 60 >= opts.chromeMinAgeMin) {
      findings.push({
        pid: info.pid,
        name: info.name,
        kind: 'headless-chrome',
        action: 'kill',
        reason: `headless chrome alive ${age.toFixed(1)}h (screenshot residue)`,
        ageHours: age,
        cmdline: info.cmdline.slice(0, 180),
      });
    }
  }

  return { findings, keptHealthy };
}

// ─── Action (impure) ──────────────────────────────────────────────────────────

/** Tree kill — grandchild processes are the #1 orphan source after single-PID kills. */
function killTree(pid: number): boolean {
  try {
    if (process.platform === 'win32') {
      const r = runSync('taskkill', ['/T', '/F', '/PID', String(pid)], { timeout: 8000 });
      return r.status === 0;
    }
    process.kill(pid, 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

// ─── Git config guard (BL-MW2IBHXM-777H) ─────────────────────────────────────

const GIT_GUARD_LOG = join(RUNTIME_DIR, 'git-config-guard.log');

/**
 * El flag core.bare=true reaparece en .git/config sin autor escrito (flip
 * exógeno, ver BL-MW2IBHXM-777H) y rompe todo status/commit/push con
 * "fatal: this operation must be run in a work tree". Este guard detecta el
 * flag corrupto y lo repara en cada pasada de hygiene (autostart + watchtower
 * autoheal), con registro append-only del incidente.
 */
export function guardGitRepoConfig(
  root = resolve(process.cwd()),
  log: (m: string) => void = (m) => {
    try {
      appendFileSync(GIT_GUARD_LOG, new Date().toISOString() + ' ' + m + String.fromCharCode(10), 'utf-8');
    } catch { /* best-effort */ }
  },
): { flipped: boolean } {
  const r = runSync('git', ['-C', root, 'config', 'core.bare'], { timeout: 5000 });
  const val = (r.stdout || '').trim();
  if (r.status === 0 && val === 'true') {
    runSync('git', ['-C', root, 'config', 'core.bare', 'false'], { timeout: 5000 });
    log('REPARADO: core.bare=true detectado y restaurado a false (root: ' + root + ')');
    return { flipped: true };
  }
  return { flipped: false };
}

export async function runHygiene(opts: Partial<HygieneOptions> = {}): Promise<HygieneResult> {
  const options: HygieneOptions = { ...DEFAULT_OPTIONS, ...opts };
  const snap = await buildSnapshot();
  const { findings, keptHealthy } = analyzeProcesses(snap, options);

  const result: HygieneResult = {
    timestamp: new Date().toISOString(),
    mode: options.apply ? 'apply' : 'dry-run',
    scanned: snap.repoProcesses.length,
    findings,
    killed: [],
    cleanedFiles: [],
    keptHealthy,
  };

  if (options.apply) {
    for (const f of findings) {
      if (f.action === 'kill' || f.action === 'recycle') {
        if (killTree(f.pid)) result.killed.push(f.pid);
      } else if (f.action === 'clean-pidfile') {
        try {
          unlinkSync(f.cmdline);
          result.cleanedFiles.push(f.cmdline);
        } catch {
          /* already gone */
        }
      }
    }
  }

  // Side-effect guard: detecta y repara core.bare=true (BL-MW2IBHXM-777H);
  // el resultado ya queda registrado en git-config-guard.log por el propio guard.
  guardGitRepoConfig(resolve(process.cwd()));

  persistReport(result);
  return result;
}

// ─── Reporting ────────────────────────────────────────────────────────────────

const REPORT_FILE = join(RUNTIME_DIR, 'process-hygiene-report.json');
const LOG_FILE = join(RUNTIME_DIR, 'process-hygiene.log');

function persistReport(result: HygieneResult): void {
  try {
    mkdirSync(RUNTIME_DIR, { recursive: true });
    writeFileSync(REPORT_FILE, JSON.stringify(result, null, 2), 'utf-8');
    const actions = result.killed.length > 0 || result.cleanedFiles.length > 0;
    appendFileSync(
      LOG_FILE,
      `${result.timestamp} | ${result.mode} | scanned=${result.scanned} findings=${result.findings.length} killed=${result.killed.length} cleaned=${result.cleanedFiles.length}${actions ? '' : ' clean'}\n`,
      'utf-8',
    );
  } catch {
    /* reporting must never break the pipeline */
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function printHuman(result: HygieneResult): void {
  console.log(`\n  [Process Hygiene] mode=${result.mode} scanned=${result.scanned} repo processes`);
  if (result.findings.length === 0) {
    console.log('  ✓ Clean — no orphans, duplicates, hung one-shots or stale PID files');
  }
  for (const f of result.findings) {
    const icon =
      f.action === 'report'
        ? 'ℹ'
        : f.action === 'clean-pidfile'
          ? '🧹'
          : result.mode === 'apply'
            ? '☠'
            : '!';
    console.log(
      `  ${icon} [${f.kind}] PID ${f.pid || '-'} (${f.ageHours.toFixed(1)}h) — ${f.reason}`,
    );
    if (f.cmdline && f.kind !== 'stale-pidfile') console.log(`      ${f.cmdline}`);
  }
  for (const k of result.keptHealthy) {
    console.log(`  ✓ [healthy] ${k.classId} PID ${k.pid} (${k.ageHours.toFixed(1)}h)`);
  }
  if (result.mode === 'apply') {
    console.log(`  → killed: ${result.killed.join(', ') || 'none'}`);
    console.log(`  → cleaned pid files: ${result.cleanedFiles.length}`);
  } else if (result.findings.some((f) => f.action !== 'report')) {
    console.log('  (dry-run — run with --apply to reap)');
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const json = args.includes('--json');
  const quiet = args.includes('--quiet');
  const noRecycle = args.includes('--no-recycle-aged');
  const minAgeIdx = args.indexOf('--min-age-min');
  const maxAgeIdx = args.indexOf('--max-age-hours');

  const result = await runHygiene({
    apply,
    recycleAged: !noRecycle,
    minAgeMin: minAgeIdx >= 0 ? parseInt(args[minAgeIdx + 1], 10) || 15 : DEFAULT_OPTIONS.minAgeMin,
    maxAgeHours:
      maxAgeIdx >= 0 ? parseFloat(args[maxAgeIdx + 1]) || 24 : DEFAULT_OPTIONS.maxAgeHours,
  });

  if (json) console.log(JSON.stringify(result, null, 2));
  else if (!quiet) printHuman(result);
  else if (result.findings.length > 0) {
    console.log(
      `[process-hygiene] ${result.findings.length} finding(s), killed=${result.killed.length}`,
    );
  }

  // dry-run with actionable findings → non-zero so callers can detect dirt
  if (!apply && result.findings.some((f) => f.action !== 'report')) return 1;
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(`[process-hygiene] fatal: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(2);
    });
}
