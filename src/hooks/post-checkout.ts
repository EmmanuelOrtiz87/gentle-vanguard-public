#!/usr/bin/env node

import { runNpxTsxSync, runSync } from '../core/run-command.js';
import { pathToFileURL } from 'url';

function execGit(args: string[], cwd: string = process.cwd()): string {
  const result = runSync('git', args, { cwd });
  return result.stdout?.trim() ?? '';
}

function main(): number {
  const cwd = process.cwd();
  const gitRoot = execGit(['rev-parse', '--show-toplevel'], cwd);
  if (!gitRoot) {
    return 0;
  }

  console.log('');
  console.log('  Gentle-Vanguard - Post-Checkout Health Check');
  console.log('');

  console.log('Running native TypeScript health check...');
  const result = runNpxTsxSync('src/core/health-check.ts', [], {
    cwd: gitRoot,
    timeout: 120_000,
    stdio: 'inherit',
  });
  if (result.status !== 0) return result.status ?? 1;

  console.log('[OK] Post-checkout completion check finished');
  console.log('');

  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}

export { main as postCheckout };
