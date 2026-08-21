#!/usr/bin/env node

/**
 * Convergence Monitor
 * Detects convergence, oscillation, or divergence in system behavior
 * Auto-adjusts parameters based on real-time metrics
 *
 * Part of Gentle-Vanguard  — Convergence Layer
 */

import { EventEmitter } from 'events';
// Metrics store will be implemented in
// import { MetricsStore } from '../utils/token-metrics-store';

interface ConvergenceConfig {
  windowSize: number; // Number of samples to analyze
  threshold: number; // Convergence threshold (0-1)
  oscillationThreshold: number; // Oscillation detection threshold
  divergenceThreshold: number; // Divergence detection threshold
  autoAdjust: boolean; // Enable auto-adjustment
}

interface SystemMetrics {
  timestamp: number;
  latency: number;
  errorRate: number;
  tokenUsage: number;
  costPerRequest: number;
  healthScore: number;
}

type ConvergenceState = 'converged' | 'oscillating' | 'diverging' | 'unknown';

export class ConvergenceMonitor extends EventEmitter {
  private config: ConvergenceConfig;
  private metricsBuffer: SystemMetrics[] = [];
  private currentState: ConvergenceState = 'unknown';
  private metricsStore: MetricsStore;

  constructor(config: Partial<ConvergenceConfig> = {}) {
    super();
    this.config = {
      windowSize: config.windowSize || 100,
      threshold: config.threshold || 0.95,
      oscillationThreshold: config.oscillationThreshold || 0.3,
      divergenceThreshold: config.divergenceThreshold || 0.1,
      autoAdjust: config.autoAdjust !== false,
    };
    this.metricsStore = new MetricsStore();
  }

  /**
   * Add a new metric sample
   */
  public addMetric(metric: SystemMetrics): void {
    this.metricsBuffer.push(metric);

    // Keep only the last N samples
    if (this.metricsBuffer.length > this.config.windowSize) {
      this.metricsBuffer.shift();
    }

    // Analyze if we have enough samples
    if (this.metricsBuffer.length >= this.config.windowSize * 0.5) {
      this.analyze();
    }
  }

  /**
   * Analyze metrics and detect convergence state
   */
  private analyze(): void {
    const previousState = this.currentState;

    // Calculate variance and trend
    const variance = this.calculateVariance();
    const trend = this.calculateTrend();
    const oscillation = this.detectOscillation();

    // Determine state
    if (variance < this.config.threshold && Math.abs(trend) < 0.05) {
      this.currentState = 'converged';
    } else if (oscillation > this.config.oscillationThreshold) {
      this.currentState = 'oscillating';
    } else if (trend > this.config.divergenceThreshold) {
      this.currentState = 'diverging';
    }

    // Emit state change if different
    if (previousState !== this.currentState) {
      this.emit('stateChange', {
        from: previousState,
        to: this.currentState,
        timestamp: Date.now(),
        metrics: this.getCurrentMetrics(),
      });

      // Auto-adjust if enabled
      if (this.config.autoAdjust) {
        this.autoAdjustParameters();
      }
    }

    // Always emit metrics
    this.emit('metrics', {
      state: this.currentState,
      variance,
      trend,
      oscillation,
      sampleCount: this.metricsBuffer.length,
    });
  }

  /**
   * Calculate variance of metrics
   */
  private calculateVariance(): number {
    if (this.metricsBuffer.length < 2) return 0;

    const values = this.metricsBuffer.map((m) => m.healthScore);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;

    // Normalize to 0-1 range (assuming health score is 0-100)
    return 1 - variance / 10000;
  }

  /**
   * Calculate trend direction and magnitude
   */
  private calculateTrend(): number {
    if (this.metricsBuffer.length < 10) return 0;

    const half = Math.floor(this.metricsBuffer.length / 2);
    const firstHalf = this.metricsBuffer.slice(0, half);
    const secondHalf = this.metricsBuffer.slice(half);

    const firstAvg = firstHalf.reduce((a, m) => a + m.healthScore, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, m) => a + m.healthScore, 0) / secondHalf.length;

    return (secondAvg - firstAvg) / 100; // Normalized trend
  }

  /**
   * Detect oscillation patterns
   */
  private detectOscillation(): number {
    if (this.metricsBuffer.length < 20) return 0;

    const values = this.metricsBuffer.map((m) => m.healthScore);
    let crossings = 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;

    for (let i = 1; i < values.length; i++) {
      if (
        (values[i - 1] < mean && values[i] > mean) ||
        (values[i - 1] > mean && values[i] < mean)
      ) {
        crossings++;
      }
    }

    // Normalize crossings per sample
    return crossings / values.length;
  }

  /**
   * Auto-adjust system parameters based on convergence state
   */
  private autoAdjustParameters(): void {
    const adjustments: Record<ConvergenceState, () => void> = {
      converged: () => {
        // System is stable, can optimize for efficiency
        this.emit('adjustment', {
          type: 'optimization',
          message: 'System converged. Optimizing for efficiency.',
          recommendations: [
            'Reduce sampling frequency',
            'Enable aggressive caching',
            'Lower token budget margins',
          ],
        });
      },
      oscillating: () => {
        // System is oscillating, need to dampen
        this.emit('adjustment', {
          type: 'stabilization',
          message: 'System oscillating. Applying dampening.',
          recommendations: [
            'Increase smoothing window',
            'Reduce auto-scaling sensitivity',
            'Enable rate limiting',
          ],
        });
      },
      diverging: () => {
        // System is diverging, need intervention
        this.emit('adjustment', {
          type: 'intervention',
          message: 'System diverging! Immediate intervention required.',
          recommendations: [
            'Scale up resources immediately',
            'Enable circuit breaker',
            'Alert on-call engineer',
            'Switch to fallback model',
          ],
        });
      },
      unknown: () => {
        // Not enough data
        this.emit('adjustment', {
          type: 'monitoring',
          message: 'Insufficient data for analysis.',
          recommendations: ['Continue monitoring', 'Collect more samples'],
        });
      },
    };

    adjustments[this.currentState]();
  }

  /**
   * Get current convergence state
   */
  public getState(): ConvergenceState {
    return this.currentState;
  }

  /**
   * Get current metrics summary
   */
  public getCurrentMetrics(): Partial<SystemMetrics> {
    if (this.metricsBuffer.length === 0) return {};

    const last = this.metricsBuffer[this.metricsBuffer.length - 1];
    return {
      latency: last.latency,
      errorRate: last.errorRate,
      tokenUsage: last.tokenUsage,
      healthScore: last.healthScore,
    };
  }

  /**
   * Get full metrics history
   */
  public getMetricsHistory(): SystemMetrics[] {
    return [...this.metricsBuffer];
  }

  /**
   * Reset monitor
   */
  public reset(): void {
    this.metricsBuffer = [];
    this.currentState = 'unknown';
    this.emit('reset', { timestamp: Date.now() });
  }
}

// Export singleton instance
export const convergenceMonitor = new ConvergenceMonitor();

// CLI execution
if (require.main === module) {
  console.log('Convergence Monitor ');
  console.log('Part of Gentle-Vanguard  — Convergence Layer\n');

  const monitor = new ConvergenceMonitor({
    windowSize: 50,
    autoAdjust: true,
  });

  // Example usage
  monitor.on('stateChange', (event) => {
    console.log(`[${new Date().toISOString()}] State changed: ${event.from} → ${event.to}`);
  });

  monitor.on('adjustment', (event) => {
    console.log(`[${new Date().toISOString()}] Adjustment: ${event.type}`);
    console.log(`  Message: ${event.message}`);
    console.log(`  Recommendations:`, event.recommendations);
  });

  // Simulate metrics
  setInterval(() => {
    monitor.addMetric({
      timestamp: Date.now(),
      latency: 100 + Math.random() * 50,
      errorRate: Math.random() * 0.05,
      tokenUsage: 1000 + Math.random() * 500,
      costPerRequest: 0.01 + Math.random() * 0.005,
      healthScore: 85 + Math.random() * 15,
    });
  }, 1000);

  console.log('Monitor running. Press Ctrl+C to exit.\n');
}
