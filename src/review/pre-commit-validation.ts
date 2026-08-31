#!/usr/bin/env node

import { runSync } from '../core/run-command.js';
import { statSync } from 'fs';

function main(): void {
  let valid = true;
  const errors: string[] = [];

  let files: string;
  try {
    files = runSync('git', ['diff', '--cached', '--name-only'], { stdio: 'pipe' }).stdout.trim();
  } catch {
    files = '';
  }

  for (const file of files.split('\n').filter(Boolean)) {
    try {
      const size = statSync(file).size;
      if (size > 1024 * 1024) {
        errors.push(`File too large: ${file} (${(size / (1024 * 1024)).toFixed(2)} MB)`);
        valid = false;
      }
    } catch {
      // file might be deleted
    }
  }

  let content: string;
  try {
    content = runSync('git', ['diff', '--cached', '--unified=0'], { stdio: 'pipe' }).stdout.trim();
  } catch {
    content = '';
  }

  if (/(api[_-]?key|secret|password|token)\s*[:=]\s*["']?\w+/i.test(content)) {
    errors.push('Possible secret detected in staged changes');
    valid = false;
  }

  if (!valid) {
    console.log('[FAIL] Pre-commit validation failed:');
    for (const err of errors) console.log(`  - ${err}`);
    process.exit(1);
  }

  console.log('[OK] Pre-commit validation passed');
  process.exit(0);
}

main();
