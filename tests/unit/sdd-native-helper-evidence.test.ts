import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import test from 'node:test';
import { runNpxTsxSync } from '../../src/core/run-command.js';
import { nativeResultFailure } from '../../src/orchestration/native-result.js';

test('apply preview does not claim implementation or run quality gates', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-sdd-helper-'));
  const result = runNpxTsxSync(
    resolve('src/agents/sdd-apply.ts'),
    ['--task', 'implement example', '--dry-run'],
    { cwd: root, timeout: 15000 },
  );
  assert.match(result.stdout, /"implementationPerformed": false/);
  assert.match(result.stdout, /"success": false/);
  assert.doesNotMatch(result.stdout, /Running TypeScript check/);
});
test('skipped verification and a static security checklist do not report a pass', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-sdd-helper-'));
  const result = runNpxTsxSync(
    resolve('src/agents/sdd-verify.ts'),
    ['--task', 'verify example', '--skip-tests'],
    { cwd: root, timeout: 15000 },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /"success": false/);
  assert.match(result.stdout, /"securityChecksExecuted": false/);
  assert.doesNotMatch(result.stdout, /✅ SUCCESS/);
});
test('native requirements and design templates are not qualified as completed phases', () => {
  for (const helper of ['sdd-explore', 'sdd-design']) {
    const root = mkdtempSync(join(tmpdir(), 'gv-sdd-helper-'));
    const result = runNpxTsxSync(resolve(`src/agents/${helper}.ts`), ['--task', 'audit example'], {
      cwd: root,
    });
    assert.equal(result.status, 0); // Template generation itself succeeded.
    assert.match(
      nativeResultFailure(result.stdout)!,
      /phase execution requires the active host agent/,
    );
  }
});
