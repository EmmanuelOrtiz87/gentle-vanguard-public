/** Shared, content-bound contract for receipt producers and delivery gates. */
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  lstatSync,
  openSync,
  closeSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { runSync } from '../core/run-command.js';

export type CandidateScope = 'index' | 'commit' | 'worktree';
export interface ReviewCandidate {
  schema: 'gentle-vanguard.review-candidate/v1';
  scope: CandidateScope;
  head: string;
  tree: string;
  digest: string;
  files: string[];
}
export interface ReviewEvidence {
  candidateDigest: string;
  reviewer: string;
  verdict: 'pass' | 'fail';
  checks: Array<{ command: string; exitCode: number }>;
  findings?: Array<{ severity: string; message: string }>;
}
export interface BoundReceipt {
  id: string;
  candidateHash: string;
  contentHash: string;
  timestamp: string;
  approved: boolean;
  candidate: ReviewCandidate;
  evidence?: ReviewEvidence;
  findings: Array<{ severity: string; message?: string }>;
}

export function checkedGit(root: string, args: string[]): string {
  const result = runSync('git', args, { cwd: root, timeout: 15000 });
  if (result.status !== 0)
    throw new Error(`Git ${args[0]} failed: ${result.stderr.trim() || result.status}`);
  return result.stdout;
}
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

export function captureCandidate(root: string, scope: CandidateScope): ReviewCandidate {
  const head = checkedGit(root, ['rev-parse', '--verify', 'HEAD^{commit}']).trim();
  const tree = checkedGit(
    root,
    scope === 'index' ? ['write-tree'] : ['rev-parse', 'HEAD^{tree}'],
  ).trim();
  let files: string[] = [];
  let worktree: unknown = undefined;
  if (scope !== 'commit') {
    files = checkedGit(root, [
      'diff',
      ...(scope === 'index' ? ['--cached'] : []),
      '--name-only',
      '-z',
      'HEAD',
    ])
      .split('\0')
      .filter(Boolean);
  }
  if (scope === 'worktree') {
    const untracked = checkedGit(root, ['ls-files', '--others', '--exclude-standard', '-z'])
      .split('\0')
      .filter(Boolean)
      .sort();
    worktree = {
      diff: checkedGit(root, ['diff', '--binary', 'HEAD']),
      index: checkedGit(root, ['write-tree']).trim(),
      untracked: untracked.map((file) => {
        const path = join(root, file);
        if (!lstatSync(path).isFile()) throw new Error(`Unsupported candidate entry: ${file}`);
        return [file, hash(readFileSync(path))];
      }),
    };
    files = [...new Set([...files, ...untracked])];
  }
  return {
    schema: 'gentle-vanguard.review-candidate/v1',
    scope,
    head,
    tree,
    digest: hash(JSON.stringify({ scope, head, tree, worktree })),
    files: files.sort(),
  };
}

export function evidenceErrors(evidence: ReviewEvidence | undefined, digest: string): string[] {
  if (!evidence || typeof evidence !== 'object') return ['Review evidence is required'];
  const errors: string[] = [];
  if (evidence.candidateDigest !== digest)
    errors.push('Review evidence belongs to a different candidate');
  if (
    evidence.verdict !== 'pass' ||
    typeof evidence.reviewer !== 'string' ||
    !evidence.reviewer.trim()
  )
    errors.push('Passing review and named reviewer are required');
  if (
    !Array.isArray(evidence.checks) ||
    !evidence.checks.length ||
    evidence.checks.some(
      (check) => typeof check.command !== 'string' || !check.command.trim() || check.exitCode !== 0,
    )
  )
    errors.push('Successful executed checks are required');
  if (
    evidence.findings &&
    (!Array.isArray(evidence.findings) ||
      evidence.findings.some((f) => !f || ['critical', 'required', 'high'].includes(f.severity)))
  )
    errors.push('Unresolved review findings');
  return errors;
}

/** Canonical index, with legacy per-file read compatibility; never guess by mtime. */
export function readReceipt(root: string, id?: string): BoundReceipt | null {
  if (id && !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid receipt ID');
  const dir = join(root, '.session', 'receipts');
  const indexFile = join(dir, 'index.json');
  const index = existsSync(indexFile)
    ? JSON.parse(readFileSync(indexFile, 'utf8'))
    : { receipts: [] };
  if (!Array.isArray(index.receipts)) throw new Error('Malformed receipt index');
  const found = id
    ? index.receipts.find((item: BoundReceipt) => item.id === id)
    : index.receipts.at(-1);
  const legacy =
    id && existsSync(join(dir, `${id}.json`))
      ? JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8'))
      : undefined;
  if (found && legacy && JSON.stringify(found) !== JSON.stringify(legacy))
    throw new Error('Conflicting receipt representations');
  return found ?? legacy ?? null;
}

export function appendReceipt(root: string, receipt: BoundReceipt): void {
  const dir = join(root, '.session', 'receipts');
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, 'index.lock');
  const handle = openSync(lock, 'wx'); // Concurrent writers fail visibly; never steal stale authority.
  try {
    const file = join(dir, 'index.json');
    const index = existsSync(file)
      ? JSON.parse(readFileSync(file, 'utf8'))
      : { receipts: [], nextId: 1 };
    if (
      !Array.isArray(index.receipts) ||
      index.receipts.some((r: BoundReceipt) => r.id === receipt.id)
    )
      throw new Error('Invalid or duplicate receipt index entry');
    index.receipts.push(receipt);
    const temp = join(dir, `index-${randomUUID()}.tmp`);
    writeFileSync(temp, JSON.stringify(index, null, 2), { flag: 'wx' });
    renameSync(temp, file);
  } finally {
    closeSync(handle);
    unlinkSync(lock);
  }
}

export function receiptErrors(root: string, receipt: BoundReceipt, gate: string): string[] {
  const errors: string[] = [];
  const candidate = receipt.candidate;
  if (
    !candidate ||
    candidate.schema !== 'gentle-vanguard.review-candidate/v1' ||
    !['index', 'commit', 'worktree'].includes(candidate.scope) ||
    !/^[a-f0-9]{64}$/.test(candidate.digest) ||
    !/^[a-f0-9]{40,64}$/.test(candidate.head) ||
    !/^[a-f0-9]{40,64}$/.test(candidate.tree)
  ) {
    return ['Legacy or malformed receipt: capture a new candidate and review evidence'];
  }
  if (
    candidate.scope !== 'worktree' &&
    candidate.digest !==
      hash(JSON.stringify({ scope: candidate.scope, head: candidate.head, tree: candidate.tree }))
  ) {
    errors.push('Candidate metadata does not match the frozen digest');
  }
  if (receipt.approved !== true) errors.push('Receipt not approved');
  errors.push(...evidenceErrors(receipt.evidence, candidate.digest));
  if (receipt.candidateHash !== candidate.head || receipt.contentHash !== candidate.digest)
    errors.push('Receipt candidate metadata is inconsistent');
  if (
    !Array.isArray(receipt.findings) ||
    receipt.findings.some((f) => !f || ['critical', 'required', 'high'].includes(f.severity))
  )
    errors.push('Unresolved receipt findings');
  try {
    checkedGit(root, ['cat-file', '-e', `${candidate.head}^{commit}`]);
    if (gate === 'post-apply' || gate === 'pre-commit') {
      if (gate === 'pre-commit' && candidate.scope === 'worktree')
        errors.push('Pre-commit requires an index or commit candidate');
      const current = captureCandidate(root, candidate.scope);
      if (current.digest !== candidate.digest)
        errors.push('Candidate content drifted after review');
    } else {
      if (candidate.scope === 'worktree')
        errors.push('Delivery requires a reviewed index or commit candidate');
      const current = captureCandidate(root, 'commit');
      if (current.tree !== candidate.tree)
        errors.push('Delivered tree differs from reviewed candidate');
      checkedGit(root, ['merge-base', '--is-ancestor', candidate.head, 'HEAD']);
      if (candidate.scope === 'commit' && current.head !== candidate.head)
        errors.push('Delivered commit differs from reviewed commit');
      if (
        candidate.scope === 'index' &&
        current.head !== candidate.head &&
        checkedGit(root, ['rev-parse', 'HEAD^']).trim() !== candidate.head
      )
        errors.push('Index review does not cover subsequent commits');
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return errors;
}
