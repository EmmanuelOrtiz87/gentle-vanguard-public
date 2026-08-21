#!/usr/bin/env node

/* eslint-disable security/detect-unsafe-regex */
/* This regex validates conventional commit format - safe static pattern */

import { existsSync, readFileSync } from 'fs';
import { pathToFileURL } from 'url';

const CONVENTIONAL_COMMIT_PATTERN =
  /^(feat|fix|docs|style|refactor|test|chore|perf|ci|build)(\(.+\))?: .+/;

const VALID_TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'test',
  'chore',
  'perf',
  'ci',
  'build',
];

function main(): number {
  const commitMsgFile = process.argv[2];

  if (!commitMsgFile || !existsSync(commitMsgFile)) {
    console.log('Usage: commitlint.ts <commit-msg-file>');
    return 0;
  }

  const msg = readFileSync(commitMsgFile, 'utf-8').trim();

  if (!CONVENTIONAL_COMMIT_PATTERN.test(msg)) {
    console.error('ERROR: Commit message must follow conventional commits format:');
    console.error('  <type>(<scope>): <description>');
    console.error(`  Types: ${VALID_TYPES.join('|')}`);
    return 1;
  }

  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}

export { main as commitlint };
