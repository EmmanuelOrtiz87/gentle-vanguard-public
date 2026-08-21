export interface TenantInfo {
  id: string;
  name: string;
  lastActive: string;
  isDefault: boolean;
}

export interface TenantMetrics {
  tenantId: string;
  metrics: import('./dashboard').DashboardData;
}
