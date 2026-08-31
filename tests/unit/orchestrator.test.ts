import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('orchestrator', () => {
  it('src/orchestration/team-orchestrator.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'orchestration', 'team-orchestrator.ts')));
  });

  it('config/orchestrator.json has version', () => {
    const parsed = JSON.parse(readFileSync(resolve(ROOT, 'config', 'orchestrator.json'), 'utf-8'));
    assert.ok(parsed.orchestrator?.version !== undefined, 'Expected orchestrator.version');
  });
});
