import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
const logger = log('ML-KNOWLEDGE-SYNTHESIZER-CONFIG');
import { log } from '../../utils/logger.js';

export const ROOT = resolve(process.cwd());
export const SESSION_DIR = join(ROOT, '.session');
export const AUDIT_DIR = join(SESSION_DIR, 'audit', 'logs');
export const REFLECTIONS_DIR = join(SESSION_DIR, 'reflections');
export const DIGESTS_DIR = join(SESSION_DIR, 'digests');
export const METRICS_FILE = join(SESSION_DIR, 'metrics-report.json');
export const KNOWLEDGE_DIR = join(SESSION_DIR, 'knowledge');
export const KB_VAULT = join(ROOT, 'knowledge-base');
export const SYNTH_CONFIG = join(ROOT, 'config', 'knowledge-synthesis.json');

export const DEFAULT_CONFIG = {
  minSessionsForTrend: 2,
  maxKnowledgeMaps: 5,
  maxTrends: 10,
  maxGaps: 8,
  outputDir: KNOWLEDGE_DIR,
  sources: {
    engramContext: true,
    sessionDigests: true,
    reflectionOutputs: true,
    auditLogs: true,
    metrics: true,
    knowledgeBase: true,
    fineTuningData: true,
    contextLogs: true,
  },
  knowledgeMap: { maxConcepts: 50, maxRelationships: 100, minConfidence: 0.3 },
  trendAnalysis: { windowDays: 14, minDataPoints: 3, detectAccelerations: true },
  gapAnalysis: { enabled: true, minEvidenceCount: 2, suggestSources: true },
};

export function loadJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

export function loadJsonLines(path: string): Record<string, unknown>[] {
  try {
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf-8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Record<string, unknown>[];
  } catch {
    return [];
  }
}

export interface Logger {
  (msg: string): void;
}

export function getLogger(quiet: boolean): Logger {
  return (msg: string) => {
    if (!quiet) logger.info(msg);
  };
}

export function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

export function getDate(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function now(): string {
  return new Date().toISOString();
}
