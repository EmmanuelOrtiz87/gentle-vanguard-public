#!/usr/bin/env node
/**
 * Unit Tests: Load Test — Multi-Repo Scenario
 *
 * Verifies the load-testing harness: operation execution, report aggregation
 * (success rate, p95, throughput), CLI arg parsing, exit-code decision, and
 * temp-repo cleanup.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildReport,
  decideExitCode,
  parseArgs,
  renderHuman,
  runLoadTest,
  runOperation,
  type LoadTestConfig,
  type LoadTestReport,
  type OpResult,
  type RepoResult,
} from '../../src/load-test-multi-repo.ts';

const TEST_TMP = join(tmpdir(), `gv-loadtest-test-${process.pid}`);

before(() => {
  mkdirSync(TEST_TMP, { recursive: true });
});

after(() => {
  rmSync(TEST_TMP, { recursive: true, force: true });
});

function makeOp(name: string, duration_ms: number, success: boolean): OpResult {
  return { name, duration_ms, exit_code: success ? 0 : 1, success, stdout_bytes: 100 };
}

function makeRepoResult(ops: OpResult[], repoDir = '/tmp/repo'): RepoResult {
  return {
    repoDir,
    total_ms: ops.reduce((a, o) => a + o.duration_ms, 0),
    ops_ok: ops.filter((o) => o.success).length,
    ops_total: ops.length,
    operations: ops,
  };
}

function makeReport(repos: RepoResult[], total_ms: number): LoadTestReport {
  return buildReport({
    config: { repos: repos.length, ops: ['a'], concurrency: 1, skipGit: true },
    repos_created: repos.length,
    total_ms,
    memory_delta_mb: 0.5,
    repos,
  });
}

describe('Load Test — Multi-Repo Scenario', () => {
  it('runOperation health-check returns a successful OpResult', async () => {
    const result = await runOperation('health-check', TEST_TMP);
    assert.strictEqual(result.name, 'health-check');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.exit_code, 0);
    assert.ok(result.duration_ms >= 0);
    assert.ok(result.stdout_bytes >= 0);
  });

  it('runOperation with unknown operation returns success=false and non-zero exit', async () => {
    const result = await runOperation('does-not-exist', TEST_TMP);
    assert.strictEqual(result.success, false);
    assert.notStrictEqual(result.exit_code, 0);
  });

  it('buildReport computes success_rate correctly', () => {
    const repos = [
      makeRepoResult([makeOp('a', 10, true), makeOp('b', 20, true)]),
      makeRepoResult([makeOp('c', 30, true), makeOp('d', 40, false)]),
    ];
    const report = makeReport(repos, 1000);
    assert.strictEqual(report.success_rate, 0.75);
    assert.strictEqual(report.pass, false);
  });

  it('p95_latency_ms is correct for a known dataset', () => {
    const repos = [
      makeRepoResult([makeOp('a', 100, true), makeOp('b', 200, true)]),
      makeRepoResult([makeOp('c', 300, true), makeOp('d', 400, true)]),
    ];
    const report = makeReport(repos, 2000);
    assert.strictEqual(report.p95_latency_ms, 400);
    assert.strictEqual(report.avg_latency_ms, 250);
  });

  it('throughput_ops_per_sec is positive for a known dataset', () => {
    const repos = [
      makeRepoResult([makeOp('a', 100, true), makeOp('b', 100, true)]),
      makeRepoResult([makeOp('c', 100, true), makeOp('d', 100, true)]),
    ];
    const report = makeReport(repos, 2000);
    assert.ok(report.throughput_ops_per_sec > 0);
    assert.strictEqual(report.throughput_ops_per_sec, 2);
  });

  it('runLoadTest with --skip-git completes and reports repos_created=2', async () => {
    const config: LoadTestConfig = {
      repos: 2,
      ops: ['recommend'],
      concurrency: 2,
      skipGit: true,
      tmpBase: TEST_TMP,
    };
    const report = await runLoadTest(config);
    assert.strictEqual(report.repos_created, 2);
    assert.strictEqual(report.repos.length, 2);
    assert.ok(report.total_ms >= 0);
  });

  it('renderHuman produces output with LOAD-TEST and PASS/FAIL', () => {
    const report = makeReport([makeRepoResult([makeOp('recommend', 50, true)])], 100);
    const output = renderHuman(report);
    assert.ok(output.includes('LOAD-TEST'));
    assert.ok(output.includes('PASS'));
  });

  it('decideExitCode returns 0 for high success rate and 1 for low', () => {
    const high = makeReport([makeRepoResult([makeOp('a', 10, true)])], 100);
    const low = makeReport([makeRepoResult([makeOp('a', 10, true), makeOp('b', 10, false)])], 100);
    assert.strictEqual(decideExitCode(high), 0);
    assert.strictEqual(decideExitCode(low), 1);
  });

  it('parseArgs handles default and custom flags', () => {
    const defaults = parseArgs([]);
    assert.strictEqual(defaults.config.repos, 5);
    assert.strictEqual(defaults.config.concurrency, 2);
    assert.strictEqual(defaults.config.skipGit, false);
    assert.deepStrictEqual(defaults.config.ops, ['health-check', 'watchtower', 'recommend']);
    assert.strictEqual(defaults.json, false);
    assert.strictEqual(defaults.reportPath, null);

    const custom = parseArgs([
      '--repos',
      '3',
      '--ops',
      '2',
      '--concurrency',
      '4',
      '--json',
      '--report',
      '.runtime/load-test-report.json',
      '--skip-git',
    ]);
    assert.strictEqual(custom.config.repos, 3);
    assert.deepStrictEqual(custom.config.ops, ['health-check', 'watchtower']);
    assert.strictEqual(custom.config.concurrency, 4);
    assert.strictEqual(custom.config.skipGit, true);
    assert.strictEqual(custom.json, true);
    assert.strictEqual(custom.reportPath, '.runtime/load-test-report.json');

    const singleOp = parseArgs(['--ops', 'recommend']);
    assert.deepStrictEqual(singleOp.config.ops, ['recommend']);

    const opList = parseArgs(['--ops', 'health-check,sdd-gate']);
    assert.deepStrictEqual(opList.config.ops, ['health-check', 'sdd-gate']);
  });

  it('cleans up gv-loadtest-* dirs after runLoadTest', async () => {
    const config: LoadTestConfig = {
      repos: 2,
      ops: ['recommend'],
      concurrency: 2,
      skipGit: true,
      tmpBase: TEST_TMP,
    };
    await runLoadTest(config);
    const leftovers = readdirSync(TEST_TMP).filter((f) => f.startsWith('gv-loadtest-'));
    assert.deepStrictEqual(leftovers, []);
  });
});
