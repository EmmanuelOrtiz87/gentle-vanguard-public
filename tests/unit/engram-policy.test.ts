import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { runNpxTsxSync } from '../../src/core/run-command.ts';
import { assessEngramDoctor, getDoctorArgs } from '../../src/knowledge/engram-policy.ts';
import { getExternalApiTimeouts } from '../../src/core/timeout-config.ts';

const script = resolve('src/knowledge/engram-policy.ts');

test('startup probes SQLite availability; a full history audit requires an explicit mode', () => {
  const startup = getDoctorArgs(false);
  const deep = getDoctorArgs(true);
  assert.equal(startup[startup.indexOf('--check') + 1], 'sqlite_lock_contention');
  assert.ok(!deep.includes('--check'));
  assert.ok(startup.includes('gentle-vanguard') && deep.includes('gentle-vanguard'));
});

test('full doctor has a separate central budget for measured project scans', () => {
  const timeouts = getExternalApiTimeouts();
  assert.equal(timeouts?.engram_doctor_ms, 30000);
  assert.equal(timeouts?.engram_operation_ms, 15000);
});

for (const [label, binary] of [
  ['missing executable', 'gv-missing-engram-0198391'],
  ['failing doctor', process.execPath],
]) {
  test(`critical Engram policy reports ${label} instead of a false success`, () => {
    const result = runNpxTsxSync(script, [], { env: { ...process.env, ENGRAM_BIN: binary }, timeout: 15000 });
    assert.equal(result.status, 1, result.stdout);
    assert.doesNotMatch(result.stdout, /Memory integrity verified|completed successfully/);
  });
}

for (const [label, output, code, expected] of [
  ['healthy', JSON.stringify({ status: 'ok', summary: { warnings: 0, errors: 0, blocked: 0 } }), 0, 'pass'],
  ['reviewable warning', JSON.stringify({ status: 'warning', summary: { warnings: 1, errors: 0, blocked: 0 } }), 0, 'warn'],
  ['blocked report', JSON.stringify({ status: 'warning', summary: { warnings: 1, errors: 0, blocked: 1 } }), 0, 'fail'],
  ['nonzero exit', JSON.stringify({ status: 'ok', summary: { warnings: 0, errors: 0, blocked: 0 } }), 1, 'fail'],
  ['malformed JSON', '{broken', 0, 'fail'],
  ['unstructured success', JSON.stringify({ status: 'ok' }), 0, 'fail'],
] as const) {
  test(`Engram policy classifies ${label}`, () => {
    assert.equal(assessEngramDoctor(output, code), expected);
  });
}
