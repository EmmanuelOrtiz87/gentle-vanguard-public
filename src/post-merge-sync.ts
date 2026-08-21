#!/usr/bin/env node

import { runSync } from './core/run-command.js';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function main(): void {
  const repoRoot = resolve(__dirname, '..');

  console.log('[INFO] Running post-merge sync...');

  const validatorTs = resolve(repoRoot, 'src', 'cross-workspace-validator.ts');
  const validatorPs1 = resolve(repoRoot, 'src/cross-workspace-validator.ts');
  if (existsSync(validatorTs)) {
    runSync('npx', ['tsx', validatorTs, '--fix'], { stdio: 'inherit' });
  } else if (existsSync(validatorPs1)) {
    runSync('powershell', ['-File', validatorPs1, '-Fix'], { stdio: 'inherit' });
  }

  try {
    const version = runSync('engram', ['--version'], { stdio: 'pipe' }).stdout.trim();
    if (/Update available/i.test(version)) {
      console.log('[WARN] Engram update available');
    }
  } catch {
    // engram CLI not available
  }

  console.log('[OK] Post-merge sync completed');
  process.exit(0);
}

main();
