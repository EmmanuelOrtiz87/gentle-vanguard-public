import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('gentle-vanguard-manager', () => {
  it('opencode.json exists', () => {
    const p = resolve(ROOT, 'opencode.json');
    assert.ok(existsSync(p));
    const cfg = JSON.parse(readFileSync(p, 'utf-8'));
    assert.ok(cfg);
  });

  it('package.json exists', () => {
    const p = resolve(ROOT, 'package.json');
    assert.ok(existsSync(p));
    const cfg = JSON.parse(readFileSync(p, 'utf-8'));
    assert.ok(cfg);
  });
});
