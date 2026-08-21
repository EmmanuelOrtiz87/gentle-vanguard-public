#!/usr/bin/env node

/**
 * Auto Code Review
 * Autonomous code review with multi-lens analysis
 * Part of Gentle-Vanguard
 */

import { EventEmitter } from 'events';

interface CodeReview {
  id: string;
  filePath: string;
  content: string;
  language: string;
  timestamp: number;
  lenses: LensResult[];
  overallScore: number;
  status: 'pending' | 'completed' | 'failed';
}

interface LensResult {
  lens: string;
  score: number;
  issues: Issue[];
  suggestions: string[];
}

interface Issue {
  line: number;
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  rule: string;
  fix?: string;
}

export class AutoCodeReview extends EventEmitter {
  private reviews: Map<string, CodeReview> = new Map();
  private lenses: string[] = ['security', 'performance', 'maintainability', 'style'];

  public async review(filePath: string, content: string, language: string): Promise<CodeReview> {
    const reviewId = `review_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const review: CodeReview = {
      id: reviewId,
      filePath,
      content,
      language,
      timestamp: Date.now(),
      lenses: [],
      overallScore: 0,
      status: 'pending',
    };

    this.emit('reviewStarted', review);

    // Run all lenses
    for (const lens of this.lenses) {
      const result = await this.runLens(lens, content, language);
      review.lenses.push(result);
    }

    // Calculate overall score
    review.overallScore = review.lenses.reduce((a, l) => a + l.score, 0) / review.lenses.length;
    review.status = review.overallScore >= 0.8 ? 'completed' : 'failed';

    this.reviews.set(reviewId, review);
    this.emit('reviewCompleted', review);

    return review;
  }

  private async runLens(lens: string, content: string, language: string): Promise<LensResult> {
    const issues: Issue[] = [];
    const suggestions: string[] = [];
    let score = 1.0;

    // Language-specific checks
    const lang = language;
    if (lang) {
      /* language-specific analysis would go here */
    }

    // Security lens
    if (lens === 'security') {
      if (content.includes('eval(') || content.includes('Function(')) {
        issues.push({
          line: 1,
          severity: 'critical',
          message: 'Dynamic code execution detected',
          rule: 'no-eval',
        });
        score -= 0.3;
      }
      if (content.includes('password') && !content.includes('hash')) {
        issues.push({
          line: 1,
          severity: 'error',
          message: 'Plain text password detected',
          rule: 'no-plain-password',
        });
        score -= 0.2;
      }
      suggestions.push('Use parameterized queries to prevent SQL injection');
    }

    // Performance lens
    if (lens === 'performance') {
      const nestedLoops = (content.match(/for.*for/g) || []).length;
      if (nestedLoops > 2) {
        issues.push({
          line: 1,
          severity: 'warning',
          message: 'Nested loops may cause performance issues',
          rule: 'avoid-nested-loops',
        });
        score -= 0.1;
      }
      suggestions.push('Consider memoization for expensive calculations');
    }

    // Maintainability lens
    if (lens === 'maintainability') {
      const lines = content.split('\n');
      if (lines.length > 200) {
        issues.push({
          line: lines.length,
          severity: 'warning',
          message: 'File too long, consider splitting',
          rule: 'max-lines',
        });
        score -= 0.1;
      }
      suggestions.push('Add JSDoc comments for public APIs');
    }

    // Style lens
    if (lens === 'style') {
      if (content.includes('var ')) {
        issues.push({
          line: 1,
          severity: 'info',
          message: 'Use const or let instead of var',
          rule: 'no-var',
        });
        score -= 0.05;
      }
      suggestions.push('Follow consistent naming conventions');
    }

    return { lens, score: Math.max(0, score), issues, suggestions };
  }

  public getStats(): object {
    const reviews = Array.from(this.reviews.values());
    return {
      totalReviews: reviews.length,
      passed: reviews.filter((r) => r.status === 'completed').length,
      failed: reviews.filter((r) => r.status === 'failed').length,
      avgScore:
        reviews.length > 0 ? reviews.reduce((a, r) => a + r.overallScore, 0) / reviews.length : 0,
    };
  }
}

export const autoCodeReview = new AutoCodeReview();
