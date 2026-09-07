import { z } from 'zod';

export const dashboardSourceClassificationSchema = z.object({
  scope: z.enum(['system-wide', 'deployment-tenant']),
  source: z.enum(['database', 'filesystem', 'mixed']),
  provenance: z.enum(['explicit', 'unprovenanced']),
  tenantId: z.string().min(1).optional(),
});

export type DashboardSourceClassification = z.infer<typeof dashboardSourceClassificationSchema>;

export const filesystemSourceMetadataSchema = z.object({
  scope: z.enum(['system-wide', 'deployment-tenant']),
  tenantId: z.string().min(1).optional(),
});

export type FilesystemSourceMetadata = z.infer<typeof filesystemSourceMetadataSchema>;

export function classifyDashboardSource(input: {
  source: 'database' | 'filesystem' | 'mixed';
  tenantId?: string;
  filesystemMetadata?: unknown;
}): DashboardSourceClassification {
  if (input.source === 'database' && input.tenantId) {
    return dashboardSourceClassificationSchema.parse({
      scope: 'deployment-tenant',
      source: input.source,
      provenance: 'explicit',
      tenantId: input.tenantId,
    });
  }

  if (input.source === 'filesystem' || input.source === 'mixed') {
    const metadata = input.filesystemMetadata
      ? filesystemSourceMetadataSchema.parse(input.filesystemMetadata)
      : undefined;
    if (metadata?.scope === 'deployment-tenant') {
      if (!metadata.tenantId) {
        throw new Error('Tenant-scoped filesystem data requires an explicit tenantId');
      }
      return dashboardSourceClassificationSchema.parse({
        scope: metadata.scope,
        source: input.source,
        provenance: 'explicit',
        tenantId: metadata.tenantId,
      });
    }
    return dashboardSourceClassificationSchema.parse({
      scope: 'system-wide',
      source: input.source,
      provenance: metadata ? 'explicit' : 'unprovenanced',
    });
  }

  return dashboardSourceClassificationSchema.parse({
    scope: 'system-wide',
    source: input.source,
    provenance: 'unprovenanced',
  });
}

export function assertDashboardSourceBelongsToTenant(
  classification: DashboardSourceClassification,
  tenantId: string,
): void {
  if (classification.scope !== 'deployment-tenant' || classification.tenantId !== tenantId) {
    throw new Error(
      `Dashboard source is ${classification.scope} and cannot be treated as tenant data`,
    );
  }
}
