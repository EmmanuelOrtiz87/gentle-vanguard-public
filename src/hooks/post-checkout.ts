#!/usr/bin/env node

import { existsSync } from 'fs';
import { join } from 'path';
import { runSync } from '../core/run-command.js';
import { pathToFileURL } from 'url';

function execGit(args: string[], cwd: string = process.cwd()): string {
  const result = runSync('git', args, { cwd });
  return result.stdout?.trim() ?? '';
}

function runPowerShell(scriptPath: string, args: string[]): void {
  runSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
    {
      stdio: 'inherit',
    },
  );
}

function findUpward(startDir: string, relativePath: string): string | null {
  let candidate = startDir;
  while (candidate) {
    const testPath = join(candidate, relativePath);
    if (existsSync(testPath)) {
      return testPath;
    }
    const parent = join(candidate, '..');
    if (parent === candidate || !parent) break;
    candidate = parent;
  }
  return null;
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

  const diagnosticsScript = findUpward(
    gitRoot,
    join('scripts', 'diagnostics', 'system-diagnostics.ps1'),
  );
  const autoInitScript = findUpward(
    gitRoot,
    join('scripts', 'utilities', 'UTILITIES', 'auto-init-dev-environment.ps1'),
  );

  if (diagnosticsScript) {
    console.log('Running system diagnostics...');
    runPowerShell(diagnosticsScript, ['-Quiet', '-AutoRepair']);
  } else {
    console.log('[WARN] Diagnostics script not found');
  }

  if (autoInitScript) {
    console.log('Verifying environment...');
    runPowerShell(autoInitScript, ['-Quiet', '-Force']);
  } else {
    console.log('[INFO] Optional auto-init script not found (skipped)');
  }

  console.log('[OK] Post-checkout completion check finished');
  console.log('');

  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}

export { main as postCheckout };
