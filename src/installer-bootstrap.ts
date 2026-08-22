#!/usr/bin/env node

/**
 * Reproducible bootstrap for a checked-out Gentle-Vanguard distribution.
 *
 * This is intentionally conservative: it installs project dependencies only,
 * never downloads OS runtimes or secrets without an explicit external installer.
 * The future SEA/NSIS installer can call the same phases after provisioning Node.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(process.cwd());
const dryRun = process.argv.includes('--dry-run');
const full = process.argv.includes('--full');

function command(name: string, args: string[], label: string): boolean {
  console.log(`${dryRun ? '[DRY-RUN] ' : ''}${label}`);
  if (dryRun) return true;
  const result = spawnSync(name, args, { cwd: root, stdio: 'inherit', shell: false, windowsHide: true });
  if (result.status !== 0) {
    console.error(`Bootstrap failed in: ${label}`);
    return false;
  }
  return true;
}

function main(): void {
  if (!existsSync(join(root, 'package.json')) || !existsSync(join(root, 'config', 'installer-manifest.json'))) {
    console.error('Run the bootstrap from the Gentle-Vanguard repository root.');
    process.exit(2);
  }

  for (const directory of ['.runtime', '.session', '.telemetry']) {
    const path = join(root, directory);
    if (!existsSync(path) && !dryRun) mkdirSync(path, { recursive: true });
  }

  if (!command('pnpm', ['install', '--frozen-lockfile'], 'Install locked project dependencies')) process.exit(1);
  if (!command('npx', ['tsx', 'src/installer-doctor.ts', '--strict'], 'Verify installed dependencies')) process.exit(1);
  if (!command('npx', ['tsx', 'src/database/db-init.ts', '--quiet'], 'Initialize Nexus database')) process.exit(1);
  if (!command('npx', ['lefthook', 'install'], 'Install repository hooks')) process.exit(1);
  if (full && !command('npx', ['tsx', 'src/maintenance-watchtower.ts', '--Action', 'health', '--Quiet'], 'Run full stack health check')) process.exit(1);

  console.log('Bootstrap completed. Next: npm run session:autostart:detached');
}

main();
