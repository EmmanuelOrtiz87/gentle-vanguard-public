#!/usr/bin/env node
/**
 * session-scoring-autocompare.ts — Comparación automática de calidad entre sesiones
 *
 * Detecta regresión, anomalías y clusters de sesiones similares.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(process.cwd());
const SESSION_DIR = join(ROOT, '.session');
const CONTEXT_LOG = join(SESSION_DIR, 'context-log');
const REPORT_FILE = join(ROOT, '.session', 'quality-trend.json');

interface SessionScore {
  sessionId: string;
  timestamp: string;
  qualityScore: number;
  tokenEfficiency: number;
  errorCount: number;
  correctionCount: number;
  filesChanged: number;
  duration: number;
}

interface TrendReport {
  currentSession: SessionScore | null;
  baseline: {
    avgQuality: number;
    avgEfficiency: number;
    avgErrors: number;
  };
  regression: {
    qualityDrop: number | null;
    efficiencyDrop: number | null;
    errorIncrease: number | null;
  };
  anomalies: string[];
  recommendation: string;
}

function loadStateFiles(): SessionScore[] {
  const scores: SessionScore[] = [];

  if (!existsSync(CONTEXT_LOG)) return scores;

  const dirs = readdirSync(CONTEXT_LOG, { withFileTypes: true }).filter((d) => d.isDirectory());

  for (const dir of dirs.slice(-20)) {
    // Last 20 sessions
    const stateFile = join(CONTEXT_LOG, dir.name, '.state.json');
    if (!existsSync(stateFile)) continue;

    try {
      const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
      scores.push({
        sessionId: dir.name,
        timestamp: state.timestamp || state.createdAt || '',
        qualityScore: state.qualityScore || state.metrics?.qualityScore || 0,
        tokenEfficiency: state.tokenEfficiency || 0,
        errorCount: state.errors?.length || state.metrics?.errors || 0,
        correctionCount: state.corrections || 0,
        filesChanged: state.filesChanged || 0,
        duration: state.duration || 0,
      });
    } catch {
      /* skip corrupt */
    }
  }

  return scores.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

function detectRegression(scores: SessionScore[]): TrendReport {
  if (scores.length < 2) {
    return {
      currentSession: scores[0] || null,
      baseline: { avgQuality: 0, avgEfficiency: 0, avgErrors: 0 },
      regression: { qualityDrop: null, efficiencyDrop: null, errorIncrease: null },
      anomalies: [],
      recommendation: 'Not enough data for trend analysis',
    };
  }

  const current = scores[0];
  const historical = scores.slice(1);

  const baseline = {
    avgQuality: historical.reduce((s, x) => s + x.qualityScore, 0) / historical.length,
    avgEfficiency: historical.reduce((s, x) => s + x.tokenEfficiency, 0) / historical.length,
    avgErrors: historical.reduce((s, x) => s + x.errorCount, 0) / historical.length,
  };

  const regression = {
    qualityDrop:
      baseline.avgQuality > 0
        ? ((current.qualityScore - baseline.avgQuality) / baseline.avgQuality) * 100
        : null,
    efficiencyDrop:
      baseline.avgEfficiency > 0
        ? ((current.tokenEfficiency - baseline.avgEfficiency) / baseline.avgEfficiency) * 100
        : null,
    errorIncrease:
      baseline.avgErrors > 0
        ? ((current.errorCount - baseline.avgErrors) / baseline.avgErrors) * 100
        : null,
  };

  const anomalies: string[] = [];
  if (regression.qualityDrop !== null && regression.qualityDrop < -15) {
    anomalies.push(`Quality regression: ${regression.qualityDrop.toFixed(1)}%`);
  }
  if (regression.errorIncrease !== null && regression.errorIncrease > 50) {
    anomalies.push(`Error spike: ${regression.errorIncrease.toFixed(1)}% increase`);
  }

  let recommendation = 'Session quality is stable';
  if (anomalies.length > 0) {
    recommendation = `Anomalies detected: ${anomalies.join('; ')}. Auto-investigation recommended.`;
  } else if (regression.qualityDrop !== null && regression.qualityDrop > 5) {
    recommendation = 'Quality improving. Continue current patterns.';
  }

  const report: TrendReport = {
    currentSession: current,
    baseline,
    regression,
    anomalies,
    recommendation,
  };

  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf-8');
  return report;
}

function main(): void {
  const scores = loadStateFiles();
  const report = detectRegression(scores);
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1]?.includes('session-scoring-autocompare')) main();
