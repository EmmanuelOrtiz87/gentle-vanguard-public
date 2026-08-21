import { existsSync, readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { IncomingMessage, ServerResponse } from 'http';
import { getExternalApiTimeouts } from '@gentle-vanguard/core/timeout-config';
import { runNpxTsxSync } from '@gentle-vanguard/core/run-command';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '../../..');
const GATEWAY_SCRIPT = join(ROOT, 'src', 'mcp', 'mcp-gateway.ts');
const MANAGER_SCRIPT = join(ROOT, 'src', 'mcp', 'mcp-manager.ts');
const REGISTRY_PATH = join(ROOT, 'config', 'mcp-registry.json');

function tsx(script: string): string {
  try {
    const timeout = getExternalApiTimeouts()?.mcp_request_ms ?? 15000;
    const result = runNpxTsxSync(script, [], { timeout });
    return result.status === 0 ? result.stdout : '';
  } catch {
    return '';
  }
}

export interface MCPServerEntry {
  name: string;
  type: string;
  transport: string;
  command: string;
  args: string[];
  enabled: boolean;
  autoStart: boolean;
  description: string;
  pid: number | null;
  status: string;
  uptime: number;
  toolsCount: number;
  lastError: string | null;
}

export function getMCPServersStatus(): MCPServerEntry[] {
  if (existsSync(GATEWAY_SCRIPT)) {
    const raw = tsx(`${GATEWAY_SCRIPT} --action status --quiet`);
    if (raw) {
      try {
        return JSON.parse(raw.trim())?.servers || [];
      } catch {
        /* fallthrough */
      }
    }
  }
  const registry = existsSync(REGISTRY_PATH)
    ? JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'))
    : { servers: [] };
  return (registry.servers || []).map((s: any) => ({
    name: s.name,
    type: s.type || 'user',
    transport: s.transport || 'stdio',
    command: s.command,
    args: s.args || [],
    enabled: s.enabled !== false,
    autoStart: s.autoStart || false,
    description: s.description || '',
    pid: null,
    status: 'unknown',
    uptime: 0,
    toolsCount: 0,
    lastError: null,
  }));
}

export function mcpServersHandler(
  _req: IncomingMessage,
  res: ServerResponse,
  headers: Record<string, string>,
) {
  const servers = getMCPServersStatus();
  res.writeHead(200, headers);
  res.end(JSON.stringify({ type: 'mcp-servers', data: { servers } }));
}

export function mcpServerActionHandler(
  req: IncomingMessage,
  res: ServerResponse,
  headers: Record<string, string>,
) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);
  const match = url.pathname.match(/^\/api\/mcp\/servers\/([^/]+)\/(start|stop)$/);
  if (!match) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const [, name, action] = match;
  if (!existsSync(MANAGER_SCRIPT)) {
    res.writeHead(500);
    res.end('Manager not found');
    return;
  }
  tsx(`${MANAGER_SCRIPT} --action ${action} --name ${name} --quiet`);
  res.writeHead(200, headers);
  res.end(JSON.stringify({ success: true, name, action }));
}

export function mcpServerRegisterHandler(
  req: IncomingMessage,
  res: ServerResponse,
  headers: Record<string, string>,
) {
  let body = '';
  req.on('data', (chunk: Buffer) => {
    body += chunk.toString();
  });
  req.on('end', () => {
    try {
      const payload = JSON.parse(body);
      if (!payload.name || !payload.command) {
        res.writeHead(400, headers);
        res.end(JSON.stringify({ error: 'name and command required' }));
        return;
      }
      const args = (payload.args || []).join(' ');
      const cmd = `${MANAGER_SCRIPT} --action register --name ${payload.name} --command ${payload.command} --args "${args}" --description "${payload.description || ''}" --quiet`;
      tsx(cmd);
      res.writeHead(200, headers);
      res.end(JSON.stringify({ success: true, name: payload.name }));
    } catch {
      res.writeHead(400, headers);
      res.end(JSON.stringify({ error: 'invalid JSON' }));
    }
  });
}
