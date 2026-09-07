import type { IncomingMessage, ServerResponse } from 'http';
import type { URL } from 'url';
import {
  meshHandler as meshApiHandler,
  meshDiscoverHandler,
  meshSyncHandler,
} from '../mesh-api.ts';

export async function meshHandler(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: typeof import('../ws-hub/context.ts'),
  headers: Record<string, string>,
): Promise<boolean> {
  if (url.pathname === '/api/mesh') {
    meshApiHandler(req, res, headers);
    return true;
  }

  if (url.pathname === '/api/mesh/discover' && req.method === 'POST') {
    meshDiscoverHandler(req, res, headers);
    return true;
  }

  if (url.pathname === '/api/mesh/sync' && req.method === 'POST') {
    meshSyncHandler(req, res, headers);
    return true;
  }

  return false;
}
