import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('model-router', () => {
  it('config/model-router.json exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'config', 'model-router.json')));
  });

  it('config/orchestrator.json has orchestrator block', () => {
    const parsed = JSON.parse(readFileSync(resolve(ROOT, 'config', 'orchestrator.json'), 'utf-8'));
    assert.ok(parsed.orchestrator);
  });
});
