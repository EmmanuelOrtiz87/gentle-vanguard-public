import type { IncomingMessage, ServerResponse } from 'http';
import { existsSync, mkdirSync, readFileSync, watch } from 'fs';
import { join } from 'path';
import { getBridge } from './mcp-bridge.ts';
import { getStateBridge } from './shared-state-bridge.ts';
import { getOtelPipeline } from './otel-pipeline.ts';
import { can, resolveRoutePermission } from './rbac.ts';
import { ROOT } from './shared.ts';
import { validateTenantSelector } from '../../../src/integrations/deployment-tenant-context.ts';
import * as ctx from './ws-hub/context.ts';
import { loadSessions } from './ws-hub/session-store.ts';
import { registerConnectionHandler } from './ws-hub/connection.ts';
import { startBroadcastLoop, startMetricsWatcher } from './ws-hub/broadcast.ts';
import { authHandler } from './handlers/auth.ts';
import { adminHandler } from './handlers/admin.ts';
import { metricsHandler } from './handlers/metrics.ts';
import { mcpHandler } from './handlers/mcp.ts';
import { healthHandler } from './handlers/health.ts';
import { observabilityHandler } from './handlers/observability.ts';
import { knowledgeHandler } from './handlers/knowledge.ts';
import { meshHandler } from './handlers/mesh.ts';
import { agentHandler } from './handlers/agent.ts';
import { marketplaceHandler } from './handlers/marketplace.ts';
import { costsHandler } from './handlers/costs.ts';
import { continuationsHandler } from './handlers/continuations.ts';

const otelPipeline = getOtelPipeline();
let metricsWriterStarted = false;

process.on('uncaughtException', (err) => {
  console.error('[WS-ERROR] Uncaught exception:', err.message);
});
process.on('unhandledRejection', (err: unknown) => {
  console.error(
    '[WS-ERROR] Unhandled rejection:',
    err instanceof Error ? err.message : String(err),
  );
});

ctx.server.requestTimeout = 30_000;
ctx.server.headersTimeout = 10_000;
ctx.server.timeout = 30_000;
ctx.server.keepAliveTimeout = 5_000;
ctx.server.on('error', (err: Error) => console.error('[WS-ERROR] HTTP server:', err.message));

ctx.server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (!validateTenantSelector(ctx.deploymentTenant, url.searchParams.get('tenantId'))) {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  if (url.searchParams.has('token') || !ctx.dashboardAuth.authenticate(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  ctx.wss.handleUpgrade(req, socket, head, (ws) => ctx.wss.emit('connection', ws, req));
});
ctx.wss.on('error', (err: Error) => console.error('[WS-ERROR] WS server:', err.message));

registerConnectionHandler(ctx.wss);
startBroadcastLoop();
startMetricsWatcher();

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const configuredOrigins = (
    process.env.GV_DASHBOARD_CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const requestOrigin = req.headers.origin;
  const allowedOrigin =
    requestOrigin && configuredOrigins.includes(requestOrigin)
      ? requestOrigin
      : configuredOrigins[0];
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-GV-Dashboard-Token',
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  };
  const requestStartedAt = Date.now();
  ctx.dashboardTelemetry.httpRequests++;
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...headers, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
      res.end();
      return;
    }

    const publicHealth = url.pathname === '/api/health' && req.method === 'GET';
    const publicAuth =
      url.pathname === '/api/auth/status' ||
      url.pathname === '/api/auth/login' ||
      url.pathname === '/api/auth/logout';
    if (!publicHealth && !publicAuth && !ctx.dashboardAuth.authenticate(req)) {
      res.writeHead(401, { ...headers, 'WWW-Authenticate': 'Bearer' });
      res.end(JSON.stringify({ success: false, error: 'Dashboard authentication required' }));
      return;
    }

    if (await authHandler(req, res, url, ctx, headers)) return;

    if (await adminHandler(req, res, url, ctx, headers)) return;

    if (!validateTenantSelector(ctx.deploymentTenant, url.searchParams.get('tenantId'))) {
      res.writeHead(400, headers);
      res.end(
        JSON.stringify({
          success: false,
          error: 'Tenant selector does not match this deployment',
        }),
      );
      return;
    }

    // ─── Coarse RBAC guard (policy v1) ─────────────────────────────────
    // Reads require viewer; mutations require operator (admin endpoints are
    // handled above with their own admin gate + CSRF). Local-default/dev
    // loopback bypass keeps full access; production sessions without a bound
    // principal must re-login to acquire one.
    const routePermission = resolveRoutePermission(url.pathname, req.method ?? 'GET');
    if (routePermission && !ctx.devBypassActive(req)) {
      const access = ctx.resolveSessionAccess(req);
      if (!access || !can(access.role, routePermission)) {
        res.writeHead(403, headers);
        res.end(
          JSON.stringify({
            success: false,
            error: 'Insufficient dashboard role',
            required: routePermission,
            policyVersion: 1,
          }),
        );
        return;
      }
    }

    if (await metricsHandler(req, res, url, ctx, headers)) return;
    if (await mcpHandler(req, res, url, ctx, headers)) return;
    if (await healthHandler(req, res, url, ctx, headers)) return;
    if (await observabilityHandler(req, res, url, ctx, headers)) return;
    if (await knowledgeHandler(req, res, url, ctx, headers)) return;
    if (await meshHandler(req, res, url, ctx, headers)) return;
    if (await agentHandler(req, res, url, ctx, headers)) return;
    if (await marketplaceHandler(req, res, url, ctx, headers)) return;
    if (await costsHandler(req, res, url, ctx, headers)) return;
    if (await continuationsHandler(req, res, url, ctx, headers)) return;

    res.writeHead(404, headers);
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[WS-ERROR] handleRequest failed:', msg);
    try {
      res.writeHead(500, headers);
      res.end(JSON.stringify({ error: 'Internal server error' }));
    } catch {
      /* ignore write errors after crash */
    }
  } finally {
    const elapsedMs = Date.now() - requestStartedAt;
    ctx.dashboardTelemetry.httpLatencyTotalMs += elapsedMs;
    ctx.dashboardTelemetry.httpLatencyMaxMs = Math.max(
      ctx.dashboardTelemetry.httpLatencyMaxMs,
      elapsedMs,
    );
    ctx.dashboardTelemetry.httpStatusCounts.set(
      res.statusCode,
      (ctx.dashboardTelemetry.httpStatusCounts.get(res.statusCode) || 0) + 1,
    );
    if (res.statusCode >= 500) ctx.dashboardTelemetry.httpErrors++;
  }
}

ctx.server.on('request', handleRequest);

async function start() {
  loadSessions();
  // Start the unified OTel pipeline (spans ingest + metrics writer snapshots)
  otelPipeline.start();
  metricsWriterStarted = true;
  try {
    const mcpBridge = getBridge();
    await mcpBridge.start();
    ctx.setBridgeReady(true);
    ctx.setBridgeToolCount(mcpBridge.tools.length);
    console.log(`[MCP] Bridge connected — ${ctx.bridgeToolCount} tools available`);
  } catch {
    console.warn('[MCP] Bridge not available (MCP server not running)');
    ctx.setBridgeReady(false);
    ctx.setBridgeToolCount(0);
  }
}

function initSharedState(): void {
  const stateBridge = getStateBridge();
  stateBridge.on('history_update', (events: unknown) => {
    const msg = JSON.stringify({ type: 'state_history', events });
    ctx.clients.forEach((c) => ctx.safeSend(c, msg));
  });
  stateBridge.on('task_update', (tasks: unknown) => {
    const msg = JSON.stringify({ type: 'state_tasks', tasks });
    ctx.clients.forEach((c) => ctx.safeSend(c, msg));
  });
  stateBridge.on('event', (evt: unknown) => {
    const msg = JSON.stringify({ type: 'state_event', event: evt });
    ctx.clients.forEach((c) => ctx.safeSend(c, msg));
  });
  stateBridge.on('state_delta', (delta: unknown) => {
    const msg = JSON.stringify({ type: 'state_delta', ...(delta as object) });
    ctx.clients.forEach((c) => ctx.safeSend(c, msg));
  });
  stateBridge.on('task_delta', (delta: unknown) => {
    const msg = JSON.stringify({ type: 'task_delta', ...(delta as object) });
    ctx.clients.forEach((c) => ctx.safeSend(c, msg));
  });
  stateBridge.start();
  console.log('[STATE] Shared State Bridge started');
}

function startTraceWatcher(): void {
  const ctxDir = join(ROOT, '.session', 'context-log');
  if (!existsSync(ctxDir)) {
    mkdirSync(ctxDir, { recursive: true });
  }
  try {
    watch(ctxDir, { recursive: true }, (_eventType, filename) => {
      if (!filename || !filename.endsWith('.state.json')) return;
      const statePath = join(ctxDir, filename);
      try {
        const state = JSON.parse(readFileSync(statePath, 'utf-8'));
        const msg = JSON.stringify({
          type: 'trace_update',
          session: { id: state.sessionId || filename.split(/[\\/]/)[0], state },
        });
        ctx.clients.forEach((c) => ctx.safeSend(c, msg));
      } catch (e) {
        console.warn('[TRACE] Error parsing state file:', filename, (e as Error).message);
      }
    });
    console.log('[TRACE] Context-log watcher started');
  } catch (err) {
    console.warn('[TRACE] File watcher not available:', (err as Error).message);
  }
}

ctx.server.listen(ctx.PORT, () => {
  console.log(`[WS] Server on port ${ctx.PORT}`);
  void start();
  initSharedState();
  startTraceWatcher();
});

// --- Graceful Shutdown ---

function shutdown(signal: string) {
  console.log(`[SHUTDOWN] Received ${signal}, closing gracefully...`);
  if (metricsWriterStarted) otelPipeline.stop();
  const bridge = getBridge();
  bridge.stop().catch(() => {});
  getStateBridge().stop();
  ctx.wss.close(() => {
    console.log('[SHUTDOWN] WebSocket server closed');
  });
  ctx.server.close(() => {
    console.log('[SHUTDOWN] HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.warn('[SHUTDOWN] Forced exit after timeout');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
