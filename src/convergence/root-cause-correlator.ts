#!/usr/bin/env node

/**
 * Root-Cause Correlator
 * Cross-component failure correlation and root cause identification
 * Integrates with Tracing and Event Sourcing
 *
 * Part of Gentle-Vanguard  — Convergence Layer
 */

import { EventEmitter } from 'events';

interface FailureEvent {
  id: string;
  timestamp: number;
  component: string;
  errorType: string;
  errorMessage: string;
  stackTrace?: string;
  context: Record<string, any>;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

interface Correlation {
  id: string;
  primaryEvent: FailureEvent;
  relatedEvents: FailureEvent[];
  rootCause: RootCause;
  confidence: number;
  correlationChain: string[];
  timeSpan: number;
}

interface RootCause {
  component: string;
  errorType: string;
  description: string;
  contributingFactors: string[];
  recommendedActions: string[];
}

interface CorrelationRule {
  id: string;
  name: string;
  pattern: {
    primaryError: string;
    relatedErrors: string[];
    timeWindow: number;
    componentChain: string[];
  };
  rootCauseTemplate: Partial<RootCause>;
}

interface CorrelatorConfig {
  timeWindow: number;
  minCorrelationConfidence: number;
  maxCorrelationDepth: number;
  enableML: boolean;
}

export class RootCauseCorrelator extends EventEmitter {
  private config: CorrelatorConfig;
  private failureHistory: FailureEvent[] = [];
  private correlations: Correlation[] = [];
  private correlationRules: CorrelationRule[] = [];
  private componentGraph: Map<string, Set<string>> = new Map();

  constructor(config: Partial<CorrelatorConfig> = {}) {
    super();
    this.config = {
      timeWindow: config.timeWindow || 300000, // 5 minutes
      minCorrelationConfidence: config.minCorrelationConfidence || 0.7,
      maxCorrelationDepth: config.maxCorrelationDepth || 5,
      enableML: config.enableML !== false,
    };

    this.initializeDefaultRules();
  }

  /**
   * Initialize default correlation rules
   */
  private initializeDefaultRules(): void {
    this.correlationRules = [
      {
        id: 'rule_db_connection',
        name: 'Database Connection Failure Cascade',
        pattern: {
          primaryError: 'ECONNREFUSED|connection timeout',
          relatedErrors: ['query failed', 'transaction rollback', 'cache miss'],
          timeWindow: 60000,
          componentChain: ['database', 'api', 'cache', 'frontend'],
        },
        rootCauseTemplate: {
          component: 'database',
          errorType: 'connection_failure',
          description: 'Database connection failure causing cascade of dependent service failures',
          contributingFactors: [
            'Database server overload',
            'Network connectivity issues',
            'Connection pool exhaustion',
          ],
          recommendedActions: [
            'Check database server health',
            'Verify network connectivity',
            'Increase connection pool size',
            'Implement circuit breaker',
          ],
        },
      },
      {
        id: 'rule_memory_leak',
        name: 'Memory Leak Detection',
        pattern: {
          primaryError: 'OutOfMemory|heap exhausted',
          relatedErrors: ['GC overhead limit', 'slow response', 'timeout'],
          timeWindow: 300000,
          componentChain: ['worker', 'api', 'queue'],
        },
        rootCauseTemplate: {
          component: 'worker',
          errorType: 'memory_leak',
          description: 'Memory leak causing service degradation and eventual failure',
          contributingFactors: [
            'Unclosed connections',
            'Large object retention',
            'Event listener accumulation',
          ],
          recommendedActions: [
            'Profile memory usage',
            'Check for unclosed resources',
            'Review event listeners',
            'Implement memory limits',
          ],
        },
      },
      {
        id: 'rule_rate_limit',
        name: 'Rate Limiting Cascade',
        pattern: {
          primaryError: '429|rate limit|throttle',
          relatedErrors: ['queue full', 'retry storm', 'degraded performance'],
          timeWindow: 120000,
          componentChain: ['gateway', 'api', 'queue'],
        },
        rootCauseTemplate: {
          component: 'gateway',
          errorType: 'rate_limiting',
          description: 'Rate limiting causing request queuing and service degradation',
          contributingFactors: [
            'Sudden traffic spike',
            'Insufficient rate limits',
            'Missing backoff strategy',
          ],
          recommendedActions: [
            'Implement exponential backoff',
            'Increase rate limits temporarily',
            'Add traffic shaping',
            'Scale affected services',
          ],
        },
      },
    ];
  }

  /**
   * Register a failure event
   */
  public registerFailure(event: Omit<FailureEvent, 'id'>): string {
    const failureEvent: FailureEvent = {
      ...event,
      id: `failure_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    };

    this.failureHistory.push(failureEvent);

    // Prune old failures
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    this.failureHistory = this.failureHistory.filter((f) => f.timestamp > cutoff);

    // Attempt correlation
    this.correlate(failureEvent);

    this.emit('failureRegistered', failureEvent);

    return failureEvent.id;
  }

  /**
   * Correlate a failure event with existing events
   */
  private correlate(event: FailureEvent): void {
    // Find related events within time window
    const relatedEvents = this.findRelatedEvents(event);

    if (relatedEvents.length === 0) return;

    // Apply correlation rules
    for (const rule of this.correlationRules) {
      const match = this.applyRule(rule, event, relatedEvents);

      if (match.confidence >= this.config.minCorrelationConfidence) {
        const correlation: Correlation = {
          id: `corr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          primaryEvent: event,
          relatedEvents: match.matchedEvents,
          rootCause: this.generateRootCause(rule, event, match.matchedEvents),
          confidence: match.confidence,
          correlationChain: this.buildCorrelationChain(event, match.matchedEvents),
          timeSpan:
            Math.max(...match.matchedEvents.map((e) => e.timestamp)) -
            Math.min(event.timestamp, ...match.matchedEvents.map((e) => e.timestamp)),
        };

        this.correlations.push(correlation);

        this.emit('correlationFound', correlation);

        // Keep only last 100 correlations
        if (this.correlations.length > 100) {
          this.correlations = this.correlations.slice(-50);
        }

        break; // Stop after first match
      }
    }
  }

  /**
   * Find related events within time window
   */
  private findRelatedEvents(event: FailureEvent): FailureEvent[] {
    const windowStart = event.timestamp - this.config.timeWindow;
    const windowEnd = event.timestamp + this.config.timeWindow;

    return this.failureHistory.filter(
      (f) => f.id !== event.id && f.timestamp >= windowStart && f.timestamp <= windowEnd,
    );
  }

  /**
   * Apply a correlation rule
   */
  private applyRule(
    rule: CorrelationRule,
    primaryEvent: FailureEvent,
    candidates: FailureEvent[],
  ): { confidence: number; matchedEvents: FailureEvent[] } {
    const matchedEvents: FailureEvent[] = [];

    // Check if primary matches
    const primaryRegex = new RegExp(rule.pattern.primaryError, 'i');
    if (!primaryRegex.test(primaryEvent.errorMessage)) {
      return { confidence: 0, matchedEvents: [] };
    }

    // Find related matches
    for (const relatedError of rule.pattern.relatedErrors) {
      const relatedRegex = new RegExp(relatedError, 'i');
      const match = candidates.find(
        (c) => relatedRegex.test(c.errorMessage) && !matchedEvents.some((m) => m.id === c.id),
      );

      if (match) {
        matchedEvents.push(match);
      }
    }

    // Calculate confidence
    const expectedMatches = rule.pattern.relatedErrors.length;
    const actualMatches = matchedEvents.length;
    const matchRatio = actualMatches / expectedMatches;

    // Component chain bonus
    const componentBonus = this.checkComponentChain(rule.pattern.componentChain, [
      primaryEvent,
      ...matchedEvents,
    ])
      ? 0.2
      : 0;

    const confidence = Math.min(1, matchRatio + componentBonus);

    return { confidence, matchedEvents };
  }

  /**
   * Check if events follow expected component chain
   */
  private checkComponentChain(expectedChain: string[], events: FailureEvent[]): boolean {
    const actualChain = events.map((e) => e.component);

    // Check if actual chain is a subsequence of expected chain
    let expectedIndex = 0;
    for (const component of actualChain) {
      while (expectedIndex < expectedChain.length && expectedChain[expectedIndex] !== component) {
        expectedIndex++;
      }
      if (expectedIndex >= expectedChain.length) return false;
      expectedIndex++;
    }

    return true;
  }

  /**
   * Generate root cause analysis
   */
  private generateRootCause(
    rule: CorrelationRule,
    primaryEvent: FailureEvent,
    relatedEvents: FailureEvent[],
  ): RootCause {
    return {
      component: rule.rootCauseTemplate.component || primaryEvent.component,
      errorType: rule.rootCauseTemplate.errorType || primaryEvent.errorType,
      description: rule.rootCauseTemplate.description || primaryEvent.errorMessage,
      contributingFactors: [
        ...(rule.rootCauseTemplate.contributingFactors || []),
        ...relatedEvents.map((e) => `${e.component}: ${e.errorType}`),
      ],
      recommendedActions: rule.rootCauseTemplate.recommendedActions || [
        'Investigate primary component',
        'Check related services',
        'Review logs for patterns',
      ],
    };
  }

  /**
   * Build correlation chain
   */
  private buildCorrelationChain(primary: FailureEvent, related: FailureEvent[]): string[] {
    const chain = [primary.component];

    // Sort by timestamp
    const sorted = [...related].sort((a, b) => a.timestamp - b.timestamp);

    for (const event of sorted) {
      if (!chain.includes(event.component)) {
        chain.push(event.component);
      }
    }

    return chain;
  }

  /**
   * Get correlations for a component
   */
  public getCorrelationsForComponent(component: string): Correlation[] {
    return this.correlations.filter(
      (c) =>
        c.primaryEvent.component === component ||
        c.relatedEvents.some((e) => e.component === component),
    );
  }

  /**
   * Get failure statistics
   */
  public getStats(): object {
    const byComponent: Record<string, number> = {};
    const byErrorType: Record<string, number> = {};

    this.failureHistory.forEach((f) => {
      byComponent[f.component] = (byComponent[f.component] || 0) + 1;
      byErrorType[f.errorType] = (byErrorType[f.errorType] || 0) + 1;
    });

    return {
      totalFailures: this.failureHistory.length,
      totalCorrelations: this.correlations.length,
      byComponent,
      byErrorType,
      correlationRate: this.correlations.length / Math.max(1, this.failureHistory.length),
      avgCorrelationConfidence:
        this.correlations.length > 0
          ? this.correlations.reduce((a, c) => a + c.confidence, 0) / this.correlations.length
          : 0,
    };
  }

  /**
   * Export correlation data
   */
  public exportData(): { failures: FailureEvent[]; correlations: Correlation[] } {
    return {
      failures: [...this.failureHistory],
      correlations: [...this.correlations],
    };
  }
}

// Export singleton instance
export const rootCauseCorrelator = new RootCauseCorrelator();

// CLI execution
if (require.main === module) {
  console.log('Root-Cause Correlator ');
  console.log('Part of Gentle-Vanguard  — Convergence Layer\n');

  const correlator = new RootCauseCorrelator();

  correlator.on('failureRegistered', (event) => {
    console.log(`[${new Date().toISOString()}] Failure registered: ${event.component}`);
    console.log(`  Error: ${event.errorType} - ${event.errorMessage}`);
  });

  correlator.on('correlationFound', (correlation) => {
    console.log('\n' + '='.repeat(60));
    console.log('CORRELATION FOUND');
    console.log('='.repeat(60));
    console.log(`ID: ${correlation.id}`);
    console.log(`Confidence: ${(correlation.confidence * 100).toFixed(0)}%`);
    console.log(`\nRoot Cause:`);
    console.log(`  Component: ${correlation.rootCause.component}`);
    console.log(`  Type: ${correlation.rootCause.errorType}`);
    console.log(`  Description: ${correlation.rootCause.description}`);
    console.log(`\nCorrelation Chain: ${correlation.correlationChain.join(' → ')}`);
    console.log(`\nRecommended Actions:`);
    correlation.rootCause.recommendedActions.forEach((action) => {
      console.log(`  • ${action}`);
    });
  });

  // Simulate failure cascade
  console.log('Simulating failure cascade...\n');

  // Primary failure
  setTimeout(() => {
    correlator.registerFailure({
      timestamp: Date.now(),
      component: 'database',
      errorType: 'connection_failure',
      errorMessage: 'ECONNREFUSED: Connection to database refused',
      severity: 'critical',
      context: { host: 'db.internal', port: 5432 },
    });
  }, 100);

  // Cascade failures
  setTimeout(() => {
    correlator.registerFailure({
      timestamp: Date.now(),
      component: 'api',
      errorType: 'query_failed',
      errorMessage: 'Query failed: connection timeout',
      severity: 'high',
      context: { query: 'SELECT * FROM users' },
    });
  }, 500);

  setTimeout(() => {
    correlator.registerFailure({
      timestamp: Date.now(),
      component: 'cache',
      errorType: 'cache_miss',
      errorMessage: 'Cache miss: unable to fetch from database',
      severity: 'medium',
      context: { key: 'user:123' },
    });
  }, 1000);

  setTimeout(() => {
    console.log('\n\n--- Correlator Statistics ---');
    console.log(JSON.stringify(correlator.getStats(), null, 2));
  }, 2000);
}
