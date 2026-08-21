#!/usr/bin/env node

/**
 * Skill Evolution Engine
 * Usage analysis, gap detection, and skill deprecation
 * Continuous improvement of skill ecosystem
 *
 * Part of Gentle-Vanguard — Convergence Layer
 */

import { EventEmitter } from 'events';

interface Skill {
  id: string;
  name: string;
  category: string;
  version: string;
  createdAt: number;
  lastUsed: number;
  usageCount: number;
  successCount: number;
  failureCount: number;
  avgLatency: number;
  avgTokenUsage: number;
  dependencies: string[];
  deprecated: boolean;
  replacement?: string;
}

interface SkillUsage {
  timestamp: number;
  skillId: string;
  success: boolean;
  latency: number;
  tokenUsage: number;
  context: string;
  userFeedback?: number; // 1-5 rating
}

interface SkillAnalysis {
  skill: Skill;
  health: number; // 0-1
  trend: 'improving' | 'stable' | 'declining';
  recommendations: string[];
  gaps: string[];
  alternatives: string[];
}

interface EvolutionPlan {
  toDeprecate: string[];
  toImprove: Array<{ skillId: string; actions: string[] }>;
  toCreate: Array<{ name: string; reason: string; features: string[] }>;
  toMerge: Array<{ skills: string[]; newName: string }>;
}

interface EvolutionConfig {
  minUsageThreshold: number;
  deprecationThreshold: number;
  analysisWindow: number;
  autoDeprecate: boolean;
}

export class SkillEvolutionEngine extends EventEmitter {
  private config: EvolutionConfig;
  private skills: Map<string, Skill> = new Map();
  private usageHistory: SkillUsage[] = [];
  private evolutionPlans: EvolutionPlan[] = [];

  constructor(config: Partial<EvolutionConfig> = {}) {
    super();
    this.config = {
      minUsageThreshold: config.minUsageThreshold || 10,
      deprecationThreshold: config.deprecationThreshold || 0.3,
      analysisWindow: config.analysisWindow || 30 * 24 * 60 * 60 * 1000, // 30 days
      autoDeprecate: config.autoDeprecate !== false,
    };
  }

  /**
   * Register a new skill
   */
  public registerSkill(
    skill: Omit<
      Skill,
      | 'createdAt'
      | 'lastUsed'
      | 'usageCount'
      | 'successCount'
      | 'failureCount'
      | 'avgLatency'
      | 'avgTokenUsage'
      | 'deprecated'
    >,
  ): string {
    const fullSkill: Skill = {
      ...skill,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      usageCount: 0,
      successCount: 0,
      failureCount: 0,
      avgLatency: 0,
      avgTokenUsage: 0,
      deprecated: false,
    };

    this.skills.set(fullSkill.id, fullSkill);

    this.emit('skillRegistered', fullSkill);

    return fullSkill.id;
  }

  /**
   * Record skill usage
   */
  public recordUsage(usage: SkillUsage): void {
    this.usageHistory.push(usage);

    // Update skill metrics
    const skill = this.skills.get(usage.skillId);
    if (skill) {
      skill.lastUsed = usage.timestamp;
      skill.usageCount++;

      if (usage.success) {
        skill.successCount++;
      } else {
        skill.failureCount++;
      }

      // Update averages
      const alpha = 0.1; // Exponential moving average
      skill.avgLatency = (1 - alpha) * skill.avgLatency + alpha * usage.latency;
      skill.avgTokenUsage = (1 - alpha) * skill.avgTokenUsage + alpha * usage.tokenUsage;
    }

    // Prune old history
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000; // 90 days
    this.usageHistory = this.usageHistory.filter((u) => u.timestamp > cutoff);

    this.emit('usageRecorded', usage);
  }

  /**
   * Analyze all skills
   */
  public analyze(): SkillAnalysis[] {
    const analyses: SkillAnalysis[] = [];

    for (const skill of this.skills.values()) {
      if (skill.deprecated) continue;

      const analysis = this.analyzeSkill(skill);
      analyses.push(analysis);
    }

    this.emit('analysisComplete', analyses);

    return analyses;
  }

  /**
   * Analyze a single skill
   */
  private analyzeSkill(skill: Skill): SkillAnalysis {
    const recentUsage = this.getRecentUsage(skill.id);

    // Calculate health score
    const successRate = skill.usageCount > 0 ? skill.successCount / skill.usageCount : 0;
    const recency = this.calculateRecency(skill);
    const frequency = this.calculateFrequency(skill);

    const health = successRate * 0.4 + recency * 0.3 + frequency * 0.3;

    // Determine trend
    const trend = this.calculateTrend(skill);

    // Generate recommendations
    const recommendations = this.generateRecommendations(skill, health, trend);

    // Identify gaps
    const gaps = this.identifyGaps(skill);

    // Find alternatives
    const alternatives = this.findAlternatives(skill);

    return {
      skill,
      health,
      trend,
      recommendations,
      gaps,
      alternatives,
    };
  }

  /**
   * Get recent usage for a skill
   */
  private getRecentUsage(skillId: string): SkillUsage[] {
    const cutoff = Date.now() - this.config.analysisWindow;
    return this.usageHistory.filter((u) => u.skillId === skillId && u.timestamp > cutoff);
  }

  /**
   * Calculate recency score
   */
  private calculateRecency(skill: Skill): number {
    const daysSinceUse = (Date.now() - skill.lastUsed) / (1000 * 60 * 60 * 24);
    return Math.max(0, 1 - daysSinceUse / 30); // Decay over 30 days
  }

  /**
   * Calculate frequency score
   */
  private calculateFrequency(skill: Skill): number {
    const recentUsage = this.getRecentUsage(skill.id);
    const daysInWindow = this.config.analysisWindow / (1000 * 60 * 60 * 24);
    const avgDailyUsage = recentUsage.length / daysInWindow;
    return Math.min(1, avgDailyUsage / 10); // Normalize to 10 uses per day
  }

  /**
   * Calculate trend
   */
  private calculateTrend(skill: Skill): SkillAnalysis['trend'] {
    const recent = this.getRecentUsage(skill.id).slice(-30);
    const older = this.getRecentUsage(skill.id).slice(-60, -30);

    if (recent.length === 0 || older.length === 0) return 'stable';

    const recentSuccess = recent.filter((u) => u.success).length / recent.length;
    const olderSuccess = older.filter((u) => u.success).length / older.length;

    const change = recentSuccess - olderSuccess;

    if (change > 0.1) return 'improving';
    if (change < -0.1) return 'declining';
    return 'stable';
  }

  /**
   * Generate recommendations for a skill
   */
  private generateRecommendations(
    skill: Skill,
    health: number,
    trend: SkillAnalysis['trend'],
  ): string[] {
    const recommendations: string[] = [];

    if (health < this.config.deprecationThreshold) {
      recommendations.push(
        `Consider deprecating: low health score (${(health * 100).toFixed(0)}%)`,
      );
    }

    if (trend === 'declining') {
      recommendations.push('Investigate declining success rate');
    }

    if (skill.avgLatency > 5000) {
      recommendations.push('Optimize for lower latency');
    }

    if (skill.avgTokenUsage > 2000) {
      recommendations.push('Reduce token usage for cost efficiency');
    }

    if (skill.usageCount < this.config.minUsageThreshold) {
      recommendations.push('Low adoption - consider promotion or consolidation');
    }

    return recommendations;
  }

  /**
   * Identify gaps in skill coverage
   */
  private identifyGaps(skill: Skill): string[] {
    const gaps: string[] = [];

    // Check for missing related skills
    const categories = Array.from(this.skills.values()).filter(
      (s) => s.category === skill.category && !s.deprecated,
    );

    if (categories.length < 3) {
      gaps.push(`Sparse coverage in ${skill.category} category`);
    }

    // Check for missing dependencies
    skill.dependencies.forEach((depId) => {
      if (!this.skills.has(depId) || this.skills.get(depId)?.deprecated) {
        gaps.push(`Missing or deprecated dependency: ${depId}`);
      }
    });

    return gaps;
  }

  /**
   * Find alternative skills
   */
  private findAlternatives(skill: Skill): string[] {
    const alternatives: string[] = [];

    for (const other of this.skills.values()) {
      if (other.id === skill.id || other.deprecated) continue;

      // Same category and better health
      if (other.category === skill.category) {
        const otherHealth = other.successCount / Math.max(1, other.usageCount);
        const skillHealth = skill.successCount / Math.max(1, skill.usageCount);

        if (otherHealth > skillHealth * 1.2) {
          alternatives.push(other.name);
        }
      }
    }

    return alternatives.slice(0, 3);
  }

  /**
   * Generate evolution plan
   */
  public generateEvolutionPlan(): EvolutionPlan {
    const analyses = this.analyze();

    const plan: EvolutionPlan = {
      toDeprecate: [],
      toImprove: [],
      toCreate: [],
      toMerge: [],
    };

    analyses.forEach((analysis) => {
      // Deprecate low-health skills
      if (analysis.health < this.config.deprecationThreshold) {
        plan.toDeprecate.push(analysis.skill.id);
      }

      // Improve skills with recommendations
      if (analysis.recommendations.length > 0) {
        plan.toImprove.push({
          skillId: analysis.skill.id,
          actions: analysis.recommendations,
        });
      }
    });

    // Identify merge opportunities
    this.identifyMergeOpportunities(plan);

    // Identify creation opportunities
    this.identifyCreationOpportunities(plan);

    this.evolutionPlans.push(plan);

    this.emit('evolutionPlanGenerated', plan);

    return plan;
  }

  /**
   * Identify skills to merge
   */
  private identifyMergeOpportunities(plan: EvolutionPlan): void {
    const byCategory: Record<string, Skill[]> = {};

    this.skills.forEach((skill) => {
      if (skill.deprecated) return;
      byCategory[skill.category] = byCategory[skill.category] || [];
      byCategory[skill.category].push(skill);
    });

    for (const [category, skills] of Object.entries(byCategory)) {
      if (skills.length > 5) {
        // Find similar skills
        const similar = this.findSimilarSkills(skills);
        if (similar.length >= 2) {
          plan.toMerge.push({
            skills: similar.map((s) => s.id),
            newName: `${category}-unified`,
          });
        }
      }
    }
  }

  /**
   * Find similar skills
   */
  private findSimilarSkills(skills: Skill[]): Skill[] {
    // Simple similarity: same category and similar usage patterns
    return skills.sort((a, b) => b.usageCount - a.usageCount).slice(0, 3);
  }

  /**
   * Identify opportunities for new skills
   */
  private identifyCreationOpportunities(plan: EvolutionPlan): void {
    const categories = new Set(Array.from(this.skills.values()).map((s) => s.category));

    // Check for high-demand uncategorized usage
    const uncategorized = this.usageHistory.filter((u) => !this.skills.has(u.skillId));
    if (uncategorized.length > 50) {
      plan.toCreate.push({
        name: 'generic-handler',
        reason: 'High demand for uncategorized operations',
        features: ['Auto-detection', 'Fallback handling', 'Logging'],
      });
    }
  }

  /**
   * Deprecate a skill
   */
  public deprecateSkill(skillId: string, replacement?: string): void {
    const skill = this.skills.get(skillId);
    if (!skill) return;

    skill.deprecated = true;
    skill.replacement = replacement;

    this.emit('skillDeprecated', skill);
  }

  /**
   * Get skill statistics
   */
  public getStats(): object {
    const skills = Array.from(this.skills.values());
    const active = skills.filter((s) => !s.deprecated);
    const deprecated = skills.filter((s) => s.deprecated);

    const byCategory: Record<string, number> = {};
    active.forEach((s) => {
      byCategory[s.category] = (byCategory[s.category] || 0) + 1;
    });

    return {
      totalSkills: skills.length,
      activeSkills: active.length,
      deprecatedSkills: deprecated.length,
      byCategory,
      totalUsage: this.usageHistory.length,
      avgSuccessRate:
        active.length > 0
          ? active.reduce((a, s) => a + s.successCount / Math.max(1, s.usageCount), 0) /
            active.length
          : 0,
    };
  }

  /**
   * Export skill data
   */
  public exportData(): { skills: Skill[]; usage: SkillUsage[] } {
    return {
      skills: Array.from(this.skills.values()),
      usage: [...this.usageHistory],
    };
  }
}

// Export singleton instance
export const skillEvolutionEngine = new SkillEvolutionEngine();

// CLI execution
if (require.main === module) {
  console.log('Skill Evolution Engine v1.0.0');
  console.log('Part of Gentle-Vanguard v5.0 — Convergence Layer\n');

  const engine = new SkillEvolutionEngine();

  engine.on('skillRegistered', (skill) => {
    console.log(`[${new Date().toISOString()}] Skill registered: ${skill.name}`);
  });

  engine.on('evolutionPlanGenerated', (plan) => {
    console.log('\n' + '='.repeat(60));
    console.log('EVOLUTION PLAN GENERATED');
    console.log('='.repeat(60));
    console.log(`\nTo Deprecate: ${plan.toDeprecate.length} skills`);
    console.log(`To Improve: ${plan.toImprove.length} skills`);
    console.log(`To Create: ${plan.toCreate.length} new skills`);
    console.log(`To Merge: ${plan.toMerge.length} groups`);
  });

  // Register sample skills
  console.log('Registering skills...\n');

  const skill1 = engine.registerSkill({
    id: 'skill_001',
    name: 'code-analyzer',
    category: 'analysis',
    version: '1.0.0',
    dependencies: [],
  });

  const skill2 = engine.registerSkill({
    id: 'skill_002',
    name: 'refactor-helper',
    category: 'analysis',
    version: '1.0.0',
    dependencies: ['skill_001'],
  });

  const skill3 = engine.registerSkill({
    id: 'skill_003',
    name: 'legacy-parser',
    category: 'parsing',
    version: '0.9.0',
    dependencies: [],
  });

  // Simulate usage
  console.log('Simulating skill usage...\n');

  for (let i = 0; i < 100; i++) {
    const skillId = i % 3 === 0 ? skill3 : i % 2 === 0 ? skill1 : skill2;
    const success = Math.random() > (skillId === skill3 ? 0.4 : 0.1);

    engine.recordUsage({
      timestamp: Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
      skillId,
      success,
      latency: 100 + Math.random() * 2000,
      tokenUsage: 500 + Math.random() * 1500,
      context: 'test',
    });
  }

  // Analyze
  setTimeout(() => {
    console.log('\n--- Skill Analysis ---');
    const analyses = engine.analyze();
    analyses.forEach((analysis) => {
      console.log(`\n${analysis.skill.name}:`);
      console.log(`  Health: ${(analysis.health * 100).toFixed(0)}%`);
      console.log(`  Trend: ${analysis.trend}`);
      console.log(`  Recommendations: ${analysis.recommendations.length}`);
    });

    // Generate evolution plan
    engine.generateEvolutionPlan();

    console.log('\n\n--- Engine Statistics ---');
    console.log(JSON.stringify(engine.getStats(), null, 2));
  }, 500);
}
