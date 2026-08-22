#!/usr/bin/env tsx
/**
 * performance-analyzer.ts — Analyze script performance and identify bottlenecks
 *
 * Usage:
 *   npx tsx src/performance-analyzer.ts --scan src/
 *   npx tsx src/performance-analyzer.ts --benchmark src/skills/skill-embedder.ts
 *   npx tsx src/performance-analyzer.ts --report
 *
 * Features:
 *   - Scan all TypeScript files and measure startup time
 *   - Identify slow imports and heavy dependencies
 *   - Generate performance report with recommendations
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = process.cwd();
const REPORT_FILE = path.join(ROOT, '.runtime', 'performance-report.json');

interface PerfResult {
  file: string;
  startupTime: number;
  fileSize: number;
  importCount: number;
  timestamp: string;
}

interface PerfReport {
  version: string;
  generatedAt: string;
  results: PerfResult[];
  summary: {
    totalFiles: number;
    avgStartupTime: number;
    slowest: PerfResult[];
    fastest: PerfResult[];
  };
}

function ensureDir(): void {
  const dir = path.dirname(REPORT_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function measureStartupTime(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn('npx', ['tsx', filePath, '--help'], {
      cwd: ROOT,
      stdio: 'ignore',
      shell: true,
      windowsHide: true,
    });

    child.on('close', () => {
      resolve(Date.now() - start);
    });

    child.on('error', () => {
      resolve(-1);
    });

    // Timeout after 30s
    setTimeout(() => {
      child.kill();
      resolve(-1);
    }, 30000);
  });
}

function countImports(filePath: string): number {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const imports = content.match(/^import\s+/gm);
    return imports ? imports.length : 0;
  } catch {
    return 0;
  }
}

function getFileSize(filePath: string): number {
  try {
    const stats = fs.statSync(filePath);
    return stats.size;
  } catch {
    return 0;
  }
}

function findTsFilesRecursive(
  dir: string,
  baseDir: string,
  maxDepth: number = 3,
  currentDepth: number = 0,
): string[] {
  const files: string[] = [];

  if (currentDepth > maxDepth) return files;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        !entry.name.includes('node_modules')
      ) {
        files.push(...findTsFilesRecursive(fullPath, baseDir, maxDepth, currentDepth + 1));
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory not accessible, skip
  }

  return files;
}

async function scanDirectory(dir: string): Promise<string[]> {
  const absoluteDir = path.isAbsolute(dir) ? dir : path.join(ROOT, dir);
  return findTsFilesRecursive(absoluteDir, absoluteDir);
}

async function benchmarkFile(filePath: string): Promise<PerfResult | null> {
  const relativePath = path.relative(ROOT, filePath);
  const startupTime = await measureStartupTime(filePath);

  if (startupTime < 0) {
    return null;
  }

  return {
    file: relativePath,
    startupTime,
    fileSize: getFileSize(filePath),
    importCount: countImports(filePath),
    timestamp: new Date().toISOString(),
  };
}

async function scanAndReport(): Promise<void> {
  console.log('🔍 Scanning TypeScript files for performance analysis...\n');

  const files = await scanDirectory(path.join(ROOT, 'src'));
  console.log(`Found ${files.length} TypeScript files\n`);

  const results: PerfResult[] = [];

  // Sample only critical files to avoid long execution
  const criticalDirs = [
    'src\\skills',
    'src\\core',
    'src\\cli',
    'src' + path.sep + 'skills',
    'src' + path.sep + 'core',
    'src' + path.sep + 'cli',
  ];

  const sampleFiles = files
    .filter((f) => {
      const normalizedPath = f.replace(/\\/g, path.sep);
      return criticalDirs.some((dir) => normalizedPath.includes(dir));
    })
    .slice(0, 20);

  for (let i = 0; i < sampleFiles.length; i++) {
    const file = sampleFiles[i];
    const relativePath = path.relative(ROOT, file);
    process.stdout.write(`[${i + 1}/${sampleFiles.length}] Analyzing ${relativePath}...`);

    const result = await benchmarkFile(file);
    if (result) {
      results.push(result);
      process.stdout.write(` ${result.startupTime}ms\n`);
    } else {
      process.stdout.write(' ERROR\n');
    }
  }

  // Sort by startup time
  results.sort((a, b) => b.startupTime - a.startupTime);

  const report: PerfReport = {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    results,
    summary: {
      totalFiles: results.length,
      avgStartupTime: results.reduce((a, r) => a + r.startupTime, 0) / results.length,
      slowest: results.slice(0, 5),
      fastest: results.slice(-5).reverse(),
    },
  };

  ensureDir();
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf-8');

  console.log('\n📊 Performance Report\n');
  console.log(`Total files analyzed: ${report.summary.totalFiles}`);
  console.log(`Average startup time: ${report.summary.avgStartupTime.toFixed(0)}ms\n`);

  console.log('🐌 Slowest files:');
  report.summary.slowest.forEach((r) => {
    console.log(
      `  ${r.startupTime.toString().padStart(4)}ms - ${r.file} (${r.importCount} imports, ${(r.fileSize / 1024).toFixed(1)}KB)`,
    );
  });

  console.log('\n🚀 Fastest files:');
  report.summary.fastest.forEach((r) => {
    console.log(`  ${r.startupTime.toString().padStart(4)}ms - ${r.file}`);
  });

  console.log(`\n💾 Full report saved to: ${REPORT_FILE}`);
}

async function benchmarkSingle(filePath: string): Promise<void> {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);

  console.log(`Benchmarking: ${filePath}\n`);

  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    process.stdout.write(`Run ${i + 1}/5...`);
    const time = await measureStartupTime(absolutePath);
    times.push(time);
    process.stdout.write(` ${time}ms\n`);

    // Small delay between runs
    await new Promise((r) => setTimeout(r, 100));
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);

  console.log(`\n📊 Results:`);
  console.log(`  Average: ${avg.toFixed(0)}ms`);
  console.log(`  Min: ${min}ms`);
  console.log(`  Max: ${max}ms`);
  console.log(
    `  StdDev: ${Math.sqrt(times.map((t) => Math.pow(t - avg, 2)).reduce((a, b) => a + b) / times.length).toFixed(1)}ms`,
  );
}

async function showReport(): Promise<void> {
  if (!fs.existsSync(REPORT_FILE)) {
    console.error('No report found. Run: npx tsx src/performance-analyzer.ts --scan');
    process.exit(1);
  }

  const report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf-8')) as PerfReport;

  console.log('📊 Last Performance Report\n');
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Files: ${report.summary.totalFiles}`);
  console.log(`Avg startup: ${report.summary.avgStartupTime.toFixed(0)}ms\n`);

  console.log('🐌 Slowest:');
  report.summary.slowest.forEach((r) => {
    console.log(`  ${r.startupTime}ms - ${r.file}`);
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--scan')) {
    await scanAndReport();
  } else if (args.includes('--benchmark') && args[args.indexOf('--benchmark') + 1]) {
    await benchmarkSingle(args[args.indexOf('--benchmark') + 1]);
  } else if (args.includes('--report')) {
    await showReport();
  } else {
    console.log(`
Performance Analyzer - Gentle-Vanguard

Usage:
  npx tsx src/performance-analyzer.ts --scan
    Analyze all critical TypeScript files

  npx tsx src/performance-analyzer.ts --benchmark <file>
    Benchmark a specific file (5 runs)

  npx tsx src/performance-analyzer.ts --report
    Show last report

Examples:
  npx tsx src/performance-analyzer.ts --benchmark src/skills/skill-embedder.ts
  npx tsx src/performance-analyzer.ts --scan
`);
  }
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
