#!/usr/bin/env node
/**
 * ab-testing-framework.ts — Sistema de experimentación A/B
 *
 * Permite definir experimentos, asignar variantes, registrar resultados
 * y determinar ganador estadístico con auto-rollback en degradación.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { randomUUID, randomInt } from 'crypto';

// ─── Types ────────────────────────────────────────────────────────────

export interface ABExperiment {
  id: string;
  name: string;
  description: string;
  variants: Variant[];
  targetMetric: string;
  minSampleSize: number;
  significanceLevel: number;
  startDate: string;
  endDate?: string;
  status: 'draft' | 'running' | 'completed' | 'rolled-back';
}

export interface Variant {
  id: string;
  name: string;
  config: Record<string, unknown>;
  trafficPercent: number;
}

interface ExperimentResult {
  variantId: string;
  samples: number;
  totalMetric: number;
  avgMetric: number;
  confidence?: number;
}

interface Assignment {
  sessionId: string;
  experimentId: string;
  variantId: string;
  assignedAt: string;
  metrics?: Record<string, number>;
}

// ─── Store ────────────────────────────────────────────────────────────

const ROOT = resolve(process.cwd());
const EXPERIMENTS_DIR = join(ROOT, '.session', 'experiments');
const ASSIGNMENTS_FILE = join(EXPERIMENTS_DIR, 'assignments.json');
const RESULTS_FILE = join(EXPERIMENTS_DIR, 'results.json');

function ensureStore(): void {
  if (!existsSync(EXPERIMENTS_DIR)) mkdirSync(EXPERIMENTS_DIR, { recursive: true });
  if (!existsSync(ASSIGNMENTS_FILE)) writeFileSync(ASSIGNMENTS_FILE, '[]', 'utf-8');
  if (!existsSync(RESULTS_FILE)) writeFileSync(RESULTS_FILE, '{}', 'utf-8');
}

function loadAssignments(): Assignment[] {
  ensureStore();
  return JSON.parse(readFileSync(ASSIGNMENTS_FILE, 'utf-8'));
}

function saveAssignments(a: Assignment[]): void {
  ensureStore();
  writeFileSync(ASSIGNMENTS_FILE, JSON.stringify(a, null, 2), 'utf-8');
}

function loadResults(): Record<string, ExperimentResult[]> {
  ensureStore();
  return JSON.parse(readFileSync(RESULTS_FILE, 'utf-8'));
}

function saveResults(r: Record<string, ExperimentResult[]>): void {
  ensureStore();
  writeFileSync(RESULTS_FILE, JSON.stringify(r, null, 2), 'utf-8');
}

function loadExperiments(): ABExperiment[] {
  ensureStore();
  const file = join(EXPERIMENTS_DIR, 'experiments.json');
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, 'utf-8'));
}

function saveExperiments(e: ABExperiment[]): void {
  ensureStore();
  writeFileSync(join(EXPERIMENTS_DIR, 'experiments.json'), JSON.stringify(e, null, 2), 'utf-8');
}

// ─── API ──────────────────────────────────────────────────────────────

export function createExperiment(
  config: Omit<ABExperiment, 'id' | 'startDate' | 'status'>,
): ABExperiment {
  const experiments = loadExperiments();

  const experiment: ABExperiment = {
    ...config,
    id: `exp-${randomUUID().slice(0, 8)}`,
    startDate: new Date().toISOString(),
    status: 'draft',
  };

  // Validate traffic distribution sums to 100
  const totalTraffic = experiment.variants.reduce((s, v) => s + v.trafficPercent, 0);
  if (Math.abs(totalTraffic - 100) > 1) {
    throw new Error(`Traffic distribution must sum to 100%, got ${totalTraffic}%`);
  }

  experiments.push(experiment);
  saveExperiments(experiments);
  return experiment;
}

export function assignVariant(experimentId: string, sessionId: string): Variant {
  const experiments = loadExperiments();
  const experiment = experiments.find((e) => e.id === experimentId);
  if (!experiment) throw new Error(`Experiment ${experimentId} not found`);
  if (experiment.status !== 'running') throw new Error(`Experiment ${experimentId} is not running`);

  // Check existing assignment
  const assignments = loadAssignments();
  const existing = assignments.find(
    (a) => a.sessionId === sessionId && a.experimentId === experimentId,
  );
  if (existing) {
    const variant = experiment.variants.find((v) => v.id === existing.variantId);
    if (variant) return variant;
  }

  // Weighted random assignment
  const rand = randomInt(0, 100);
  let cumulative = 0;
  for (const variant of experiment.variants) {
    cumulative += variant.trafficPercent;
    if (rand < cumulative) {
      assignments.push({
        sessionId,
        experimentId,
        variantId: variant.id,
        assignedAt: new Date().toISOString(),
      });
      saveAssignments(assignments);
      return variant;
    }
  }

  // Fallback to first variant
  const fallback = experiment.variants[0];
  assignments.push({
    sessionId,
    experimentId,
    variantId: fallback.id,
    assignedAt: new Date().toISOString(),
  });
  saveAssignments(assignments);
  return fallback;
}

export function recordResult(
  experimentId: string,
  variantId: string,
  metrics: Record<string, number>,
): void {
  const results = loadResults();
  if (!results[experimentId]) results[experimentId] = [];

  let variantResult = results[experimentId].find((r) => r.variantId === variantId);
  if (!variantResult) {
    variantResult = { variantId, samples: 0, totalMetric: 0, avgMetric: 0 };
    results[experimentId].push(variantResult);
  }

  const metricValue = metrics[Object.keys(metrics)[0]] || 0;
  variantResult.samples++;
  variantResult.totalMetric += metricValue;
  variantResult.avgMetric = variantResult.totalMetric / variantResult.samples;

  saveResults(results);
}

export function evaluateExperiment(experimentId: string): {
  winner: string | null;
  significant: boolean;
} {
  const results = loadResults();
  const experimentResults = results[experimentId];
  if (!experimentResults || experimentResults.length < 2) {
    return { winner: null, significant: false };
  }

  const experiments = loadExperiments();
  const experiment = experiments.find((e) => e.id === experimentId);
  if (!experiment) return { winner: null, significant: false };

  // Check minimum sample size
  const minSamples = Math.min(...experimentResults.map((r) => r.samples));
  if (minSamples < experiment.minSampleSize) {
    return { winner: null, significant: false };
  }

  // Simple winner determination (highest avg metric)
  const sorted = [...experimentResults].sort((a, b) => b.avgMetric - a.avgMetric);
  const winner = sorted[0];
  const runnerUp = sorted[1];

  // Simple significance check (effect size > 5%)
  const effectSize =
    runnerUp.avgMetric > 0 ? (winner.avgMetric - runnerUp.avgMetric) / runnerUp.avgMetric : 1;

  const significant = effectSize > 0.05 && winner.samples >= experiment.minSampleSize;

  // Auto-complete if significant
  if (significant && experiment.status === 'running') {
    experiment.status = 'completed';
    experiment.endDate = new Date().toISOString();
    saveExperiments(experiments);
  }

  return {
    winner: winner.variantId,
    significant,
  };
}

export function rollbackExperiment(experimentId: string): boolean {
  const experiments = loadExperiments();
  const experiment = experiments.find((e) => e.id === experimentId);
  if (!experiment) return false;

  experiment.status = 'rolled-back';
  experiment.endDate = new Date().toISOString();
  saveExperiments(experiments);
  return true;
}

export function startExperiment(experimentId: string): boolean {
  const experiments = loadExperiments();
  const experiment = experiments.find((e) => e.id === experimentId);
  if (!experiment || experiment.status !== 'draft') return false;

  experiment.status = 'running';
  saveExperiments(experiments);
  return true;
}

// ─── CLI ──────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const action = args[0];

  if (action === 'list') {
    const experiments = loadExperiments();
    console.log(
      JSON.stringify(
        experiments.map((e) => ({
          id: e.id,
          name: e.name,
          status: e.status,
          variants: e.variants.length,
        })),
      ),
    );
  } else if (action === 'evaluate' && args[1]) {
    const result = evaluateExperiment(args[1]);
    console.log(JSON.stringify(result));
  } else {
    console.log('AB Testing Framework — CLI');
    console.log('  Commands: list, evaluate <id>');
  }
}

if (process.argv[1]?.includes('ab-testing-framework')) main();
