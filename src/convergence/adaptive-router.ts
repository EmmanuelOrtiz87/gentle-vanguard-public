#!/usr/bin/env node

/**
 * Adaptive Router
 * Dynamic routing based on historical performance data
 * Learns optimal paths through continuous feedback
 *
 * Part of Gentle-Vanguard  — Convergence Layer
 */

import { EventEmitter } from 'events';

interface Route {
  id: string;
  path: string[];
  metrics: RouteMetrics;
  weight: number;
  lastUsed: number;
  successCount: number;
  failureCount: number;
}

interface RouteMetrics {
  avgLatency: number;
  avgCost: number;
  successRate: number;
  throughput: number;
  lastUpdated: number;
}

interface RoutingDecision {
  routeId: string;
  confidence: number;
  reason: string;
  estimatedLatency: number;
  estimatedCost: number;
}

interface RouterConfig {
  learningRate: number;
  explorationRate: number;
  minSamples: number;
  maxRoutes: number;
  decayFactor: number;
}

export class AdaptiveRouter extends EventEmitter {
  private config: RouterConfig;
  private routes: Map<string, Route> = new Map();
  private decisionHistory: Array<{
    timestamp: number;
    input: string;
    decision: RoutingDecision;
    actualOutcome: { latency: number; cost: number; success: boolean };
  }> = [];

  constructor(config: Partial<RouterConfig> = {}) {
    super();
    this.config = {
      learningRate: config.learningRate || 0.1,
      explorationRate: config.explorationRate || 0.2,
      minSamples: config.minSamples || 10,
      maxRoutes: config.maxRoutes || 50,
      decayFactor: config.decayFactor || 0.95,
    };
  }

  /**
   * Register a new route
   */
  public registerRoute(path: string[]): string {
    const routeId = `route_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const route: Route = {
      id: routeId,
      path,
      metrics: {
        avgLatency: 0,
        avgCost: 0,
        successRate: 1,
        throughput: 0,
        lastUpdated: Date.now(),
      },
      weight: 1 / (this.routes.size + 1),
      lastUsed: 0,
      successCount: 0,
      failureCount: 0,
    };

    this.routes.set(routeId, route);

    // Normalize weights
    this.normalizeWeights();

    this.emit('routeRegistered', { routeId, path });

    return routeId;
  }

  /**
   * Route a request to the optimal path
   */
  public route(
    input: string,
    constraints?: { maxLatency?: number; maxCost?: number },
  ): RoutingDecision {
    const availableRoutes = Array.from(this.routes.values()).filter((route) => {
      if (constraints?.maxLatency && route.metrics.avgLatency > constraints.maxLatency) {
        return false;
      }
      if (constraints?.maxCost && route.metrics.avgCost > constraints.maxCost) {
        return false;
      }
      return true;
    });

    if (availableRoutes.length === 0) {
      // Fallback to any route
      availableRoutes.push(...this.routes.values());
    }

    // Exploration vs Exploitation
    const shouldExplore = Math.random() < this.config.explorationRate;

    let selectedRoute: Route;

    if (
      shouldExplore &&
      availableRoutes.some((r) => r.metrics.throughput < this.config.minSamples)
    ) {
      // Explore: pick under-sampled route
      selectedRoute = availableRoutes
        .filter((r) => r.metrics.throughput < this.config.minSamples)
        .sort((a, b) => a.metrics.throughput - b.metrics.throughput)[0];
    } else {
      // Exploit: pick best weighted route
      selectedRoute = availableRoutes.sort((a, b) => b.weight - a.weight)[0];
    }

    const decision: RoutingDecision = {
      routeId: selectedRoute.id,
      confidence: this.calculateConfidence(selectedRoute),
      reason: shouldExplore ? 'exploration' : 'exploitation',
      estimatedLatency: selectedRoute.metrics.avgLatency,
      estimatedCost: selectedRoute.metrics.avgCost,
    };

    selectedRoute.lastUsed = Date.now();

    this.emit('routed', { input, decision });

    return decision;
  }

  /**
   * Update route metrics based on actual outcome
   */
  public updateOutcome(
    routeId: string,
    outcome: { latency: number; cost: number; success: boolean },
  ): void {
    const route = this.routes.get(routeId);
    if (!route) return;

    // Update metrics using exponential moving average
    const alpha = this.config.learningRate;

    if (route.metrics.throughput === 0) {
      // First sample
      route.metrics.avgLatency = outcome.latency;
      route.metrics.avgCost = outcome.cost;
      route.metrics.successRate = outcome.success ? 1 : 0;
    } else {
      route.metrics.avgLatency = (1 - alpha) * route.metrics.avgLatency + alpha * outcome.latency;
      route.metrics.avgCost = (1 - alpha) * route.metrics.avgCost + alpha * outcome.cost;
      route.metrics.successRate =
        (1 - alpha) * route.metrics.successRate + alpha * (outcome.success ? 1 : 0);
    }

    route.metrics.throughput++;
    route.metrics.lastUpdated = Date.now();

    if (outcome.success) {
      route.successCount++;
    } else {
      route.failureCount++;
    }

    // Update weight based on performance
    this.updateWeight(route);

    // Record decision history
    this.decisionHistory.push({
      timestamp: Date.now(),
      input: '',
      decision: {
        routeId,
        confidence: 0,
        reason: 'feedback',
        estimatedLatency: 0,
        estimatedCost: 0,
      },
      actualOutcome: outcome,
    });

    // Prune old history
    if (this.decisionHistory.length > 1000) {
      this.decisionHistory = this.decisionHistory.slice(-500);
    }

    this.emit('outcomeUpdated', { routeId, outcome, metrics: route.metrics });
  }

  /**
   * Update route weight based on performance
   */
  private updateWeight(route: Route): void {
    // Calculate performance score
    const latencyScore = Math.max(0, 1 - route.metrics.avgLatency / 10000); // Normalize to 0-1
    const costScore = Math.max(0, 1 - route.metrics.avgCost / 100); // Normalize to 0-1
    const successScore = route.metrics.successRate;

    const performanceScore = (latencyScore + costScore + successScore) / 3;

    // Update weight
    route.weight =
      (1 - this.config.learningRate) * route.weight + this.config.learningRate * performanceScore;

    // Normalize all weights
    this.normalizeWeights();
  }

  /**
   * Normalize route weights
   */
  private normalizeWeights(): void {
    const routes = Array.from(this.routes.values());
    const totalWeight = routes.reduce((sum, r) => sum + r.weight, 0);

    if (totalWeight > 0) {
      routes.forEach((route) => {
        route.weight = route.weight / totalWeight;
      });
    }
  }

  /**
   * Calculate confidence in a route
   */
  private calculateConfidence(route: Route): number {
    if (route.metrics.throughput < this.config.minSamples) {
      return route.metrics.throughput / this.config.minSamples;
    }
    return Math.min(1, route.metrics.successRate * (1 - 1 / route.metrics.throughput));
  }

  /**
   * Get optimal route for a specific pattern
   */
  public getOptimalRoute(pattern: string): Route | null {
    const matchingRoutes = Array.from(this.routes.values())
      .filter((r) => r.path.some((p) => p.includes(pattern)))
      .sort((a, b) => b.weight - a.weight);

    return matchingRoutes[0] || null;
  }

  /**
   * Get routing statistics
   */
  public getStats(): object {
    const routes = Array.from(this.routes.values());

    return {
      totalRoutes: routes.length,
      totalDecisions: this.decisionHistory.length,
      avgSuccessRate: routes.reduce((a, r) => a + r.metrics.successRate, 0) / routes.length || 0,
      avgLatency: routes.reduce((a, r) => a + r.metrics.avgLatency, 0) / routes.length || 0,
      avgCost: routes.reduce((a, r) => a + r.metrics.avgCost, 0) / routes.length || 0,
      topRoutes: routes
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 5)
        .map((r) => ({
          id: r.id,
          path: r.path.join(' → '),
          weight: r.weight.toFixed(3),
          successRate: (r.metrics.successRate * 100).toFixed(1) + '%',
        })),
    };
  }

  /**
   * Export routing model
   */
  public exportModel(): object {
    return {
      routes: Array.from(this.routes.entries()),
      config: this.config,
      timestamp: Date.now(),
    };
  }

  /**
   * Import routing model
   */
  public importModel(model: { routes: [string, Route][]; config: RouterConfig }): void {
    this.routes = new Map(model.routes);
    this.config = { ...this.config, ...model.config };
    this.emit('modelImported', { timestamp: Date.now(), routes: this.routes.size });
  }

  /**
   * Apply temporal decay to old routes
   */
  public applyDecay(): void {
    const now = Date.now();

    this.routes.forEach((route) => {
      const daysSinceUse = (now - route.lastUsed) / (1000 * 60 * 60 * 24);
      if (daysSinceUse > 7) {
        route.weight *= Math.pow(this.config.decayFactor, daysSinceUse / 7);
      }
    });

    this.normalizeWeights();
  }
}

// Export singleton instance
export const adaptiveRouter = new AdaptiveRouter();

// CLI execution
if (require.main === module) {
  console.log('Adaptive Router ');
  console.log('Part of Gentle-Vanguard  — Convergence Layer\n');

  const router = new AdaptiveRouter({
    learningRate: 0.2,
    explorationRate: 0.3,
  });

  router.on('routeRegistered', (event) => {
    console.log(`[${new Date().toISOString()}] Route registered: ${event.routeId}`);
  });

  router.on('routed', (event) => {
    console.log(
      `[${new Date().toISOString()}] Routed to: ${event.decision.routeId} (${event.decision.reason})`,
    );
  });

  router.on('outcomeUpdated', (event) => {
    console.log(`[${new Date().toISOString()}] Outcome updated for ${event.routeId}`);
    console.log(`  Success: ${event.outcome.success}, Latency: ${event.outcome.latency}ms`);
  });

  // Register sample routes
  console.log('Registering routes...\n');
  const route1 = router.registerRoute(['fast-model', 'cache', 'response']);
  const route2 = router.registerRoute(['balanced-model', 'queue', 'response']);
  const route3 = router.registerRoute(['accurate-model', 'process', 'response']);

  // Simulate routing decisions
  console.log('Simulating routing decisions...\n');

  let count = 0;
  const interval = setInterval(() => {
    const decision = router.route(`request_${count}`);

    // Simulate outcome
    const success = Math.random() > 0.1;
    router.updateOutcome(decision.routeId, {
      latency: 100 + Math.random() * 500,
      cost: 0.01 + Math.random() * 0.05,
      success,
    });

    count++;
    if (count >= 30) {
      clearInterval(interval);

      setTimeout(() => {
        console.log('\n\n--- Routing Statistics ---');
        console.log(JSON.stringify(router.getStats(), null, 2));
      }, 500);
    }
  }, 200);
}
