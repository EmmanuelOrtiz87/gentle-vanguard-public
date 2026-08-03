import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('monitoring-scripts', () => {
  it('src/metrics-collector.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'metrics-collector.ts')));
  });

  it('src/periodic-checkpoint.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'infrastructure', 'periodic-checkpoint.ts')));
  });
});
