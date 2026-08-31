#!/usr/bin/env node
/**
 * Lefthook Verify — check that lefthook CLI + config are present.
 * TS migration of scripts/utilities/lefthook-verify.ps1
 */

import { runSync } from '../core/run-command.js';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

const ROOT = path.resolve(process.cwd());

function main(): number {
  // Check if lefthook is installed
  let lefthookVersion: string | null = null;
  try {
    const output = runSync('lefthook', ['version'], { timeout: 5000 }).stdout;
    lefthookVersion = output.trim();
  } catch {
    console.log('lefthook is not installed — hooks will not run');
    return 0;
  }

  if (!lefthookVersion) {
    console.log('lefthook binary found but failed to run');
    return 0;
  }

  // Check for config file
  const configCandidates = ['lefthook.json', '.lefthook.yml', '.lefthook.yaml'];
  const found = configCandidates.find((name) => fs.existsSync(path.join(ROOT, name)));

  if (found) {
    console.log(`lefthook ${lefthookVersion} — ${found} found`);
  } else {
    console.log('lefthook is installed but no config file found in repo root');
  }

  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}

export { main as verifyLefthook };
