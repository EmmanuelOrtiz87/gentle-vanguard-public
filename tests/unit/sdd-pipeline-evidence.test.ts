import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { runNpxTsxSync } from '../../src/core/run-command.js';

const script = resolve('src/sdd/sdd-pipeline.ts');
function run(root: string, phase: string) {
  return runNpxTsxSync(
    script,
    ['--feature', 'audit', '--description', 'Evidence audit', '--phase', phase],
    {
      cwd: root,
      env: { ...process.env, GENTLE_VANGUARD_BASE_DIR: root },
      timeout: 15000,
    },
  );
}
test('SDD scaffolding never passes implementation or verification gates', () => {
  for (const phase of ['APPLY', 'VERIFY']) {
    const root = mkdtempSync(join(tmpdir(), 'gv-sdd-evidence-'));
    const result = run(root, phase);
    const gate = JSON.parse(readFileSync(join(root, '.sdd/audit', `gate-${phase}.json`), 'utf8'));
    assert.equal(gate.status, 'DRAFT');
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /Pipeline passed/);
  }
});
test('archive cannot claim completion without passing prior phases', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-sdd-evidence-'));
  const result = run(root, 'ARCHIVE');
  assert.notEqual(result.status, 0);
  assert.equal(
    JSON.parse(readFileSync(join(root, '.sdd/audit/gate-ARCHIVE.json'), 'utf8')).status,
    'BLOCKED',
  );
  assert.doesNotMatch(
    readFileSync(join(root, '.sdd/audit/ARCHIVE/artifact.md'), 'utf8'),
    /\*\*Completed\*\*/,
  );
});
test('re-running a phase preserves existing agent-authored artifacts', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-sdd-evidence-'));
  run(root, 'EXPLORE');
  const artifact = join(root, '.sdd/audit/EXPLORE/artifact.md');
  writeFileSync(artifact, 'Actual owner requirements');
  const result = run(root, 'EXPLORE');
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(artifact, 'utf8'), 'Actual owner requirements');
  assert.equal(existsSync(join(root, '.sdd/audit/gate-ARCHIVE.json')), false);
});
test('dry-run creates no workflow artifacts', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-sdd-evidence-'));
  const result = runNpxTsxSync(
    script,
    ['--feature', 'audit', '--description', 'Preview', '--dry-run'],
    {
      cwd: root,
      env: { ...process.env, GENTLE_VANGUARD_BASE_DIR: root },
    },
  );
  assert.equal(result.status, 0);
  assert.equal(existsSync(join(root, '.sdd')), false);
  assert.equal(existsSync(join(root, '.session')), false);
});
test('feature names cannot escape their workflow directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-sdd-evidence-'));
  const result = runNpxTsxSync(script, ['--feature', '../outside', '--description', 'Invalid'], {
    cwd: root,
    env: { ...process.env, GENTLE_VANGUARD_BASE_DIR: root },
  });
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(join(root, '.sdd')), false);
});
