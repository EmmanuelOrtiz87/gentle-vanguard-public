import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import type { URL } from 'url';
import { DEFAULT_TENANT_ID } from '../database/manager.ts';
import {
  dashboardAuth,
  dashboardDatabase,
  loginRateLimiter,
  readJsonBody,
  sha256Hex,
  CSRF_COOKIE,
} from '../ws-hub/context.ts';

export async function authHandler(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: typeof import('../ws-hub/context.ts'),
  headers: Record<string, string>,
): Promise<boolean> {
  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    const clientKey = req.socket.remoteAddress || 'unknown';
    const limit = loginRateLimiter.check(clientKey);
    if (!limit.allowed) {
      res.writeHead(429, {
        ...headers,
        'Retry-After': String(limit.retryAfterSeconds),
      });
      res.end(JSON.stringify({ success: false, error: 'Too many login attempts' }));
      return true;
    }
    const body = await readJsonBody<{ token?: string }>(req);
    const sessionId = dashboardAuth.login(body.token || '');
    if (!sessionId) {
      loginRateLimiter.recordFailure(clientKey);
      res.writeHead(401, headers);
      res.end(JSON.stringify({ success: false, error: 'Invalid dashboard token' }));
      return true;
    }
    loginRateLimiter.reset(clientKey);

    // Bind session → principal with bootstrap semantics:
    // the first principal becomes admin; later logins keep their existing
    // tenant role or default to viewer (fail-closed).
    const subject = process.env.GV_DASHBOARD_PRINCIPAL_SUBJECT?.trim() || 'dashboard-operator';
    const principal = dashboardDatabase.principals.findOrCreateBySubject(
      subject,
      'Dashboard Operator',
    );
    let role = dashboardDatabase.principals.getRole(DEFAULT_TENANT_ID, principal.id);
    if (!role && dashboardDatabase.principals.countAdmins() === 0) role = 'admin';
    if (!role) role = 'viewer';
    dashboardDatabase.principals.upsertMembership(DEFAULT_TENANT_ID, principal.id, role);

    const csrfToken = randomBytes(32).toString('hex');
    try {
      dashboardDatabase.authSessions.bindSession(sessionId, principal.id, sha256Hex(csrfToken));
    } catch {
      dashboardAuth.logout(req);
      res.writeHead(500, headers);
      res.end(JSON.stringify({ success: false, error: 'Session binding failed' }));
      return true;
    }
    dashboardDatabase.insertEvent('dashboard.auth.login', {
      principalId: principal.id,
      subject,
      role,
    });

    const ttlSeconds = Math.floor(
      (Number(process.env.GV_DASHBOARD_SESSION_TTL_MS) || 8 * 60 * 60 * 1000) / 1000,
    );
    const csrfCookie = `${CSRF_COOKIE}=${csrfToken}; Path=/; SameSite=Strict${dashboardAuth.productionMode ? '; Secure' : ''}; Max-Age=${ttlSeconds}`;
    res.writeHead(200, {
      ...headers,
      'Set-Cookie': [dashboardAuth.cookieHeader(sessionId), csrfCookie],
    });
    res.end(
      JSON.stringify({
        success: true,
        principal: { id: principal.id, subject: principal.subject, role },
      }),
    );
    return true;
  }

  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    dashboardAuth.logout(req);
    const clearCsrf = `${CSRF_COOKIE}=; Path=/; SameSite=Strict${dashboardAuth.productionMode ? '; Secure' : ''}; Max-Age=0`;
    res.writeHead(200, {
      ...headers,
      'Set-Cookie': [dashboardAuth.clearCookieHeader(), clearCsrf],
    });
    res.end(JSON.stringify({ success: true }));
    return true;
  }

  if (url.pathname === '/api/auth/status') {
    res.writeHead(200, headers);
    res.end(
      JSON.stringify({
        enabled: dashboardAuth.enabled,
        mode: dashboardAuth.devMode
          ? 'dev-localhost'
          : dashboardAuth.enabled
            ? 'session'
            : 'disabled',
        authenticated: dashboardAuth.authenticate(req),
        warning: dashboardAuth.warning,
      }),
    );
    return true;
  }

  return false;
}
