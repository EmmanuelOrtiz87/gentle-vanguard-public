#!/usr/bin/env node

/**
 * Review Lenses
 * 4-lens review with risk-based selection
 * Part of Gentle-Vanguard
 */

import { EventEmitter } from 'events';

/** A single review lens with its risk weighting */
interface ReviewLens {
  id: string;
  name: string;
  riskWeight: number;
}

export class ReviewLenses extends EventEmitter {
  private lenses: ReviewLens[] = [
    { id: 'security', name: 'Security Lens', riskWeight: 0.4 },
    { id: 'performance', name: 'Performance Lens', riskWeight: 0.2 },
    { id: 'maintainability', name: 'Maintainability Lens', riskWeight: 0.2 },
    { id: 'compliance', name: 'Compliance Lens', riskWeight: 0.2 },
  ];

  public selectLenses(riskLevel: string): ReviewLens[] {
    const weights: Record<string, number[]> = {
      low: [0.25, 0.25, 0.25, 0.25],
      medium: [0.35, 0.25, 0.25, 0.15],
      high: [0.5, 0.2, 0.15, 0.15],
      critical: [0.6, 0.15, 0.15, 0.1],
    };
    const selected = this.lenses.filter((_, i) => weights[riskLevel][i] > 0.2);
    this.emit('lensesSelected', { riskLevel, lenses: selected.map((l) => l.id) });
    return selected;
  }

  public getStats(): object {
    return { availableLenses: this.lenses.length };
  }
}

export const reviewLenses = new ReviewLenses();
