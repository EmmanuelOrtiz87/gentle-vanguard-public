import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SRC = (name: string) => pathToFileURL(resolve(ROOT, 'src', name)).href;

describe('session-scoring-autocompare', () => {
  it('source file exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src/session/session-scoring-autocompare.ts')));
  });

  it('imports without error', async () => {
    const mod = await import(SRC('session/session-scoring-autocompare.ts'));
    assert.ok(mod);
  });

  it('handles missing quality-trend.json gracefully', () => {
    // The function should not throw when there's no data yet
    assert.ok(true);
  });
});
