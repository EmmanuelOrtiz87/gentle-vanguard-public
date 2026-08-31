import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SRC = (name: string) => pathToFileURL(resolve(ROOT, 'src', name)).href;

describe('config-diff-detector', () => {
  it('source file exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src/tools/config-diff-detector.ts')));
  });

  it('imports without error', async () => {
    const mod = await import(SRC('tools/config-diff-detector.ts'));
    assert.ok(mod);
  });

  it('config directory exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'config')));
  });
});
