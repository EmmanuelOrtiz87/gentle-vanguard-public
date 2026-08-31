import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runNpxTsxSync } from '../../src/core/run-command.ts';
import {
  buildReport,
  evaluate,
  loadBaseline,
  parseDurations,
} from '../../src/monitor/perf-baseline-check.ts';

const ROOT = resolve(import.meta.dirname, '..', '..');
const PERF_SCRIPT = join(ROOT, 'src', 'monitor', 'perf-baseline-check.ts');

const ENTRY = { baseline_seconds: 1, warn_seconds: 2, max_seconds: 3 };

describe('perf-baseline-check', () => {
  it('evaluates measured duration against warn/max thresholds', () => {
    assert.equal(evaluate('x', ENTRY, 1.5).status, 'ok');
    assert.equal(evaluate('x', ENTRY, 2.5).status, 'warn');
    assert.equal(evaluate('x', ENTRY, 3.5).status, 'fail');
    assert.equal(evaluate('x', ENTRY, null).status, 'skipped');
  });

  it('degrades max breach to warn when block_on_max is false', () => {
    assert.equal(evaluate('x', ENTRY, 3.5, false).status, 'warn');
    assert.equal(evaluate('x', ENTRY, 3.5, true).status, 'fail');
  });

  it('builds a report honoring warn_on_warn policy', () => {
    const baseline = {
      baselines: { a: ENTRY },
      alert_policy: { block_on_max: false, warn_on_warn: true },
    };
    const report = buildReport(baseline, 'baseline.json', new Map([['a', 2.5]]), false);
    assert.equal(report.ok, false);
    assert.equal(report.results[0].status, 'warn');
  });

  it('builds a passing report when everything is under warn', () => {
    const baseline = {
      baselines: { a: ENTRY },
      alert_policy: { block_on_max: false, warn_on_warn: true },
    };
    const report = buildReport(baseline, 'baseline.json', new Map([['a', 1.5]]), false);
    assert.equal(report.ok, true);
    assert.equal(report.results[0].status, 'ok');
  });

  it('parses --duration args', () => {
    const durations = parseDurations([
      '--duration=audit-check=1.5',
      '--duration=npm-audit=3',
      '--report',
    ]);
    assert.equal(durations.get('audit-check'), 1.5);
    assert.equal(durations.get('npm-audit'), 3);
    assert.equal(durations.size, 2);
  });

  it('loads baseline file or returns null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gv-perf-'));
    try {
      const path = join(dir, 'baseline.json');
      writeFileSync(path, JSON.stringify({ baselines: {} }), 'utf8');
      assert.ok(loadBaseline(path));
      assert.equal(loadBaseline(join(dir, 'missing.json')), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('CLI exits 1 when a warn threshold is breached and warn_on_warn is true', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gv-perf-cli-'));
    try {
      const baselinePath = join(dir, 'baseline.json');
      writeFileSync(
        baselinePath,
        JSON.stringify({
          baselines: { 'audit-check': ENTRY },
          alert_policy: { block_on_max: false, warn_on_warn: true },
        }),
        'utf8',
      );
      const result = runNpxTsxSync(
        PERF_SCRIPT,
        [`--baseline=${baselinePath}`, '--duration=audit-check=2.5'],
        { cwd: dir },
      );
      assert.equal(result.status, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('CLI exits 0 when everything is under warn', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gv-perf-cli-'));
    try {
      const baselinePath = join(dir, 'baseline.json');
      writeFileSync(
        baselinePath,
        JSON.stringify({
          baselines: { 'audit-check': ENTRY },
          alert_policy: { block_on_max: false, warn_on_warn: true },
        }),
        'utf8',
      );
      const result = runNpxTsxSync(
        PERF_SCRIPT,
        [`--baseline=${baselinePath}`, '--duration=audit-check=1.5'],
        { cwd: dir },
      );
      assert.equal(result.status, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('CLI exits 0 (skip) when the baseline file is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gv-perf-cli-'));
    try {
      const result = runNpxTsxSync(PERF_SCRIPT, [`--baseline=${join(dir, 'missing.json')}`], {
        cwd: dir,
      });
      assert.equal(result.status, 0);
      assert.match(result.stdout, /SKIP/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('CLI exits 0 (skip) when --skip is passed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gv-perf-cli-'));
    try {
      const result = runNpxTsxSync(PERF_SCRIPT, ['--skip'], { cwd: dir });
      assert.equal(result.status, 0);
      assert.match(result.stdout, /SKIP/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
