#!/usr/bin/env node

import { existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { runSync } from '../core/run-command.js';
import { join } from 'path';

function main(): number {
  const result = runSync('git', ['rev-parse', '--git-dir']);

  const gitDir = result.stdout?.trim();
  if (!gitDir) return 0;

  const mergeHead = join(gitDir, 'MERGE_HEAD');
  const rebaseApply = join(gitDir, 'rebase-apply');
  const rebaseMerge = join(gitDir, 'rebase-merge');
  const cherryPick = join(gitDir, 'CHERRY_PICK_HEAD');

  if (existsSync(rebaseApply) || existsSync(rebaseMerge)) {
    console.log(
      'Commit blocked: rebase in progress. Finish or abort the rebase before committing.',
    );
    return 1;
  }

  if (existsSync(cherryPick)) {
    console.log(
      'Commit blocked: cherry-pick in progress (CHERRY_PICK_HEAD present). Resolve it before committing.',
    );
    return 1;
  }

  const unmergedResult = runSync('git', ['diff', '--name-only', '--diff-filter=U']);
  const unmergedFiles = unmergedResult.stdout?.trim()
    ? unmergedResult.stdout.trim().split('\n').filter(Boolean)
    : [];

  if (existsSync(mergeHead) && unmergedFiles.length > 0) {
    console.log('Commit blocked: merge has unresolved conflicts. Resolve them before committing.');
    return 1;
  }

  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}

export { main as preventCommitDuringMerge };
