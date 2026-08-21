#!/usr/bin/env node

/* eslint-disable security/detect-unsafe-regex */
/* This regex validates conventional commit format - safe static pattern */

import { readFileSync, existsSync } from 'fs';
import { pathToFileURL } from 'url';

const CONVENTIONAL_COMMIT_REGEX =
  /^(feat|fix|docs|chore|refactor|test|style|perf|build|ci|revert)(\([a-z]+\))?:/;

function main(): number {
  const args = process.argv.slice(2);
  const commitMsgFile = args[0];

  if (!commitMsgFile) return 0;
  if (!existsSync(commitMsgFile)) return 0;

  let msg: string;
  try {
    msg = readFileSync(commitMsgFile, 'utf-8');
  } catch {
    return 0;
  }

  if (CONVENTIONAL_COMMIT_REGEX.test(msg)) {
    console.log('[OK] Conventional commit');
    return 0;
  }

  console.log('[FAIL] Not conventional commit');
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}

export { main as commitMsgSessionTrackHook };
