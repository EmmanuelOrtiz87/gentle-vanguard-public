#!/usr/bin/env node

import { runSync } from '../core/run-command.js';
import { existsSync } from 'fs';
import { join, resolve } from 'path';

interface CodegraphSyncArgs {
  workspaceRoot: string;
  trigger: string;
  minChangesThreshold: number;
  force: boolean;
  asJson: boolean;
}

function parseArgs(): CodegraphSyncArgs {
  const raw = process.argv.slice(2);
  return {
    workspaceRoot: extractArg(raw, '--workspace-root') || resolve('.'),
    trigger: extractArg(raw, '--trigger') || 'manual',
    minChangesThreshold: parseInt(extractArg(raw, '--min-changes-threshold') || '3', 10),
    force: raw.includes('--force') || raw.includes('-f'),
    asJson: raw.includes('--as-json'),
  };
}

function extractArg(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

function findRepoRoot(dir: string): string {
  const envDir = process.env.GENTLE_VANGUARD_BASE_DIR;
  if (envDir && existsSync(envDir)) return envDir;
  let current = resolve(dir);
  while (current) {
    if (existsSync(join(current, 'config', 'orchestrator.json'))) return current;
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return dir;
}

function writeResult(
  status: string,
  message: string,
  asJson: boolean,
  extraData: Record<string, unknown> = {},
): void {
  if (asJson) {
    const result: Record<string, unknown> = {
      status,
      message,
      trigger: '',
      timestamp: new Date().toISOString().slice(0, 19),
      ...extraData,
    };
    console.log(JSON.stringify(result));
  } else {
    console.log(`[${status}] ${message}`);
  }
}

function main(): void {
  const args = parseArgs();
  const repoRoot = findRepoRoot(args.workspaceRoot);
  const dbPath = join(repoRoot, '.codegraph', 'codegraph.db');

  if (!existsSync(dbPath)) {
    writeResult('WARN', 'CodeGraph database not found. Skipping sync.', args.asJson);
    process.exit(0);
  }

  let changedFiles = 0;
  if (args.trigger === 'post-commit' || args.trigger === 'git') {
    try {
      const gitStatus = runSync('git', ['-C', repoRoot, 'status', '--porcelain'], {
        cwd: repoRoot,
        stdio: 'pipe',
      }).stdout.trim();
      const lines = gitStatus.split('\n').filter(Boolean);
      changedFiles = lines.filter((l) => /^\s*[MADRC]/.test(l)).length;
    } catch {
      changedFiles = 0;
    }
  }

  if (
    args.force ||
    changedFiles >= args.minChangesThreshold ||
    args.trigger === 'manual' ||
    args.trigger === 'branch-switch'
  ) {
    console.log(
      `[INFO] Syncing CodeGraph index (trigger: ${args.trigger}, changed: ${changedFiles} files)...`,
    );
    try {
      const sync = runSync('codegraph', ['sync'], { stdio: 'pipe' });
      if (sync.error && sync.status === null) throw sync.error;
      writeResult(
        'OK',
        `CodeGraph index synced (trigger: ${args.trigger}, ${changedFiles} changed files)`,
        args.asJson,
        { changedFiles, trigger: args.trigger },
      );
    } catch (e) {
      const exitCode = (e as { status?: number }).status;
      if (exitCode !== undefined) {
        writeResult('WARN', `CodeGraph sync exited with code ${exitCode}`, args.asJson, {
          changedFiles,
          trigger: args.trigger,
        });
      } else {
        writeResult('WARN', `CodeGraph sync failed: ${(e as Error).message}`, args.asJson, {
          changedFiles,
          trigger: args.trigger,
        });
      }
    }
  } else {
    writeResult(
      'OK',
      `CodeGraph sync skipped (only ${changedFiles} changed files, threshold: ${args.minChangesThreshold})`,
      args.asJson,
      { changedFiles, trigger: args.trigger },
    );
  }

  process.exit(0);
}

main();
