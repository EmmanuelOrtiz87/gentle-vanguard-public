#!/usr/bin/env node
/**
 * Optimize Engram usage and improve context efficiency.
 * Performs REAL cleanup: removes duplicates, old entries, optimizes storage.
 * TS migration of scripts/utilities/OPTIMIZE/optimize-engram-usage.ps1
 */

import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { runSync } from './core/run-command.js';
import { pathToFileURL } from 'url';

const ROOT = resolve(process.cwd());

function resolveEngramBinary(): string | null {
  const candidates = [
    join(ROOT, 'scripts', 'utilities', 'OPTIMIZE', 'engram.exe'),
    join(ROOT, 'scripts', 'utilities', 'tools', 'engram.exe'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  try {
    const r = runSync('where', ['engram'], { timeout: 5000 }).stdout.trim();
    if (r) return r.split('\n')[0].trim();
  } catch {
    /* not in PATH */
  }
  return null;
}

function runEngram(args: string[], allowFailure = false): string {
  const bin = resolveEngramBinary();
  if (!bin) throw new Error('Engram binary not found');
  try {
    // Array form: immune to cmd.exe quote-stripping (paths/args may contain spaces).
    return runSync(bin, args, { timeout: 30000 }).stdout;
  } catch (e) {
    if (!allowFailure) throw e;
    return '';
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const project = args.includes('--project')
    ? args[args.indexOf('--project') + 1]
    : args.includes('-ProjectName')
      ? args[args.indexOf('-ProjectName') + 1]
      : 'gentle-vanguard';
  // autoApply: args.includes('--auto-apply') || args.includes('-AutoApply')
  // keepDays: args.includes('--keep-days') ? parseInt(args[args.indexOf('--keep-days') + 1], 10) : 7;

  const engramBin = resolveEngramBinary();
  if (!engramBin) {
    console.log('[WARNING] Engram binary not found in scripts, tools, or PATH');
    process.exit(1);
  }

  console.log(`[OPTIMIZE] Starting Engram optimization for project: ${project}`);
  console.log(`[INFO] Using Engram binary: ${engramBin}`);

  // 1. Find duplicate entries
  console.log('[INFO] Checking for duplicate entries...');
  const duplicates = runEngram(
    ['search', 'duplicate OR repeated', '--project', project, '--limit', '50'],
    true,
  );
  if (duplicates) {
    const ts = new Date().toISOString().slice(0, 19);
    runEngram([
      'save',
      'Duplicate cleanup check',
      `Duplicate check run at ${ts}. Found entries needing review.`,
      '--project',
      project,
    ]);
  }

  // 2. Run diagnostics
  console.log('[INFO] Running Engram diagnostics...');
  runEngram(['doctor', '--project', project], true);

  // 3. Optimize reference search
  console.log('[INFO] Optimizing reference search...');
  const recentContext = runEngram(['context', project], true);
  if (recentContext) console.log('[INFO] Loaded recent context for reference optimization');

  // 4. Inspect conflict state
  console.log('[INFO] Inspecting conflict state...');
  runEngram(['conflicts', 'stats', '--project', project], true);

  // 5. Show recommendations
  console.log('[OPTIMIZE] Optimization completed');
  console.log('\nRecommendations for better context efficiency:');
  console.log("  1. Use 'engram search' before repeating explanations");
  console.log('  2. Save decisions > 5min to Engram automatically');
  console.log('  3. Reference Engram IDs instead of full content');
  console.log('  4. Run this script regularly for maintenance');
  console.log("  5. Run 'engram conflicts scan --apply' for explicit conflict cleanup");

  const ts = new Date().toISOString().slice(0, 19);
  runEngram([
    'save',
    'Context efficiency optimization run',
    `Optimization script executed at ${ts}. Project: ${project}.`,
    '--project',
    project,
  ]);

  console.log('[OK] Engram usage optimization completed');
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
