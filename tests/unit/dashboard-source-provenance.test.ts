import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertDashboardSourceBelongsToTenant,
  classifyDashboardSource,
} from '../../apps/web-dashboard/server/dashboard-source-provenance.ts';

describe('dashboard source provenance', () => {
  it('classifies legacy filesystem data as unprovenanced system-wide data', () => {
    assert.deepEqual(classifyDashboardSource({ source: 'filesystem' }), {
      scope: 'system-wide',
      source: 'filesystem',
      provenance: 'unprovenanced',
    });
  });

  it('requires explicit tenant metadata for tenant-scoped filesystem data', () => {
    assert.deepEqual(
      classifyDashboardSource({
        source: 'filesystem',
        filesystemMetadata: { scope: 'deployment-tenant', tenantId: 'tenant-a' },
      }),
      {
        scope: 'deployment-tenant',
        source: 'filesystem',
        provenance: 'explicit',
        tenantId: 'tenant-a',
      },
    );
    assert.throws(
      () =>
        classifyDashboardSource({
          source: 'filesystem',
          filesystemMetadata: { scope: 'deployment-tenant' },
        }),
      /requires an explicit tenantId/,
    );
  });

  it('rejects using an unprovenanced global file as tenant data', () => {
    const classification = classifyDashboardSource({ source: 'filesystem' });
    assert.throws(
      () => assertDashboardSourceBelongsToTenant(classification, 'tenant-a'),
      /cannot be treated as tenant data/,
    );
  });

  it('accepts only the explicitly proven tenant source', () => {
    const classification = classifyDashboardSource({
      source: 'filesystem',
      filesystemMetadata: { scope: 'deployment-tenant', tenantId: 'tenant-a' },
    });
    assert.doesNotThrow(() => assertDashboardSourceBelongsToTenant(classification, 'tenant-a'));
    assert.throws(() => assertDashboardSourceBelongsToTenant(classification, 'tenant-b'));
  });
});
