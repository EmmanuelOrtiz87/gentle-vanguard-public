#!/usr/bin/env node

/**
 * Predictive Governor
 * Anticipates load and adjusts budgets proactively
 * Prevents resource exhaustion through prediction
 *
 * Part of Gentle-Vanguard  — Convergence Layer
 */

import { EventEmitter } from 'events';

interface LoadMetrics {
  timestamp: number;
  requestsPerMinute: number;
  tokenUsage: number;
  cost: number;
  errorRate: number;
  latency: number;
  activeSessions: number;
}

interface Prediction {
  timestamp: number;
  horizon: number; // minutes ahead
  predictedLoad: number;
  predictedTokens: number;
  predictedCost: number;
  confidence: number;
  trend: 'increasing' | 'decreasing' | 'stable';
}

interface BudgetAdjustment {
  type: 'increase' | 'decrease' | 'maintain';
  reason: string;
  newBudget: number;
  expectedSavings: number;
  riskLevel: 'low' | 'medium' | 'high';
}

interface GovernorConfig {
  predictionHorizon: number; // minutes
  updateInterval: number; // minutes
  safetyMargin: number; // 0-1
  minBudget: number;
  maxBudget: number;
  smoothingFactor: number;
}

export class PredictiveGovernor extends EventEmitter {
  private config: GovernorConfig;
  private metricsHistory: LoadMetrics[] = [];
  private predictions: Prediction[] = [];
  private currentBudget: number;
  private adjustmentHistory: Array<{
    timestamp: number;
    adjustment: BudgetAdjustment;
    actualOutcome: LoadMetrics;
  }> = [];

  constructor(config: Partial<GovernorConfig> = {}) {
    super();
    this.config = {
      predictionHorizon: config.predictionHorizon || 60,
      updateInterval: config.updateInterval || 5,
      safetyMargin: config.safetyMargin || 0.2,
      minBudget: config.minBudget || 1000,
      maxBudget: config.maxBudget || 10000,
      smoothingFactor: config.smoothingFactor || 0.3,
    };
    this.currentBudget = this.config.minBudget;

    this.startPredictionLoop();
  }

  /**
   * Record current load metrics
   */
  public recordMetrics(metrics: LoadMetrics): void {
    this.metricsHistory.push(metrics);

    // Keep only last 24 hours of data
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    this.metricsHistory = this.metricsHistory.filter((m) => m.timestamp > cutoff);

    this.emit('metricsRecorded', metrics);
  }

  /**
   * Generate predictions for future load
   */
  public predict(): Prediction {
    if (this.metricsHistory.length < 10) {
      return {
        timestamp: Date.now(),
        horizon: this.config.predictionHorizon,
        predictedLoad: 0,
        predictedTokens: 0,
        predictedCost: 0,
        confidence: 0,
        trend: 'stable',
      };
    }

    const recent = this.metricsHistory.slice(-60); // Last hour
    const older = this.metricsHistory.slice(-120, -60); // Previous hour

    // Calculate trends
    const recentAvg = {
      load: recent.reduce((a, m) => a + m.requestsPerMinute, 0) / recent.length,
      tokens: recent.reduce((a, m) => a + m.tokenUsage, 0) / recent.length,
      cost: recent.reduce((a, m) => a + m.cost, 0) / recent.length,
    };

    const olderAvg =
      older.length > 0
        ? {
            load: older.reduce((a, m) => a + m.requestsPerMinute, 0) / older.length,
            tokens: older.reduce((a, m) => a + m.tokenUsage, 0) / older.length,
            cost: older.reduce((a, m) => a + m.cost, 0) / older.length,
          }
        : recentAvg;

    // Calculate growth rates
    const loadGrowth = olderAvg.load > 0 ? (recentAvg.load - olderAvg.load) / olderAvg.load : 0;
    const tokenGrowth =
      olderAvg.tokens > 0 ? (recentAvg.tokens - olderAvg.tokens) / olderAvg.tokens : 0;
    const costGrowth = olderAvg.cost > 0 ? (recentAvg.cost - olderAvg.cost) / olderAvg.cost : 0;

    // Predict future values
    const horizon = this.config.predictionHorizon;
    const predictedLoad = recentAvg.load * (1 + loadGrowth * (horizon / 60));
    const predictedTokens = recentAvg.tokens * (1 + tokenGrowth * (horizon / 60));
    const predictedCost = recentAvg.cost * (1 + costGrowth * (horizon / 60));

    // Determine trend
    let trend: Prediction['trend'] = 'stable';
    if (loadGrowth > 0.1) trend = 'increasing';
    else if (loadGrowth < -0.1) trend = 'decreasing';

    // Calculate confidence based on data quality
    const confidence = Math.min(1, this.metricsHistory.length / 100);

    const prediction: Prediction = {
      timestamp: Date.now(),
      horizon,
      predictedLoad,
      predictedTokens,
      predictedCost,
      confidence,
      trend,
    };

    this.predictions.push(prediction);

    // Keep only last 100 predictions
    if (this.predictions.length > 100) {
      this.predictions = this.predictions.slice(-50);
    }

    this.emit('prediction', prediction);

    return prediction;
  }

  /**
   * Adjust budget based on predictions
   */
  public adjustBudget(): BudgetAdjustment {
    const prediction = this.predict();

    if (prediction.confidence < 0.3) {
      return {
        type: 'maintain',
        reason: 'Insufficient confidence in prediction',
        newBudget: this.currentBudget,
        expectedSavings: 0,
        riskLevel: 'low',
      };
    }

    const requiredBudget = prediction.predictedCost * (1 + this.config.safetyMargin);
    const currentBudget = this.currentBudget;

    let adjustment: BudgetAdjustment;

    if (requiredBudget > currentBudget * 1.2) {
      // Need to increase budget
      const newBudget = Math.min(this.config.maxBudget, requiredBudget);
      adjustment = {
        type: 'increase',
        reason: `Predicted load increase (${prediction.trend}). Required: ${requiredBudget.toFixed(2)}, Current: ${currentBudget.toFixed(2)}`,
        newBudget,
        expectedSavings: 0,
        riskLevel: prediction.trend === 'increasing' ? 'high' : 'medium',
      };
    } else if (requiredBudget < currentBudget * 0.8) {
      // Can decrease budget
      const newBudget = Math.max(this.config.minBudget, requiredBudget);
      adjustment = {
        type: 'decrease',
        reason: `Predicted load decrease (${prediction.trend}). Can reduce from ${currentBudget.toFixed(2)} to ${newBudget.toFixed(2)}`,
        newBudget,
        expectedSavings: currentBudget - newBudget,
        riskLevel: 'low',
      };
    } else {
      // Maintain current budget
      adjustment = {
        type: 'maintain',
        reason: 'Predicted load within acceptable range',
        newBudget: currentBudget,
        expectedSavings: 0,
        riskLevel: 'low',
      };
    }

    // Apply smoothing
    if (adjustment.type !== 'maintain') {
      this.currentBudget =
        this.config.smoothingFactor * this.currentBudget +
        (1 - this.config.smoothingFactor) * adjustment.newBudget;
    }

    this.emit('budgetAdjusted', adjustment);

    return adjustment;
  }

  /**
   * Start prediction loop
   */
  private startPredictionLoop(): void {
    setInterval(
      () => {
        if (this.metricsHistory.length >= 10) {
          this.adjustBudget();
        }
      },
      this.config.updateInterval * 60 * 1000,
    );
  }

  /**
   * Check if budget will be exhausted
   */
  public checkExhaustionRisk(): {
    atRisk: boolean;
    minutesUntilExhaustion: number;
    confidence: number;
  } {
    if (this.metricsHistory.length < 10) {
      return { atRisk: false, minutesUntilExhaustion: Infinity, confidence: 0 };
    }

    const recent = this.metricsHistory.slice(-10);
    const avgConsumption = recent.reduce((a, m) => a + m.cost, 0) / recent.length;
    const remaining = this.currentBudget - recent[recent.length - 1].cost;

    if (avgConsumption <= 0) {
      return { atRisk: false, minutesUntilExhaustion: Infinity, confidence: 0 };
    }

    const minutesUntilExhaustion = remaining / avgConsumption;
    const atRisk = minutesUntilExhaustion < this.config.predictionHorizon;

    return {
      atRisk,
      minutesUntilExhaustion,
      confidence: Math.min(1, this.metricsHistory.length / 50),
    };
  }

  /**
   * Get current budget status
   */
  public getStatus(): object {
    const risk = this.checkExhaustionRisk();
    const latest = this.metricsHistory[this.metricsHistory.length - 1];

    return {
      currentBudget: this.currentBudget,
      currentUsage: latest?.cost || 0,
      remaining: this.currentBudget - (latest?.cost || 0),
      utilization: latest ? latest.cost / this.currentBudget : 0,
      exhaustionRisk: risk,
      lastPrediction: this.predictions[this.predictions.length - 1] || null,
      totalAdjustments: this.adjustmentHistory.length,
    };
  }

  /**
   * Get historical data
   */
  public getHistory(): { metrics: LoadMetrics[]; predictions: Prediction[] } {
    return {
      metrics: [...this.metricsHistory],
      predictions: [...this.predictions],
    };
  }
}

// Export singleton instance
export const predictiveGovernor = new PredictiveGovernor();

// CLI execution
if (require.main === module) {
  console.log('Predictive Governor ');
  console.log('Part of Gentle-Vanguard  — Convergence Layer\n');

  const governor = new PredictiveGovernor({
    predictionHorizon: 30,
    updateInterval: 1,
    safetyMargin: 0.25,
  });

  governor.on('metricsRecorded', (metrics) => {
    console.log(
      `[${new Date().toISOString()}] Metrics recorded: ${metrics.requestsPerMinute} req/min`,
    );
  });

  governor.on('prediction', (prediction) => {
    console.log(`[${new Date().toISOString()}] Prediction: ${prediction.trend}`);
    console.log(
      `  Load: ${prediction.predictedLoad.toFixed(1)}, Cost: ${prediction.predictedCost.toFixed(2)}`,
    );
    console.log(`  Confidence: ${(prediction.confidence * 100).toFixed(0)}%`);
  });

  governor.on('budgetAdjusted', (adjustment) => {
    console.log(`[${new Date().toISOString()}] Budget ${adjustment.type.toUpperCase()}`);
    console.log(`  Reason: ${adjustment.reason}`);
    console.log(`  New budget: ${adjustment.newBudget.toFixed(2)}`);
  });

  // Simulate load
  console.log('Simulating load patterns...\n');

  let count = 0;
  const interval = setInterval(() => {
    // Simulate increasing load
    const baseLoad = 10 + count * 2;
    const variance = Math.random() * 10;

    governor.recordMetrics({
      timestamp: Date.now(),
      requestsPerMinute: baseLoad + variance,
      tokenUsage: (baseLoad + variance) * 100,
      cost: (baseLoad + variance) * 0.01,
      errorRate: Math.random() * 0.05,
      latency: 100 + Math.random() * 200,
      activeSessions: Math.floor(baseLoad / 2),
    });

    // Generate prediction every 5 samples
    if (count % 5 === 0 && count > 0) {
      governor.adjustBudget();
    }

    count++;
    if (count >= 30) {
      clearInterval(interval);

      setTimeout(() => {
        console.log('\n\n--- Governor Status ---');
        console.log(JSON.stringify(governor.getStatus(), null, 2));
      }, 1000);
    }
  }, 500);
}
