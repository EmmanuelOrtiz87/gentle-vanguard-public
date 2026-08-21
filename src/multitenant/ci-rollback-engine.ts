#!/usr/bin/env node

/**
 * CI Rollback Engine
 * Self-healing CI/CD with automatic rollback
 * Part of Gentle-Vanguard
 */

import { EventEmitter } from 'events';

interface Deployment {
  id: string;
  version: string;
  timestamp: number;
  status: 'pending' | 'success' | 'failed' | 'rolledback';
  metrics: {
    latency: number;
    errorRate: number;
    throughput: number;
  };
}

interface RollbackConfig {
  autoRollback: boolean;
  healthCheckInterval: number;
  failureThreshold: number;
  rollbackTimeout: number;
}

export class CIRollbackEngine extends EventEmitter {
  private config: RollbackConfig;
  private deployments: Map<string, Deployment> = new Map();
  private deploymentHistory: string[] = [];
  private healthCheckTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<RollbackConfig> = {}) {
    super();
    this.config = {
      autoRollback: config.autoRollback !== false,
      healthCheckInterval: config.healthCheckInterval || 30000,
      failureThreshold: config.failureThreshold || 3,
      rollbackTimeout: config.rollbackTimeout || 60000,
    };
    this.startHealthChecks();
  }

  public deploy(version: string): string {
    const deploymentId = `deploy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const deployment: Deployment = {
      id: deploymentId,
      version,
      timestamp: Date.now(),
      status: 'pending',
      metrics: { latency: 0, errorRate: 0, throughput: 0 },
    };
    this.deployments.set(deploymentId, deployment);
    this.deploymentHistory.push(deploymentId);
    this.emit('deploymentStarted', deployment);
    return deploymentId;
  }

  public updateMetrics(deploymentId: string, metrics: Partial<Deployment['metrics']>): void {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) return;
    deployment.metrics = { ...deployment.metrics, ...metrics };
    if (deployment.status === 'pending') {
      deployment.status = 'success';
      this.emit('deploymentSuccess', deployment);
    }
    if (this.shouldRollback(deployment)) {
      this.rollback(deploymentId);
    }
  }

  private shouldRollback(deployment: Deployment): boolean {
    return (
      deployment.metrics.errorRate > 0.05 ||
      deployment.metrics.latency > 5000 ||
      deployment.metrics.throughput < 10
    );
  }

  public rollback(deploymentId: string): void {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) return;
    deployment.status = 'rolledback';
    this.emit('rollbackStarted', { deploymentId, version: deployment.version });
    setTimeout(() => {
      this.emit('rollbackCompleted', { deploymentId, success: true });
    }, 5000);
  }

  private startHealthChecks(): void {
    if (!this.config.autoRollback) return;
    this.healthCheckTimer = setInterval(() => {
      this.deployments.forEach((deployment, id) => {
        if (deployment.status === 'success' && this.shouldRollback(deployment)) {
          this.rollback(id);
        }
      });
    }, this.config.healthCheckInterval);
  }

  public getStats(): object {
    const deps = Array.from(this.deployments.values());
    return {
      totalDeployments: deps.length,
      successful: deps.filter((d) => d.status === 'success').length,
      failed: deps.filter((d) => d.status === 'failed').length,
      rolledback: deps.filter((d) => d.status === 'rolledback').length,
      autoRollbackEnabled: this.config.autoRollback,
    };
  }

  public stop(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }
}

export const ciRollbackEngine = new CIRollbackEngine();
