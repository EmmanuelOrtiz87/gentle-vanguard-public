import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { runSync } from '../../src/core/run-command.js';

test('importing the apps audit does not run its CLI or exit the consumer', () => {
  const moduleUrl = pathToFileURL(resolve('src/ops/stack-audit-apps.ts')).href;
  const code = `process.argv=['node','consumer.ts','--check','none']; await import(${JSON.stringify(moduleUrl)}); console.log('import-only');`;
  const result = runSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'import-only');
});

test('failure summary retains an early failure despite later passing apps', async () => {
  const { buildAppAudit, failureSummary } = await import('../../src/ops/stack-audit-apps.js');
  const plan = [{ kind: 'test' as const, script: 'test' }];
  const failed = buildAppAudit('early-app', true, plan, [{ kind: 'test', status: 'FAIL', durationMs: 1, message: 'root failure' }]);
  const passed = buildAppAudit('last-app', true, plan, [{ kind: 'test', status: 'PASS', durationMs: 1, message: 'ok' }]);
  assert.deepEqual(failureSummary([failed, passed]), ['FAIL early-app test: root failure']);
  assert.deepEqual(failureSummary([passed]), []);
});
