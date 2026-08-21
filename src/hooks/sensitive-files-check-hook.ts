#!/usr/bin/env node

import { readFileSync, existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { runSync } from '../core/run-command.js';

function main(): number {
  const staging = runSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM']);

  let stagedFiles: string[] = [];
  if (staging.stdout?.trim()) {
    stagedFiles = staging.stdout.trim().split('\n').filter(Boolean);
  }

  // Accept files from CLI args if provided
  const args = process.argv.slice(2);
  if (args.length > 0) {
    stagedFiles = args;
  }

  if (stagedFiles.length === 0) return 0;

  for (const file of stagedFiles) {
    if (!existsSync(file)) continue;
    try {
      const content = readFileSync(file, 'utf-8');
      JSON.parse(content);
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.log(`[FAIL] Invalid JSON in ${file}: ${errMsg}`);
      return 1;
    }
  }

  console.log('[OK] All JSON valid');
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}

export { main as sensitiveFilesCheck };
