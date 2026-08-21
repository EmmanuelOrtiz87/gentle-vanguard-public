import { existsSync, readFileSync } from 'fs';
import { join, resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import type { IncomingMessage, ServerResponse } from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '../../..');
const FED_CONFIG = join(ROOT, 'config', 'federation-config.json');

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
    let servers: MeshServer[] = [];

    if (existsSync(regPath)) {
      try {
        const reg = JSON.parse(readFileSync(regPath, 'utf-8'));
        servers = (reg.servers || []).map((s: any) => {
          const lockPath = join(ws.path, '.runtime', 'mcp', `${s.name}.pid`);
          let pid: number | null = null;
          let status = 'stopped';

          if (existsSync(lockPath)) {
            try {
              pid = parseInt(readFileSync(lockPath, 'utf-8').trim(), 10);
              // Use cross-platform Node.js check instead of PowerShell
              status = isProcessRunning(pid) ? 'running' : 'error';
              if (status === 'error') pid = null;
            } catch {
              status = 'error';
              pid = null;
            }
          } else if (s.autoStart) {
            status = 'error';
          }

          return {
            name: s.name,
            type: s.type || 'user',
            status,
            pid,
            autoStart: s.autoStart || false,
            description: s.description || '',
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
