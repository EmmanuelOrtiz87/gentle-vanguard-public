#!/usr/bin/env node
/**
 * config-diff-detector.ts — Detecta drift en configuraciones JSON
 *
 * Escanea config/*.json, hashea contenidos y detecta cambios contra baseline.
 * Modos: --scan, --report, --diff
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, resolve, extname } from 'path';
import { createHash } from 'crypto';

const ROOT = resolve(process.cwd());
const CONFIG_DIR = join(ROOT, 'config');
const BASELINE_DIR = join(ROOT, '.runtime', 'config-baseline');
const BASELINE_FILE = join(BASELINE_DIR, 'baseline.json');

interface ConfigEntry {
  file: string;
  hash: string;
  size: number;
  lastModified: string;
  valid: boolean;
  schema?: string;
}

interface DiffEntry {
  file: string;
  type: 'added' | 'removed' | 'modified' | 'unchanged';
  oldHash?: string;
  newHash?: string;
  oldSize?: number;
  newSize?: number;
}

function hashFile(filePath: string): string {
  const content = readFileSync(filePath, 'utf-8');
  return createHash('sha256').update(content).digest('hex');
}

function isValidJson(filePath: string): boolean {
  try {
    JSON.parse(readFileSync(filePath, 'utf-8'));
    return true;
  } catch {
    return false;
  }
}

function scanConfigs(): ConfigEntry[] {
  if (!existsSync(CONFIG_DIR)) return [];

  return readdirSync(CONFIG_DIR)
    .filter((f) => extname(f) === '.json')
    .map((f) => {
      const fullPath = join(CONFIG_DIR, f);
      const stat = statSync(fullPath);
      return {
        file: f,
        hash: hashFile(fullPath),
        size: stat.size,
        lastModified: stat.mtime.toISOString(),
        valid: isValidJson(fullPath),
      };
    });
}

function loadBaseline(): ConfigEntry[] {
  try {
    if (existsSync(BASELINE_FILE)) return JSON.parse(readFileSync(BASELINE_FILE, 'utf-8'));
  } catch {
    /* ignore */
  }
  return [];
}

function saveBaseline(entries: ConfigEntry[]): void {
  if (!existsSync(BASELINE_DIR)) mkdirSync(BASELINE_DIR, { recursive: true });
  writeFileSync(BASELINE_FILE, JSON.stringify(entries, null, 2), 'utf-8');
}

function computeDiff(current: ConfigEntry[], baseline: ConfigEntry[]): DiffEntry[] {
  const diffs: DiffEntry[] = [];
  const baselineMap = new Map(baseline.map((e) => [e.file, e]));

  for (const entry of current) {
    const base = baselineMap.get(entry.file);
    if (!base) {
      diffs.push({ file: entry.file, type: 'added', newHash: entry.hash, newSize: entry.size });
    } else if (base.hash !== entry.hash) {
      diffs.push({
        file: entry.file,
        type: 'modified',
        oldHash: base.hash,
        newHash: entry.hash,
        oldSize: base.size,
        newSize: entry.size,
      });
    } else {
      diffs.push({ file: entry.file, type: 'unchanged' });
    }
    baselineMap.delete(entry.file);
  }

  for (const [file] of baselineMap) {
    diffs.push({ file, type: 'removed' });
  }

  return diffs;
}

function main(): void {
  const args = process.argv.slice(2);
  const action = args.includes('--scan')
    ? 'scan'
    : args.includes('--report')
      ? 'report'
      : args.includes('--diff')
        ? 'diff'
        : 'scan';

  const current = scanConfigs();
  const baseline = loadBaseline();

  if (action === 'scan') {
    saveBaseline(current);
    console.log(
      JSON.stringify({
        action: 'scan',
        configsFound: current.length,
        validCount: current.filter((c) => c.valid).length,
        invalidCount: current.filter((c) => !c.valid).length,
        baselineSaved: true,
      }),
    );
  } else if (action === 'diff') {
    const diffs = computeDiff(current, baseline);
    const changed = diffs.filter((d) => d.type !== 'unchanged');
    console.log(
      JSON.stringify({
        action: 'diff',
        total: diffs.length,
        unchanged: diffs.filter((d) => d.type === 'unchanged').length,
        added: diffs.filter((d) => d.type === 'added').length,
        removed: diffs.filter((d) => d.type === 'removed').length,
        modified: diffs.filter((d) => d.type === 'modified').length,
        changes: changed,
      }),
    );
  } else if (action === 'report') {
    console.log(
      JSON.stringify({
        action: 'report',
        configs: current,
        validRate:
          current.length > 0
            ? Math.round((current.filter((c) => c.valid).length / current.length) * 100)
            : 0,
      }),
    );
  }
}

if (process.argv[1]?.includes('config-diff-detector')) main();
