#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { runSync, runNpxTsxSync } from './core/run-command.js';

const ROOT = process.cwd();

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

interface Options {
  quiet: boolean;
  json: boolean;
}

function parseOptions(): Options {
  const args = process.argv.slice(2);
  return {
    quiet: args.includes('--quiet'),
    json: args.includes('--json'),
  };
}

async function checkEngramVersion(): Promise<CheckResult> {
  try {
    const out = runSync('engram', ['--version'], { timeout: 10000 }).stdout.trim();
    return { name: 'Engram Version', passed: true, detail: out };
  } catch {
    return { name: 'Engram Version', passed: false, detail: 'Engram not available' };
  }
}

async function checkPnpmAudit(): Promise<CheckResult> {
  try {
    runSync('pnpm', ['audit'], { timeout: 60000, stdio: 'pipe' });
    return { name: 'pnpm Audit', passed: true, detail: 'No vulnerabilities found' };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Audit failed';
    return { name: 'pnpm Audit', passed: false, detail: msg };
  }
}

async function checkJsonConfigs(): Promise<CheckResult> {
  const details: string[] = [];
  let allPassed = true;
  for (const file of ['opencode.json', '.windsurf/config.json']) {
    const fp = path.resolve(ROOT, file);
    if (!fs.existsSync(fp)) {
      details.push(`${file}: Not found`);
      allPassed = false;
      continue;
    }
    try {
      JSON.parse(fs.readFileSync(fp, 'utf-8'));
      details.push(`${file}: Valid`);
    } catch {
      details.push(`${file}: Invalid JSON`);
      allPassed = false;
    }
  }
  return { name: 'JSON Config Validation', passed: allPassed, detail: details.join(', ') };
}

async function checkFileSizes(): Promise<CheckResult> {
  const details: string[] = [];
  let allPassed = true;
  for (const file of ['opencode.json', '.windsurf/config.json', 'package.json']) {
    const fp = path.resolve(ROOT, file);
    if (!fs.existsSync(fp)) {
      details.push(`${file}: Not found`);
      allPassed = false;
      continue;
    }
    const size = fs.statSync(fp).size;
    details.push(`${file}: ${size} bytes`);
    if (size === 0) {
      allPassed = false;
    }
  }
  return { name: 'File Size Check', passed: allPassed, detail: details.join(', ') };
}

async function checkWatchtowerHealth(): Promise<CheckResult> {
  try {
    runNpxTsxSync('src/maintenance-watchtower.ts', ['--action', 'health', '--quiet'], {
      timeout: 30000,
      stdio: 'pipe',
    });
    return { name: 'Watchtower Health', passed: true, detail: 'Watchtower ran successfully' };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Watchtower failed';
    return { name: 'Watchtower Health', passed: false, detail: msg };
  }
}

async function run(): Promise<void> {
  const opts = parseOptions();
  const checks: (() => Promise<CheckResult>)[] = [
    checkEngramVersion,
    checkPnpmAudit,
    checkJsonConfigs,
    checkFileSizes,
    checkWatchtowerHealth,
  ];

  const results: CheckResult[] = [];
  for (const check of checks) {
    const result = await check();
    results.push(result);
    if (opts.json) continue;
    if (!opts.quiet || !result.passed) {
      const icon = result.passed ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
      console.log(`${icon} ${result.name}`);
      if (result.detail) console.log(`       \x1b[90m${result.detail}\x1b[0m`);
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(results, null, 2));
  }

  const failed = results.filter((r) => !r.passed).length;
  if (failed > 0) process.exit(1);
}

void run();
