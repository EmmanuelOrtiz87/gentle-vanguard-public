import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { runNpxTsxSync, runSync } from '../../src/core/run-command.ts';

const script = resolve('src/orchestration/karpathy-enforcer.ts');

for (const useGit of [true, false]) {
  test(`Karpathy audits project sources without runtime archives (git=${useGit})`, (t) => {
    const root = mkdtempSync(join(tmpdir(), 'gv-karpathy-scope-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    for (const file of ['src/active.ts', 'packages/shared/new.ts', '.session/external-repos/vendor.ts',
      '.runtime/snapshot.ts', 'output/captured.ts', 'src/node_modules/dependency.ts', 'src/generated/ignored.ts']) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), 'const pattern = "Singleton";');
    }
    if (useGit) {
      assert.equal(runSync('git', ['init', '--quiet'], { cwd: root }).status, 0);
      writeFileSync(join(root, '.gitignore'), '.session/\n.runtime/\noutput/\nnode_modules/\nsrc/generated/\n');
      assert.equal(runSync('git', ['add', 'src/active.ts'], { cwd: root }).status, 0);
    }
    const result = runNpxTsxSync(script, ['--trigger', 'session-start'], {
      cwd: root, env: { ...process.env, GV_BASE_DIR: root }, timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    const baseline = JSON.parse(readFileSync(join(root, '.runtime/quality/karpathy-baseline.json'), 'utf8'));
    assert.ok(baseline.items.some((line: string) => line.includes('active.ts')));
    assert.ok(baseline.items.some((line: string) => line.includes('new.ts')), 'includes new source files');
    assert.ok(!baseline.items.some((line: string) => /vendor.ts|snapshot.ts|captured.ts|dependency.ts/.test(line)));
    if (useGit) assert.ok(!baseline.items.some((line: string) => line.includes('ignored.ts')));
  });
}
