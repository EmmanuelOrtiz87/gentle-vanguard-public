#!/usr/bin/env node
/**
 * Unit Tests: Chaos Engineering Engine
 * Verifies dry-run mode, result formatting, persistence round-trip, and
 * experiment definitions (names unique, components valid).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  EXPERIMENTS,
  runExperiment,
  runAll,
  saveResults,
  loadResults,
  formatResults,
  RESULTS_DIR,
  RESULTS_FILE,
} from '../../src/chaos-engineering.ts';

describe('EXPERIMENTS', () => {
  it('has unique experiment names', () => {
    const names = EXPERIMENTS.map((e) => e.name);
    assert.strictEqual(new Set(names).size, names.length);
  });

  it('has non-empty descriptions and components', () => {
    for (const exp of EXPERIMENTS) {
      assert.ok(exp.description.length > 0, `${exp.name} missing description`);
      assert.ok(exp.component.length > 0, `${exp.name} missing component`);
    }
  });

  it('includes the three core experiments', () => {
    const names = EXPERIMENTS.map((e) => e.name);
    assert.ok(names.includes('config-corruption'));
    assert.ok(names.includes('session-manifest-corruption'));
    assert.ok(names.includes('dashboard-ws-kill'));
  });
});

describe('runExperiment', () => {
  it('dry-run never injects and returns dry-run status', () => {
    for (const exp of EXPERIMENTS) {
      const result = runExperiment(exp, true);
      assert.strictEqual(result.status, 'dry-run');
      assert.ok(result.details.some((d) => d.includes('dry-run')));
      assert.strictEqual(result.name, exp.name);
    }
  });

  it('config-corruption passes in real mode (detects + restores)', () => {
    const exp = EXPERIMENTS.find((e) => e.name === 'config-corruption')!;
    const result = runExperiment(exp, false);
    assert.strictEqual(result.status, 'passed');
    assert.ok(result.details.some((d) => d.includes('corruption detected')));
    assert.ok(result.details.some((d) => d.includes('state restored')));
  });

  it('session-manifest-corruption passes when manifest exists', () => {
    // Ensure a manifest exists so the experiment is not skipped
    const manifestDir = join(import.meta.dirname, '..', '..', '.session');
    const manifest = join(manifestDir, 'session-current.json');
    const hadManifest = existsSync(manifest);
    if (!hadManifest) {
      writeFileSync(manifest, '{"sessionId":"chaos-test","status":"active"}', 'utf-8');
    }
    try {
      const exp = EXPERIMENTS.find((e) => e.name === 'session-manifest-corruption')!;
      const result = runExperiment(exp, false);
      assert.strictEqual(result.status, 'passed');
      assert.ok(result.details.some((d) => d.includes('corruption detected')));
      assert.ok(result.details.some((d) => d.includes('state restored')));
    } finally {
      if (!hadManifest) rmSync(manifest, { force: true });
    }
  });
});

describe('runAll', () => {
  it('returns one result per experiment', () => {
    const results = runAll(true); // dry-run — safe
    assert.strictEqual(results.length, EXPERIMENTS.length);
    for (const r of results) {
      assert.strictEqual(r.status, 'dry-run');
    }
  });
});

describe('saveResults + loadResults', () => {
  it('round-trips results to disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gv-chaos-'));
    try {
      const results = runAll(true);
      // Point save/load at the temp dir by overriding the module constants is not
      // possible (const), so we test the real path but clean up after.
      saveResults(results);
      const loaded = loadResults();
      assert.ok(loaded, 'results should load');
      assert.strictEqual(loaded!.results.length, results.length);
      assert.strictEqual(loaded!.total, results.length);
      assert.strictEqual(loaded!.dryRun, results.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      // Clean up the real results file created by saveResults
      rmSync(RESULTS_FILE, { force: true });
      rmSync(RESULTS_DIR, { recursive: true, force: true });
    }
  });
});

describe('formatResults', () => {
  it('renders a summary with totals', () => {
    const results = runAll(true);
    const text = formatResults(results);
    assert.ok(text.includes('CHAOS ENGINEERING'));
    assert.ok(text.includes(`TOTAL: ${results.length}`));
    assert.ok(text.includes(`DRY-RUN: ${results.length}`));
  });

  it('renders passed/failed icons', () => {
    const exp = EXPERIMENTS.find((e) => e.name === 'config-corruption')!;
    const result = runExperiment(exp, false);
    const text = formatResults([result]);
    assert.ok(text.includes('✓ config-corruption'));
    assert.ok(text.includes('PASSED'));
  });
});
