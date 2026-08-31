import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
const logger = log('ORCHESTRATION-ADAPTIVE-ROUTER-CONFIG');
import { log } from '../../utils/logger.js';

// ─── Constants ────────────────────────────────────────────────────────

export const ROOT = resolve(process.cwd());
export const SESSION_DIR = join(ROOT, '.session');
export const SKILL_USAGE_DIR = join(SESSION_DIR, 'skill-usage');
export const METRICS_FILE = join(SESSION_DIR, 'metrics-report.json');
export const CORRECTIONS_LOG = join(SESSION_DIR, 'corrections-log.jsonl');
export const REFLECTIONS_DIR = join(SESSION_DIR, 'reflections');
export const KNOWLEDGE_DIR = join(SESSION_DIR, 'knowledge');
export const ROUTING_DIR = join(SESSION_DIR, 'routing');
export const ROUTING_TABLE_FILE = join(ROUTING_DIR, 'routing-table.json');
export const ROUTING_CONFIG = join(ROOT, 'config', 'adaptive-router.json');

export const DEFAULT_CONFIG = {
  minDataPoints: 3,
  minConfidenceForOverride: 0.8,
  maxOverrides: 20,
  decayDays: 14,
  outputDir: ROUTING_DIR,
  sources: {
    skillUsage: true,
    metricsDelegations: true,
    corrections: true,
    reflections: true,
    knowledgeConcepts: true,
    staticRouter: true,
  },
  routingTable: { maxEntries: 50, minSuccessRate: 0.3, preferRecentOverrides: true },
  autoApply: { overridesToPipeline: true, updateSkillRouter: false, maxChangesPerRun: 3 },
};

// ─── Helpers ──────────────────────────────────────────────────────────

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

export function now(): string {
  return new Date().toISOString();
}

export function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}
