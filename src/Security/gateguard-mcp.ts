#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runSync } from '../core/run-command.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ServerState {
  ConsecutiveFailures: number;
  LastFailure: { Timestamp: string; Reason: string } | null;
}

interface GateGuardState {
  [server: string]: ServerState;
}

interface HealthResult {
  Server: string;
  Status: 'healthy' | 'unhealthy';
  LatencyMs: number;
  LastFailure: { Timestamp: string; Reason: string } | null;
  Reason?: string;
}

function parseArgs(): { server: string; retry: boolean } {
  const args = process.argv.slice(2);
  let server = '';
  let retry = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--server':
        server = args[++i] || '';
        break;
      case '--retry':
        retry = true;
        break;
      case '-Server':
        server = args[++i] || '';
        break;
      case '-Retry':
        retry = true;
        break;
    }
  }

  if (!server) {
    console.error('Usage: gateguard-mcp.ts --server <name> [--retry]');
    process.exit(1);
  }

  return { server, retry };
}

function getStateFilePath(): string {
  return join(__dirname, '.gateguard-state.json');
}

function getState(): GateGuardState {
  const stateFile = getStateFilePath();
  if (existsSync(stateFile)) {
    try {
      const raw = readFileSync(stateFile, 'utf-8');
      return JSON.parse(raw) as GateGuardState;
    } catch {
      return {};
    }
  }
  return {};
}

function saveState(state: GateGuardState): void {
  writeFileSync(getStateFilePath(), JSON.stringify(state, null, 2), 'utf-8');
}

function getProjectRoot(): string {
  return resolve(__dirname, '..', '..');
}

function sleep(ms: number): void {
  const target = Date.now() + ms;
  while (Date.now() < target) {
    /* busy-wait */
  }
}

function main(): void {
  const { server, retry } = parseArgs();
  const state = getState();
  let serverState: ServerState = state[server];

  if (!serverState) {
    serverState = { ConsecutiveFailures: 0, LastFailure: null };
    state[server] = serverState;
  }

  if (serverState.ConsecutiveFailures >= 3) {
    const result: HealthResult = {
      Server: server,
      Status: 'unhealthy',
      LatencyMs: 0,
      LastFailure: serverState.LastFailure,
      Reason: `Marked unhealthy after ${serverState.ConsecutiveFailures} consecutive failures`,
    };
    console.log(JSON.stringify(result));
    process.exit(0);
  }

  const start = Date.now();
  let healthy = false;
  let failureReason: string | null = null;
  let latency = 0;

  try {
    if (server === 'codegraph') {
      const proc = runSync('codegraph', ['status'], { stdio: 'pipe' });
      if (proc.status === 0) {
        healthy = true;
      } else {
        throw new Error(`codegraph status returned exit code ${proc.status}`);
      }
    } else {
      const serverDir = join(getProjectRoot(), 'scripts', 'mcp');
      const serverJs = join(serverDir, `${server}-server.js`);
      if (existsSync(serverJs)) {
        const input = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
        const proc = runSync('node', [serverJs], { input, stdio: 'pipe' });
        if (proc.status === 0 || proc.status === null) {
          healthy = true;
        } else {
          throw new Error(`Server process exited with code ${proc.status}`);
        }
      } else {
        healthy = true;
      }
    }
    latency = Date.now() - start;
  } catch (e) {
    latency = Date.now() - start;
    failureReason = e instanceof Error ? e.message : String(e);

    if (retry && serverState.ConsecutiveFailures === 0) {
      sleep(500);
      try {
        const retryStart = Date.now();
        if (server === 'codegraph') {
          const proc = runSync('codegraph', ['status'], { stdio: 'pipe' });
          if (proc.status === 0) healthy = true;
        } else {
          const serverJs = join(getProjectRoot(), 'scripts', 'mcp', `${server}-server.js`);
          if (existsSync(serverJs)) {
            const input = JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/list',
              params: {},
            });
            runSync('node', [serverJs], { input, stdio: 'pipe' });
            healthy = true;
          }
        }
        latency = Date.now() - retryStart;
        failureReason = null;
      } catch (retryErr) {
        failureReason = `Retry failed: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`;
      }
    }
  }

  if (healthy) {
    serverState.ConsecutiveFailures = 0;
    serverState.LastFailure = null;
  } else {
    serverState.ConsecutiveFailures++;
    serverState.LastFailure = { Timestamp: new Date().toISOString(), Reason: failureReason! };
  }

  state[server] = serverState;
  saveState(state);

  const result: HealthResult = {
    Server: server,
    Status: healthy ? 'healthy' : 'unhealthy',
    LatencyMs: latency,
    LastFailure: serverState.LastFailure,
  };

  console.log(JSON.stringify(result));
}

if (
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith('gateguard-mcp.ts'))
) {
  main();
}
