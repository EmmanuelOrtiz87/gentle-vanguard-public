import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generatePRDescription } from '../../src/planning/planning-integration.ts';

const estimatorPath = resolve(
  fileURLToPath(new URL('../../src/planning/planning-estimator.ts', import.meta.url)),
);

test('JSON estimate retains its fields and marks confidence uncalibrated', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', estimatorPath, '--json'], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as {
    estimate: Record<string, unknown>;
    prSize: Record<string, unknown>;
  };

  assert.deepEqual(Object.keys(report.estimate).sort(), [
    'complexity',
    'confidence',
    'estimatedCost',
    'estimatedMinutes',
    'estimatedTime',
    'estimatedTokens',
    'factors',
    'model',
    'taskType',
  ]);
  assert.equal(report.estimate.confidence, 'uncalibrated');
  assert.equal(report.estimate.estimatedMinutes, 60);
  assert.equal(report.estimate.estimatedTokens, 15_000);
  assert.equal(report.prSize.size, 'S');
  assert.equal(report.prSize.calibrationStatus, 'uncalibrated');
});

test('text estimate states its uncalibrated basis and cost assumptions', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', estimatorPath], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Confidence:\s+uncalibrated/);
  assert.match(result.stdout, /no linked historical estimate\/outcome calibration data was found/);
  assert.match(result.stdout, /assumed 70% input \/ 30% output token mix/);
  assert.match(
    result.stdout,
    /Fixed size\/review thresholds; no linked PR outcome calibration data was found/,
  );
  assert.match(result.stdout, /not commitments/);
});

test('PR-size JSON preserves its existing fields and marks the heuristic uncalibrated', () => {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', estimatorPath, '--action', 'pr-size', '--json'],
    { encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  const prSize = JSON.parse(result.stdout) as Record<string, unknown>;
  for (const key of [
    'size',
    'filesChanged',
    'linesChanged',
    'reviewTime',
    'mergeWindow',
    'reviewersRequired',
  ]) {
    assert.ok(key in prSize, `missing prior PR-size output field: ${key}`);
  }
  assert.equal(prSize.calibrationStatus, 'uncalibrated');
});

test('high-complexity warning remains actionable without claiming confidence', () => {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', estimatorPath, '--complexity', '4'],
    { encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Confidence:\s+uncalibrated/);
  assert.match(result.stdout, /High-complexity task — consider breaking it down/);
});

test('PR description labels file-count complexity as uncalibrated triage guidance', () => {
  const description = generatePRDescription();

  assert.match(description, /^## Planning Estimate$/m);
  assert.match(
    description,
    /\*\*Estimate Status:\*\* Uncalibrated file-count heuristic; use for triage, not as a delivery commitment\./,
  );
  assert.match(description, /\*\*Files Changed:\*\*/);
  assert.match(description, /\*\*Lines Changed:\*\*/);
});
