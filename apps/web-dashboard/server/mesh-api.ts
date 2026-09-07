import { existsSync, readFileSync } from 'fs';
import { join, resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import type { IncomingMessage, ServerResponse } from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '../../..');
const FED_CONFIG = join(ROOT, 'config', 'federation-config.json');
const MCP_POLICY = join(ROOT, 'config', 'mcp-lifecycle-policy.json');

function readLifecyclePolicy(): Record<string, Record<string, string>> {
  try {
    const policy = JSON.parse(readFileSync(MCP_POLICY, 'utf-8')) as {
      servers?: Record<string, Record<string, string>>;
    };
    return policy.servers || {};
  } catch {
    return {};
  }
}

// Utility to check if process is running (cross-platform stub)
function isProcessRunning(pid: number): boolean {
  try {
    // Node.js built-in check - works on all platforms
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

interface MeshServer {
  name: string;
  type: string;
  status: string;
  pid: number | null;
  autoStart: boolean;
  description: string;
  lifecycle: string;
  management: string;
  verification: string;
  stateReason: string;
}

interface MeshWorkspace {
  name: string;
  path: string;
  servers: MeshServer[];
  status: string;
  error?: string;
}

function getMeshWorkspaces(): MeshWorkspace[] {
  const workspaces: { name: string; path: string }[] = [];

  const local = { name: basename(ROOT), path: ROOT };
  workspaces.push(local);

  if (existsSync(FED_CONFIG)) {
    try {
      const cfg = JSON.parse(readFileSync(FED_CONFIG, 'utf-8'));
      const peers = cfg.peers || [];
      const known = cfg.discovery?.knownWorkspaces || [];
      for (const w of [...peers, ...known]) {
        if (w.path && w.name && !workspaces.some((x) => x.path === w.path)) {
          workspaces.push({ name: w.name, path: w.path });
        }
      }
    } catch {
      /* best-effort */
    }
  }

  return workspaces.map((ws) => {
    const regPath = join(ws.path, 'config', 'mcp-registry.json');
    const lifecyclePolicy = readLifecyclePolicy();
    let servers: MeshServer[] = [];

    if (existsSync(regPath)) {
      try {
        const reg = JSON.parse(readFileSync(regPath, 'utf-8'));
        servers = (reg.servers || []).map((s: any) => {
          // Registry names historically use `engram-mcp`, while host configs
          // use `engram`; normalize aliases before reporting lifecycle state.
          const policy =
            lifecyclePolicy[s.name] || lifecyclePolicy[s.name.replace(/-mcp$/, '')] || {};
          const lockPath = join(ws.path, '.runtime', 'mcp', `${s.name}.pid`);
          let pid: number | null = null;
          let status = 'stopped';
          let stateReason = 'not-observed';

          if (existsSync(lockPath)) {
            try {
              pid = parseInt(readFileSync(lockPath, 'utf-8').trim(), 10);
              // Use cross-platform Node.js check instead of PowerShell
              if (isProcessRunning(pid)) {
                status = 'running';
                stateReason = 'pid-alive';
              } else {
                status = 'stopped';
                stateReason = 'stale-pid';
                pid = null;
              }
            } catch {
              status = 'stopped';
              stateReason = 'invalid-pid';
              pid = null;
            }
          } else if (s.autoStart) {
            // autoStart means configured for startup, not proof that the
            // process is not observed. This is not an error for host-managed
            // stdio MCPs; the host may start them only when a tool is called.
            status = 'stopped';
            stateReason = 'configured-not-observed';
          }

          return {
            name: s.name,
            type: s.type || 'user',
            status,
            pid,
            autoStart: s.autoStart || false,
            description: s.description || '',
            lifecycle: policy.activation || 'unspecified',
            management: policy.management || 'unknown',
            verification: policy.verification || 'not-configured',
            stateReason,
          };
        });
      } catch {
        /* best-effort */
      }
    }

    const hasError = servers.some((s) => s.status === 'error');
    const hasRunning = servers.some((s) => s.status === 'running');
    const status = hasError ? 'degraded' : hasRunning ? 'healthy' : 'inactive';

    return { name: ws.name, path: ws.path, servers, status };
  });
}

export function meshHandler(
  _req: IncomingMessage,
  res: ServerResponse,
  headers: Record<string, string>,
) {
  const workspaces = getMeshWorkspaces();
  res.writeHead(200, headers);
  res.end(JSON.stringify({ type: 'mesh', data: { workspaces } }));
}

export function meshDiscoverHandler(
  _req: IncomingMessage,
  res: ServerResponse,
  headers: Record<string, string>,
) {
  // Mesh scan script is deprecated (PS1 -> TS migration)
  // Discovery is now done via direct workspace registry polling
  const workspaces = getMeshWorkspaces();
  res.writeHead(200, headers);
  res.end(
    JSON.stringify({
      type: 'mesh',
      data: { workspaces, message: 'Mesh discovery completed via registry polling' },
    }),
  );
}

export function meshSyncHandler(
  _req: IncomingMessage,
  res: ServerResponse,
  headers: Record<string, string>,
) {
  // Mesh sync script is deprecated (PS1 -> TS migration)
  // Sync is now done via direct workspace registry polling
  const workspaces = getMeshWorkspaces();
  res.writeHead(200, headers);
  res.end(
    JSON.stringify({
      type: 'mesh',
      data: { workspaces, message: 'Mesh sync completed via registry polling' },
    }),
  );
}
