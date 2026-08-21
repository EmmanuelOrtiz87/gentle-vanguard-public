#!/usr/bin/env node

import { runSync, runNpxTsxSync } from '../core/run-command.js';
import { existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface HashlineSnapshotHookArgs {
  quiet: boolean;
}

function parseArgs(): HashlineSnapshotHookArgs {
  const args = process.argv.slice(2);
  return { quiet: args.includes('--quiet') || args.includes('-q') };
}

function main(): void {
  const args = parseArgs();

  let changed: string;
  try {
    changed = runSync('git', ['diff', '--name-only', 'HEAD~1', 'HEAD'], {
      stdio: 'pipe',
    }).stdout.trim();
  } catch {
    return;
  }

  if (!changed) return;

  const lines = changed.split('\n');
  for (const rawPath of lines) {
    const p = rawPath.trim();
    if (p && existsSync(p)) {
      const hashlineScript = join(resolve(__dirname, '..'), 'src', 'hashline.ts');
      const quietArgs = args.quiet ? ['--quiet'] : [];
      try {
        runNpxTsxSync(hashlineScript, ['--action', 'update', '--path', p, ...quietArgs], {
          stdio: 'pipe',
        });
      } catch {
        // silently continue on error
      }
    }
  }
}

main();
