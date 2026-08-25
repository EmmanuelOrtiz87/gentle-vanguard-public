#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { runSync, runNpxTsxSync } from '../core/run-command.js';
import { pathToFileURL } from 'url';

interface CliArgs {
  action: string;
  quiet: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = { action: 'init', quiet: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--action' || args[i] === '-Action') {
      result.action = args[++i] || 'init';
    } else if (args[i] === '--quiet' || args[i] === '-Quiet') {
      result.quiet = true;
    }
  }
  return result;
}

const ROOT = path.resolve(process.cwd());
const SCRIPT_DIR = path.join(ROOT, 'scripts', 'utilities');
const LEGACY_PS1 = path.join(SCRIPT_DIR, 'token', 'token-metrics-store.ps1');
const TS_ENTRY = path.join(ROOT, 'src', 'tokens', 'token-metrics-store.ts');

function run(): void {
  const { action, quiet } = parseArgs();

  // TS migration: token-metrics-store.ps1 → src/tokens/token-metrics-store.ts
  if (fs.existsSync(TS_ENTRY)) {
    const tsArgs: string[] = [TS_ENTRY];
    if (action) {
      tsArgs.push('-Action', action);
    }
    if (quiet) {
      tsArgs.push('-Quiet');
    }
    const result = runNpxTsxSync(tsArgs[0], tsArgs.slice(1), {
      stdio: 'inherit',
      cwd: ROOT,
    });
    process.exit(result.status ?? 0);
  } else if (fs.existsSync(LEGACY_PS1)) {
    const psArgs: string[] = ['-File', LEGACY_PS1, '-Action', action];
    if (quiet) {
      psArgs.push('-Quiet');
    }
    const result = runSync('powershell', psArgs, { stdio: 'inherit', cwd: ROOT });
    process.exit(result.status ?? 0);
  } else {
    console.warn(`[token-usage-notifier] target not found: ${TS_ENTRY}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
