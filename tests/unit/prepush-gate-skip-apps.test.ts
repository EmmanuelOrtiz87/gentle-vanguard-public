import { describe, it } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const GATE = resolve(ROOT, 'src', 'git', 'prepush-gate.ts');

function listChecks(args: string[]): string[] {
  // shell: true required on Windows so npx.cmd is resolved (raw spawnSync ENOENT otherwise)
  const result = spawnSync('npx', ['tsx', GATE, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 60_000,
    shell: true,
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
    assert.ok(
      src.includes("c.name !== 'stack-audit-apps'"),
      'flag must filter the check list',
    );
    assert.ok(
      src.includes('!skipApps'),
      'cache must not be stored when --skip-apps is used',
    );
  });
});
