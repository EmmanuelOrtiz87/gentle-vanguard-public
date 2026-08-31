#!/usr/bin/env node
/**
 * witr-wrapper.ts — TypeScript wrapper for the witr binary
 * (github.com/pranshuparmar/witr — "Why Is This Running?").
 *
 * witr traces processes, ports, containers and files back to their causal
 * chain (systemd → PM2 → node, etc.). This wrapper resolves the installed
 * binary, auto-installs it on first use, and exposes typed query methods.
 *
 * Usage:
 *   import { witr } from './web/witr-wrapper.js';
 *   const chain = await witr.traceProcess(1234);
 *   const portChain = await witr.tracePort(8080);
 *   const fileChain = await witr.traceFile('/var/lib/dpkg/lock');
 *   const containerChain = await witr.traceContainer('redis');
 *
 * CLI:
 *   npx tsx src/web/witr-cli.ts process <pid>
 *   npx tsx src/web/witr-cli.ts port <port>
 */

import { join } from 'path';
import { existsSync } from 'fs';
import { runNpxTsxSync, runSync } from '../core/run-command.js';
import { ROOT } from '../core/repo-root';
import { WITR_INSTALL_TIMEOUT } from './witr-installer.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CausalLink {
  pid: number;
  name: string;
  command: string;
}

export interface ProcessChain {
  pid: number;
  name: string;
  command: string;
  user?: string;
  startedAt?: string;
  workingDir?: string;
  gitRepo?: string;
  gitBranch?: string;
  source?: string;
  sourceName?: string;
  health?: string;
  causalChain: CausalLink[];
  warnings: string[];
  raw?: unknown;
}

export interface FileChain extends ProcessChain {
  path: string;
  openFiles?: number;
  fileLimit?: number;
  lockedFiles?: string[];
}

export interface ContainerChain extends ProcessChain {
  containerName: string;
  containerId?: string;
  runtime?: string;
  image?: string;
  state?: string;
  status?: string;
}

export interface WitrWrapper {
  traceProcess(pid: number): Promise<ProcessChain>;
  tracePort(port: number): Promise<ProcessChain>;
  traceFile(path: string): Promise<FileChain>;
  traceContainer(name: string): Promise<ContainerChain>;
}

// Raw witr JSON shape (Go model.Result — PascalCase keys preserved).
interface WitrProcess {
  PID: number;
  PPID: number;
  Command: string;
  Cmdline: string;
  Exe: string;
  StartedAt: string;
  User: string;
  WorkingDir: string;
  GitRepo: string;
  GitBranch: string;
  Health: string;
  Env: string[];
  Sockets: unknown;
}

interface WitrSource {
  Type: string;
  Name: string;
  Description: string;
  UnitFile: string;
  Details: Record<string, string> | null;
}

interface WitrResult {
  Target: { Type: string; Value: string };
  ResolvedTarget: string;
  Process: WitrProcess;
  RestartCount: number;
  Ancestry: WitrProcess[];
  Children?: WitrProcess[];
  Source: WitrSource;
  Warnings: string[];
  SocketInfo: unknown;
  ResourceContext: unknown;
  FileContext: { OpenFiles: number; FileLimit: number; LockedFiles: string[] } | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const WITR_VERSION = 'v0.3.3';

const TOOLS_DIR = join(ROOT, '.runtime', 'tools', 'witr');
const WITR_BIN = process.platform === 'win32' ? 'witr.exe' : 'witr';
export const WITR_BIN_PATH = join(TOOLS_DIR, WITR_BIN);
const INSTALLER_SCRIPT = join(ROOT, 'src', 'web', 'witr-installer.ts');

const SENSITIVE_ENV_PREFIXES = [
  'GH_',
  'GITHUB_',
  'TOKEN',
  'SECRET',
  'KEY',
  'AWS_',
  'AZURE_',
  'OPENAI_',
  'ANTHROPIC_',
];
const SENSITIVE_FIELD = /(env|headers?|args?|query|tokens?|secrets?|passwords?|keys?)/i;
const SENSITIVE_ASSIGNMENT =
  /(?:gh|github|gv_dashboard|opencode_server|authorization|[a-z0-9_-]*(?:token|secret|password|api[_-]?key))\s*[=:]\s*[^\s,;]+/gi;
const SENSITIVE_FLAG = /--?(?:token|secret|password|api[-_]?key)\s+[^\s]+/gi;
const SENSITIVE_AUTH = /\b(?:bearer|basic)\s+[^\s,;]+/gi;
const SENSITIVE_QUERY = /[?&](?:token|secret|password|api[-_]?key)=[^&\s]+/gi;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** True when the witr binary is present on disk. */
export function isWitrInstalled(): boolean {
  return existsSync(WITR_BIN_PATH);
}

export function isWitrCompatible(): boolean {
  if (!isWitrInstalled()) return false;
  try {
    const result = runSync(WITR_BIN_PATH, ['--version'], { timeout: 30_000 });
    return result.status === 0 && Boolean((result.stdout || result.stderr).trim());
  } catch {
    return false;
  }
}

/**
 * Install witr via the TypeScript installer if the binary is missing.
 * Returns true when witr is available afterwards.
 */
export function ensureWitrInstalled(): boolean {
  if (isWitrInstalled()) return true;
  if (!existsSync(INSTALLER_SCRIPT)) return false;

  try {
    const r = runNpxTsxSync(INSTALLER_SCRIPT, ['--quiet'], { timeout: WITR_INSTALL_TIMEOUT });
    return r.status === 0 && isWitrInstalled();
  } catch {
    return false;
  }
}

/** Run witr with `--json` and parse the result. Returns null on failure. */
function runWitrJson(args: string[]): WitrResult | null {
  ensureWitrInstalled();
  if (!isWitrInstalled()) return null;

  const r = runSync(WITR_BIN_PATH, [...args, '--json'], {
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (r.status === null || r.status > 2) return null;
  const stdout = (r.stdout ?? '').trim();
  if (!stdout) return null;

  try {
    return JSON.parse(stdout) as WitrResult;
  } catch {
    return null;
  }
}

function redactEnv(env: string[] | undefined): string[] {
  if (!env) return [];
  return env.map((entry) => {
    const eq = entry.indexOf('=');
    if (eq <= 0) return entry;
    const key = entry.slice(0, eq);
    const upper = key.toUpperCase();
    const sensitive = SENSITIVE_ENV_PREFIXES.some((p) => upper.includes(p));
    return sensitive ? '[REDACTED_ENV]' : entry;
  });
}

function redactText(value: string): string {
  return value
    .replace(SENSITIVE_ASSIGNMENT, '[REDACTED]')
    .replace(SENSITIVE_FLAG, '[REDACTED]')
    .replace(SENSITIVE_AUTH, '[REDACTED]')
    .replace(SENSITIVE_QUERY, '[REDACTED]');
}

export function sanitizeWitrOutput(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeWitrOutput(item));
  if (!value || typeof value !== 'object') return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_FIELD.test(key) || /^env$/i.test(key)) continue;
    sanitized[key] = sanitizeWitrOutput(item);
  }
  return sanitized;
}

function toCausalChain(ancestry: WitrProcess[] | undefined): CausalLink[] {
  if (!ancestry || ancestry.length === 0) return [];
  return ancestry.map((p) => ({
    pid: p.PID,
    name: redactText(p.Command || `pid ${p.PID}`),
    command: redactText(p.Cmdline || p.Command),
  }));
}

function mapProcess(result: WitrResult): ProcessChain {
  const p = result.Process;
  const sanitized = sanitizeWitrOutput({
    ...result,
    Process: { ...p, Env: redactEnv(p.Env) },
  });
  return {
    pid: p.PID,
    name: redactText(p.Command || result.ResolvedTarget),
    command: redactText(p.Cmdline || p.Command),
    user: redactText(p.User) || undefined,
    startedAt: redactText(p.StartedAt) || undefined,
    workingDir: redactText(p.WorkingDir) || undefined,
    gitRepo: redactText(p.GitRepo) || undefined,
    gitBranch: redactText(p.GitBranch) || undefined,
    source: redactText(result.Source?.Type ?? '') || undefined,
    sourceName: redactText(result.Source?.Name ?? '') || undefined,
    health: redactText(p.Health) || undefined,
    causalChain: toCausalChain(result.Ancestry),
    warnings: (result.Warnings ?? []).map((warning) => redactText(warning)),
    raw: sanitized,
  };
}

// ─── Wrapper implementation ──────────────────────────────────────────────────

class WitrWrapperImpl implements WitrWrapper {
  async traceProcess(pid: number): Promise<ProcessChain> {
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error(`Invalid PID: ${pid}`);
    }
    const result = runWitrJson(['--pid', String(pid)]);
    if (!result) {
      throw new Error(`witr could not trace PID ${pid} (binary missing or query failed)`);
    }
    return mapProcess(result);
  }

  async tracePort(port: number): Promise<ProcessChain> {
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(`Invalid port: ${port}`);
    }
    const result = runWitrJson(['--port', String(port)]);
    if (!result) {
      throw new Error(`witr could not trace port ${port} (binary missing or query failed)`);
    }
    return mapProcess(result);
  }

  async traceFile(path: string): Promise<FileChain> {
    if (!path) throw new Error('Empty file path');
    const result = runWitrJson(['--file', path]);
    if (!result) {
      throw new Error(`witr could not trace file ${path} (binary missing or query failed)`);
    }
    const chain = mapProcess(result);
    const fileChain = {
      ...chain,
      path,
      openFiles: result.FileContext?.OpenFiles,
      fileLimit: result.FileContext?.FileLimit,
      lockedFiles: result.FileContext?.LockedFiles,
    } as FileChain;
    return fileChain;
  }

  async traceContainer(name: string): Promise<ContainerChain> {
    if (!name) throw new Error('Empty container name');
    const result = runWitrJson(['--container', name]);
    if (!result) {
      throw new Error(`witr could not trace container ${name} (binary missing or query failed)`);
    }
    const chain = mapProcess(result);
    return {
      ...chain,
      containerName: name,
      containerId: undefined,
      runtime: undefined,
      image: undefined,
      state: undefined,
      status: undefined,
    } as ContainerChain;
  }
}

/** Shared singleton instance. */
export const witr: WitrWrapper = new WitrWrapperImpl();

// CLI mode
if (
  process.argv[1] &&
  (process.argv[1].endsWith('witr-wrapper.ts') || process.argv[1].endsWith('witr-wrapper.js'))
) {
  void (async () => {
    const [, , ...args] = process.argv;
    const command = args[0] ?? 'status';
    try {
      switch (command) {
        case 'process':
        case 'pid': {
          const chain = await witr.traceProcess(parseInt(args[1] ?? '0', 10));
          console.log(JSON.stringify(chain, null, 2));
          break;
        }
        case 'port': {
          const chain = await witr.tracePort(parseInt(args[1] ?? '0', 10));
          console.log(JSON.stringify(chain, null, 2));
          break;
        }
        case 'file': {
          const chain = await witr.traceFile(args[1] ?? '');
          console.log(JSON.stringify(chain, null, 2));
          break;
        }
        case 'container': {
          const chain = await witr.traceContainer(args[1] ?? '');
          console.log(JSON.stringify(chain, null, 2));
          break;
        }
        case 'install':
          console.log(ensureWitrInstalled() ? 'installed' : 'failed');
          break;
        case 'status':
          console.log(isWitrInstalled() ? `installed: ${WITR_BIN_PATH}` : 'not installed');
          break;
        default:
          console.error(
            'Usage: witr-wrapper.ts <process|pid|port|file|container|install|status> [target]',
          );
          process.exit(1);
      }
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  })();
}
