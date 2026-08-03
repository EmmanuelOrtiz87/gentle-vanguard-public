/**
 * Resilience Manager Tests
 * Tests for multi-tier resilience pattern implementation
 * @version 1.0.0
 */

import ResilienceManager from '../../src/architecture/resilience/ResilienceManager';

describe('ResilienceManager', () => {
  let manager: ResilienceManager;

  beforeEach(() => {
    manager = new ResilienceManager();
  });

  describe('Initialization', () => {
    it('should initialize with primary tier active', () => {
      expect(manager.getActiveTier()).toBe('primary');
    });

    it('should have all tiers configured', () => {
      const statuses = manager.getAllTierStatuses();
      expect(statuses.size).toBe(3);
      expect(statuses.has('primary')).toBe(true);
      expect(statuses.has('secondary')).toBe(true);
      expect(statuses.has('tertiary')).toBe(true);
    });

    it('should initialize all tiers as healthy', () => {
      const statuses = manager.getAllTierStatuses();
      statuses.forEach((status) => {
        expect(status.isHealthy).toBe(true);
      });
    });
  });

  describe('Health Checks', () => {
    it('should check primary tier health', async () => {
      const status = await manager.checkTierHealth('primary');
      expect(status).toBeDefined();
      expect(status.tierId).toBe('primary');
      expect(status.lastCheck).toBeDefined();
      expect(status.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('should check secondary tier health', async () => {
      const status = await manager.checkTierHealth('secondary');
      expect(status).toBeDefined();
      expect(status.tierId).toBe('secondary');
    });

    it('should check tertiary tier health', async () => {
      const status = await manager.checkTierHealth('tertiary');
      expect(status).toBeDefined();
      expect(status.tierId).toBe('tertiary');
    });

    it('should throw error for invalid tier', async () => {
      await expect(manager.checkTierHealth('invalid')).rejects.toThrow();
    });
  });

  describe('Failover', () => {
    it('should failover to secondary tier', async () => {
      const result = await manager.failoverToSecondary();
      expect(result).toBe(true);
      expect(manager.getActiveTier()).toBe('secondary');
    });

    it('should failover to tertiary tier', async () => {
      await manager.failoverToSecondary();
      const result = await manager.failoverToTertiary();
      expect(result).toBe(true);
      expect(manager.getActiveTier()).toBe('tertiary');
    });

    it('should increment failover count', async () => {
      const initialMetrics = manager.getMetrics();
      const initialCount = initialMetrics.failoverCount;

      await manager.failoverToSecondary();

      const updatedMetrics = manager.getMetrics();
      expect(updatedMetrics.failoverCount).toBe(initialCount + 1);
    });
  });

  describe('Metrics', () => {
    it('should return metrics object', () => {
      const metrics = manager.getMetrics();
      expect(metrics).toBeDefined();
      expect(metrics.uptime).toBeDefined();
      expect(metrics.failoverCount).toBeDefined();
      expect(metrics.recoveryTime).toBeDefined();
      expect(metrics.dataLossEvents).toBeDefined();
    });

    it('should track failover count', async () => {
      const initialCount = manager.getMetrics().failoverCount;
      await manager.failoverToSecondary();
      const updatedCount = manager.getMetrics().failoverCount;
      expect(updatedCount).toBe(initialCount + 1);
    });
  });

  describe('Monitoring', () => {
    it('should start monitoring', () => {
      expect(() => manager.startMonitoring()).not.toThrow();
    });
  });
});
