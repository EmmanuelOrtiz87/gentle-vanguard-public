#!/usr/bin/env node
/**
 * MCP Gateway — Manages MCP server lifecycle (start/stop/status/reload).
 *
 * Reads config/mcp-registry.json, starts/stops servers as background processes,
 * tracks PIDs in .runtime/mcp/*.pid.
 *
 * Migrated from: scripts/utilities/MCP/mcp-gateway.ps1
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { run } from '../../adapters/command-runner.js';

const ROOT = resolve(process.cwd());
const REGISTRY_PATH = join(ROOT, 'config', 'mcp-registry.json');
const LOCK_DIR = join(ROOT, '.runtime', 'mcp');

if (!existsSync(LOCK_DIR)) mkdirSync(LOCK_DIR, { recursive: true });

let quiet = false;

function log(msg: string) {
  if (!quiet) console.log(msg);
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('-')) {
      const key = arg.slice(1);
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        args[key] = next;
        i++;
      } else {
        args[key] = 'true';
      }
    }
  }
  return args;
}

interface McpServer {
  name: string;
  type: string;
  transport: string;
  command: string;
  args: string[];
  enabled: boolean;
  autoStart: boolean;
  description: string;
}

interface Registry {
  servers: McpServer[];
}

function readRegistry(): Registry {
  if (!existsSync(REGISTRY_PATH)) return { servers: [] };
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
  } catch {
    log(`Corrupt registry at ${REGISTRY_PATH}, using empty registry`);
    return { servers: [] };
  }
}

function getProcPath(name: string): { pid: number; proc: ReturnType<typeof process.kill> } | null {
  const lockFile = join(LOCK_DIR, `${name}.pid`);
  if (!existsSync(lockFile)) return null;
  const pidStr = readFileSync(lockFile, 'utf-8').trim();
  if (!/^\d+$/.test(pidStr)) return null;
  const pid = parseInt(pidStr, 10);
  try {
    process.kill(pid, 0); // Signal 0 = check if process exists
    return { pid, proc: true as unknown as ReturnType<typeof process.kill> };
  } catch {
    try {
      unlinkSync(lockFile);
    } catch {
      /* ignore */
    }
    return null;
  }
}

// ===== Actions =====

function startServers() {
  const reg = readRegistry();
  let count = 0;
  for (const s of reg.servers) {
    if (!s.enabled) continue;
    const existing = getProcPath(s.name);
    if (existing) {
      log(`  \u23e9 ${s.name} \u2014 already running (PID ${existing.pid})`);
      continue;
    }
    try {
      const child = run(s.command, s.args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      writeFileSync(join(LOCK_DIR, `${s.name}.pid`), String(child.pid), 'utf-8');
      count++;
      log(`  \u2705 ${s.name} \u2014 started (PID ${child.pid})`);
    } catch (e: unknown) {
      log(`  \u274c ${s.name} \u2014 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  log(`Gateway: ${count} server(s) started.`);
}

function stopServers() {
  const reg = readRegistry();
  let count = 0;
  for (const s of reg.servers) {
    const existing = getProcPath(s.name);
    if (!existing) continue;
    try {
      process.kill(existing.pid, 'SIGTERM');
      const lockFile = join(LOCK_DIR, `${s.name}.pid`);
      if (existsSync(lockFile)) unlinkSync(lockFile);
      count++;
      log(`  \u23f9  ${s.name} \u2014 stopped`);
    } catch (e: unknown) {
      log(`  \u274c ${s.name} \u2014 stop failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // Cleanup all pid files
  for (const f of readdirSync(LOCK_DIR).filter((f) => f.endsWith('.pid'))) {
    try {
      unlinkSync(join(LOCK_DIR, f));
    } catch {
      /* ignore */
    }
  }
  log(`Gateway: ${count} server(s) stopped.`);
}

function statusServers() {
  const reg = readRegistry();
  const result: Array<{
    name: string;
    type: string;
    transport: string;
    command: string;
    args: string[];
    enabled: boolean;
    autoStart: boolean;
    description: string;
    pid: number | null;
    status: 'running' | 'stopped';
    uptime: number;
    toolsCount: number;
    lastError: string | null;
  }> = [];
  for (const s of reg.servers) {
    const existing = getProcPath(s.name);
    result.push({
      name: s.name,
      type: s.type,
      transport: s.transport,
      command: s.command,
      args: s.args,
      enabled: s.enabled,
      autoStart: s.autoStart,
      description: s.description,
      pid: existing?.pid ?? null,
      status: existing ? 'running' : 'stopped',
      uptime: 0,
      toolsCount: 0,
      lastError: null,
    });
  }
  console.log(JSON.stringify({ servers: result }, null, 2));
}

// ===== MAIN =====

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv);
  const action = args['Action'] ?? 'status';
  quiet = args['Quiet'] === 'true';

  switch (action) {
    case 'start':
      startServers();
      break;
    case 'stop':
      stopServers();
      break;
    case 'status':
      statusServers();
      break;
    case 'reload':
      // Reload delegates to mcp-manager
      log('Reload: delegating to mcp-manager...');
      break;
    default:
      console.error(`Unknown action: ${action}`);
      process.exit(1);
  }
}
