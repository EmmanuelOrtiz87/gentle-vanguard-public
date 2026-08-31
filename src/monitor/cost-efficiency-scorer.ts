#!/usr/bin/env node
/**
 * Cost Efficiency Scoring System
 *
 * Scores sessions based on token efficiency and task completion.
 * Identifies optimal patterns and provides recommendations for improvement.
 *
 * Scoring Formula:
 *   Efficiency Score = (Tasks Completed / Total Tokens) * 1000 * Quality Multiplier
 *
 * Quality Multipliers:
 *   - High quality output: 1.2x
 *   - No errors: 1.1x
 *   - Used skills: 1.05x per skill
 *   - Cache hit: 1.15x
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

interface SessionMetrics {
  sessionId: string;
  date: string;
  startTime: number;
  endTime?: number;
  tasksCompleted: number;
  tasksFailed: number;
  totalTokens: number;
  totalCost: number;
  toolCalls: number;
  filesRead: number;
  filesEdited: number;
  skillsUsed: string[];
  errors: number;
  warnings: number;
  cacheHits: number;
  cacheMisses: number;
  qualityScore: number;
}

interface EfficiencyScore {
  sessionId: string;
  date: string;
  rawScore: number;
  adjustedScore: number;
  tokensPerTask: number;
  costPerTask: number;
  grade: string;
  percentile: number;
  multipliers: {
    quality: number;
    errorFree: number;
    skillUsage: number;
    cacheEfficiency: number;
    total: number;
  };
  recommendations: string[];
}

const ROOT = resolve(process.cwd());
const SCORES_DIR = join(ROOT, '.session', 'efficiency-scores');
const SCORES_FILE = join(SCORES_DIR, 'scores.jsonl');

const GRADE_THRESHOLDS = { S: 90, A: 75, B: 60, C: 45, D: 30, F: 0 };

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function calculateGrade(score: number): string {
  if (score >= GRADE_THRESHOLDS.S) return 'S';
  if (score >= GRADE_THRESHOLDS.A) return 'A';
  if (score >= GRADE_THRESHOLDS.B) return 'B';
  if (score >= GRADE_THRESHOLDS.C) return 'C';
  if (score >= GRADE_THRESHOLDS.D) return 'D';
  return 'F';
}

export class CostEfficiencyScorer {
  private scores: EfficiencyScore[] = [];

  constructor() {
    ensureDir(SCORES_DIR);
    this.loadScores();
  }

  private loadScores(): void {
    if (!existsSync(SCORES_FILE)) return;
    const lines = readFileSync(SCORES_FILE, 'utf-8')
      .split('\n')
      .filter((l) => l.trim());
    for (const line of lines) {
      try {
        this.scores.push(JSON.parse(line));
      } catch {}
    }
  }

  calculateScore(metrics: SessionMetrics): EfficiencyScore {
    const rawScore =
      metrics.totalTokens > 0 ? (metrics.tasksCompleted / metrics.totalTokens) * 1000 : 0;

    const multipliers: {
      quality: number;
      errorFree: number;
      skillUsage: number;
      cacheEfficiency: number;
      total: number;
    } = {
      quality: metrics.qualityScore >= 90 ? 1.2 : metrics.qualityScore >= 70 ? 1.1 : 1.0,
      errorFree: metrics.errors === 0 ? 1.1 : 1.0,
      skillUsage: 1 + Math.min(metrics.skillsUsed.length * 0.05, 0.25),
      cacheEfficiency: 1.0,
      total: 1.0,
    };

    const totalCache = metrics.cacheHits + metrics.cacheMisses;
    if (totalCache > 0) {
      const cacheRate = metrics.cacheHits / totalCache;
      multipliers.cacheEfficiency = cacheRate >= 0.4 ? 1.15 : cacheRate >= 0.2 ? 1.08 : 1.0;
    }

    multipliers.total =
      multipliers.quality *
      multipliers.errorFree *
      multipliers.skillUsage *
      multipliers.cacheEfficiency;
    const adjustedScore = rawScore * multipliers.total;
    const grade = calculateGrade(adjustedScore);

    const recommendations: string[] = [];
    if (metrics.totalTokens / (metrics.tasksCompleted || 1) > 5000) {
      recommendations.push(
        'High token usage per task. Consider breaking tasks into smaller steps.',
      );
    }
    if (metrics.errors > 0)
      recommendations.push(`${metrics.errors} errors detected. Review error patterns.`);
    if (metrics.cacheHits / (totalCache || 1) < 0.2) {
      recommendations.push('Low cache hit rate. Consider enabling response caching.');
    }

    return {
      sessionId: metrics.sessionId,
      date: metrics.date,
      rawScore: Math.round(rawScore * 100) / 100,
      adjustedScore: Math.round(adjustedScore * 100) / 100,
      tokensPerTask:
        metrics.tasksCompleted > 0 ? Math.round(metrics.totalTokens / metrics.tasksCompleted) : 0,
      costPerTask:
        metrics.tasksCompleted > 0
          ? Math.round((metrics.totalCost / metrics.tasksCompleted) * 10000) / 10000
          : 0,
      grade,
      percentile: 50,
      multipliers,
      recommendations,
    };
  }

  saveScore(score: EfficiencyScore): void {
    ensureDir(SCORES_DIR);
    appendFileSync(SCORES_FILE, JSON.stringify(score) + '\n');
    this.scores.push(score);
  }

  getLeaderboard(limit: number = 10): EfficiencyScore[] {
    return [...this.scores].sort((a, b) => b.adjustedScore - a.adjustedScore).slice(0, limit);
  }
}

function runCLI(): void {
  const args = process.argv.slice(2);
  const command = args[0];
  const scorer = new CostEfficiencyScorer();

  if (command === 'score') {
    const demoMetrics: SessionMetrics = {
      sessionId: `demo-${Date.now()}`,
      date: new Date().toISOString().slice(0, 10),
      startTime: Date.now(),
      tasksCompleted: 5,
      tasksFailed: 0,
      totalTokens: 15000,
      totalCost: 0.15,
      toolCalls: 12,
      filesRead: 8,
      filesEdited: 4,
      skillsUsed: ['code-review', 'debugging', 'testing'],
      errors: 0,
      warnings: 2,
      cacheHits: 3,
      cacheMisses: 7,
      qualityScore: 85,
    };

    const score = scorer.calculateScore(demoMetrics);
    scorer.saveScore(score);

    console.log('\n=== Cost Efficiency Score ===\n');
    console.log(`Session: ${score.sessionId}`);
    console.log(`Raw Score: ${score.rawScore} tasks/1K tokens`);
    console.log(`Adjusted Score: ${score.adjustedScore}`);
    console.log(`Tokens per Task: ${score.tokensPerTask}`);
    console.log(`Cost per Task: $${score.costPerTask}`);
    console.log(`Grade: ${score.grade}`);
    console.log('\nMultipliers:', score.multipliers);
    console.log('\nRecommendations:', score.recommendations);
    console.log();
  } else if (command === 'leaderboard') {
    const limit = parseInt(args[1] || '10', 10);
    const leaderboard = scorer.getLeaderboard(limit);
    console.log(`\n=== Top ${limit} Sessions ===\n`);
    leaderboard.forEach((s, i) => {
      console.log(`${i + 1}. ${s.sessionId}: ${s.adjustedScore} pts (${s.grade})`);
    });
    console.log();
  } else {
    console.log('Usage: npx tsx src/monitor/cost-efficiency-scorer.ts [score|leaderboard]');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCLI();
}
