#!/usr/bin/env node

import { runSync } from './core/run-command.js';
import { existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface GitFlowArgs {
  quiet: boolean;
  enforcePrBase: boolean;
  prBase: string;
  interactive: boolean;
}

interface GitFlowResult {
  exitCode: number;
}

function parseArgs(): GitFlowArgs {
  const args = process.argv.slice(2);
  return {
    quiet: args.includes('--quiet') || args.includes('-q'),
    enforcePrBase: args.includes('--enforce-pr-base'),
    prBase: extractArg(args, '--pr-base') || '',
    interactive: args.includes('--interactive') || args.includes('-i'),
  };
}

function extractArg(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

function findRepoRoot(start: string): string {
  const envDir = process.env.GV_BASE_DIR;
  if (envDir && existsSync(envDir)) return envDir;
  let dir = resolve(start);
  while (dir) {
    if (existsSync(join(dir, 'config', 'orchestrator.json'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

function writeHeader(msg: string, quiet: boolean): void {
  if (!quiet) {
    console.log('');
    console.log('='.repeat(56));
    console.log(msg);
    console.log('='.repeat(56));
  }
}

function writeOk(msg: string, quiet: boolean): void {
  if (!quiet) console.log(`[OK] ${msg}`);
}
function writeWarn(msg: string, quiet: boolean): void {
  if (!quiet) console.log(`[WARN] ${msg}`);
}
function writeFail(msg: string): void {
  console.error(`[ERROR] ${msg}`);
}
function writeInfo(msg: string, quiet: boolean): void {
  if (!quiet) console.log(`[INFO] ${msg}`);
}

function showGitFlowHelp(currentBranch: string, _kind: string, expectedBase: string): void {
  console.log('');
  console.log('='.repeat(56));
  console.log('GitFlow Validation Guide - Gentle-Vanguard');
  console.log('='.repeat(56));
  console.log('');
  console.log('QUICK SOLUTION:');
  console.log('1. Create a working branch:');
  console.log('   git checkout -b feature/your-description');
  console.log('');
  console.log('2. Make your changes and commits');
  console.log('3. Push the branch:');
  console.log(`   git push -u origin ${currentBranch}`);
  console.log('');
  console.log('4. Open a Pull Request on GitHub');
  console.log(`   Base: ${expectedBase}`);
  console.log('');
  console.log('ALLOWED BRANCH TYPES:');
  console.log('  feature/*  - New functionality - PR base: develop');
  console.log('  bugfix/*   - Bug fixes - PR base: develop');
  console.log('  chore/*    - Maintenance - PR base: develop');
  console.log('  hotfix/*   - Critical fixes - PR base: main');
  console.log('  release/*  - Release prep - PR base: main');
  console.log('');
  console.log('VALID BRANCH NAME EXAMPLES:');
  console.log('  feature/add-user-authentication');
  console.log('  bugfix/fix-login-timeout');
  console.log('  chore/update-dependencies');
  console.log('  hotfix/critical-security-patch');
  console.log('');
}

function main(): GitFlowResult {
  const args = parseArgs();
  const repoRoot = findRepoRoot(__dirname);

  try {
    process.chdir(repoRoot);
  } catch {
    writeFail(`Cannot change to repo root: ${repoRoot}`);
    return { exitCode: 1 };
  }

  writeHeader('GitFlow Validation', args.quiet);

  let branch: string;
  try {
    branch = runSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { stdio: 'pipe' }).stdout.trim();
  } catch {
    writeFail('Unable to detect current git branch.');
    return { exitCode: 1 };
  }

  writeInfo(`Current branch: ${branch}`, args.quiet);

  const allowProtectedPush = process.env.GITFLOW_ALLOW_PROTECTED_PUSH === '1';
  if ((branch === 'main' || branch === 'develop') && !allowProtectedPush) {
    writeFail(`Direct push from protected branch '${branch}' is blocked by GitFlow policy.`);
    showGitFlowHelp(branch, 'protected', 'N/A');
    return { exitCode: 1 };
  }

  let kind = 'unknown';
  if (/^feature\//.test(branch)) kind = 'feature';
  else if (/^bugfix\//.test(branch)) kind = 'bugfix';
  else if (/^chore\//.test(branch)) kind = 'chore';
  else if (/^hotfix\//.test(branch)) kind = 'hotfix';
  else if (/^release\//.test(branch)) kind = 'release';
  else if (branch === 'main' || branch === 'develop') kind = 'protected';

  if (kind === 'unknown') {
    writeFail(`Branch '${branch}' does not match allowed GitFlow naming.`);
    console.log('');
    console.log('INVALID BRANCH NAME');
    console.log('Your branch must start with one of these prefixes:');
    console.log('  feature/  - for new functionality');
    console.log('  bugfix/   - for bug fixes');
    console.log('  chore/    - for maintenance');
    console.log('  hotfix/   - for critical fixes');
    console.log('  release/  - for release preparation');

    if (args.interactive) {
      console.log('');
      console.log('Do you want to create a valid branch now? (Y/n)');
      // In a CLI tool, we can't easily prompt, but we can note it
      writeInfo(
        'Interactive branch creation not available in headless mode. Use --interactive with a TTY.',
        args.quiet,
      );
    }

    showGitFlowHelp(branch, 'unknown', 'N/A');
    return { exitCode: 1 };
  }

  const expectedBase = ['feature', 'bugfix', 'chore'].includes(kind)
    ? 'develop'
    : ['hotfix', 'release'].includes(kind)
      ? 'main'
      : branch;

  writeOk(
    `Branch '${branch}' classified as '${kind}' (expected PR base: ${expectedBase}).`,
    args.quiet,
  );

  if (args.enforcePrBase) {
    if (!args.prBase) {
      writeFail('PR base validation requested but PrBase was not provided.');
      return { exitCode: 1 };
    }

    if (args.prBase !== expectedBase) {
      writeFail(
        `PR base '${args.prBase}' violates GitFlow for branch '${branch}'. Expected base: '${expectedBase}'.`,
      );
      showGitFlowHelp(branch, kind, expectedBase);
      return { exitCode: 1 };
    }

    writeOk(`PR base '${args.prBase}' matches GitFlow expectation.`, args.quiet);
  }

  if (allowProtectedPush && (branch === 'main' || branch === 'develop')) {
    writeWarn('Protected branch override active via GITFLOW_ALLOW_PROTECTED_PUSH=1.', args.quiet);
  }

  writeOk('GitFlow validation passed', args.quiet);
  return { exitCode: 0 };
}

const result = main();
process.exit(result.exitCode);
