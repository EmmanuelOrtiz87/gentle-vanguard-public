#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface PeriodicCheckpointArgs {
  intervalHours: number;
  quiet: boolean;
}

function parseArgs(): PeriodicCheckpointArgs {
  const args = process.argv.slice(2);
  let intervalHours = 24;
  const idx = args.indexOf('--interval-hours');
  if (idx !== -1 && idx + 1 < args.length) {
    intervalHours = parseInt(args[idx + 1], 10) || 24;
  }
  return { intervalHours, quiet: args.includes('--quiet') || args.includes('-q') };
}

function findRepoRoot(dir: string): string {
  let current = resolve(dir);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return dir;
}

function main(): void {
  const args = parseArgs();
  const root = findRepoRoot(__dirname);
  const rpDir = join(root, '.session', 'restore-points');
  mkdirSync(rpDir, { recursive: true });

  const loop = async (): Promise<void> => {
    while (true) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
      const rp = {
        id: `checkpoint-${timestamp}`,
        timestamp,
        type: 'scheduled-checkpoint',
        intervalHours: args.intervalHours,
      };
      writeFileSync(join(rpDir, `${timestamp}.json`), JSON.stringify(rp, null, 2), 'utf8');
      if (!args.quiet) console.log(`[CHECKPOINT] Created: checkpoint-${timestamp}`);
      await new Promise((resolve) => setTimeout(resolve, args.intervalHours * 3600000));
    }
  };

  loop().catch((err) => {
    console.error('[CHECKPOINT] Fatal error:', err);
    process.exit(1);
  });
}

main();
