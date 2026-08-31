import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getStateBridge } from '../shared-state-bridge.ts';
import { ROOT } from '../shared.ts';
import {
  dashboardAuth,
  deploymentTenant,
  wsTenants,
  connPerIp,
  MAX_CONN_PER_IP,
  dashboardTelemetry,
  clients,
  sendJson,
  MAX_WS_MESSAGE_BYTES,
  bridgeReady,
  agentSubscriptions,
} from './context.ts';
import { generateMetrics } from './metrics.ts';
import { handleAgentCommand } from './skill-execution.ts';

export function registerConnectionHandler(wss: WebSocketServer): void {
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    if (!dashboardAuth.authenticate(req)) {
      ws.close(1008, 'Unauthorized');
      return;
    }
    wsTenants.set(ws, deploymentTenant);
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'unknown';
    const current = connPerIp.get(ip) || 0;
    if (current >= MAX_CONN_PER_IP) {
      console.log(`[WS] Blocked excessive connection from ${ip} (${current})`);
      ws.close(1013, 'Too many connections');
      return;
    }
    connPerIp.set(ip, current + 1);
    dashboardTelemetry.wsConnectionsTotal++;
    dashboardTelemetry.wsConnectionsPeak = Math.max(
      dashboardTelemetry.wsConnectionsPeak,
      clients.size + 1,
    );
    console.log(`[WS] Client connected (${ip}, conns: ${current + 1})`);
    clients.add(ws);
    sendJson(ws, { type: 'metrics', data: generateMetrics(wsTenants.get(ws)?.tenantId) });
    sendJson(ws, { type: 'bridge_status', connected: bridgeReady });

    // Send current state to newly connected client
    const stateBridge = getStateBridge();
    sendJson(ws, { type: 'state_tasks', tasks: stateBridge.tasks });
    try {
      const historyPath = join(ROOT, '.event-bus', 'history.json');
      if (existsSync(historyPath)) {
        const history = JSON.parse(readFileSync(historyPath, 'utf-8'));
        sendJson(ws, { type: 'state_history', events: (history.events || []).slice(0, 20) });
      }
    } catch (e) {
      console.warn('[WS] Failed to send state history to new client:', (e as Error).message);
    }

    ws.on('message', (raw: Buffer | string) => {
      if (Buffer.byteLength(raw.toString(), 'utf8') > MAX_WS_MESSAGE_BYTES) {
        ws.close(1009, 'Message too large');
        return;
      }
      try {
        const parsed = JSON.parse(raw.toString());

        if (parsed.type === 'ping') {
          sendJson(ws, { type: 'pong' });
          return;
        }

        if (parsed.type === 'agent') {
          void handleAgentCommand(ws, parsed);
          return;
        }
      } catch {
        // Ignore invalid messages
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      const prev = connPerIp.get(ip) || 1;
      if (prev <= 1) connPerIp.delete(ip);
      else connPerIp.set(ip, prev - 1);
      for (const [, subs] of agentSubscriptions) {
        subs.delete(ws);
      }
    });
  });
}
