import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('feedback-digest-scripts', () => {
  it('Check config/dashboard-alerts.json exists and is valid', () => {
    const p = resolve(ROOT, 'config', 'dashboard-alerts.json');
    assert.ok(existsSync(p));
    const parsed = JSON.parse(readFileSync(p, 'utf-8'));
    assert.ok(typeof parsed === 'object' && parsed !== null);
    assert.ok(parsed.version || parsed.rules, 'Expected version or rules field');
  });
});
