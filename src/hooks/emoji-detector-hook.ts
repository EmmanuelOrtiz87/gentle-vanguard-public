#!/usr/bin/env node

import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';

function hasEmojiChar(code: number): boolean {
  if (code >= 0xd800 && code <= 0xdfff) return true;
  if (code >= 0x2600 && code <= 0x27bf) return true;
  if (code >= 0x2b05 && code <= 0x2b55) return true;
  if (code >= 0x1f300) return true;
  return false;
}

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

    for (let i = 0; i < content.length; i++) {
      const code = content.charCodeAt(i);
      if (hasEmojiChar(code)) {
        console.log('[FAIL] Emojis found in script');
        return 1;
      }
    }
  }

  console.log('[OK] No emojis in script');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}

export { main as emojiDetectorHook };
