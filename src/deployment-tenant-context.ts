import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';

const tenantIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const tenantRegistrySchema = z
  .object({
    tenants: z.array(z.object({ id: tenantIdSchema, name: z.string().min(1) }).passthrough()),
  })
  .passthrough();

export interface DeploymentTenantContext {
  tenantId?: string;
  tenantName?: string;
  configured: boolean;
  scopeLabel: 'deployment-tenant' | 'system-wide';
}

export function resolveDeploymentTenantContext(
  env: NodeJS.ProcessEnv = process.env,
  registryPath = join(resolve(process.cwd()), 'config', 'tenant-registry.json'),
): DeploymentTenantContext {
  const rawTenantId = env.GENTLE_TENANT_ID?.trim();
  const production = env.NODE_ENV === 'production';
  if (!rawTenantId) {
    if (production) throw new Error('GENTLE_TENANT_ID is required in production');
    return { configured: false, scopeLabel: 'system-wide' };
  }

  const tenantId = tenantIdSchema.parse(rawTenantId);
  if (!existsSync(registryPath)) throw new Error(`Tenant registry not found: ${registryPath}`);
  let registry: z.infer<typeof tenantRegistrySchema>;
  try {
    registry = tenantRegistrySchema.parse(JSON.parse(readFileSync(registryPath, 'utf8')));
  } catch (error) {
    throw new Error(
      `Invalid tenant registry: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const tenant = registry.tenants.find((entry) => entry.id === tenantId);
  if (!tenant) throw new Error(`GENTLE_TENANT_ID is not registered: ${tenantId}`);
  return { tenantId, tenantName: tenant.name, configured: true, scopeLabel: 'deployment-tenant' };
}

export function validateTenantSelector(
  context: DeploymentTenantContext,
  selectedTenantId: string | null,
): boolean {
  if (!selectedTenantId) return true;
  return context.configured && selectedTenantId === context.tenantId;
}
