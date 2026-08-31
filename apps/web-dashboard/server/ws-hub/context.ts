import { WebSocketServer, WebSocket } from 'ws';
import { createServer, IncomingMessage } from 'http';
import { join } from 'path';
import { DatabaseManager, DEFAULT_TENANT_ID } from '../database/manager.ts';
import { createDashboardAuth } from '../auth.ts';
import { createLoginRateLimiter } from '../login-rate-limiter.ts';
import { createHash } from 'node:crypto';
import type { DashboardRole } from '../database/repositories/PrincipalRepo';
import {
  resolveDeploymentTenantContext,
  type DeploymentTenantContext,
} from '../../../../src/integrations/deployment-tenant-context.ts';
import { ROOT } from '../shared.ts';
import type { AgentSession } from '../../src/types/agent.ts';

export const ALERTS_CONFIG_PATH = join(ROOT, 'config', 'dashboard-alerts.json');

export const STATS_PATH = join(ROOT, '.atl', 'skill-stats.json');
export const REGISTRY_PATH = join(ROOT, '.atl', 'skill-registry.md');
export const SESSIONS_HISTORY_PATH = join(ROOT, '.event-bus', 'sessions-history.json');

export const PORT = parseInt(process.env.WS_PORT || '8080', 10);
export const dashboardDatabase = DatabaseManager.getInstance();
export const dashboardAuth = createDashboardAuth(process.env, dashboardDatabase.authSessions);
export const loginRateLimiter = createLoginRateLimiter(process.env);
export const CSRF_COOKIE = 'gv_dashboard_csrf';

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export interface SessionAccess {
  principalId: string;
  role: DashboardRole;
}

/** Resolve the authenticated session to its bound principal + tenant role. */
export function resolveSessionAccess(req: IncomingMessage): SessionAccess | undefined {
  if (dashboardAuth.devMode && dashboardAuth.isLocalhost(req)) return undefined;
  const sessionId = dashboardAuth.cookie(req);
  if (!sessionId) return undefined;
  const principalId = dashboardDatabase.authSessions.getPrincipalId(sessionId);
  if (!principalId) return undefined;
  const role = dashboardDatabase.principals.getRole(DEFAULT_TENANT_ID, principalId);
  if (!role) return undefined;
  return { principalId, role };
}

export function devBypassActive(req: IncomingMessage): boolean {
  // devMode bypass (GV_DASHBOARD_DEV_AUTH=1) or the local-default profile:
  // no configured token + loopback request = trusted owner access (ADR-0017).
  // Production always resolves sessions through RBAC instead.
  return (
    !dashboardAuth.productionMode &&
    (dashboardAuth.devMode || !dashboardAuth.enabled) &&
    dashboardAuth.isLocalhost(req)
  );
}

/**
 * Double-submit CSRF verification for cookie-authenticated mutations:
 * the X-GV-CSRF header must match the CSRF cookie, and both must hash to
 * the value stored server-side with the session.
 */
export function verifyCsrf(req: IncomingMessage): boolean {
  const sessionId = dashboardAuth.cookie(req);
  if (!sessionId) return false;
  const header = req.headers['x-gv-csrf'];
  const headerToken = Array.isArray(header) ? header[0] : header;
  if (!headerToken) return false;
  let cookieToken: string | undefined;
  for (const part of (req.headers.cookie || '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === CSRF_COOKIE) cookieToken = value.join('=') || undefined;
  }
  if (!cookieToken || cookieToken !== headerToken) return false;
  try {
    return dashboardDatabase.authSessions.getCsrfHash(sessionId) === sha256Hex(headerToken);
  } catch {
    return false;
  }
}

if (dashboardAuth.warning) console.warn(`[AUTH-WARNING] ${dashboardAuth.warning}`);
export const deploymentTenant = resolveDeploymentTenantContext(
  process.env,
  join(ROOT, 'config', 'tenant-registry.json'),
);
export const server = createServer();
export const MAX_JSON_BODY_BYTES = 1_048_576;
export const MAX_WS_MESSAGE_BYTES = 256 * 1024;
export const MAX_WS_BUFFERED_BYTES = 1_048_576;
export const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_MESSAGE_BYTES });
export const wsTenants = new WeakMap<WebSocket, DeploymentTenantContext>();

export const clients = new Set<WebSocket>();
export const agentSubscriptions = new Map<string, Set<WebSocket>>();
export const sessions = new Map<string, AgentSession>();
export const connPerIp = new Map<string, number>();
export const MAX_CONN_PER_IP = 5;
export const dashboardTelemetry = {
  httpRequests: 0,
  httpErrors: 0,
  httpLatencyTotalMs: 0,
  httpLatencyMaxMs: 0,
  httpStatusCounts: new Map<number, number>(),
  wsConnectionsTotal: 0,
  wsConnectionsPeak: 0,
};
export let bridgeReady = false;
export let bridgeToolCount = 0;

export function setBridgeReady(value: boolean): void {
  bridgeReady = value;
}

export function setBridgeToolCount(value: number): void {
  bridgeToolCount = value;
}

export class RequestBodyTooLargeError extends Error {}

export async function readJsonBody<T>(
  req: IncomingMessage,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<T> {
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (declaredLength > maxBytes) throw new RequestBodyTooLargeError('Request body too large');
  const chunks: Buffer[] = [];
  let bytes = 0;
  return new Promise<T>((resolve, reject) => {
    const fail = (error: Error): void => {
      req.removeAllListeners('data');
      req.removeAllListeners('end');
      req.removeAllListeners('error');
      req.resume();
      reject(error);
    };
    req.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBytes) {
        fail(new RequestBodyTooLargeError('Request body too large'));
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', (error) => reject(error));
    req.on('aborted', () => reject(new Error('Request aborted')));
  });
}

export function safeSend(ws: WebSocket, message: string): boolean {
  if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_WS_BUFFERED_BYTES) return false;
  try {
    ws.send(message);
    return true;
  } catch {
    return false;
  }
}

export function sendJson(ws: WebSocket, payload: unknown): boolean {
  return safeSend(ws, JSON.stringify(payload));
}

export interface ActiveSkillExecution {
  active: boolean;
  cancelled: boolean;
  messageId?: string;
  abortController?: AbortController;
}

export const activeSkillExecutions = new Map<string, ActiveSkillExecution>();

export const prevAlertState = new Map<string, boolean>();
