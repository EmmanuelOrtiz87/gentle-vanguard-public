#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface AdaptiveState {
  optimizationActive: boolean;
  normalStreak: number;
  lastAction: string;
  lastReason: string;
  lastChangedAt: string | null;
}

export function getRepoRoot(): string {
  let dir = resolve(__dirname);
  while (dir) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export function getSessionDir(repoRoot: string): string {
  const sessionDir = join(repoRoot, '.session');
  mkdirSync(sessionDir, { recursive: true });
  return sessionDir;
}

export function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8');
    if (raw) return JSON.parse(raw) as T;
  } catch {
    /* ignore */
  }
  return null;
}

export function saveJsonFile(path: string, data: unknown): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

export function getDefaultState(): AdaptiveState {
  return {
    optimizationActive: false,
    normalStreak: 0,
    lastAction: 'none',
    lastReason: 'none',
    lastChangedAt: null,
  };
}

export function ensureStateProperties(state: AdaptiveState | null): AdaptiveState {
  if (!state) return getDefaultState();
  const defaults = getDefaultState();
  for (const key of Object.keys(defaults) as Array<keyof AdaptiveState>) {
    if (state[key] === undefined)
      (state as unknown as Record<string, unknown>)[key] = defaults[key];
  }
  return state;
}

export function testPeakHour(timeZone: string, peakStart = 9, peakEnd = 15): boolean {
  try {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const tzOffset = getTimezoneOffset(timeZone);
    const localHour = new Date(utc + tzOffset * 3600000).getHours();
    return localHour >= peakStart && localHour < peakEnd;
  } catch {
    return false;
  }
}

function getTimezoneOffset(tz: string): number {
  // Approximate offset lookup for common timezones
  const offsets: Record<string, number> = {
    UTC: 0,
    GMT: 0,
    'America/New_York': -5,
    'America/Chicago': -6,
    'America/Denver': -7,
    'America/Los_Angeles': -8,
    'Europe/London': 0,
    'Europe/Paris': 1,
    'Europe/Berlin': 1,
    'Europe/Madrid': 1,
    'Europe/Rome': 1,
    'Asia/Tokyo': 9,
    'Asia/Shanghai': 8,
    'Asia/Hong_Kong': 8,
    'Asia/Singapore': 8,
    'Australia/Sydney': 11,
    'Australia/Melbourne': 11,
    'Pacific/Auckland': 13,
    'America/Sao_Paulo': -3,
    'America/Argentina/Buenos_Aires': -3,
  };
  if (offsets[tz] !== undefined) return offsets[tz];
  // Try to extract offset from Windows timezone ID
  const match = tz.match(/UTC([+-]\d+)/);
  if (match) return parseInt(match[1], 10);
  return 0;
}

export function testTokenPressure(repoRoot?: string): boolean {
  const root = repoRoot || getRepoRoot();
  const budgetFile = join(root, '.session', 'token-budget.json');
  const budget = readJsonFile<{ used?: number; limit?: number }>(budgetFile);
  if (!budget) return false;
  if (budget.used && budget.limit) {
    return budget.used / budget.limit > 0.8;
  }
  return false;
}

export function getAdaptiveReason(peak: boolean, pressure: boolean): string {
  if (peak && pressure) return 'peak+pressure';
  if (peak) return 'peak-hours';
  if (pressure) return 'token-pressure';
  return 'normal';
}

export function logOk(msg: string): void {
  console.log(`  [OK] ${msg}`);
}
export function logWarn(msg: string): void {
  console.log(`  [WARN] ${msg}`);
}
export function logInfo(msg: string): void {
  console.log(`  [INFO] ${msg}`);
}

// CLI entry point
function main(): void {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('adaptive-common.ts — shared helper functions for adaptive profile scripts');
    console.log('');
    console.log('Exports:');
    console.log('  getRepoRoot, getSessionDir, readJsonFile, saveJsonFile');
    console.log('  getDefaultState, ensureStateProperties, testPeakHour');
    console.log('  testTokenPressure, getAdaptiveReason, logOk, logWarn, logInfo');
    process.exit(0);
  }

  const repoRoot = getRepoRoot();
  console.log(`Repo root: ${repoRoot}`);
  console.log(`Token pressure: ${testTokenPressure(repoRoot)}`);
  console.log(`Default state: ${JSON.stringify(getDefaultState())}`);
}

if (
  process.argv[1] &&
  (process.argv[1] === __filename || process.argv[1].endsWith('adaptive-common.ts'))
) {
  main();
}
