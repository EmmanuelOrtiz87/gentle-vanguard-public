import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runNpxTsxSync, runSync } from '../../src/core/run-command.ts';

const root = resolve('.');
const script = join(root, 'src/tools/odd-benchmark.ts');
const commit = runSync('git', ['rev-parse', 'HEAD'], { cwd: root }).stdout.trim();
const valid = { id: 'measured-case', elapsedSeconds: 12, turns: 3, commit: commit.slice(0, 9) };

for (const [label, overrides] of Object.entries({
  'missing commit': { commit: undefined },
  'pending commit': { commit: 'pending' },
  'unknown commit': { commit: '0000000000000000000000000000000000000000' },
  'negative elapsed time': { elapsedSeconds: -1 },
  'fractional tool calls': { turns: 1.5 },
  'zero tool calls': { turns: 0 },
  'empty id': { id: ' ' },
})) {
  test(`benchmark rejects ${label} before writing the store`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'gv-odd-bench-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const result = runNpxTsxSync(script, ['--add', JSON.stringify({ ...valid, ...overrides })], {
      cwd: dir, env: { ...process.env, GIT_DIR: join(root, '.git'), GIT_WORK_TREE: root },
    });
    assert.notEqual(result.status, 0, result.stdout);
    assert.equal(existsSync(join(dir, '.runtime/odd-bench/cases.json')), false);
  });
}

test('benchmark resolves a real commit and rejects duplicate case IDs', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'gv-odd-bench-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const options = { cwd: dir, env: { ...process.env, GIT_DIR: join(root, '.git'), GIT_WORK_TREE: root } };
  const args = ['--add', JSON.stringify(valid)];
  const added = runNpxTsxSync(script, args, options);
  assert.equal(added.status, 0, added.stderr);
  assert.match(added.stdout, /no demuestra paridad ni superioridad/);
  assert.doesNotMatch(added.stdout, /dentro del rango ODD|comparable v4/);
  const storePath = join(dir, '.runtime/odd-bench/cases.json');
  const before = readFileSync(storePath, 'utf8');
  assert.equal(JSON.parse(before).cases.at(-1).commit, commit);
  const duplicate = runNpxTsxSync(script, args, options);
  assert.notEqual(duplicate.status, 0);
  assert.equal(readFileSync(storePath, 'utf8'), before);
});
