import { describe, it } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildAppAuditArgs,
  buildPerfBaselineArgs,
  hashWorkingTreeChanges,
  runOne,
} from '../../src/git/prepush-gate.ts';

const ROOT = resolve(import.meta.dirname, '..', '..');
const GATE = resolve(ROOT, 'src', 'git', 'prepush-gate.ts');

it('fails a gate that exceeds its timeout and preserves the last started check', async () => {
  const check = {
    name: 'timeout-regression',
    command: process.execPath,
    args: ['-e', "console.error('checking audit fixture'); setTimeout(() => {}, 10000)"],
    timeoutMs: 1500,
    description: 'bounded test command',
  };
  let progress = '';
  const result = await runOne(check, check.args, (chunk) => {
    progress += chunk.toString();
  });
  assert.equal(result.status, 'error');
  assert.match(progress, /checking audit fixture/);
  assert.match(result.tail, /checking audit fixture/);
  assert.match(result.tail, /timeout.*1500/i);
});

function listChecks(args: string[]): string[] {
  const result = spawnSync(process.execPath, ['--import', 'tsx', GATE, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 60_000,
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`gate exited ${result.status} (signal=${result.signal}): ${result.stderr}`);
  }
  return result.stdout
    .split('\n')
    .map((line) => line.split('\t')[0]?.trim())
    .filter(Boolean);
}

describe('prepush-gate --skip-apps flag', () => {
  it('distinguishes content edits when the git status paths stay the same', () => {
    const changedOnce = hashWorkingTreeChanges(Buffer.from('tracked diff'), [
      { path: 'docs/guide.md', contents: Buffer.from('version one') },
    ]);
    const changedAgain = hashWorkingTreeChanges(Buffer.from('tracked diff'), [
      { path: 'docs/guide.md', contents: Buffer.from('version two') },
    ]);
    assert.notEqual(changedOnce, changedAgain);
  });

  it('passes both the verified push range and local changes to the app selector', () => {
    const args = ['--import', 'tsx', 'src/ops/stack-audit-apps.ts'];
    assert.deepEqual(
      buildAppAuditArgs(args, { mode: 'apps', apps: ['gv-agenda'], base: 'base-sha' }),
      [...args, '--affected', 'base-sha', '--include-worktree', '--reuse-evidence'],
    );
    assert.deepEqual(buildAppAuditArgs(args, { mode: 'none', apps: [], base: 'base-sha' }), [
      ...args,
      '--affected',
      'base-sha',
      '--include-worktree',
      '--reuse-evidence',
    ]);
  });

  it('allows known shared inputs and stops an unverified range before running suites', () => {
    const args = ['--import', 'tsx', 'src/ops/stack-audit-apps.ts'];
    assert.deepEqual(buildAppAuditArgs(args, { mode: 'full', apps: [], base: 'base-sha' }), [
      ...args,
      '--reuse-evidence',
    ]);
    assert.throws(
      () => buildAppAuditArgs(args, { mode: 'apps', apps: ['gv-agenda'], base: null }),
      /no verificable/,
    );
    assert.throws(
      () => buildAppAuditArgs(args, { mode: 'unknown', base: 'base-sha' }),
      /Alcance de apps no resuelto/,
    );
  });

  it('evaluates measured check durations without rerunning the checks', () => {
    const args = buildPerfBaselineArgs([
      { name: 'npm-audit', status: 'pass', durationMs: 12_345, tail: '' },
      { name: 'orchestrator-auto-fix', status: 'fail', durationMs: 98_765, tail: '' },
      { name: 'typecheck', status: 'pass', durationMs: 1000, tail: '' },
    ]);
    assert.deepEqual(args, [
      'run',
      'perf:baseline:check',
      '--',
      '--duration=npm-audit=12.35',
      '--duration=orchestrator-auto-fix=98.77',
    ]);
  });

  it('default --list includes stack-audit-apps', () => {
    const names = listChecks(['--list']);
    assert.ok(
      names.includes('stack-audit-apps'),
      'stack-audit-apps should be present in default --list',
    );
  });

  it('--list --skip-apps excludes stack-audit-apps', () => {
    const names = listChecks(['--list', '--skip-apps']);
    assert.ok(
      !names.includes('stack-audit-apps'),
      'stack-audit-apps must NOT be present with --skip-apps',
    );
  });

  it('--skip-apps preserves the rest of the check list', () => {
    const baseline = listChecks(['--list']);
    const skipped = listChecks(['--list', '--skip-apps']);
    // Every skipped check should be in baseline except stack-audit-apps
    for (const name of skipped) {
      assert.ok(baseline.includes(name), `${name} should exist in baseline list`);
    }
    // And the count should differ by exactly 1
    assert.strictEqual(baseline.length - skipped.length, 1);
  });

  it('source file references stack-audit-apps check name (regression)', () => {
    const src = readFileSync(GATE, 'utf-8');
    assert.ok(src.includes("name: 'stack-audit-apps'"), 'check must be named stack-audit-apps');
    assert.ok(src.includes('--skip-apps'), 'flag must be parsed in main()');
    assert.ok(src.includes("c.name !== 'stack-audit-apps'"), 'flag must filter the check list');
    assert.ok(src.includes('!skipApps'), 'cache must not be stored when --skip-apps is used');
  });

  it('allows slow but successful checks to finish before timing out', () => {
    const src = readFileSync(GATE, 'utf-8');
    const orchestrator = src.match(/name: 'orchestrator-auto-fix'[\s\S]*?timeoutMs: (\d+)_000/);
    const performance = src.match(/name: 'perf-baseline'[\s\S]*?timeoutMs: (\d+)_000/);
    assert.equal(orchestrator?.[1], '120');
    assert.equal(performance?.[1], '120');
  });
});
