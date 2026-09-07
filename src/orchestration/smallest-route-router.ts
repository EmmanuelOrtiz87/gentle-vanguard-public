#!/usr/bin/env node
/**
 * Smallest Route Router — Organic Implementation Routing
 *
 * Based on Gentle-AI v2.5.0 "smallest route" philosophy:
 * "The agent picks the smallest route that gets there."
 *
 * PRINCIPLE: Size never selects SDD. File count, changed lines and perceived
 * risk never force the heavier route. Only explicit request or accepted proposal.
 *
 * RULES:
 *   - 1-3 files, 1 mechanical change → Direct inline
 *   - 4+ files, broad research needed → Delegated direct (1 agent)
 *   - Ambiguous substantial features → Optional SDD (user accepts)
 *   - Commit/PR/Release → Follow repository policy (not SDD)
 *
 * USAGE:
 *   import { smallestRoute } from './smallest-route-router.js';
 *
 *   const route = smallestRoute.analyze({
 *     description: 'Fix typo',
 *     estimatedFiles: 1,
 *     confidence: 0.95,
 *   });
 *   // → { route: 'direct', reason: '1 file, high confidence', steps: 5 }
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';

// =============================================================================
// TYPES
// =============================================================================

export type RouteType = 'direct' | 'delegated' | 'sdd' | 'collaborative';

export interface RouteAnalysis {
  /** Selected route */
  route: RouteType;

  /** Human-readable explanation */
  reason: string;

  /** Estimated steps for this route */
  steps: number;

  /** Confidence in route selection (0-1) */
  confidence: number;

  /** Signals that determined the route */
  signals: RouteSignal[];

  /** Alternative routes considered */
  alternatives: RouteAlternative[];

  /** Whether user confirmation is recommended */
  requiresConfirmation: boolean;

  /** Route metadata */
  metadata: {
    estimatedFiles: number;
    complexity: 'low' | 'medium' | 'high';
    ambiguity: number;
  };
}

export interface RouteSignal {
  name: string;
  value: number;
  weight: number;
  description: string;
}

export interface RouteAlternative {
  route: RouteType;
  score: number;
  reason: string;
}

export interface RoutingRequest {
  /** Task description */
  description: string;

  /** Estimated files to change (if known) */
  estimatedFiles?: number;

  /** User's explicit confidence (0-1) */
  confidence?: number;

  /** Whether this involves research/exploration */
  requiresResearch?: boolean;

  /** Whether this is a bug fix */
  isBugFix?: boolean;

  /** Whether this is a refactor */
  isRefactor?: boolean;

  /** Whether this is a new feature */
  isNewFeature?: boolean;

  /** Files already identified */
  identifiedFiles?: string[];

  /** Task complexity (user assessment) */
  complexity?: 'trivial' | 'simple' | 'moderate' | 'complex' | 'substantial';

  /** Previous similar tasks (history) */
  similarTasks?: string[];

  /** Whether user explicitly requested SDD */
  explicitSDD?: boolean;

  /** Stakeholder count */
  stakeholderCount?: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const ROOT = resolve(process.cwd());
const RUNTIME_DIR = join(ROOT, '.runtime');
const ROUTING_HISTORY_FILE = join(RUNTIME_DIR, 'routing-history.json');

// Thresholds (from Gentle-AI trigger-rules)
const THRESHOLDS = {
  DIRECT_MAX_FILES: 3,
  DIRECT_MAX_STEPS: 15,
  DELEGATED_MIN_FILES: 4,
  DELEGATED_MAX_FILES: 15,
  SDD_MIN_AMBIGUITY: 0.4,
  CONFIDENCE_DIRECT: 0.8,
  CONFIDENCE_DELEGATED: 0.6,
};

// Complexity multipliers (impact on route selection)
const COMPLEXITY_WEIGHTS = {
  trivial: 0.2,
  simple: 0.4,
  moderate: 0.6,
  complex: 0.8,
  substantial: 1.0,
};

/** Map 5-level complexity to the 3-level metadata bucket. */
function mapComplexityBucket(
  c: 'trivial' | 'simple' | 'moderate' | 'complex' | 'substantial',
): 'low' | 'medium' | 'high' {
  if (c === 'trivial' || c === 'simple') return 'low';
  if (c === 'moderate') return 'medium';
  return 'high';
}

// =============================================================================
// ROUTING ENGINE
// =============================================================================

export class SmallestRouteRouter {
  private history: RoutingHistoryEntry[] = [];

  constructor() {
    this.loadHistory();
  }

  /**
   * Analyze task and select smallest viable route
   *
   * CORE ALGORITHM (from Gentle-AI trigger-rules.md):
   * 1. Count signals (files, complexity, ambiguity, confidence)
   * 2. Calculate score for each route
   * 3. Select lowest-weight route that can succeed
   * 4. Never escalate based on perceived risk alone
   */
  analyze(request: RoutingRequest): RouteAnalysis {
    const signals: RouteSignal[] = [];
    const fileCount = this.estimateFileCount(request);
    const ambiguity = this.estimateAmbiguity(request);
    const complexity = this.determineComplexity(request);

    // Signal 1: File count
    signals.push({
      name: 'file_count',
      value: fileCount,
      weight: this.getFileWeight(fileCount),
      description: `${fileCount} files to change`,
    });

    // Signal 2: Confidence
    const confidence = request.confidence || this.inferConfidence(request);
    signals.push({
      name: 'confidence',
      value: confidence,
      weight: (1 - confidence) * 0.3, // Lower confidence = higher weight
      description: `Confidence: ${(confidence * 100).toFixed(0)}%`,
    });

    // Signal 3: Ambiguity
    signals.push({
      name: 'ambiguity',
      value: ambiguity,
      weight: ambiguity * 0.4,
      description: `Ambiguity: ${(ambiguity * 100).toFixed(0)}%`,
    });

    // Signal 4: Complexity
    const complexityWeight = COMPLEXITY_WEIGHTS[complexity];
    signals.push({
      name: 'complexity',
      value: complexityWeight,
      weight: complexityWeight * 0.2,
      description: `Complexity: ${complexity}`,
    });

    // Signal 5: Research needed
    const researchWeight = request.requiresResearch ? 0.3 : 0;
    signals.push({
      name: 'research_needed',
      value: request.requiresResearch ? 1 : 0,
      weight: researchWeight,
      description: request.requiresResearch ? 'Research required' : 'No research needed',
    });

    // Signal 6: Stakeholders
    const stakeholderWeight = (request.stakeholderCount || 1) > 2 ? 0.2 : 0;
    signals.push({
      name: 'stakeholders',
      value: request.stakeholderCount || 1,
      weight: stakeholderWeight,
      description: `${request.stakeholderCount || 1} stakeholder(s)`,
    });

    // Calculate scores for each route
    const alternatives = this.calculateAlternatives(signals, request);

    // Select smallest viable route
    const selected = this.selectSmallestViable(alternatives, request);

    // Build analysis
    const analysis: RouteAnalysis = {
      route: selected.route,
      reason: selected.reason,
      steps: selected.steps,
      confidence: selected.confidence,
      signals,
      alternatives: alternatives.filter((a) => a.route !== selected.route),
      requiresConfirmation: this.requiresConfirmation(selected, request),
      metadata: {
        estimatedFiles: fileCount,
        complexity: mapComplexityBucket(complexity),
        ambiguity,
      },
    };

    // Log for learning
    this.logRoutingDecision(analysis, request);

    return analysis;
  }

  /**
   * Recommend next action based on route
   */
  recommend(route: RouteAnalysis): string {
    switch (route.route) {
      case 'direct':
        return `Execute directly: ${route.reason}. Estimated ${route.steps} steps.`;

      case 'delegated':
        return `Delegate to agent: ${route.reason}. Use smartTask() with appropriate agent. Estimated ${route.steps} steps.`;

      case 'sdd':
        return `Use SDD workflow: ${route.reason}. Run 'npm run sdd:run' or propose SDD phases. Estimated ${route.steps} steps.`;

      case 'collaborative':
        return `Collaborative approach: ${route.reason}. Multiple agents may be needed. Estimated ${route.steps} steps.`;

      default:
        return `Unknown route. Defaulting to delegated.`;
    }
  }

  // =============================================================================
  // PRIVATE HELPERS
  // =============================================================================

  private estimateFileCount(request: RoutingRequest): number {
    if (request.estimatedFiles !== undefined) return request.estimatedFiles;
    if (request.identifiedFiles) return request.identifiedFiles.length;

    // Infer from description
    const desc = request.description.toLowerCase();
    if (desc.includes('typo') || desc.includes('fix') && !desc.includes('refactor')) return 1;
    if (desc.includes('config') || desc.includes('readme')) return 1;
    if (desc.includes('multiple files') || desc.includes('across')) return 8;
    if (desc.includes('new feature') || desc.includes('implement')) return 5;

    return 2; // Default conservative estimate
  }

  private estimateAmbiguity(request: RoutingRequest): number {
    let ambiguity = 0.3; // Base

    if (request.isNewFeature) ambiguity += 0.3;
    if (request.requiresResearch) ambiguity += 0.2;
    if (request.complexity === 'substantial') ambiguity += 0.2;
    if (request.stakeholderCount && request.stakeholderCount > 2) ambiguity += 0.1;

    // Reduce ambiguity if confidence high
    if (request.confidence && request.confidence > 0.9) ambiguity -= 0.2;
    if (request.explicitSDD) ambiguity -= 0.3; // User knows what they want

    return Math.min(Math.max(ambiguity, 0), 1);
  }

  private determineComplexity(request: RoutingRequest): 'trivial' | 'simple' | 'moderate' | 'complex' | 'substantial' {
    if (request.complexity) return request.complexity;

    const desc = request.description.toLowerCase();
    const fileCount = request.estimatedFiles || 0;

    if (desc.includes('typo') || desc.includes('spelling')) return 'trivial';
    if (fileCount === 1 && !request.isNewFeature) return 'simple';
    if (fileCount <= 3 && !request.requiresResearch) return 'moderate';
    if (fileCount <= 8 && !request.isNewFeature) return 'complex';
    return 'substantial';
  }

  private inferConfidence(request: RoutingRequest): number {
    let confidence = 0.7; // Base

    if (request.isBugFix) confidence += 0.1;
    if (request.identifiedFiles && request.identifiedFiles.length > 0) confidence += 0.1;
    if (request.isRefactor) confidence -= 0.1; // Refactors can be risky

    return Math.min(Math.max(confidence, 0), 1);
  }

  private getFileWeight(count: number): number {
    if (count <= 1) return 0.1;
    if (count <= 3) return 0.2;
    if (count <= 8) return 0.4;
    if (count <= 15) return 0.6;
    return 0.8;
  }

  private calculateAlternatives(signals: RouteSignal[], request: RoutingRequest): RouteAlternative[] {
    const totalWeight = signals.reduce((sum, s) => sum + s.value * s.weight, 0);

    // Calculate scores (lower = better for "smallest route")
    const alternatives: RouteAlternative[] = [
      {
        route: 'direct',
        score: totalWeight * 0.5, // Direct is always lighter
        reason: 'Direct inline execution',
      },
      {
        route: 'delegated',
        score: totalWeight * 0.7 + (request.requiresResearch ? 0.2 : 0),
        reason: 'Single-agent delegation',
      },
      {
        route: 'sdd',
        score: totalWeight + (request.explicitSDD ? -0.2 : 0.3),
        reason: 'Full SDD workflow (explore → design → apply → verify)',
      },
      {
        route: 'collaborative',
        score: totalWeight * 1.2,
        reason: 'Multi-agent collaboration',
      },
    ];

    // Sort by score (ascending = smallest first)
    alternatives.sort((a, b) => a.score - b.score);

    return alternatives;
  }

  private selectSmallestViable(alternatives: RouteAlternative[], request: RoutingRequest): {
    route: RouteType;
    reason: string;
    steps: number;
    confidence: number;
  } {
    // Rule 1: Explicit SDD request → use SDD
    if (request.explicitSDD) {
      return {
        route: 'sdd',
        reason: 'User explicitly requested SDD workflow',
        steps: 50,
        confidence: 1.0,
      };
    }

    // Rule 2: 1-3 files, high confidence → Direct
    const fileCount = this.estimateFileCount(request);
    const confidence = request.confidence || this.inferConfidence(request);

    if (fileCount <= THRESHOLDS.DIRECT_MAX_FILES && confidence >= THRESHOLDS.CONFIDENCE_DIRECT && !request.requiresResearch) {
      return {
        route: 'direct',
        reason: `${fileCount} file(s), high confidence (${(confidence * 100).toFixed(0)}%)`,
        steps: fileCount * 3 + 2,
        confidence,
      };
    }

    // Rule 3: 4+ files or research needed → Delegated
    if (fileCount >= THRESHOLDS.DELEGATED_MIN_FILES || request.requiresResearch) {
      // But never force SDD just because of size
      return {
        route: 'delegated',
        reason: fileCount >= THRESHOLDS.DELEGATED_MIN_FILES
          ? `${fileCount} files require focused agent`
          : 'Research phase needs dedicated agent',
        steps: 20 + fileCount * 2,
        confidence: Math.max(confidence - 0.1, 0.5),
      };
    }

    // Rule 4: Low confidence or high ambiguity → Offer SDD as option
    const ambiguity = this.estimateAmbiguity(request);
    if (ambiguity >= THRESHOLDS.SDD_MIN_AMBIGUITY && !request.explicitSDD) {
      return {
        route: 'delegated', // Offer, don't force
        reason: `Ambiguous (${(ambiguity * 100).toFixed(0)}%), SDD available as option`,
        steps: 25,
        confidence: 0.6,
      };
    }

    // Default: Delegated (safe middle ground)
    return {
      route: 'delegated',
      reason: 'Balanced approach for unclear scope',
      steps: 20,
      confidence: 0.65,
    };
  }

  private requiresConfirmation(selected: ReturnType<SmallestRouteRouter['selectSmallestViable']>, request: RoutingRequest): boolean {
    // Require confirmation if:
    // - High ambiguity and not using SDD
    // - Large file count with direct route
    // - Low confidence

    const ambiguity = this.estimateAmbiguity(request);
    const fileCount = this.estimateFileCount(request);

    if (ambiguity > 0.7 && selected.route !== 'sdd') return true;
    if (fileCount > 10 && selected.route === 'direct') return true;
    if (selected.confidence < 0.5) return true;

    return false;
  }

  // =============================================================================
  // HISTORY & LEARNING
  // =============================================================================

  private loadHistory(): void {
    try {
      if (existsSync(ROUTING_HISTORY_FILE)) {
        this.history = JSON.parse(readFileSync(ROUTING_HISTORY_FILE, 'utf-8'));
      }
    } catch {
      this.history = [];
    }
  }

  private logRoutingDecision(analysis: RouteAnalysis, request: RoutingRequest): void {
    const entry: RoutingHistoryEntry = {
      timestamp: new Date().toISOString(),
      description: request.description.substring(0, 100),
      selectedRoute: analysis.route,
      files: analysis.metadata.estimatedFiles,
      confidence: analysis.confidence,
      success: null, // Will be updated later
    };

    this.history.push(entry);

    // Keep only last 100 entries
    if (this.history.length > 100) {
      this.history = this.history.slice(-100);
    }

    try {
      if (!existsSync(RUNTIME_DIR)) mkdirSync(RUNTIME_DIR, { recursive: true });
      writeFileSync(ROUTING_HISTORY_FILE, JSON.stringify(this.history, null, 2));
    } catch {
      // Non-critical
    }
  }

  /**
   * Get historical routing statistics
   */
  getStats(): {
    total: number;
    byRoute: Record<RouteType, number>;
    averageConfidence: number;
    lastAttempt: RoutingHistoryEntry | null;
  } {
    const byRoute: Record<RouteType, number> = { direct: 0, delegated: 0, sdd: 0, collaborative: 0 };

    for (const entry of this.history) {
      byRoute[entry.selectedRoute]++;
    }

    const totalConfidence = this.history.reduce((sum, e) => sum + e.confidence, 0);

    return {
      total: this.history.length,
      byRoute,
      averageConfidence: this.history.length > 0 ? totalConfidence / this.history.length : 0,
      lastAttempt: this.history[this.history.length - 1] || null,
    };
  }
}

interface RoutingHistoryEntry {
  timestamp: string;
  description: string;
  selectedRoute: RouteType;
  files: number;
  confidence: number;
  success: boolean | null;
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const smallestRoute = new SmallestRouteRouter();

// =============================================================================
// CLI
// =============================================================================

function cli(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'analyze': {
      const descIndex = args.indexOf('--description');
      const filesIndex = args.indexOf('--files');
      const confIndex = args.indexOf('--confidence');

      const description = descIndex > -1 ? args[descIndex + 1] : args[1] || 'Unknown task';
      const files = filesIndex > -1 ? parseInt(args[filesIndex + 1], 10) : undefined;
      const confidence = confIndex > -1 ? parseFloat(args[confIndex + 1]) : undefined;

      const analysis = smallestRoute.analyze({
        description,
        estimatedFiles: files,
        confidence,
      });

      console.log('\n=== Smallest Route Analysis ===\n');
      console.log(`Route: ${analysis.route}`);
      console.log(`Reason: ${analysis.reason}`);
      console.log(`Steps: ~${analysis.steps}`);
      console.log(`Confidence: ${(analysis.confidence * 100).toFixed(1)}%`);
      console.log(`Requires Confirmation: ${analysis.requiresConfirmation ? 'Yes' : 'No'}`);
      console.log('\nSignals:');
      for (const signal of analysis.signals) {
        console.log(`  ${signal.name}: ${signal.description} (weight: ${(signal.weight * 100).toFixed(0)}%)`);
      }
      console.log('\nRecommendation:');
      console.log(`  ${smallestRoute.recommend(analysis)}`);
      break;
    }

    case 'stats': {
      const stats = smallestRoute.getStats();
      console.log('\n=== Routing Statistics ===\n');
      console.log(`Total routings: ${stats.total}`);
      console.log(`Average confidence: ${(stats.averageConfidence * 100).toFixed(1)}%`);
      console.log('\nBy route:');
      for (const [route, count] of Object.entries(stats.byRoute)) {
        console.log(`  ${route}: ${count}`);
      }
      if (stats.lastAttempt) {
        console.log(`\nLast attempt: ${stats.lastAttempt.description.substring(0, 50)}...`);
        console.log(`  Route: ${stats.lastAttempt.selectedRoute}`);
        console.log(`  Confidence: ${(stats.lastAttempt.confidence * 100).toFixed(1)}%`);
      }
      break;
    }

    default:
      console.log(`
Smallest Route Router v1.0 — Organic Implementation Routing

Based on Gentle-AI "smallest route" philosophy:
"The agent picks the smallest route that gets there."

Commands:
  analyze [--description "..."] [--files N] [--confidence 0.8]
    Analyze task and recommend smallest route
    Example: analyze --description "Fix typo" --files 1 --confidence 0.95

  stats
    Show routing history and statistics

Principles:
  - Size never selects SDD
  - File count alone doesn't escalate
  - Perceived risk alone doesn't escalate
  - Only explicit request or accepted proposal selects SDD

Routes:
  direct      → Execute inline (1-3 files, high confidence)
  delegated   → Single agent delegation (4+ files, research)
  sdd         → Full SDD workflow (user accepted proposal)
  collaborative → Multi-agent collaboration (complex scope)
`);
  }
}

// Run CLI if executed directly
import { pathToFileURL } from 'url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli();
}
