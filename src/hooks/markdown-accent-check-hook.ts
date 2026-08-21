#!/usr/bin/env node

import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';

const SPANISH_ACCENT_PATTERN = /[áéíóúñ]/;

function main(): number {
  const args = process.argv.slice(2);
  if (args.length === 0) return 0;

  let files: string[];
  if (args.length === 1 && args[0].includes(' ')) {
    files = args[0].split(' ').filter(Boolean);
  } else {
    files = args;
  }

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }

    if (SPANISH_ACCENT_PATTERN.test(content)) {
      console.log('[OK] Spanish accents found');
      return 0;
    }
  }

  console.log('[WARN] No Spanish accents detected');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}

export { main as markdownAccentCheckHook };
