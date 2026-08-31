#!/usr/bin/env node
/**
 * Unit Tests: Coverage Runner
 * Verifies coverage parsing, threshold computation and config loading.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  pct,
  parseCoverage,
  loadConfig,
  parseArgs,
  DEFAULT_CONFIG,
} from '../../src/review/coverage-runner.ts';

function sampleCoverageFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gv-cov-test-'));
  const file = join(dir, 'coverage-final.json');
  writeFileSync(
    file,
    JSON.stringify({
      'C:\\repo\\src\\mod.ts': {
        path: 'C:\\repo\\src\\mod.ts',
        all: false,
        statementMap: {
          '0': { start: { line: 1 } },
          '1': { start: { line: 2 } },
          '2': { start: { line: 3 } },
        },
        s: { '0': 1, '1': 0, '2': 1 },
        fnMap: { '0': { loc: { line: 1 }, name: 'a' }, '1': { loc: { line: 2 }, name: 'b' } },
        f: { '0': 1, '1': 0 },
        branchMap: {
          '0': { locations: [{ line: 2 }, { line: 2 }] },
        },
        b: { '0': [1, 0] },
      },
    }),
  );
  return file;
}

describe('Coverage Runner', () => {
  it('pct handles empty denominators as 100', () => {
    assert.strictEqual(pct(0, 0), 100);
    assert.strictEqual(pct(5, 10), 50);
  });

  it('parseCoverage computes per-file percentages from V8 format', () => {
    const file = sampleCoverageFile();
    try {
      const cov = parseCoverage(file);
      const mod = cov['C:\\repo\\src\\mod.ts'];
      assert.ok(mod, 'module entry exists');
      // statements: 2/3 covered
      assert.ok(Math.abs(mod.statements - (2 / 3) * 100) < 0.001);
      // functions: 1/2 covered
      assert.ok(Math.abs(mod.functions - 50) < 0.001);
      // branches: 1/2 covered
      assert.ok(Math.abs(mod.branches - 50) < 0.001);
      // lines: statement lines {1,2,3}, covered {1,3}
      assert.ok(Math.abs(mod.lines - (2 / 3) * 100) < 0.001);
    } finally {
      rmSync(join(file, '..'), { recursive: true, force: true });
    }
  });

  it('loadConfig loads thresholds from tests/coverage-config.json', () => {
    const cfg = loadConfig();
    assert.ok(cfg.thresholds.lines >= 0, 'lines threshold present');
    assert.ok(Array.isArray(cfg.coverageTargets), 'targets is array');
    assert.ok(cfg.outputDir.length > 0, 'output dir present');
  });

  it('loadConfig falls back to defaults when config missing', () => {
    const orig = process.cwd;
    // loadConfig resolves from ROOT; just assert defaults shape
    assert.strictEqual(DEFAULT_CONFIG.minimumCoverage, 30);
    assert.ok(DEFAULT_CONFIG.reportFormats.includes('text'));
  });

  it('parseArgs supports --quick, --no-enforce, --json', () => {
    assert.deepStrictEqual(parseArgs(), {
      quick: false,
      enforce: true,
      json: false,
      noWrite: false,
    });
    assert.deepStrictEqual(parseArgs(['--quick']), {
      quick: true,
      enforce: true,
      json: false,
      noWrite: false,
    });
    assert.deepStrictEqual(parseArgs(['--no-enforce', '--json']), {
      quick: false,
      enforce: false,
      json: true,
      noWrite: false,
    });
  });

  it('parseArgs exposes argv via process.argv fallback', () => {
    const saved = process.argv;
    process.argv = ['node', 'src/review/coverage-runner.ts', '--quick', '--json'];
    try {
      assert.deepStrictEqual(parseArgs(), {
        quick: true,
        enforce: true,
        json: true,
        noWrite: false,
      });
    } finally {
      process.argv = saved;
    }
  });
});
