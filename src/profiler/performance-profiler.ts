#!/usr/bin/env node
/**
 * Performance Profiler - Native Stack Implementation
 * Benchmarks performance metrics without external dependencies
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join, resolve } from 'path';
import { performance } from 'perf_hooks';

interface BenchmarkResult {
  name: string;
  duration_ms: number;
  memory_before_mb: number;
  memory_after_mb: number;
  memory_delta_mb: number;
  timestamp: string;
  version: string;
}

interface BenchmarkComparison {
  name: string;
  current_ms: number;
  baseline_ms: number;
  delta_pct: number;
  status: 'IMPROVED' | 'REGRESSION' | 'STABLE';
  alert: boolean;
}

const PROFILER_DIR = join(resolve(process.cwd()), '.runtime', 'profiler');
const BASELINE_FILE = join(PROFILER_DIR, 'baseline.json');
const RESULTS_FILE = join(PROFILER_DIR, 'results.jsonl');

// Ensure directories exist
function ensureDirs(): void {
  mkdirSync(PROFILER_DIR, { recursive: true });
}

// Get memory usage in MB
function getMemoryMB(): number {
  return Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100;
}

// Run a benchmark
export async function benchmark<T>(name: string, fn: () => Promise<T>): Promise<BenchmarkResult> {
  ensureDirs();

  const memBefore = getMemoryMB();
  const start = performance.now();

  await fn();

  const duration = performance.now() - start;
  const memAfter = getMemoryMB();

  const result: BenchmarkResult = {
    name,
    duration_ms: Math.round(duration * 100) / 100,
    memory_before_mb: memBefore,
    memory_after_mb: memAfter,
    memory_delta_mb: Math.round((memAfter - memBefore) * 100) / 100,
    timestamp: new Date().toISOString(),
    version: getVersion(),
  };

  // Save result
  appendFileSync(RESULTS_FILE, JSON.stringify(result) + '\n', 'utf-8');

  return result;
}

// Get current version from package.json
function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

// Save baseline for comparison
export function saveBaseline(results: BenchmarkResult[]): void {
  ensureDirs();
  const baseline = {
    createdAt: new Date().toISOString(),
    version: getVersion(),
    benchmarks: results.reduce(
      (acc, r) => {
        acc[r.name] = r;
        return acc;
      },
      {} as Record<string, BenchmarkResult>,
    ),
  };
  writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2), 'utf-8');
}

// Compare with baseline
export function compareWithBaseline(result: BenchmarkResult): BenchmarkComparison {
  if (!existsSync(BASELINE_FILE)) {
    return {
      name: result.name,
      current_ms: result.duration_ms,
      baseline_ms: 0,
      delta_pct: 0,
      status: 'STABLE',
      alert: false,
    };
  }

  const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8'));
  const baselineResult = baseline.benchmarks[result.name];

  if (!baselineResult) {
    return {
      name: result.name,
      current_ms: result.duration_ms,
      baseline_ms: 0,
      delta_pct: 0,
      status: 'STABLE',
      alert: false,
    };
  }

  const delta = (result.duration_ms - baselineResult.duration_ms) / baselineResult.duration_ms;
  const deltaPct = Math.round(delta * 1000) / 10;

  let status: 'IMPROVED' | 'REGRESSION' | 'STABLE' = 'STABLE';
  if (delta < -0.1) status = 'IMPROVED';
  else if (delta > 0.1) status = 'REGRESSION';

  return {
    name: result.name,
    current_ms: result.duration_ms,
    baseline_ms: baselineResult.duration_ms,
    delta_pct: deltaPct,
    status,
    alert: delta > 0.2, // Alert if >20% slower
  };
}

// Run all benchmarks
export async function runAllBenchmarks(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  console.log('=== Gentle-Vanguard Performance Profiler ===\n');

  // Benchmark 1: Health check (skip - requires interactive)
  console.log('Benchmarking health check (simulated)...');
  results.push(
    await benchmark('health-check', async () => {
      // Simulate health check components
      await new Promise((r) => setTimeout(r, 100));
    }),
  );

  // Benchmark 2: Skill router query
  console.log('Benchmarking skill router...');
  results.push(
    await benchmark('skill-router', async () => {
      const fs = await import('fs');
      const embeddings = JSON.parse(fs.readFileSync('.atl/skill-embeddings.json', 'utf-8'));
      // Simulate 10 queries
      for (let i = 0; i < 10; i++) {
        embeddings.skills.slice(0, 5);
      }
    }),
  );

  // Benchmark 3: Audit pipeline
  console.log('Benchmarking audit pipeline...');
  results.push(
    await benchmark('audit-pipeline', async () => {
      const fs = await import('fs');
      const auditPath = join('.session', 'audit', 'index.json');
      if (fs.existsSync(auditPath)) {
        JSON.parse(fs.readFileSync(auditPath, 'utf-8'));
      }
    }),
  );

  // Benchmark 4: Nexus DB query
  console.log('Benchmarking Nexus DB...');
  results.push(
    await benchmark('nexus-db', async () => {
      const fs = await import('fs');
      const dbPath = join('.runtime', 'gentle-vanguard.db');
      if (fs.existsSync(dbPath)) {
        fs.statSync(dbPath);
      }
    }),
  );

  // Benchmark 5: Session start (lightweight)
  console.log('Benchmarking session pipeline load...');
  results.push(
    await benchmark('session-pipeline', async () => {
      const fs = await import('fs');
      const config = JSON.parse(fs.readFileSync('config/session-autostart.config.json', 'utf-8'));
      config.pipeline.steps.length;
    }),
  );

  return results;
}

// Print results
export function printResults(results: BenchmarkResult[]): void {
  console.log('\n=== Results ===\n');
  console.log('┌────────────────────┬────────────┬────────────┬────────────┐');
  console.log('│ Operation          │ Time (ms)  │ Memory Δ   │ Status     │');
  console.log('├────────────────────┼────────────┼────────────┼────────────┤');

  for (const result of results) {
    const comparison = compareWithBaseline(result);
    const status = comparison.alert
      ? '⚠️ REGRESSION'
      : comparison.delta_pct < -5
        ? '✅ IMPROVED'
        : '✓ STABLE';

    console.log(
      `│ ${result.name.padEnd(18)} │ ${result.duration_ms.toString().padStart(10)} │ ${
        (result.memory_delta_mb >= 0 ? '+' : '') + result.memory_delta_mb.toString().padStart(9)
      } │ ${status.padEnd(10)} │`,
    );
  }

  console.log('└────────────────────┴────────────┴────────────┴────────────┘');

  const alerts = results.filter((r) => compareWithBaseline(r).alert);
  if (alerts.length > 0) {
    console.log('\n⚠️  PERFORMANCE ALERTS:');
    for (const alert of alerts) {
      const cmp = compareWithBaseline(alert);
      console.log(`  - ${alert.name}: +${cmp.delta_pct}% slower than baseline`);
    }
  }
}

// CLI
if (process.argv[1]?.includes('performance-profiler.ts')) {
  const command = process.argv[2];

  void (async () => {
    switch (command) {
      case 'run': {
        const results = await runAllBenchmarks();
        printResults(results);
        break;
      }
      case 'baseline': {
        const results = await runAllBenchmarks();
        saveBaseline(results);
        console.log('\n✅ Baseline saved to', BASELINE_FILE);
        break;
      }
      case 'status': {
        if (existsSync(BASELINE_FILE)) {
          const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8'));
          console.log('Baseline created:', baseline.createdAt);
          console.log('Version:', baseline.version);
          console.log('Benchmarks:', Object.keys(baseline.benchmarks).length);
        } else {
          console.log('No baseline found. Run: npm run perf:baseline');
        }
        break;
      }
      default: {
        console.log('Usage: npx tsx src/profiler/performance-profiler.ts [run|baseline|status]');
        console.log('');
        console.log('  run     - Run benchmarks and compare with baseline');
        console.log('  baseline - Save current results as new baseline');
        console.log('  status  - Show baseline information');
        process.exit(1);
      }
    }
  })();
}
