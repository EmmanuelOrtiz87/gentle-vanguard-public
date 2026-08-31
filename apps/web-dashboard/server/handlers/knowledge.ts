import type { IncomingMessage, ServerResponse } from 'http';
import type { URL } from 'url';
import { knowledgeHandler as knowledgeApiHandler } from '../knowledge-api.ts';

export async function knowledgeHandler(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: typeof import('../ws-hub/context.ts'),
  headers: Record<string, string>,
): Promise<boolean> {
  if (url.pathname === '/api/knowledge') {
    knowledgeApiHandler(req, res, headers);
    return true;
  }

  return false;
}
