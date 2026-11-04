#!/usr/bin/env node
/**
 * Auto-Optimizer (MEASUREMENT-ONLY)
 *
 * Mide el hit-rate del ResponseCache y persiste un reporte. NO aplica
 * optimizaciones automáticas: el output anterior ("Optimizations applied
 * automatically") mentía — corregido 2026-11-04 (auditoría de stack, regla
 * "no asumir ni fingir"). Si se quieren optimizaciones reales, construirlas
 * como steps con efecto verificable en el autostart.
 * Modes: auto, analyze, dry-run
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { ResponseCache } from '../resilience/response-cache';

const ROOT = resolve(process.cwd());
const REPORTS_DIR = join(ROOT, 'reports', 'optimization');

function log(msg: string, level = 'info'): void {
  const colors: Record<string, string> = {
    info: '\x1b[36m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
    success: '\x1b[32m',
  };
  console.log(`${colors[level] || colors.info}[AUTO-OPTIMIZE]\x1b[0m ${msg}`);
}

function analyzeCache(): { hitRate: number; entries: number } {
  try {
    const cache = new ResponseCache();
    const stats = cache.getStats();
    const total = stats.hits + stats.misses;
    return { hitRate: total > 0 ? (stats.hits / total) * 100 : 0, entries: stats.entries };
  } catch {
    return { hitRate: 0, entries: 0 };
  }
}

function runAutoOptimize(mode: string, quiet: boolean): void {
  if (!quiet) log(`Starting auto-optimization in ${mode} mode...`);

  const cacheStats = analyzeCache();

  if (!quiet) {
    console.log('\n=== Auto-Optimization Report (measurement-only) ===\n');
    console.log(`Cache Hit Rate: ${cacheStats.hitRate.toFixed(1)}%`);
    console.log(`Cache Entries: ${cacheStats.entries}`);
    console.log(`Mode: ${mode}`);
    console.log('\nStatus: medición completada');
    console.log('No se aplicaron optimizaciones automáticas (este script mide, no optimiza).\n');
  }

  // Save report
  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  const reportFile = join(
    REPORTS_DIR,
    `optimization-${new Date().toISOString().slice(0, 10)}.json`,
  );
  writeFileSync(
    reportFile,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        mode,
        cacheHitRate: cacheStats.hitRate,
        cacheEntries: cacheStats.entries,
        status: 'measurement-only',
        note: 'sin efecto: el script mide cache hit-rate; no aplica optimizaciones',
      },
      null,
      2,
    ),
  );

  if (!quiet) log(`Report saved to ${reportFile}`, 'success');
}

function main(): void {
  const args = process.argv.slice(2);
  let mode = 'auto';
  let quiet = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode') mode = args[++i] || 'auto';
    if (args[i] === '--quiet') quiet = true;
  }

  runAutoOptimize(mode, quiet);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { runAutoOptimize };
