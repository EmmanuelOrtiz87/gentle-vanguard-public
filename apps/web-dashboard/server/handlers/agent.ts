import { existsSync, readFileSync } from 'fs';
import type { IncomingMessage, ServerResponse } from 'http';
import { join } from 'path';
import type { URL } from 'url';
import { getBridge } from '../mcp-bridge.ts';
import { getStateBridge } from '../shared-state-bridge.ts';
import { DatabaseManager, DEFAULT_TENANT_ID } from '../database/manager.ts';
import { ROOT } from '../shared.ts';
import { readJsonBody, RequestBodyTooLargeError, sessions } from '../ws-hub/context.ts';

export async function agentHandler(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: typeof import('../ws-hub/context.ts'),
  headers: Record<string, string>,
): Promise<boolean> {
  if (url.pathname === '/api/agent/tools') {
    const bridge = getBridge();
    res.writeHead(200, headers);
    res.end(JSON.stringify({ tools: bridge.tools, connected: bridge.connected }));
    return true;
  }

  if (url.pathname === '/api/agent/sessions') {
    // Live in-memory agent sessions first…
    const list: Array<{
      id: string;
      agent: string;
      status: string;
      messageCount: number;
      updatedAt: string;
      startedAt?: string;
      totalTokens?: number;
      cost?: number;
    }> = Array.from(sessions.values()).map((s) => ({
      id: s.id,
      agent: s.agent,
      status: s.status,
      messageCount: s.messages?.length ?? 0,
      updatedAt: s.updatedAt,
    }));
    // …then real historical sessions from Nexus (source of truth).
    try {
      const db = DatabaseManager.getInstance();
      const rows = db
        .getDb()
        .prepare(
          'SELECT id, tenant_id, agent, status, created_at, updated_at, tokens_used, cost, message_count FROM sessions WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT 50',
        )
        .all(DEFAULT_TENANT_ID) as Array<{
        id: string;
        agent: string | null;
        status: string | null;
        created_at: string;
        updated_at: string;
        tokens_used: number;
        cost: number;
        message_count: number;
      }>;
      const known = new Set(list.map((s) => s.id));
      for (const r of rows) {
        if (known.has(r.id)) continue;
        list.push({
          id: r.id,
          agent: r.agent || 'orchestrator',
          status: r.status === 'active' ? 'active' : 'idle',
          messageCount: r.message_count ?? 0,
          updatedAt: r.updated_at || r.created_at,
          startedAt: r.created_at,
          totalTokens: r.tokens_used ?? 0,
          cost: r.cost ?? 0,
        });
      }
    } catch {
      /* Nexus unavailable — live sessions only */
    }
    res.writeHead(200, headers);
    res.end(JSON.stringify({ sessions: list }));
    return true;
  }

  if (url.pathname === '/api/state/events') {
    res.writeHead(200, headers);
    try {
      const historyPath = join(ROOT, '.event-bus', 'history.json');
      if (existsSync(historyPath)) {
        const history = JSON.parse(readFileSync(historyPath, 'utf-8'));
        res.end(JSON.stringify({ events: history.events || [] }));
      } else {
        res.end(JSON.stringify({ events: [] }));
      }
    } catch {
      res.end(JSON.stringify({ events: [] }));
    }
    return true;
  }

  if (url.pathname === '/api/state/events/persisted') {
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    res.writeHead(200, headers);
    try {
      const events = await getStateBridge().getPersistedEvents(limit);
      res.end(JSON.stringify({ events, source: 'nexus' }));
    } catch {
      res.end(JSON.stringify({ events: [], source: 'nexus' }));
    }
    return true;
  }

  if (url.pathname === '/api/state/tasks') {
    res.writeHead(200, headers);
    const bridge = getStateBridge();
    res.end(JSON.stringify({ tasks: bridge.tasks }));
    return true;
  }

  if (url.pathname === '/api/state/emit' && req.method === 'POST') {
    try {
      const { event, payload } = await readJsonBody<{
        event?: string;
        payload?: Record<string, unknown>;
      }>(req);
      if (event) {
        getStateBridge().emitEvent(event, payload || {});
        res.writeHead(200, headers);
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(400, headers);
        res.end(JSON.stringify({ error: 'event field required' }));
      }
    } catch (e) {
      res.writeHead(e instanceof RequestBodyTooLargeError ? 413 : 400, headers);
      res.end(
        JSON.stringify({
          error: e instanceof RequestBodyTooLargeError ? 'Request body too large' : 'Invalid JSON',
        }),
      );
    }
    return true;
  }

  if (url.pathname.startsWith('/api/agent/session/')) {
    const sessionId = url.pathname.split('/').pop();
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session) {
      res.writeHead(404, headers);
      res.end(JSON.stringify({ error: 'Session not found' }));
      return true;
    }
    res.writeHead(200, headers);
    res.end(JSON.stringify({ session }));
    return true;
  }

  return false;
}
