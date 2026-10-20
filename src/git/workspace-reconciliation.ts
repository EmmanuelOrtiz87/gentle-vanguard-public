/** Read-only reconciliation of actual local files against a committed baseline. */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runSync } from '../core/run-command.js';

type State = 'matches-baseline' | 'matches-after-eol-normalization' | 'different' |
  'local-only' | 'missing-locally' | 'unsupported-entry';
interface FileComparison { path: string; state: State }

export function reconcileWorkspace(workspace: string, baseline = 'main'): {
  root: string; baselineCommit: string; files: FileComparison[]; counts: Partial<Record<State, number>>;
} {
  const root = resolve(workspace);
  const git = (...args: string[]): string => {
    const result = runSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
    if (result.status !== 0) throw new Error(`Git ${args[0]} failed: ${result.stderr}`);
    return result.stdout;
  };
  const baselineCommit = git('rev-parse', '--verify', '--end-of-options', `${baseline}^{commit}`).trim();
  const objectFormat = git('rev-parse', '--show-object-format').trim();
  const blobHash = (bytes: Buffer): string => createHash(objectFormat)
    .update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const tree = new Map<string, { mode: string; hash: string }>();
  for (const entry of git('ls-tree', '-rz', baselineCommit).split('\0').filter(Boolean)) {
    const tab = entry.indexOf('\t');
    const [mode, , hash] = entry.slice(0, tab).split(' ');
    tree.set(entry.slice(tab + 1), { mode: mode!, hash: hash! });
  }
  const status = (): string => git('status', '--porcelain=v1', '-z', '--untracked-files=all');
  const before = status();
  const candidates = new Set([
    ...git('diff', '--no-ext-diff', '--no-renames', '--name-only', '-z', baselineCommit, '--').split('\0'),
    ...git('ls-files', '--others', '--exclude-standard', '-z').split('\0'),
  ].filter(Boolean));
  const files: FileComparison[] = [...candidates].sort().map((path) => {
    const expected = tree.get(path);
    const local = join(root, path);
    let state: State;
    if (!existsSync(local)) state = 'missing-locally';
    else if (!lstatSync(local).isFile() || (expected && !['100644', '100755'].includes(expected.mode))) {
      state = 'unsupported-entry';
    } else if (!expected) state = 'local-only';
    else {
      const bytes = readFileSync(local);
      if (blobHash(bytes) === expected.hash) state = 'matches-baseline';
      else if (!bytes.includes(0) && blobHash(Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'))) === expected.hash) {
        state = 'matches-after-eol-normalization';
      } else state = 'different';
    }
    return { path, state };
  });
  if (status() !== before) throw new Error('Workspace changed during reconciliation; rerun on a stable tree');
  const counts: Partial<Record<State, number>> = {};
  for (const { state } of files) counts[state] = (counts[state] ?? 0) + 1;
  return { root, baselineCommit, files, counts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(reconcileWorkspace(process.argv[2] ?? process.cwd(), process.argv[3] ?? 'main'), null, 2));
}
