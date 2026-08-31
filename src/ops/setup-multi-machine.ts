#!/usr/bin/env node

import { runSync, runNpxTsxSync } from '../core/run-command.js';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

interface SetupMultiMachineArgs {
  owner: string;
  gentleVanguardRepo: string;
  publicRepo: string;
  basePath: string;
  installRunner: boolean;
  runnerConfigPath: string;
}

function parseArgs(): SetupMultiMachineArgs {
  const args = process.argv.slice(2);
  return {
    owner: extractArg(args, '--owner') || 'EmmanuelOrtiz87',
    gentleVanguardRepo: extractArg(args, '--gentle-vanguard-repo') || 'gentle-vanguard',
    publicRepo: extractArg(args, '--public-repo') || 'gentle-vanguard-public',
    basePath: extractArg(args, '--base-path') || '',
    installRunner: args.includes('--install-runner'),
    runnerConfigPath:
      extractArg(args, '--runner-config-path') || 'config/github-runner.example.json',
  };
}

function extractArg(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

function ensureGitRepo(repoSlug: string, targetPath: string): void {
  const repoUrl = `https://github.com/${repoSlug}.git`;
  if (!existsSync(targetPath)) {
    console.log(`Cloning ${repoSlug} -> ${targetPath}`);
    runSync('git', ['clone', repoUrl, targetPath], { stdio: 'inherit' });
    return;
  }

  if (!existsSync(join(targetPath, '.git'))) {
    throw new Error(`Path exists but is not a git repository: ${targetPath}`);
  }

  console.log(`Updating ${repoSlug} at ${targetPath}`);
  try {
    runSync('git', ['fetch', 'origin', '--prune'], { cwd: targetPath, stdio: 'inherit' });
    let defaultBranch = 'main';
    try {
      const remoteHead = runSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
        cwd: targetPath,
        stdio: 'pipe',
      }).stdout.trim();
      defaultBranch = remoteHead.replace('^refs/remotes/origin/', '');
    } catch {
      // fallback to main
    }
    runSync('git', ['checkout', defaultBranch], { cwd: targetPath, stdio: 'inherit' });
    runSync('git', ['pull', '--rebase', 'origin', defaultBranch], {
      cwd: targetPath,
      stdio: 'inherit',
    });
  } catch (err) {
    throw new Error(`Failed to update ${repoSlug}: ${err}`);
  }
}

function main(): void {
  const args = parseArgs();
  const basePath =
    args.basePath || join(process.env.HOME || process.env.USERPROFILE || '', 'source');

  if (!existsSync(basePath)) {
    mkdirSync(basePath, { recursive: true });
  }

  const gentleVanguardSlug = `${args.owner}/${args.gentleVanguardRepo}`;
  const publicSlug = `${args.owner}/${args.publicRepo}`;
  const gentleVanguardPath = join(basePath, args.gentleVanguardRepo);
  const publicPath = join(basePath, args.publicRepo);

  console.log('\n=== Prepare repositories ===');
  ensureGitRepo(gentleVanguardSlug, gentleVanguardPath);
  ensureGitRepo(publicSlug, publicPath);
  console.log('[OK] Repositories are ready');

  console.log('\n=== Bootstrap gentle-vanguard workspace ===');
  // TS migration: bootstrap.ps1 → src/infrastructure/bootstrap.ts
  const bootstrapTs = join(gentleVanguardPath, 'src', 'infrastructure', 'bootstrap.ts');
  const bootstrapPs1 = join(gentleVanguardPath, 'src/infrastructure/bootstrap.ts');
  if (!existsSync(bootstrapTs) && !existsSync(bootstrapPs1)) {
    throw new Error(`Bootstrap script not found (TS: ${bootstrapTs}, PS1: ${bootstrapPs1})`);
  }

  const runnerArgs = args.installRunner
    ? ['-InstallGitHubRunner', '-GitHubRunnerConfigPath', args.runnerConfigPath]
    : [];
  if (existsSync(bootstrapTs)) {
    // Array form: paths/args may contain spaces — shell quoting is unreliable.
    runNpxTsxSync(bootstrapTs, runnerArgs, { stdio: 'inherit' });
  } else {
    runSync('powershell', ['-File', bootstrapPs1, ...runnerArgs], { stdio: 'inherit' });
  }

  console.log('[OK] Bootstrap completed');

  console.log('\n=== Done ===');
  console.log(`Gentle-Vanguard repo: ${gentleVanguardPath}`);
  console.log(`Public repo:     ${publicPath}`);
  console.log('Run this same script on any new PC to replicate setup.');
}

main();
