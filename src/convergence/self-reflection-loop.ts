#!/usr/bin/env node

/**
 * Self-Reflection Loop
 * Meta-cognitive analysis and improvement suggestions
 * Continuous self-optimization through introspection
 *
 * Part of Gentle-Vanguard  — Convergence Layer
 */

import { EventEmitter } from 'events';

interface ReflectionConfig {
  reflectionInterval: number; // Minutes between reflections
  minObservations: number; // Minimum observations before reflection
  suggestionThreshold: number; // Confidence threshold for suggestions
  maxSuggestions: number; // Maximum suggestions per reflection
}

interface PerformanceMetrics {
  timestamp: number;
  taskType: string;
  success: boolean;
  duration: number;
  tokenUsage: number;
  errorType?: string;
  complexity: 'low' | 'medium' | 'high';
}

interface Reflection {
  id: string;
  timestamp: number;
  period: { start: number; end: number };
  observations: string[];
  patterns: Pattern[];
  suggestions: Suggestion[];
  insights: string[];
}

interface Pattern {
  type: 'success' | 'failure' | 'inefficiency' | 'strength';
  description: string;
  frequency: number;
  confidence: number;
  examples: string[];
}

interface Suggestion {
  id: string;
  category: 'process' | 'skill' | 'tool' | 'strategy';
  description: string;
  priority: 'low' | 'medium' | 'high';
  confidence: number;
  expectedImpact: string;
  implementationSteps: string[];
}

export class SelfReflectionLoop extends EventEmitter {
  private config: ReflectionConfig;
  private metrics: PerformanceMetrics[] = [];
  private reflections: Reflection[] = [];
  private reflectionTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<ReflectionConfig> = {}) {
    super();
    this.config = {
      reflectionInterval: config.reflectionInterval || 60,
      minObservations: config.minObservations || 10,
      suggestionThreshold: config.suggestionThreshold || 0.7,
      maxSuggestions: config.maxSuggestions || 5,
    };

    this.startReflectionLoop();
  }

  /**
   * Record a performance metric
   */
  public recordMetric(metric: PerformanceMetrics): void {
    this.metrics.push(metric);

    // Trigger reflection if we have enough observations
    if (
      this.metrics.length >= this.config.minObservations &&
      this.metrics.length % this.config.minObservations === 0
    ) {
      this.triggerReflection();
    }
  }

  /**
   * Start the reflection loop
   */
  private startReflectionLoop(): void {
    if (this.reflectionTimer) return;

    this.reflectionTimer = setInterval(
      () => {
        if (this.metrics.length >= this.config.minObservations) {
          this.triggerReflection();
        }
      },
      this.config.reflectionInterval * 60 * 1000,
    );

    this.emit('loopStarted', {
      timestamp: Date.now(),
      interval: this.config.reflectionInterval,
    });
  }

  /**
   * Trigger a reflection cycle
   */
  public triggerReflection(): Reflection | null {
    if (this.metrics.length < this.config.minObservations) {
      return null;
    }

    const now = Date.now();
    const periodStart = this.metrics[0].timestamp;
    const periodEnd = this.metrics[this.metrics.length - 1].timestamp;

    // Analyze patterns
    const patterns = this.analyzePatterns();

    // Generate suggestions
    const suggestions = this.generateSuggestions(patterns);

    // Generate insights
    const insights = this.generateInsights(patterns);

    // Create reflection
    const reflection: Reflection = {
      id: `reflection_${now}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: now,
      period: { start: periodStart, end: periodEnd },
      observations: this.extractObservations(),
      patterns,
      suggestions,
      insights,
    };

    this.reflections.push(reflection);

    // Emit reflection event
    this.emit('reflection', reflection);

    // Clear processed metrics (keep last 20% for continuity)
    const keepCount = Math.floor(this.metrics.length * 0.2);
    this.metrics = this.metrics.slice(-keepCount);

    return reflection;
  }

  /**
   * Analyze patterns in metrics
   */
  private analyzePatterns(): Pattern[] {
    const patterns: Pattern[] = [];

    // Pattern 1: Success rate by task type
    const byTaskType = this.groupBy(this.metrics, 'taskType');
    for (const [taskType, metrics] of Object.entries(byTaskType)) {
      const successRate = metrics.filter((m) => m.success).length / metrics.length;

      if (successRate > 0.9) {
        patterns.push({
          type: 'strength',
          description: `High success rate (${(successRate * 100).toFixed(1)}%) in ${taskType} tasks`,
          frequency: metrics.length,
          confidence: successRate,
          examples: metrics
            .slice(0, 3)
            .map((m) => `${m.taskType}: ${m.success ? 'success' : 'failure'}`),
        });
      } else if (successRate < 0.5) {
        patterns.push({
          type: 'failure',
          description: `Low success rate (${(successRate * 100).toFixed(1)}%) in ${taskType} tasks`,
          frequency: metrics.length,
          confidence: 1 - successRate,
          examples: metrics
            .filter((m) => !m.success)
            .slice(0, 3)
            .map((m) => `${m.taskType}: ${m.errorType || 'unknown error'}`),
        });
      }
    }

    // Pattern 2: Token usage inefficiency
    const avgTokenUsage = this.metrics.reduce((a, m) => a + m.tokenUsage, 0) / this.metrics.length;
    const highTokenTasks = this.metrics.filter((m) => m.tokenUsage > avgTokenUsage * 1.5);

    if (highTokenTasks.length > this.metrics.length * 0.3) {
      patterns.push({
        type: 'inefficiency',
        description: `High token usage detected in ${highTokenTasks.length} tasks (>1.5x average)`,
        frequency: highTokenTasks.length,
        confidence: 0.8,
        examples: highTokenTasks.slice(0, 3).map((m) => `${m.taskType}: ${m.tokenUsage} tokens`),
      });
    }

    // Pattern 3: Duration vs complexity
    const highDurationLowComplexity = this.metrics.filter(
      (m) => m.complexity === 'low' && m.duration > 60000,
    );

    if (highDurationLowComplexity.length > 3) {
      patterns.push({
        type: 'inefficiency',
        description: 'Simple tasks taking too long - potential optimization opportunity',
        frequency: highDurationLowComplexity.length,
        confidence: 0.75,
        examples: highDurationLowComplexity
          .slice(0, 3)
          .map((m) => `${m.taskType}: ${(m.duration / 1000).toFixed(1)}s`),
      });
    }

    return patterns;
  }

  /**
   * Generate improvement suggestions
   */
  private generateSuggestions(patterns: Pattern[]): Suggestion[] {
    const suggestions: Suggestion[] = [];

    patterns.forEach((pattern) => {
      if (pattern.confidence < this.config.suggestionThreshold) return;

      switch (pattern.type) {
        case 'failure':
          suggestions.push({
            id: `sugg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            category: 'skill',
            description: `Improve ${pattern.description.split('in')[1]?.trim() || 'task execution'}`,
            priority: 'high',
            confidence: pattern.confidence,
            expectedImpact: 'Reduce error rate by 50%',
            implementationSteps: [
              'Review failed task patterns',
              'Identify common error types',
              'Update skill definitions',
              'Add error handling',
              'Test with sample cases',
            ],
          });
          break;

        case 'inefficiency':
          if (pattern.description.includes('token')) {
            suggestions.push({
              id: `sugg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
              category: 'process',
              description: 'Optimize token usage for cost efficiency',
              priority: 'medium',
              confidence: pattern.confidence,
              expectedImpact: 'Reduce token consumption by 30%',
              implementationSteps: [
                'Analyze high-token tasks',
                'Implement context compression',
                'Use cheaper models for simple tasks',
                'Add token budget alerts',
                'Monitor improvement',
              ],
            });
          } else {
            suggestions.push({
              id: `sugg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
              category: 'tool',
              description: 'Optimize task execution time',
              priority: 'medium',
              confidence: pattern.confidence,
              expectedImpact: 'Reduce execution time by 40%',
              implementationSteps: [
                'Profile slow tasks',
                'Identify bottlenecks',
                'Implement caching',
                'Parallelize where possible',
                'Measure improvements',
              ],
            });
          }
          break;

        case 'strength':
          suggestions.push({
            id: `sugg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            category: 'strategy',
            description: `Leverage strength: ${pattern.description}`,
            priority: 'low',
            confidence: pattern.confidence,
            expectedImpact: 'Increase throughput by 25%',
            implementationSteps: [
              'Document best practices',
              'Apply pattern to similar tasks',
              'Share with team',
              'Create template',
              'Monitor adoption',
            ],
          });
          break;
      }
    });

    // Sort by priority and confidence, take top N
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    suggestions.sort((a, b) => {
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return b.confidence - a.confidence;
    });

    return suggestions.slice(0, this.config.maxSuggestions);
  }

  /**
   * Generate insights from patterns
   */
  private generateInsights(patterns: Pattern[]): string[] {
    const insights: string[] = [];

    // Calculate overall statistics
    const successRate = this.metrics.filter((m) => m.success).length / this.metrics.length;
    const avgDuration = this.metrics.reduce((a, m) => a + m.duration, 0) / this.metrics.length;
    const avgTokens = this.metrics.reduce((a, m) => a + m.tokenUsage, 0) / this.metrics.length;

    insights.push(`Overall success rate: ${(successRate * 100).toFixed(1)}%`);
    insights.push(`Average task duration: ${(avgDuration / 1000).toFixed(1)}s`);
    insights.push(`Average token usage: ${avgTokens.toFixed(0)} tokens per task`);

    // Add pattern-based insights
    const failurePatterns = patterns.filter((p) => p.type === 'failure');
    if (failurePatterns.length > 0) {
      insights.push(`Identified ${failurePatterns.length} areas needing improvement`);
    }

    const strengthPatterns = patterns.filter((p) => p.type === 'strength');
    if (strengthPatterns.length > 0) {
      insights.push(`Leveraging ${strengthPatterns.length} identified strengths`);
    }

    return insights;
  }

  /**
   * Extract observations from metrics
   */
  private extractObservations(): string[] {
    return this.metrics.map(
      (m) =>
        `${m.taskType} (${m.complexity}): ${m.success ? 'completed' : 'failed'} in ${(m.duration / 1000).toFixed(1)}s`,
    );
  }

  /**
   * Group array by key
   */
  private groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
    return array.reduce(
      (result, item) => {
        const groupKey = String(item[key]);
        result[groupKey] = result[groupKey] || [];
        result[groupKey].push(item);
        return result;
      },
      {} as Record<string, T[]>,
    );
  }

  /**
   * Get reflection history
   */
  public getReflections(): Reflection[] {
    return [...this.reflections];
  }

  /**
   * Get latest reflection
   */
  public getLatestReflection(): Reflection | null {
    return this.reflections[this.reflections.length - 1] || null;
  }

  /**
   * Get performance summary
   */
  public getSummary(): object {
    const total = this.metrics.length;
    const successful = this.metrics.filter((m) => m.success).length;
    const avgDuration = total > 0 ? this.metrics.reduce((a, m) => a + m.duration, 0) / total : 0;

    return {
      totalTasks: total,
      successfulTasks: successful,
      failedTasks: total - successful,
      successRate: total > 0 ? successful / total : 0,
      averageDuration: avgDuration,
      totalReflections: this.reflections.length,
      totalSuggestions: this.reflections.reduce((a, r) => a + r.suggestions.length, 0),
    };
  }

  /**
   * Stop the reflection loop
   */
  public stop(): void {
    if (this.reflectionTimer) {
      clearInterval(this.reflectionTimer);
      this.reflectionTimer = null;
      this.emit('loopStopped', { timestamp: Date.now() });
    }
  }
}

// Export singleton instance
export const selfReflectionLoop = new SelfReflectionLoop();

// CLI execution
if (require.main === module) {
  console.log('Self-Reflection Loop ');
  console.log('Part of Gentle-Vanguard  — Convergence Layer\n');

  const loop = new SelfReflectionLoop({
    reflectionInterval: 1, // 1 minute for demo
    minObservations: 5,
  });

  loop.on('reflection', (reflection) => {
    console.log('\n' + '='.repeat(60));
    console.log('REFLECTION GENERATED');
    console.log('='.repeat(60));
    console.log(`ID: ${reflection.id}`);
    console.log(
      `Period: ${new Date(reflection.period.start).toISOString()} - ${new Date(reflection.period.end).toISOString()}`,
    );
    console.log(`\nPatterns detected: ${reflection.patterns.length}`);
    reflection.patterns.forEach((p) => {
      console.log(
        `  [${p.type.toUpperCase()}] ${p.description} (confidence: ${(p.confidence * 100).toFixed(0)}%)`,
      );
    });

    console.log(`\nSuggestions: ${reflection.suggestions.length}`);
    reflection.suggestions.forEach((s) => {
      console.log(`  [${s.priority.toUpperCase()}] ${s.description}`);
      console.log(`    Expected impact: ${s.expectedImpact}`);
    });

    console.log(`\nInsights:`);
    reflection.insights.forEach((i) => console.log(`  • ${i}`));
  });

  // Simulate metrics
  console.log('Simulating performance metrics...\n');

  const taskTypes = ['code-review', 'refactoring', 'documentation', 'testing'];
  const complexities: Array<'low' | 'medium' | 'high'> = ['low', 'medium', 'high'];

  let count = 0;
  const interval = setInterval(() => {
    const taskType = taskTypes[Math.floor(Math.random() * taskTypes.length)];
    const complexity = complexities[Math.floor(Math.random() * complexities.length)];
    const success = Math.random() > 0.2; // 80% success rate

    loop.recordMetric({
      timestamp: Date.now(),
      taskType,
      success,
      duration: 30000 + Math.random() * 120000,
      tokenUsage: 1000 + Math.random() * 3000,
      complexity,
      errorType: success ? undefined : 'timeout',
    });

    count++;
    if (count >= 20) {
      clearInterval(interval);

      setTimeout(() => {
        console.log('\n\n--- Final Summary ---');
        console.log(JSON.stringify(loop.getSummary(), null, 2));
        loop.stop();
      }, 2000);
    }
  }, 500);
}
