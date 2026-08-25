import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  resolveDeploymentTenantContext,
  validateTenantSelector,
} from '../../src/deployment-tenant-context.ts';

const registryPath = fileURLToPath(new URL('../../config/tenant-registry.json', import.meta.url));

describe('deployment tenant context', () => {
  it('requires and validates the registered tenant in production', () => {
    const context = resolveDeploymentTenantContext(
      { NODE_ENV: 'production', GENTLE_TENANT_ID: 'gentle-vanguard' },
      registryPath,
    );
    assert.deepEqual(context, {
      tenantId: 'gentle-vanguard',
      tenantName: 'Gentle-Vanguard (default)',
      configured: true,
      scopeLabel: 'deployment-tenant',
    });
    assert.equal(validateTenantSelector(context, 'gentle-vanguard'), true);
    assert.equal(validateTenantSelector(context, 'other'), false);
  });

  it('fails closed when production is not configured or the tenant is unknown', () => {
    assert.throws(
      () => resolveDeploymentTenantContext({ NODE_ENV: 'production' }, registryPath),
      /required in production/,
    );
    assert.throws(
      () =>
        resolveDeploymentTenantContext(
          { NODE_ENV: 'production', GENTLE_TENANT_ID: 'other' },
          registryPath,
        ),
      /not registered/,
    );
  });

  it('labels development without a configured tenant as system-wide', () => {
    const context = resolveDeploymentTenantContext({ NODE_ENV: 'development' }, registryPath);
    assert.deepEqual(context, { configured: false, scopeLabel: 'system-wide' });
    assert.equal(validateTenantSelector(context, 'gentle-vanguard'), false);
  });
});
