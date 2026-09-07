import type { IncomingMessage, ServerResponse } from 'http';
import type { URL } from 'url';
import { DEFAULT_TENANT_ID } from '../database/manager.ts';
import { isDashboardRole } from '../database/repositories/PrincipalRepo';
import {
  dashboardDatabase,
  devBypassActive,
  resolveSessionAccess,
  verifyCsrf,
  readJsonBody,
} from '../ws-hub/context.ts';

export async function adminHandler(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: typeof import('../ws-hub/context.ts'),
  headers: Record<string, string>,
): Promise<boolean> {
  // ─── Admin API (RBAC v1) ────────────────────────────────────────────
  const adminMatch = url.pathname.match(
    // eslint-disable-next-line security/detect-unsafe-regex -- anchored, linear-time path regex
    /^\/api\/admin\/principals(?:\/([^/]+)(?:\/(role|revoke-sessions))?)?$/,
  );
  if (!adminMatch) return false;
  const bypass = devBypassActive(req);
  const access = resolveSessionAccess(req);
  if (!bypass && (!access || access.role !== 'admin')) {
    res.writeHead(403, headers);
    res.end(JSON.stringify({ success: false, error: 'Admin role required' }));
    return true;
  }
  const actorId = access?.principalId ?? 'dev-bypass';
  const mutating = req.method !== 'GET' && req.method !== 'HEAD';
  if (mutating && !bypass && !verifyCsrf(req)) {
    res.writeHead(403, headers);
    res.end(JSON.stringify({ success: false, error: 'CSRF token missing or invalid' }));
    return true;
  }

  const [, principalId, adminAction] = adminMatch;

  if (!principalId && req.method === 'GET') {
    const principals = dashboardDatabase.principals.list().map((p) => ({
      ...p,
      memberships: dashboardDatabase.principals.listMemberships(p.id),
    }));
    res.writeHead(200, headers);
    res.end(JSON.stringify({ success: true, principals }));
    return true;
  }

  if (!principalId && req.method === 'POST') {
    const body = await readJsonBody<{
      subject?: string;
      displayName?: string;
      role?: string;
    }>(req);
    const subject = body.subject?.trim();
    if (!subject) {
      res.writeHead(400, headers);
      res.end(JSON.stringify({ success: false, error: 'subject is required' }));
      return true;
    }
    const role = body.role ?? 'viewer';
    if (!isDashboardRole(role)) {
      res.writeHead(400, headers);
      res.end(JSON.stringify({ success: false, error: 'role must be viewer|operator|admin' }));
      return true;
    }
    const created = dashboardDatabase.principals.findOrCreateBySubject(subject, body.displayName);
    dashboardDatabase.principals.upsertMembership(DEFAULT_TENANT_ID, created.id, role);
    dashboardDatabase.insertEvent('dashboard.admin.principal.create', {
      actorId,
      principalId: created.id,
      subject,
      role,
    });
    res.writeHead(201, headers);
    res.end(JSON.stringify({ success: true, principal: { ...created, role } }));
    return true;
  }

  if (principalId && adminAction === 'role' && req.method === 'PATCH') {
    if (principalId === actorId) {
      res.writeHead(409, headers);
      res.end(JSON.stringify({ success: false, error: 'Cannot change own role' }));
      return true;
    }
    const body = await readJsonBody<{ role?: string; tenantId?: string }>(req);
    const role = body.role;
    const tenantId = body.tenantId?.trim() || DEFAULT_TENANT_ID;
    if (!isDashboardRole(role)) {
      res.writeHead(400, headers);
      res.end(JSON.stringify({ success: false, error: 'role must be viewer|operator|admin' }));
      return true;
    }
    const target = dashboardDatabase.principals.getById(principalId);
    if (!target) {
      res.writeHead(404, headers);
      res.end(JSON.stringify({ success: false, error: 'Principal not found' }));
      return true;
    }
    const previousRole = dashboardDatabase.principals.getRole(tenantId, principalId);
    if (
      previousRole === 'admin' &&
      role !== 'admin' &&
      dashboardDatabase.principals.countAdmins() <= 1
    ) {
      res.writeHead(409, headers);
      res.end(JSON.stringify({ success: false, error: 'Cannot demote the last admin' }));
      return true;
    }
    dashboardDatabase.principals.upsertMembership(tenantId, principalId, role);
    dashboardDatabase.insertEvent('dashboard.admin.principal.role_change', {
      actorId,
      principalId,
      tenantId,
      from: previousRole ?? null,
      to: role,
    });
    res.writeHead(200, headers);
    res.end(JSON.stringify({ success: true, principalId, tenantId, role }));
    return true;
  }

  if (principalId && adminAction === 'revoke-sessions' && req.method === 'POST') {
    const revoked = dashboardDatabase.authSessions.revokeAllForPrincipal(principalId);
    dashboardDatabase.insertEvent('dashboard.admin.sessions.revoke', {
      actorId,
      principalId,
      revoked,
    });
    res.writeHead(200, headers);
    res.end(JSON.stringify({ success: true, revoked }));
    return true;
  }

  if (principalId && !adminAction && req.method === 'DELETE') {
    if (principalId === actorId) {
      res.writeHead(409, headers);
      res.end(JSON.stringify({ success: false, error: 'Cannot delete own principal' }));
      return true;
    }
    const target = dashboardDatabase.principals.getById(principalId);
    if (!target) {
      res.writeHead(404, headers);
      res.end(JSON.stringify({ success: false, error: 'Principal not found' }));
      return true;
    }
    if (
      dashboardDatabase.principals.getRole(DEFAULT_TENANT_ID, principalId) === 'admin' &&
      dashboardDatabase.principals.countAdmins() <= 1
    ) {
      res.writeHead(409, headers);
      res.end(JSON.stringify({ success: false, error: 'Cannot delete the last admin' }));
      return true;
    }
    dashboardDatabase.authSessions.revokeAllForPrincipal(principalId);
    dashboardDatabase.principals.delete(principalId);
    dashboardDatabase.insertEvent('dashboard.admin.principal.delete', {
      actorId,
      principalId,
      subject: target.subject,
    });
    res.writeHead(200, headers);
    res.end(JSON.stringify({ success: true }));
    return true;
  }

  res.writeHead(405, { ...headers, Allow: 'GET, POST, PATCH, DELETE, POST' });
  res.end(JSON.stringify({ success: false, error: 'Method not allowed' }));
  return true;
}
