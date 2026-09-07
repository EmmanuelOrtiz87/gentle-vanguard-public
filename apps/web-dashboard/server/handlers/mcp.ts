import type { IncomingMessage, ServerResponse } from 'http';
import type { URL } from 'url';
import { countSkills } from '../shared.ts';
import {
  mcpServersHandler,
  mcpServerActionHandler,
  mcpServerRegisterHandler,
} from '../mcp-gateway-api.ts';
import { REGISTRY_PATH } from '../ws-hub/context.ts';
import { loadStats } from '../ws-hub/metrics.ts';

export async function mcpHandler(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: typeof import('../ws-hub/context.ts'),
  headers: Record<string, string>,
): Promise<boolean> {
  if (url.pathname === '/api/mcp/metrics') {
    res.writeHead(200, headers);
    res.end(
      JSON.stringify({
        type: 'mcp',
        data: { skills: countSkills(REGISTRY_PATH), calls: loadStats() },
      }),
    );
    return true;
  }

  if (url.pathname === '/api/mcp/servers' && req.method === 'POST') {
    mcpServerRegisterHandler(req, res, headers);
    return true;
  }

  if (url.pathname === '/api/mcp/servers') {
    mcpServersHandler(req, res, headers);
    return true;
  }

  if (url.pathname.match(/^\/api\/mcp\/servers\/([^/]+)\/(start|stop)$/)) {
    mcpServerActionHandler(req, res, headers);
    return true;
  }

  return false;
}
