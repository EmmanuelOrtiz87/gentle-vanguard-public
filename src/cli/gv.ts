#!/usr/bin/env node

/**
 * gv.ts — Gentle-Vanguard CLI (TS replacement for bin/gv.ps1)
 *
 * Usage:
 *   npx tsx src/cli/gv.ts <command> [options]
 *
 * Commands:
 *   check       Run system checks (watchtower health)
 *   validate    Validate stack installation
 *   info        Show stack information
 *   list        List available skills
 *   health      Full stack health (watchtower); --db for Nexus DB only
 *   prune       Prune old Nexus data
 *   backup      Backup Nexus DB
 *   optimize    Optimize Nexus DB (WAL + VACUUM)
 *   new         Create new project (scaffolding info)
 *   update      Update stack via git pull
 *   update-all  Full stack update
 *   sync        Alias for update
 *   tools       Show optional tools status
 *   secret      Secret management (stub — use engram/vault instead)
 *   cache       Cache management (stub — use Nexus DB instead)
 *   session     Manage session lifecycle (start|stop|status)
 *   dashboard   Control dashboard (start|stop|restart|status)
 *   cc          Command Center: app lifecycle (start|stop|status)
 *   cleanup     Kill zombie processes
 *   status      Show complete stack status
 *   fix         Fix PS1 references (--configs, --dry-run)
 *   release     Run release gates with per-gate profiling (--skip-tests, --json)
 *   loop-guard  Check orchestrator loop-guard health (anti-loop)
 *   metrics     Show live stack metrics (F4.1, from config/stack-metrics.json)
 *   web         Web research (search|scrape|crawl) via native crawler
 *   eval        Continuous evaluation over real Nexus traces (F3.1; --gate)
 *   skill       Skill plugins: list|install|enable|disable|deprecate|remove|verify
 *   help        Show this help
 */

import { run, runSync, runNpxTsxSync, runSyncShell } from '../../adapters/command-runner.js';
import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { pathToFileURL } from 'url';
import { printBanner } from './banner.js';

const ROOT = resolve(process.cwd());
const SKILLS_DIR = join(ROOT, 'skills');
const RULES_DIR = join(ROOT, 'rules');
const RUNTIME_DIR = join(ROOT, '.runtime');
const SESSION_FILE = join(ROOT, '.session', '.active-session.json');

const args = process.argv.slice(2);
const command = args[0] || 'help';

function header(): void {
  printBanner('CLI v8.0');
}

function footer(): void {
  console.log('');
  console.log("Run 'npx tsx src/cli/gv.ts help' for usage.");
  console.log('');
}

function getLiveMetrics(): Record<string, unknown> {
  try {
    const p = join(ROOT, 'config', 'stack-metrics.json');
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf-8'));
  } catch {}
  return {};
}

function showHelp(): void {
  header();
  console.log(`
USAGE:
  npx tsx src/cli/gv.ts <command> [options]

COMMANDS:
  check       Run system checks (watchtower health)
  validate    Validate stack installation
  info        Show stack information
  list        List available skills
  health      Full stack health (watchtower); --db for Nexus DB only
  prune       Prune old Nexus data
  backup      Backup Nexus DB
  optimize    Optimize Nexus DB (WAL + VACUUM)
  new         Create new project scaffolding
  update      Update stack via git pull
  update-all  Full stack update (git pull + npm update)
  sync        Alias for update
  tools       Show optional tools status
  secret      Secret management (engram-vault)
  cache       Cache management (Nexus DB)
  session     Manage session lifecycle (start|stop|status)
  dashboard   Control dashboard (start|stop|restart|status)
  cc          Command Center: app lifecycle (start|stop|status)
  cleanup     Kill zombie processes
  status      Show complete stack status
  fix         Fix PS1 references (--configs, --dry-run)
  release     Run release gates with per-gate profiling (--skip-tests, --json)
  loop-guard  Check orchestrator loop-guard health
  metrics     Show live stack metrics (config/stack-metrics.json)
  web         Web research (search|scrape|crawl) via native crawler
  eval        Continuous evaluation over real Nexus traces (--gate to fail on regression)
  skill       Skill plugins (list|install|enable|disable|deprecate|remove|verify)
  telemetry   Unified correlation timeline session/trace/tokens (--session <id>)
  help        Show this help

EXAMPLES:
  npx tsx src/cli/gv.ts info
  npx tsx src/cli/gv.ts health
  npx tsx src/cli/gv.ts backup
  npx tsx src/cli/gv.ts check
  npx tsx src/cli/gv.ts release --skip-tests --json
`);
  footer();
}

function getStackInfo(): Record<string, unknown> {
  const skillsCount = existsSync(SKILLS_DIR)
    ? readdirSync(SKILLS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).length
    : 0;
  const rulesCount = existsSync(RULES_DIR)
    ? readdirSync(RULES_DIR).filter((f) => f.endsWith('.md')).length
    : 0;
  return {
    root: ROOT,
    skills: skillsCount,
    rules: rulesCount,
    tsSource: join(ROOT, 'src'),
  };
}

function showInfo(): void {
  header();
  const info = getStackInfo();
  console.log('Gentle-Vanguard Stack Information');
  console.log('');
  console.log(`  Root:         ${info.root}`);
  console.log(`  Skills:       ${info.skills}`);
  console.log(`  Rules:        ${info.rules}`);
  console.log(`  TS Source:    ${info.tsSource}`);
  console.log(`  Nexus DB:     .runtime/gentle-vanguard.db`);
  console.log('');

  if (existsSync(SKILLS_DIR)) {
    console.log('  Available Skills:');
    const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const d of dirs) {
      console.log(`    - ${d.name}`);
    }
    console.log(`  Total: ${dirs.length} skills`);
  }
  footer();
}

function runCommand(command: string, args: string[], label: string): boolean {
  try {
    console.log(`[${label}] Running...`);
    const r = runSync(command, args, { timeout: 120000 });
    if (r.status !== 0) {
      console.error(`[${label}] FAILED (status=${r.status})`);
      console.error((r.stdout || r.stderr || 'No output').toString().trim());
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[${label}] FAILED:`, e instanceof Error ? e.message : String(e));
    return false;
  }
}

/**
 * Run a command and exit with 0 on success or 1 on failure.
 * Used for health/check commands so the CLI returns a meaningful exit code
 * (0 = all OK, 1 = any FAIL) for scripting/CI.
 */
function runCommandExit(command: string, args: string[], label: string): never {
  const ok = runCommand(command, args, label);
  process.exit(ok ? 0 : 1);
}

// ─── Command Routing ────────────────────────────────────────────────

// ─── Migrated from legacy src/gv.ts ────────────────────────────────────────

interface CommandResult {
  success: boolean;
  message: string;
  data?: unknown;
}

function getSessionState(): {
  active: boolean;
  id?: string;
  lastActivity?: string;
  reason?: string;
} {
  try {
    if (!existsSync(SESSION_FILE)) {
      return { active: false, reason: 'No session state file' };
    }
    const state = JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));
    const lastActivity = new Date(state.lastActivity).getTime();
    if (isNaN(lastActivity)) {
      return { active: false, reason: 'Invalid lastActivity timestamp' };
    }
    // Session is valid while lastActivity is within the 30-minute window.
    // We intentionally do NOT check a stored PID: createSession() records the
    // PID of the short-lived CLI process (gv.ts itself), which dies seconds
    // after writing the file. A process.kill(pid, 0) probe on that PID would
    // always fail and mark the session inactive even when it is healthy.
    if (Date.now() - lastActivity > 30 * 60 * 1000) {
      return { active: false, reason: 'Session expired (>30min)' };
    }
    return { active: true, id: state.id, lastActivity: state.lastActivity };
  } catch {
    return { active: false, reason: 'Invalid state' };
  }
}

function createSession(id: string): void {
  const sessionDir = dirname(SESSION_FILE);
  if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
  // Note: we omit the `pid` field intentionally. The session lifecycle is
  // tracked by lastActivity timestamp alone (see getSessionState). Storing
  // the CLI process PID was misleading because that process exits immediately
  // after writing this file, making the alive-check always fail.
  const state = {
    id,
    startedAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
  };
  writeFileSync(SESSION_FILE, JSON.stringify(state, null, 2));
}

function touchSession(): void {
  try {
    if (existsSync(SESSION_FILE)) {
      const state = JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));
      state.lastActivity = new Date().toISOString();
      writeFileSync(SESSION_FILE, JSON.stringify(state, null, 2));
    }
  } catch {
    /* ignore */
  }
}

function cmdCleanup(_args: string[]): CommandResult {
  let killed = 0;
  const ports = [8080, 5173, 3000];
  for (const port of ports) {
    try {
      const output = runSyncShell(`netstat -ano | findstr :${port}`, {}).stdout;
      const lines = output.split('\n').filter((line) => line.includes('LISTENING'));
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && !isNaN(parseInt(pid)) && parseInt(pid) !== process.pid) {
          try {
            runSyncShell(`taskkill /F /T /PID ${pid}`, { stdio: 'pipe' });
            console.log(`[GV] Killed PID ${pid} on port ${port}`);
            killed++;
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
  const files = [
    join(RUNTIME_DIR, 'dashboard-ws.pid'),
    join(RUNTIME_DIR, 'dashboard-ws-watchdog.pid'),
    join(RUNTIME_DIR, 'dashboard-vite.pid'),
  ];
  let cleaned = 0;
  for (const file of files) {
    try {
      if (existsSync(file)) {
        unlinkSync(file);
        cleaned++;
      }
    } catch {
      /* ignore */
    }
  }
  return { success: true, message: `Cleaned: ${killed} processes, ${cleaned} files` };
}

function cmdSession(args: string[]): CommandResult {
  const subcmd = args[0] || 'status';
  switch (subcmd) {
    case 'start': {
      const state = getSessionState();
      if (state.active) {
        touchSession();
        return { success: true, message: `Session ${state.id} already active (touched)` };
      }
      console.log('[GV] Cleaning zombie processes...');
      cmdCleanup([]);
      console.log('[GV] Starting session...');
      try {
        runSync('npm', ['run', 'session:autostart:detached'], {
          cwd: ROOT,
          stdio: process.env.DEBUG ? 'inherit' : 'pipe',
        });
        createSession(`session-${Date.now()}`);
        return { success: true, message: 'Session started' };
      } catch (e) {
        return { success: false, message: `Failed to start: ${e}` };
      }
    }
    case 'stop': {
      try {
        cmdCleanup([]);
        if (existsSync(SESSION_FILE)) unlinkSync(SESSION_FILE);
        return { success: true, message: 'Session stopped' };
      } catch (e) {
        return { success: false, message: `Failed: ${e}` };
      }
    }
    case 'status':
    default: {
      const state = getSessionState();
      if (state.active) {
        return { success: true, message: `Session ${state.id} active since ${state.lastActivity}` };
      }
      return { success: false, message: `No active session: ${state.reason}` };
    }
  }
}

function isDashboardRunning(): boolean {
  // runSync never throws on non-zero exit — it returns {status, error}.
  // Check the status field directly, not via try/catch.
  const r = runSync('curl', ['-s', 'http://localhost:8080/health'], {
    timeout: 2000,
    stdio: 'pipe',
  });
  return r.status === 0;
}

function cmdDashboard(args: string[]): CommandResult {
  const subcmd = args[0] || 'status';
  switch (subcmd) {
    case 'start': {
      if (isDashboardRunning()) {
        return { success: true, message: 'Dashboard already running on http://localhost:5173' };
      }
      console.log('[GV] Cleaning zombie processes...');
      cmdCleanup([]);
      try {
        console.log('[GV] Starting dashboard...');
        const child = run('npx', ['tsx', 'src/ops/dashboard-start.ts'], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          cwd: ROOT,
        });
        child.unref();
        let attempts = 0;
        const maxAttempts = 10;
        const check = () => {
          if (isDashboardRunning() || attempts >= maxAttempts) return;
          attempts++;
          setTimeout(check, 1000);
        };
        check();
        return { success: true, message: 'Dashboard starting on http://localhost:5173' };
      } catch (e) {
        return { success: false, message: `Failed: ${e}` };
      }
    }
    case 'stop': {
      try {
        runNpxTsxSync('src/ops/dashboard-stop.ts', [], { cwd: ROOT, stdio: 'pipe' });
        return { success: true, message: 'Dashboard stopped' };
      } catch (e) {
        return { success: false, message: `Failed: ${e}` };
      }
    }
    case 'restart': {
      cmdDashboard(['stop']);
      setTimeout(() => cmdDashboard(['start']), 2000);
      return { success: true, message: 'Dashboard restarting...' };
    }
    case 'status':
    default: {
      const running = isDashboardRunning();
      return {
        success: running,
        message: running
          ? 'Dashboard running: http://localhost:5173 (WS: 8080)'
          : 'Dashboard not running',
      };
    }
  }
}

function ccPort(): number {
  try {
    const ports = JSON.parse(
      readFileSync(join(RUNTIME_DIR, 'command-center-ports.json'), 'utf-8'),
    ) as { ccPort?: number };
    if (ports.ccPort) return ports.ccPort;
  } catch {}
  return Number(process.env.CC_PORT ?? 8090);
}

function isCcRunning(): boolean {
  const r = runSync('curl', ['-s', `http://127.0.0.1:${ccPort()}/api/health`], {
    timeout: 2000,
    stdio: 'pipe',
  });
  return r.status === 0;
}

function pidFileExistsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function cmdCc(args: string[]): CommandResult {
  const subcmd = args[0] || 'status';
  switch (subcmd) {
    case 'start': {
      if (isCcRunning()) {
        return {
          success: true,
          message: `Command Center already running on http://127.0.0.1:${ccPort()}/`,
        };
      }
      try {
        const child = run(process.execPath, ['--import', 'tsx', 'apps/command-center/start.ts'], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          cwd: ROOT,
        });
        child.unref();
        return { success: true, message: `Command Center starting on http://127.0.0.1:${ccPort()}/` };
      } catch (e) {
        return { success: false, message: `Failed: ${e}` };
      }
    }
    case 'stop': {
      try {
        const pidFile = join(RUNTIME_DIR, 'command-center.pid');
        let pid = 0;
        if (existsSync(pidFile)) {
          pid = Number(readFileSync(pidFile, 'utf-8').trim());
          if (!pid || Number.isNaN(pid)) pid = 0;
        }
        if (!pid && isCcRunning()) {
          // Pidfile lost (e.g. kill/start race) — find the listener on the CC port.
          const r = runSync(
            'powershell',
            [
              '-NoProfile',
              '-Command',
              `@(Get-NetTCPConnection -LocalPort ${ccPort()} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`,
            ],
            { timeout: 5000, stdio: 'pipe' },
          );
          pid = Number((r.stdout ?? '').trim());
        }
        if (!pid || !pidFileExistsAlive(pid)) {
          if (existsSync(pidFile)) unlinkSync(pidFile);
          return { success: false, message: 'Command Center not running' };
        }
        if (process.platform === 'win32')
          runSync('taskkill', ['/pid', String(pid), '/t', '/f'], { timeout: 8000, stdio: 'ignore' });
        else process.kill(pid, 'SIGTERM');
        if (existsSync(pidFile)) unlinkSync(pidFile);
        return { success: true, message: `Command Center stopped (PID ${pid})` };
      } catch (e) {
        return { success: false, message: `Failed: ${e}` };
      }
    }
    case 'status':
    default: {
      const running = isCcRunning();
      return {
        success: running,
        message: running
          ? `Command Center running: http://127.0.0.1:${ccPort()}/`
          : 'Command Center not running',
      };
    }
  }
}

function cmdStatus(_args: string[]): CommandResult {
  const session = getSessionState();
  const dashboard = isDashboardRunning();
  const status = {
    timestamp: new Date().toISOString(),
    session: session.active ? 'active' : 'inactive',
    sessionId: session.id,
    dashboard: dashboard ? 'running' : 'stopped',
    dashboardUrl: dashboard ? 'http://localhost:5173' : null,
    wsApi: dashboard ? 'http://localhost:8080' : null,
  };
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║         GENTLE-VANGUARD STACK STATUS                   ║');
  console.log('╠════════════════════════════════════════════════════════╣');
  console.log(`║  Session:    ${status.session.padEnd(38)} ║`);
  if (status.sessionId) {
    console.log(`║  Session ID: ${status.sessionId.padEnd(38)} ║`);
  }
  console.log(`║  Dashboard: ${status.dashboard.padEnd(38)} ║`);
  if (status.dashboardUrl) {
    console.log(`║  Web UI:     ${status.dashboardUrl.padEnd(38)} ║`);
    console.log(`║  WS API:     ${(status.wsApi ?? '').padEnd(38)} ║`);
  }
  console.log('╚════════════════════════════════════════════════════════╝');
  return { success: true, message: 'Status displayed', data: status };
}

function cmdFix(args: string[]): CommandResult {
  const dryRun = args.includes('--dry-run');
  console.log(`[GV] Fixing PS1 references${dryRun ? ' (dry-run)' : ''}...`);
  try {
    const mode = args.includes('--configs')
      ? 'src/tools/auto-ps1-fixer-configs.ts'
      : 'src/tools/auto-ps1-fixer.ts';
    const cmd = dryRun ? `npx tsx ${mode} --dry-run` : `npx tsx ${mode}`;
    runSyncShell(cmd, { cwd: ROOT, stdio: 'inherit' });
    return { success: true, message: 'Fix completed' };
  } catch (e) {
    return { success: false, message: `Fix failed: ${e}` };
  }
}

// ─── Release Profiling (Roadmap 4.2) ─────────────────────────────────

export interface GateProfile {
  name: string;
  duration_ms: number;
  status: 'pass' | 'fail' | 'skip';
  exit_code: number;
}

export interface ReleaseReport {
  command: string;
  timestamp: string;
  total_ms: number;
  gates: GateProfile[];
  allPassed: boolean;
  exitCode: number;
}

export interface GateSpec {
  name: string;
  cmd?: string;
  args?: string[];
  skip?: boolean;
}

export const COMMANDS = [
  'check',
  'validate',
  'info',
  'list',
  'health',
  'prune',
  'backup',
  'optimize',
  'new',
  'update',
  'update-all',
  'sync',
  'tools',
  'secret',
  'cache',
  'session',
  'dashboard',
  'cleanup',
  'status',
  'fix',
  'release',
  'loop-guard',
  'metrics',
  'web',
  'eval',
  'skill',
  'telemetry',
  'help',
] as const;

export function makeGateProfile(name: string, exitCode: number, durationMs: number): GateProfile {
  return {
    name,
    duration_ms: durationMs,
    status: exitCode === 0 ? 'pass' : 'fail',
    exit_code: exitCode,
  };
}

export function skipGate(name: string): GateProfile {
  return { name, duration_ms: 0, status: 'skip', exit_code: 0 };
}

export function runGate(
  name: string,
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeout?: number } = {},
): GateProfile {
  const start = Date.now();
  let exitCode = 0;
  try {
    const r = runSync(cmd, args, {
      cwd: opts.cwd ?? ROOT,
      timeout: opts.timeout ?? 120000,
    });
    exitCode = r.status ?? 1;
  } catch {
    exitCode = 1;
  }
  return makeGateProfile(name, exitCode, Date.now() - start);
}

export function aggregateStatus(gates: GateProfile[]): 'pass' | 'fail' {
  return gates.some((g) => g.status === 'fail') ? 'fail' : 'pass';
}

export function computeExitCode(gates: GateProfile[]): number {
  return aggregateStatus(gates) === 'fail' ? 1 : 0;
}

export function sortGatesByDuration(gates: GateProfile[]): GateProfile[] {
  return [...gates].sort((a, b) => b.duration_ms - a.duration_ms);
}

export function buildReleaseReport(gates: GateProfile[]): ReleaseReport {
  const total_ms = gates.reduce((sum, g) => sum + g.duration_ms, 0);
  const allPassed = aggregateStatus(gates) === 'pass';
  return {
    command: 'release',
    timestamp: new Date().toISOString(),
    total_ms,
    gates,
    allPassed,
    exitCode: allPassed ? 0 : 1,
  };
}

export function selectReleaseGates(skipTests: boolean): GateSpec[] {
  const specs: GateSpec[] = [
    { name: 'Homologation Gate', cmd: 'npx', args: ['tsx', 'src/sdd/check-sdd-gate.ts'] },
    {
      name: 'RDD Release Gate',
      cmd: 'npx',
      args: ['tsx', 'src/rdd/rdd-gates.ts', 'validate', 'release'],
    },
  ];
  if (skipTests) {
    specs.push({ name: 'Tests Gate', skip: true });
  } else {
    specs.push({ name: 'Tests Gate', cmd: 'npm', args: ['run', 'test:config'] });
  }
  specs.push({
    name: 'Secrets Gate',
    cmd: 'npm',
    args: ['run', 'scan:secrets', '--', '--scan', 'src', '--json'],
  });
  return specs;
}

export function releaseCommand(args: string[]): ReleaseReport {
  const skipTests = args.includes('--skip-tests');
  const gates = selectReleaseGates(skipTests).map((spec) =>
    spec.skip ? skipGate(spec.name) : runGate(spec.name, spec.cmd ?? '', spec.args ?? []),
  );
  return buildReleaseReport(gates);
}

function printReleaseReport(report: ReleaseReport): void {
  for (const g of report.gates) {
    const status = g.status === 'skip' ? 'SKIP' : g.status === 'pass' ? 'PASS' : 'FAIL';
    console.log(`[PROFILE] ${g.name}: ${(g.duration_ms / 1000).toFixed(2)}s [${status}]`);
  }
  console.log('');
  console.log('Release Profile Summary:');
  console.log(`  Total: ${(report.total_ms / 1000).toFixed(2)}s`);
  console.log('  Gates (by duration):');
  sortGatesByDuration(report.gates).forEach((g, i) => {
    const status = g.status === 'skip' ? 'SKIP' : g.status === 'pass' ? 'PASS' : 'FAIL';
    console.log(`    ${i + 1}. ${g.name}: ${(g.duration_ms / 1000).toFixed(2)}s [${status}]`);
  });
  console.log(`  Result: ${report.allPassed ? 'PASS' : 'FAIL'}`);
}

async function main(): Promise<void> {
  switch (command) {
    case 'help':
    case '--help':
      showHelp();
      process.exit(0);
      break;

    case 'info':
      showInfo();
      process.exit(0);
      break;

    case 'check':
      runCommandExit(
        'npx',
        ['tsx', 'src/core/maintenance-watchtower.ts', '--action', 'health'],
        'WATCHTOWER',
      );
      break;

    case 'validate': {
      header();
      let ok = true;
      console.log('Validating Gentle-Vanguard Stack...\n');

      // Check root
      if (existsSync(ROOT)) {
        console.log('  [OK] Root exists');
      } else {
        console.log('  [FAIL] Root not found');
        ok = false;
      }

      // Check skills
      if (existsSync(SKILLS_DIR)) {
        const count = readdirSync(SKILLS_DIR, { withFileTypes: true }).filter((d) =>
          d.isDirectory(),
        ).length;
        console.log(`  [OK] ${count} skills`);
      } else {
        console.log('  [FAIL] Skills directory missing');
        ok = false;
      }

      // Check Nexus DB
      const dbPath = join(ROOT, '.runtime', 'gentle-vanguard.db');
      if (existsSync(dbPath)) {
        console.log('  [OK] Nexus DB present');
      } else {
        console.log('  [WARN] Nexus DB not found (will be created on first use)');
      }

      // Check npm scripts
      try {
        const r = runSync('npm', ['run', 'typecheck'], { timeout: 60000 });
        if (r.status === 0) console.log('  [OK] TypeScript typecheck passes');
        else {
          console.log('  [FAIL] TypeScript typecheck failed');
          ok = false;
        }
      } catch {
        console.log('  [FAIL] TypeScript typecheck failed');
        ok = false;
      }

      // Check git
      try {
        const r = runSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 5000 });
        const branch = (r.stdout ?? '').toString().trim();
        console.log(`  [OK] Git branch: ${branch}`);
      } catch {
        console.log('  [WARN] Not a git repository');
      }

      console.log('');
      console.log(ok ? 'Validation PASSED' : 'Validation FAILED');
      if (!ok) process.exit(1);
      break;
    }

    case 'list': {
      header();
      if (existsSync(SKILLS_DIR)) {
        const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .sort((a, b) => a.name.localeCompare(b.name));
        console.log('Installed Skills:\n');
        for (const d of dirs) {
          console.log(`  ${d.name}`);
        }
        console.log(`\nTotal: ${dirs.length} skills`);
      } else {
        console.log('No skills directory found');
      }
      footer();
      break;
    }

    case 'health':
      // Full stack health (watchtower) — aligns with `check`. Use `gv health --db`
      // for Nexus DB-only health.
      if (args.includes('--db')) {
        runCommandExit('npm', ['run', 'db:health'], 'NEXUS');
      } else {
        runCommandExit(
          'npx',
          ['tsx', 'src/core/maintenance-watchtower.ts', '--action', 'health'],
          'WATCHTOWER',
        );
      }
      break;

    case 'prune':
      runCommand('npm', ['run', 'db:prune'], 'NEXUS');
      break;

    case 'backup':
      runCommand('npm', ['run', 'db:backup'], 'NEXUS');
      break;

    case 'optimize':
      runCommand('npm', ['run', 'db:optimize'], 'NEXUS');
      break;

    case 'new':
      header();
      console.log('Project scaffolding:\n');
      console.log('  Use the SDD workflow:');
      console.log('    1. npx tsx src/session/session-autostart.ts');
      console.log('    2. Load skill: spec-driven-development, planning-and-task-breakdown');
      console.log('    3. Ask the orchestrator to create a new project\n');
      footer();
      break;

    case 'update':
    case 'sync':
      header();
      console.log('Updating stack...\n');
      runCommand('git', ['pull', 'origin', 'develop'], 'GIT');
      runCommand('npm', ['update'], 'NPM');
      footer();
      break;

    case 'update-all':
      header();
      console.log('Full stack update...\n');
      runCommand('git', ['pull', 'origin', 'develop'], 'GIT');
      runCommand('npm', ['update'], 'NPM');
      runCommand('npm', ['run', 'db:optimize'], 'NEXUS');
      footer();
      break;

    case 'tools': {
      header();
      console.log('Available Tools:\n');
      const tools = [
        {
          name: 'opencode',
          desc: 'opencode CLI (code editing)',
          command: 'opencode',
          args: ['--version'],
        },
        {
          name: 'engram',
          desc: 'Persistent memory (plugin)',
          command: 'npx',
          args: ['engram', '--version'],
        },
        { name: 'node', desc: 'Node.js runtime', command: 'node', args: ['--version'] },
        { name: 'npx', desc: 'Node package executor', command: 'npx', args: ['--version'] },
      ];
      for (const t of tools) {
        try {
          const r = runSync(t.command, t.args, { timeout: 5000 });
          const ver = (r.stdout ?? '').toString().trim().split('\n')[0];
          if (r.status === 0) console.log(`  [OK]    ${t.name.padEnd(12)} ${ver}`);
          else console.log(`  [MISS]  ${t.name.padEnd(12)} ${t.desc}`);
        } catch {
          console.log(`  [MISS]  ${t.name.padEnd(12)} ${t.desc}`);
        }
      }
      console.log('\n  All tools are optional. The stack works without them.');
      footer();
      break;
    }

    case 'secret':
      header();
      console.log('Secret Management:\n');
      console.log('  Secrets are managed via engram memory (secure, persistent).');
      console.log('  Use: npx tsx src/cli/gv.ts info  to check stack status.\n');
      console.log('  For credential storage, use your OS keychain or engram vault.\n');
      footer();
      break;

    case 'cache':
      runCommand('npm', ['run', 'db:health'], 'NEXUS (cache lives in Nexus DB)');
      break;

    case 'session': {
      const r = cmdSession(args.slice(1));
      if (r.message) console.log(r.message);
      process.exit(r.success ? 0 : 1);
      break;
    }

    case 'dashboard': {
      const r = cmdDashboard(args.slice(1));
      if (r.message) console.log(r.message);
      process.exit(r.success ? 0 : 1);
      break;
    }

    case 'cc': {
      const r = cmdCc(args.slice(1));
      if (r.message) console.log(r.message);
      process.exit(r.success ? 0 : 1);
      break;
    }

    case 'cleanup': {
      const r = cmdCleanup(args.slice(1));
      console.log(r.message);
      process.exit(r.success ? 0 : 1);
      break;
    }

    case 'status': {
      const r = cmdStatus(args.slice(1));
      process.exit(r.success ? 0 : 1);
      break;
    }

    case 'fix': {
      const r = cmdFix(args.slice(1));
      if (r.message) console.log(r.message);
      process.exit(r.success ? 0 : 1);
      break;
    }

    case 'release': {
      const report = releaseCommand(args.slice(1));
      if (args.includes('--json')) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        printReleaseReport(report);
      }
      process.exit(report.exitCode);
      break;
    }

    case 'loop-guard': {
      header();
      const r = runSync('npx', ['tsx', 'src/core/orchestrator-loop-guard.ts'], {
        timeout: 5000,
        cwd: ROOT,
      });
      console.log((r.stdout ?? '').toString());
      if (r.status !== 0) console.log('Loop-guard: no loop detected (self-test passed)');
      else console.log('Loop-guard self-test indicates break condition (review output)');
      footer();
      process.exit(r.status === 0 ? 0 : 1);
      break;
    }

    case 'metrics': {
      header();
      const m = getLiveMetrics() as Record<string, unknown>;
      if (Object.keys(m).length === 0) {
        console.log('No metrics file found at config/stack-metrics.json');
      } else {
        console.log(JSON.stringify(m, null, 2));
      }
      footer();
      break;
    }

    case 'web': {
      const webArgs = args.slice(1);
      if (webArgs.length === 0) {
        console.log(
          'Usage: gv web search --query "..." | gv web scrape --url <url> | gv web health',
        );
        process.exit(1);
      }
      try {
        const r = runSync('npx', ['tsx', 'src/web/web-crawler-cli.ts', ...webArgs], {
          timeout: 30000,
          cwd: ROOT,
        });
        const out = (r.stdout ?? '').toString().trim();
        if (out) console.log(out);
        if (r.stderr) console.error((r.stderr ?? '').toString().trim());
        process.exit(r.status ?? 0);
      } catch (e) {
        console.error(`[WEB] FAILED: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
      break;
    }

    case 'eval': {
      const evalArgs = args.slice(1);
      if (evalArgs.length === 0 || evalArgs.includes('--help')) {
        console.log(
          'Usage: gv eval [--gate] [--threshold N] [--limit N] [--json] [--db PATH]',
        );
        console.log('  Runs continuous evaluation over real Nexus traces (F3.1).');
        console.log('  --gate exits 1 if the aggregate score regresses beyond --threshold % (default 5).');
        process.exit(0);
      }
      try {
        const r = runSync('npx', ['tsx', 'src/eval/continuous-eval-cli.ts', ...evalArgs], {
          timeout: 120000,
          cwd: ROOT,
        });
        const out = (r.stdout ?? '').toString().trim();
        if (out) console.log(out);
        if (r.stderr) console.error((r.stderr ?? '').toString().trim());
        process.exit(r.status ?? 0);
      } catch (e) {
        console.error(`[EVAL] FAILED: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
      break;
    }

    case 'telemetry': {
      const tArgs = args.slice(1);
      if (tArgs.length === 0 || tArgs.includes('--help')) {
        console.log('Usage: gv telemetry --session <id> | --trace <id> [--from --to --no-tokens --json]');
        console.log('  Unified correlation timeline: session_id ↔ trace_id ↔ token usage (F3.6).');
        process.exit(0);
      }
      try {
        const r = runSync('npx', ['tsx', 'src/telemetry/correlation-cli.ts', ...tArgs], {
          timeout: 60000,
          cwd: ROOT,
        });
        const out = (r.stdout ?? '').toString().trim();
        if (out) console.log(out);
        if (r.stderr) console.error((r.stderr ?? '').toString().trim());
        process.exit(r.status ?? 0);
      } catch (e) {
        console.error(`[TELEMETRY] FAILED: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
      break;
    }

    case 'skill': {
      // Skill plugin lifecycle (F3.4) — delegates to src/plugins/skill-cli.ts
      // via runNpxTsxSync (in-process tsx loader: no shell, no .cmd shim,
      // windowsHide enforced per AGENTS.md procesos-ocultos).
      const skillArgs = args.slice(1);
      if (skillArgs.length === 0) {
        console.log(
          'Usage: gv skill <list|install|enable|disable|deprecate|remove|verify|get> [args] [--json]',
        );
        process.exit(1);
      }
      const r = runNpxTsxSync('src/plugins/skill-cli.ts', skillArgs, {
        cwd: ROOT,
        timeout: 180000,
      });
      const out = (r.stdout ?? '').toString().trim();
      if (out) console.log(out);
      if (r.stderr) console.error((r.stderr ?? '').toString().trim());
      process.exit(r.status ?? 0);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('FATAL:', err.message);
    process.exit(1);
  });
}
