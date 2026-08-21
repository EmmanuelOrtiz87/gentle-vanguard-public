#!/usr/bin/env node

/**
 * Tenant Context
 * Multi-tenant context resolution and isolation
 * Secure tenant boundaries with complete separation
 *
 * Part of Gentle-Vanguard  — Multi-Tenant Isolation
 */

import { EventEmitter } from 'events';
import { createHash, randomBytes } from 'crypto';

interface Tenant {
  id: string;
  name: string;
  tier: 'free' | 'basic' | 'professional' | 'enterprise';
  config: TenantConfig;
  createdAt: number;
  lastActive: number;
  status: 'active' | 'suspended' | 'deleted';
  metadata: Record<string, any>;
}

interface TenantConfig {
  maxSessions: number;
  maxTokensPerDay: number;
  maxStorage: number; // MB
  allowedFeatures: string[];
  rateLimits: {
    requestsPerMinute: number;
    requestsPerHour: number;
    requestsPerDay: number;
  };
  isolationLevel: 'shared' | 'dedicated' | 'isolated';
}

interface TenantContext {
  tenant: Tenant;
  session: {
    id: string;
    userId: string;
    startedAt: number;
    permissions: string[];
  };
  resources: {
    tokensUsed: number;
    storageUsed: number;
    requestsMade: number;
  };
}

interface IsolationPolicy {
  dataIsolation: boolean;
  computeIsolation: boolean;
  networkIsolation: boolean;
  storageIsolation: boolean;
}

interface TenantManagerConfig {
  defaultMaxTenants: number;
  enforceIsolation: boolean;
  auditAccess: boolean;
}

export class TenantContextManager extends EventEmitter {
  private config: TenantManagerConfig;
  private tenants: Map<string, Tenant> = new Map();
  private activeContexts: Map<string, TenantContext> = new Map();
  private isolationPolicies: Map<string, IsolationPolicy> = new Map();
  private accessLog: Array<{
    timestamp: number;
    tenantId: string;
    action: string;
    success: boolean;
    details: string;
  }> = [];

  constructor(config: Partial<TenantManagerConfig> = {}) {
    super();
    this.config = {
      defaultMaxTenants: config.defaultMaxTenants || 1000,
      enforceIsolation: config.enforceIsolation !== false,
      auditAccess: config.auditAccess !== false,
    };
  }

  /**
   * Create a new tenant
   */
  public createTenant(
    name: string,
    tier: Tenant['tier'] = 'basic',
    customConfig?: Partial<TenantConfig>,
  ): Tenant {
    if (this.tenants.size >= this.config.defaultMaxTenants) {
      throw new Error('Maximum number of tenants reached');
    }

    const tenantId = `tenant_${createHash('sha256')
      .update(name + Date.now())
      .digest('hex')
      .substring(0, 16)}`;

    const defaultConfigs: Record<Tenant['tier'], TenantConfig> = {
      free: {
        maxSessions: 5,
        maxTokensPerDay: 10000,
        maxStorage: 100,
        allowedFeatures: ['basic-chat', 'code-completion'],
        rateLimits: { requestsPerMinute: 10, requestsPerHour: 100, requestsPerDay: 500 },
        isolationLevel: 'shared',
      },
      basic: {
        maxSessions: 20,
        maxTokensPerDay: 100000,
        maxStorage: 1000,
        allowedFeatures: ['basic-chat', 'code-completion', 'refactoring', 'documentation'],
        rateLimits: { requestsPerMinute: 30, requestsPerHour: 500, requestsPerDay: 3000 },
        isolationLevel: 'shared',
      },
      professional: {
        maxSessions: 100,
        maxTokensPerDay: 1000000,
        maxStorage: 10000,
        allowedFeatures: ['all'],
        rateLimits: { requestsPerMinute: 100, requestsPerHour: 2000, requestsPerDay: 15000 },
        isolationLevel: 'dedicated',
      },
      enterprise: {
        maxSessions: 1000,
        maxTokensPerDay: 10000000,
        maxStorage: 100000,
        allowedFeatures: ['all', 'custom-features'],
        rateLimits: { requestsPerMinute: 500, requestsPerHour: 10000, requestsPerDay: 100000 },
        isolationLevel: 'isolated',
      },
    };

    const tenant: Tenant = {
      id: tenantId,
      name,
      tier,
      config: { ...defaultConfigs[tier], ...customConfig },
      createdAt: Date.now(),
      lastActive: Date.now(),
      status: 'active',
      metadata: {},
    };

    this.tenants.set(tenantId, tenant);
    this.setupIsolationPolicy(tenantId, tenant.config.isolationLevel);

    this.emit('tenantCreated', tenant);
    this.logAccess(tenantId, 'CREATE', true, `Tenant ${name} created with ${tier} tier`);

    return tenant;
  }

  /**
   * Setup isolation policy for tenant
   */
  private setupIsolationPolicy(tenantId: string, level: TenantConfig['isolationLevel']): void {
    const policies: Record<TenantConfig['isolationLevel'], IsolationPolicy> = {
      shared: {
        dataIsolation: true,
        computeIsolation: false,
        networkIsolation: false,
        storageIsolation: true,
      },
      dedicated: {
        dataIsolation: true,
        computeIsolation: true,
        networkIsolation: false,
        storageIsolation: true,
      },
      isolated: {
        dataIsolation: true,
        computeIsolation: true,
        networkIsolation: true,
        storageIsolation: true,
      },
    };

    this.isolationPolicies.set(tenantId, policies[level]);
  }

  /**
   * Resolve tenant context for a session
   */
  public resolveContext(tenantId: string, userId: string): TenantContext {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      this.logAccess(tenantId, 'RESOLVE', false, 'Tenant not found');
      throw new Error(`Tenant ${tenantId} not found`);
    }

    if (tenant.status !== 'active') {
      this.logAccess(tenantId, 'RESOLVE', false, `Tenant status: ${tenant.status}`);
      throw new Error(`Tenant ${tenantId} is not active`);
    }

    // Check if max sessions reached
    const activeSessions = Array.from(this.activeContexts.values()).filter(
      (ctx) => ctx.tenant.id === tenantId,
    ).length;

    if (activeSessions >= tenant.config.maxSessions) {
      this.logAccess(tenantId, 'RESOLVE', false, 'Max sessions reached');
      throw new Error(`Maximum sessions reached for tenant ${tenantId}`);
    }

    const sessionId = `session_${randomBytes(16).toString('hex')}`;

    const context: TenantContext = {
      tenant,
      session: {
        id: sessionId,
        userId,
        startedAt: Date.now(),
        permissions: this.getPermissionsForTier(tenant.tier),
      },
      resources: {
        tokensUsed: 0,
        storageUsed: 0,
        requestsMade: 0,
      },
    };

    this.activeContexts.set(sessionId, context);
    tenant.lastActive = Date.now();

    this.emit('contextResolved', context);
    this.logAccess(tenantId, 'RESOLVE', true, `Session ${sessionId} created for user ${userId}`);

    return context;
  }

  /**
   * Get permissions for tier
   */
  private getPermissionsForTier(tier: Tenant['tier']): string[] {
    const permissions: Record<Tenant['tier'], string[]> = {
      free: ['read', 'basic-chat'],
      basic: ['read', 'write', 'basic-chat', 'code-completion'],
      professional: ['read', 'write', 'execute', 'all-features'],
      enterprise: ['read', 'write', 'execute', 'admin', 'all-features', 'custom-config'],
    };
    return permissions[tier];
  }

  /**
   * Check if feature is allowed for tenant
   */
  public isFeatureAllowed(tenantId: string, feature: string): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;

    return (
      tenant.config.allowedFeatures.includes(feature) ||
      tenant.config.allowedFeatures.includes('all')
    );
  }

  /**
   * Check rate limits
   */
  public checkRateLimit(
    tenantId: string,
    contextId: string,
  ): { allowed: boolean; remaining: number } {
    const context = this.activeContexts.get(contextId);
    if (!context) return { allowed: false, remaining: 0 };

    const tenant = context.tenant;
    const now = Date.now();
    const minuteAgo = now - 60000;

    // Count requests in last minute
    const recentRequests = this.accessLog.filter(
      (log) => log.tenantId === tenantId && log.timestamp > minuteAgo && log.action === 'REQUEST',
    ).length;

    const allowed = recentRequests < tenant.config.rateLimits.requestsPerMinute;
    const remaining = Math.max(0, tenant.config.rateLimits.requestsPerMinute - recentRequests);

    return { allowed, remaining };
  }

  /**
   * Update resource usage
   */
  public updateResourceUsage(
    contextId: string,
    resources: Partial<TenantContext['resources']>,
  ): void {
    const context = this.activeContexts.get(contextId);
    if (!context) return;

    if (resources.tokensUsed) {
      context.resources.tokensUsed += resources.tokensUsed;
    }
    if (resources.storageUsed) {
      context.resources.storageUsed += resources.storageUsed;
    }
    if (resources.requestsMade) {
      context.resources.requestsMade += resources.requestsMade;
    }

    // Check limits
    this.checkResourceLimits(context);
  }

  /**
   * Check if resource limits exceeded
   */
  private checkResourceLimits(context: TenantContext): void {
    const { tenant, resources } = context;

    if (resources.tokensUsed > tenant.config.maxTokensPerDay) {
      this.emit('limitExceeded', {
        tenant: tenant.id,
        resource: 'tokens',
        limit: tenant.config.maxTokensPerDay,
      });
    }

    if (resources.storageUsed > tenant.config.maxStorage) {
      this.emit('limitExceeded', {
        tenant: tenant.id,
        resource: 'storage',
        limit: tenant.config.maxStorage,
      });
    }
  }

  /**
   * Release context
   */
  public releaseContext(contextId: string): void {
    const context = this.activeContexts.get(contextId);
    if (context) {
      this.activeContexts.delete(contextId);
      this.emit('contextReleased', context);
      this.logAccess(context.tenant.id, 'RELEASE', true, `Session ${contextId} released`);
    }
  }

  /**
   * Get isolation policy for tenant
   */
  public getIsolationPolicy(tenantId: string): IsolationPolicy | null {
    return this.isolationPolicies.get(tenantId) || null;
  }

  /**
   * Enforce isolation between tenants
   */
  public enforceIsolation(sourceTenantId: string, targetTenantId: string): boolean {
    if (!this.config.enforceIsolation) return true;

    const policy = this.isolationPolicies.get(sourceTenantId);
    if (!policy) return false;

    // Check if data isolation is enforced
    if (policy.dataIsolation && sourceTenantId !== targetTenantId) {
      this.logAccess(
        sourceTenantId,
        'ISOLATION_CHECK',
        false,
        `Access to ${targetTenantId} blocked`,
      );
      return false;
    }

    return true;
  }

  /**
   * Log access attempt
   */
  private logAccess(tenantId: string, action: string, success: boolean, details: string): void {
    if (!this.config.auditAccess) return;

    this.accessLog.push({
      timestamp: Date.now(),
      tenantId,
      action,
      success,
      details,
    });

    // Prune old logs
    if (this.accessLog.length > 10000) {
      this.accessLog = this.accessLog.slice(-5000);
    }
  }

  /**
   * Get tenant statistics
   */
  public getStats(): object {
    const tenants = Array.from(this.tenants.values());
    const activeContexts = this.activeContexts.size;

    const byTier: Record<string, number> = {};
    tenants.forEach((t) => {
      byTier[t.tier] = (byTier[t.tier] || 0) + 1;
    });

    const byStatus: Record<string, number> = {};
    tenants.forEach((t) => {
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    });

    return {
      totalTenants: tenants.length,
      activeContexts,
      byTier,
      byStatus,
      isolationEnforced: this.config.enforceIsolation,
      auditEnabled: this.config.auditAccess,
      totalAccessLogs: this.accessLog.length,
    };
  }

  /**
   * Suspend tenant
   */
  public suspendTenant(tenantId: string, reason: string): void {
    const tenant = this.tenants.get(tenantId);
    if (tenant) {
      tenant.status = 'suspended';
      this.emit('tenantSuspended', { tenant: tenantId, reason });
      this.logAccess(tenantId, 'SUSPEND', true, reason);
    }
  }

  /**
   * Delete tenant
   */
  public deleteTenant(tenantId: string): void {
    const tenant = this.tenants.get(tenantId);
    if (tenant) {
      // Release all active contexts
      for (const [ctxId, ctx] of this.activeContexts.entries()) {
        if (ctx.tenant.id === tenantId) {
          this.releaseContext(ctxId);
        }
      }

      tenant.status = 'deleted';
      this.emit('tenantDeleted', tenant);
      this.logAccess(tenantId, 'DELETE', true, 'Tenant deleted');
    }
  }
}

// Export singleton instance
export const tenantContextManager = new TenantContextManager();

// CLI execution
if (require.main === module) {
  console.log('Tenant Context Manager ');
  console.log('Part of Gentle-Vanguard  — Multi-Tenant Isolation\n');

  const manager = new TenantContextManager({
    enforceIsolation: true,
    auditAccess: true,
  });

  manager.on('tenantCreated', (tenant) => {
    console.log(`[${new Date().toISOString()}] Tenant created: ${tenant.name} (${tenant.tier})`);
  });

  manager.on('contextResolved', (context) => {
    console.log(
      `[${new Date().toISOString()}] Context resolved for tenant: ${context.tenant.name}`,
    );
    console.log(`  Session: ${context.session.id}`);
    console.log(`  Isolation: ${context.tenant.config.isolationLevel}`);
  });

  manager.on('limitExceeded', (event) => {
    console.log(
      `[${new Date().toISOString()}] LIMIT EXCEEDED: ${event.tenant} - ${event.resource}`,
    );
  });

  // Create sample tenants
  console.log('Creating sample tenants...\n');

  const tenant1 = manager.createTenant('Acme Corp', 'enterprise');
  const tenant2 = manager.createTenant('Startup Inc', 'basic');
  const tenant3 = manager.createTenant('Freelancer', 'free');

  // Resolve contexts
  console.log('Resolving contexts...\n');

  try {
    const ctx1 = manager.resolveContext(tenant1.id, 'user_001');
    const ctx2 = manager.resolveContext(tenant2.id, 'user_002');

    // Check features
    console.log('Feature checks:');
    console.log(
      `  Enterprise has 'custom-features': ${manager.isFeatureAllowed(tenant1.id, 'custom-features')}`,
    );
    console.log(
      `  Basic has 'refactoring': ${manager.isFeatureAllowed(tenant2.id, 'refactoring')}`,
    );
    console.log(`  Free has 'basic-chat': ${manager.isFeatureAllowed(tenant3.id, 'basic-chat')}`);

    // Check rate limits
    console.log('\nRate limit checks:');
    const rate1 = manager.checkRateLimit(tenant1.id, ctx1.session.id);
    console.log(
      `  Enterprise: ${rate1.allowed ? 'ALLOWED' : 'BLOCKED'} (${rate1.remaining} remaining)`,
    );

    // Update resource usage
    manager.updateResourceUsage(ctx1.session.id, { tokensUsed: 5000, requestsMade: 10 });
    console.log('\nResource usage updated for enterprise tenant');

    // Check isolation
    console.log('\nIsolation checks:');
    const isolation = manager.enforceIsolation(tenant1.id, tenant2.id);
    console.log(`  Cross-tenant access: ${isolation ? 'ALLOWED' : 'BLOCKED'}`);

    // Release contexts
    manager.releaseContext(ctx1.session.id);
    manager.releaseContext(ctx2.session.id);
  } catch (error: any) {
    console.error('Error:', error?.message || error);
  }

  console.log('\n\n--- Tenant Statistics ---');
  console.log(JSON.stringify(manager.getStats(), null, 2));
}
