#!/usr/bin/env node
import { runNpxTsxSync } from './core/run-command.js';
import { resolve } from 'path';

interface CliArgs {
  mode: string;
  quiet: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = { mode: '', quiet: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode' || args[i] === '-Mode') {
      result.mode = args[++i] || '';
    } else if (args[i] === '--quiet' || args[i] === '-Quiet') {
      result.quiet = true;
    }
  }
  return result;
}

const ROOT = resolve(process.cwd());

function run(): void {
  const { mode, quiet } = parseArgs();

  const tsArgs: string[] = [];
  if (mode) {
    tsArgs.push('--mode', mode);
  }
  if (quiet) {
    tsArgs.push('--quiet');
  }

  const result = runNpxTsxSync('src/session-manager.ts', tsArgs, {
    stdio: 'inherit',
    cwd: ROOT,
  });
  process.exit(result.status ?? 0);
}

run();
