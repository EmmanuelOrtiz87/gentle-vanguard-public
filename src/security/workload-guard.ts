#!/usr/bin/env node
/**
 * Workload Guard — evaluates if a multi-file implementation exceeds thresholds.
 * Prevents large unfocused changes. TS migration of review-workload-guard concept.
 *
 * Usage:
 *   npx tsx src/security/workload-guard.ts --files src/a.ts src/b.ts --lines 450
 *   npx tsx src/security/workload-guard.ts --diff (reads from git diff --stat)
 */

import { runSync } from '../core/run-command.js';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

interface GuardResult {
  passed: boolean;
  totalFiles: number;
  totalLines: number;
  threshold: number;
  warnings: string[];
  errors: string[];
}

const DEFAULT_LINE_THRESHOLD = 400;
const DEFAULT_FILE_THRESHOLD = 8;

function parseArgs(): {
  files: string[];
  lines: number;
  fileLimit: number;
  diff: boolean;
  json: boolean;
} {
  const raw = process.argv.slice(2);
  const files: string[] = [];
  let lines = DEFAULT_LINE_THRESHOLD;
  let fileLimit = DEFAULT_FILE_THRESHOLD;
  let diff = false;
  let json = false;

  for (let i = 0; i < raw.length; i++) {
    switch (raw[i]) {
      case '--files': {
        i++;
        while (i < raw.length && !raw[i].startsWith('--')) {
          files.push(raw[i]);
          i++;
        }
        i--;
        break;
      }
      case '--lines':
        lines = parseInt(raw[++i], 10) || DEFAULT_LINE_THRESHOLD;
        break;
      case '--file-limit':
        fileLimit = parseInt(raw[++i], 10) || DEFAULT_FILE_THRESHOLD;
        break;
      case '--diff':
        diff = true;
        break;
      case '--json':
        json = true;
        break;
    }
  }

  return { files, lines, fileLimit, diff, json };
}

function getGitDiffStats(): { files: string[]; totalLines: number } {
  try {
    const output = runSync('git', ['diff', '--stat', 'HEAD'], { maxBuffer: 1024 * 1024 }).stdout;
    const lines = output.trim().split('\n');
    const changedFiles: string[] = [];
    let totalChangedLines = 0;

    for (const line of lines) {
      // Parse lines like: "src/file.ts | 15 +++++++-------"
      const match = line.match(/^(.+?)\s+\|\s+(\d+)/);
      if (match) {
        changedFiles.push(match[1].trim());
        totalChangedLines += parseInt(match[2], 10);
      }
    }

    return { files: changedFiles, totalLines: totalChangedLines };
  } catch {
    return { files: [], totalLines: 0 };
  }
}

function countLinesInFiles(filePaths: string[]): {
  totalLines: number;
  fileDetails: { path: string; lines: number }[];
} {
  const fileDetails: { path: string; lines: number }[] = [];
  let totalLines = 0;

  for (const fp of filePaths) {
    const resolved = resolve(process.cwd(), fp);
    if (!existsSync(resolved)) {
      fileDetails.push({ path: fp, lines: 0 });
      continue;
    }
    try {
      const content = readFileSync(resolved, 'utf8');
      const lineCount = content.split('\n').length;
      fileDetails.push({ path: fp, lines: lineCount });
      totalLines += lineCount;
    } catch {
      fileDetails.push({ path: fp, lines: 0 });
    }
  }

  return { totalLines, fileDetails };
}

function main(): void {
  const args = parseArgs();
  const result: GuardResult = {
    passed: true,
    totalFiles: 0,
    totalLines: 0,
    threshold: args.lines,
    warnings: [],
    errors: [],
  };

  let filesToCheck = args.files;
  let totalLines = 0;

  if (args.diff) {
    const diffStats = getGitDiffStats();
    filesToCheck = diffStats.files;
    totalLines = diffStats.totalLines;
    result.totalFiles = filesToCheck.length;
    result.totalLines = totalLines;
  } else if (filesToCheck.length > 0) {
    const counts = countLinesInFiles(filesToCheck);
    totalLines = counts.totalLines;
    result.totalFiles = filesToCheck.length;
    result.totalLines = totalLines;
  } else {
    result.errors.push('No files specified. Use --files or --diff.');
    result.passed = false;
    printResult(result, args.json);
    return;
  }

  // Check line threshold
  if (totalLines > args.lines) {
    result.errors.push(
      `Implementation exceeds line threshold: ${totalLines} lines (max ${args.lines}). ` +
        `Consider splitting into smaller PRs.`,
    );
    result.passed = false;
  } else if (totalLines > args.lines * 0.75) {
    result.warnings.push(
      `Approaching line threshold: ${totalLines}/${args.lines} lines. Consider reducing scope.`,
    );
  }

  // Check file count threshold
  if (result.totalFiles > args.fileLimit) {
    result.warnings.push(
      `High file count: ${result.totalFiles} files (recommended max ${args.fileLimit}). ` +
        `Review if all changes are necessary.`,
    );
  }

  printResult(result, args.json);
}

function printResult(result: GuardResult, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.passed ? 0 : 1);
  }

  if (result.passed) {
    if (result.warnings.length === 0) {
      console.log(
        `[WORKLOAD-GUARD] ✅ PASS — ${result.totalLines} lines across ${result.totalFiles} files`,
      );
    } else {
      console.log(
        `[WORKLOAD-GUARD] ⚠️  PASS with warnings — ${result.totalLines} lines across ${result.totalFiles} files`,
      );
      for (const w of result.warnings) console.warn(`  ⚠️  ${w}`);
    }
    process.exit(0);
  } else {
    console.error(
      `[WORKLOAD-GUARD] ❌ FAIL — ${result.totalLines} lines across ${result.totalFiles} files`,
    );
    for (const e of result.errors) console.error(`  ❌ ${e}`);
    for (const w of result.warnings) console.warn(`  ⚠️  ${w}`);
    process.exit(1);
  }
}

main();
