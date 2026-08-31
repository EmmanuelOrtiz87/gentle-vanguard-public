/**
 * delivery/git-adapter.ts — Git operations for the delivery orchestrator.
 *
 * Uses only normal git commands (no force-push, no --no-verify, no bypass).
 * All operations are idempotent and lease-protected. GitHub is reached only
 * through the `gh` CLI with least-privilege tokens; never through raw PATs
 * embedded in URLs.
 */

import { spawnSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..', '..');

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

function runGit(
  args: string[],
  cwd: string = ROOT,
  timeoutMs = 60_000,
  preserveOutput = false,
): GitResult {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
    windowsHide: true,
    timeout: timeoutMs,
  });
  return {
    ok: r.status === 0,
    stdout: preserveOutput ? (r.stdout ?? '') : (r.stdout ?? '').trim(),
    stderr: (r.stderr ?? '').trim(),
    code: r.status ?? -1,
  };
}

export function gitStatus(cwd: string = ROOT): {
  clean: boolean;
  dirty: string[];
  untracked: string[];
} {
  const r = runGit(['status', '--porcelain'], cwd);
  const lines = r.stdout.split('\n').filter(Boolean);
  const dirty: string[] = [];
  const untracked: string[] = [];
  for (const line of lines) {
    const status = line.slice(0, 2).trim();
    const path = line.slice(3);
    if (status === '??') untracked.push(path);
    else dirty.push(path);
  }
  return { clean: lines.length === 0, dirty, untracked };
}

export function currentBranch(cwd: string = ROOT): string {
  const r = runGit(['branch', '--show-current'], cwd);
  return r.stdout;
}

export function currentSha(cwd: string = ROOT): string {
  const r = runGit(['rev-parse', 'HEAD'], cwd);
  return r.stdout;
}

export function remoteSha(ref: string, remote = 'origin', cwd: string = ROOT): string {
  const r = runGit(['rev-parse', `${remote}/${ref}`], cwd);
  return r.stdout;
}

export function fetchRemote(remote = 'origin', cwd: string = ROOT): GitResult {
  return runGit(['fetch', remote, '--prune'], cwd, 120_000);
}

export function createWorktree(
  branch: string,
  baseSha: string,
  cwd: string = ROOT,
): { path: string; ok: boolean; error?: string } {
  const worktreePath = join(ROOT, '.session', 'delivery-worktrees', branch);
  if (existsSync(worktreePath)) {
    // Already exists — verify it's on the right base
    const r = runGit(['rev-parse', 'HEAD'], worktreePath);
    if (r.stdout === baseSha) {
      return { path: worktreePath, ok: true };
    }
    // Stale worktree — remove and recreate
    runGit(['worktree', 'remove', worktreePath, '--force'], cwd);
  }
  // Branch names commonly contain `/`; mirror that shape in the worktree
  // path and create every intermediate directory before `git worktree add`.
  mkdirSync(dirname(worktreePath), { recursive: true });
  const r = runGit(['worktree', 'add', worktreePath, '-b', branch, baseSha], cwd, 120_000);
  if (!r.ok) {
    return { path: worktreePath, ok: false, error: r.stderr };
  }
  return { path: worktreePath, ok: true };
}

export function removeWorktree(branch: string, cwd: string = ROOT): GitResult {
  const worktreePath = join(ROOT, '.session', 'delivery-worktrees', branch);
  if (!existsSync(worktreePath)) return { ok: true, stdout: '', stderr: '', code: 0 };
  const r = runGit(['worktree', 'remove', worktreePath, '--force'], cwd);
  return r;
}

export function stagePaths(paths: string[], cwd: string = ROOT): GitResult {
  if (paths.length === 0) return { ok: true, stdout: '', stderr: '', code: 0 };
  return runGit(['add', '--', ...paths], cwd);
}

/** Materialize the allowlisted source changes into a worktree based on target. */
export function syncPathsFromSource(
  sourceSha: string,
  targetSha: string,
  paths: string[],
  cwd: string,
  sourceCwd: string = ROOT,
): GitResult {
  if (paths.length === 0) return { ok: true, stdout: '', stderr: '', code: 0 };
  const patch = runGit(
    ['diff', '--binary', targetSha, sourceSha, '--', ...paths],
    sourceCwd,
    60_000,
    true,
  );
  if (!patch.ok) return patch;
  if (!patch.stdout) return { ok: true, stdout: '', stderr: '', code: 0 };
  const applied = spawnSync('git', ['apply', '--index', '--whitespace=nowarn', '-'], {
    cwd,
    input: patch.stdout,
    encoding: 'utf-8',
    windowsHide: true,
    timeout: 120_000,
  });
  return {
    ok: applied.status === 0,
    stdout: (applied.stdout ?? '').trim(),
    stderr: (applied.stderr ?? '').trim(),
    code: applied.status ?? -1,
  };
}

export function commit(message: string, cwd: string = ROOT): GitResult {
  return runGit(['commit', '-m', message], cwd, 120_000);
}

export function pushBranch(branch: string, remote = 'origin', cwd: string = ROOT): GitResult {
  return runGit(['push', remote, branch], cwd, 120_000);
}

export function createBranch(branch: string, baseSha: string, cwd: string = ROOT): GitResult {
  return runGit(['checkout', '-b', branch, baseSha], cwd);
}

export function diffNameOnly(base: string, head: string, cwd: string = ROOT): string[] {
  const r = runGit(['diff', '--name-only', base, head], cwd);
  return r.stdout.split('\n').filter(Boolean);
}

export function diffStat(base: string, head: string, cwd: string = ROOT): string {
  const r = runGit(['diff', '--stat', base, head], cwd);
  return r.stdout;
}

export function verifyCleanForRelease(cwd: string = ROOT): { ok: boolean; message: string } {
  const status = gitStatus(cwd);
  if (!status.clean) {
    return {
      ok: false,
      message: `Worktree is not clean. Dirty: ${status.dirty.join(', ')}. Untracked: ${status.untracked.join(', ')}`,
    };
  }
  return { ok: true, message: 'Worktree clean' };
}

// ─── GitHub adapter (via gh CLI) ─────────────────────────────────────────────

export interface GhResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

function runGh(args: string[], timeoutMs = 60_000): GhResult {
  const r = spawnSync('gh', args, {
    cwd: ROOT,
    encoding: 'utf-8',
    windowsHide: true,
    timeout: timeoutMs,
  });
  return {
    ok: r.status === 0,
    stdout: (r.stdout ?? '').trim(),
    stderr: (r.stderr ?? '').trim(),
    code: r.status ?? -1,
  };
}

export function ghAvailable(): boolean {
  const r = runGh(['--version']);
  return r.ok;
}

export function ghRepo(): string {
  const r = runGh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
  return r.ok ? r.stdout : '';
}

export function createPr(opts: {
  title: string;
  body: string;
  head: string;
  base: string;
  repo?: string;
}): { ok: boolean; prNumber?: number; url?: string; error?: string } {
  const args = [
    'pr',
    'create',
    '--title',
    opts.title,
    '--body',
    opts.body,
    '--head',
    opts.head,
    '--base',
    opts.base,
  ];
  if (opts.repo) args.push('--repo', opts.repo);
  const r = runGh(args, 120_000);
  if (!r.ok) return { ok: false, error: r.stderr };
  // Parse PR number from URL
  const urlMatch = r.stdout.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/);
  const prNumber = urlMatch ? parseInt(urlMatch[1], 10) : undefined;
  return { ok: true, prNumber, url: r.stdout };
}

export function findPrByMarker(
  marker: string,
  repo?: string,
): { ok: boolean; prNumber?: number; error?: string } {
  const args = ['pr', 'list', '--search', marker, '--json', 'number', '--jq', '.[0].number'];
  if (repo) args.push('--repo', repo);
  const r = runGh(args);
  if (!r.ok) return { ok: false, error: r.stderr };
  const num = parseInt(r.stdout, 10);
  return { ok: !isNaN(num), prNumber: isNaN(num) ? undefined : num };
}

export function getPrChecks(prNumber: number, repo?: string): Record<string, string> {
  const args = [
    'pr',
    'checks',
    String(prNumber),
    '--json',
    'name,state',
    '--jq',
    '.[] | "\(.name)=\(.state)"',
  ];
  if (repo) args.push('--repo', repo);
  const r = runGh(args);
  const result: Record<string, string> = {};
  if (!r.ok) return result;
  for (const line of r.stdout.split('\n').filter(Boolean)) {
    const [name, state] = line.split('=');
    if (name) result[name] = state ?? 'unknown';
  }
  return result;
}

export function mergePr(prNumber: number, repo?: string): { ok: boolean; error?: string } {
  const args = ['pr', 'merge', String(prNumber), '--merge'];
  if (repo) args.push('--repo', repo);
  const r = runGh(args, 120_000);
  return r.ok ? { ok: true } : { ok: false, error: r.stderr };
}

export function requestReviewers(
  prNumber: number,
  reviewers: string[],
  repo?: string,
): { ok: boolean; error?: string } {
  const args = ['pr', 'edit', String(prNumber), '--add-reviewer', reviewers.join(',')];
  if (repo) args.push('--repo', repo);
  const r = runGh(args);
  return r.ok ? { ok: true } : { ok: false, error: r.stderr };
}

export function getPrApprovals(prNumber: number, repo?: string): string[] {
  const args = ['pr', 'view', String(prNumber), '--json', 'reviews', '--jq', '.reviews[].state'];
  if (repo) args.push('--repo', repo);
  const r = runGh(args);
  if (!r.ok) return [];
  return r.stdout.split('\n').filter((s) => s === 'APPROVED');
}

export function getPrHeadSha(prNumber: number, repo?: string): string {
  const args = ['pr', 'view', String(prNumber), '--json', 'headRefOid', '--jq', '.headRefOid'];
  if (repo) args.push('--repo', repo);
  const r = runGh(args);
  return r.ok ? r.stdout : '';
}

export function getPrMergeable(prNumber: number, repo?: string): string {
  const args = ['pr', 'view', String(prNumber), '--json', 'mergeable', '--jq', '.mergeable'];
  if (repo) args.push('--repo', repo);
  const r = runGh(args);
  return r.ok ? r.stdout : 'UNKNOWN';
}

export function getPrState(prNumber: number, repo?: string): string {
  const args = ['pr', 'view', String(prNumber), '--json', 'state', '--jq', '.state'];
  if (repo) args.push('--repo', repo);
  const r = runGh(args);
  return r.ok ? r.stdout : 'UNKNOWN';
}
