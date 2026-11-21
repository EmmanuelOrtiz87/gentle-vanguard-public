import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert';
import { resolve } from 'node:path';
import { checkPlatform, type CheckResult } from '../../src/ops/stack-verify.ts';
import { getDeps } from '../../src/infrastructure/dependency-validator.ts';

const gitHooksDirectory = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], {
  encoding: 'utf8',
}).trim();
const preCommitPath = resolve(process.cwd(), gitHooksDirectory, 'pre-commit');

test(
  'stack verification finds installed hooks through Git metadata in a worktree',
  { skip: !existsSync(preCommitPath) },
  () => {
    const results: CheckResult[] = [];

    checkPlatform(results);

    const hookCheck = results.find((result) => result.name === 'Lefthook Hooks');
    assert.equal(hookCheck?.status, 'PASS', hookCheck?.message ?? 'Lefthook check was not reported');
  },
);

test("dependency validation uses Git's resolved hook directory for worktrees", () => {
  const hookDependency = getDeps().find((dependency) => dependency.name === 'Lefthook Hooks');

  assert.ok(hookDependency?.checkPath);
  assert.equal(resolve(process.cwd(), hookDependency.checkPath), preCommitPath);
});
