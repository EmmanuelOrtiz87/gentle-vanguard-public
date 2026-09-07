import type { DashboardRole } from './database/repositories/PrincipalRepo';

/**
 * Dashboard RBAC policy — version 1.
 *
 * Roles: viewer < operator < admin.
 * Actions: read < write < admin.
 *
 * The policy is intentionally coarse-grained for v1:
 * - Reads on authenticated resource routes require `viewer`.
 * - Mutations (non-GET) require `operator`.
 * - Identity administration under `/api/admin/*` requires `admin`.
 *
 * A future version may introduce per-resource matrices
 * (metrics/traces/backlog/routing/skill/mcp) without changing call sites:
 * only `resolveRoutePermission` and the matrix below would evolve.
 */
export const RBAC_POLICY_VERSION = 1;

export type RbacAction = 'read' | 'write' | 'admin';

export interface RbacPermission {
  resource: string;
  action: RbacAction;
}

const ROLE_ACTIONS: Record<DashboardRole, RbacAction[]> = {
  viewer: ['read'],
  operator: ['read', 'write'],
  admin: ['read', 'write', 'admin'],
};

export function roleHasAction(role: DashboardRole, action: RbacAction): boolean {
  return ROLE_ACTIONS[role].includes(action);
}

export function can(role: DashboardRole, permission: RbacPermission): boolean {
  return roleHasAction(role, permission.action);
}

function resourceFromPath(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  // '/api/<resource>/...' → second segment; fall back to 'general'.
  const candidate = segments[1];
  if (!candidate || /^(admin)$/.test(candidate)) return candidate === 'admin' ? 'admin' : 'general';
  return candidate;
}

/**
 * Map an authenticated dashboard route to its required permission.
 * Returns undefined for routes that are exempt (public health/auth routes
 * are handled before this policy runs).
 */
export function resolveRoutePermission(
  pathname: string,
  method: string,
): RbacPermission | undefined {
  if (pathname === '/api/health' || pathname.startsWith('/api/auth/')) return undefined;

  if (pathname.startsWith('/api/admin/')) {
    return { resource: 'admin', action: method === 'GET' || method === 'HEAD' ? 'read' : 'admin' };
  }

  const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
  return { resource: resourceFromPath(pathname), action: mutating ? 'write' : 'read' };
}
