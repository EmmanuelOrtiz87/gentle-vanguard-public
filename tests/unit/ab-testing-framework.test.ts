import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SRC = (name: string) => pathToFileURL(resolve(ROOT, 'src', name)).href;

describe('ab-testing-framework', () => {
  it('source file exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src/ab-testing-framework.ts')));
  });

  it('imports without error', async () => {
    const mod = await import(SRC('ab-testing-framework.ts'));
    assert.ok(mod);
  });

  it('exports createExperiment function', async () => {
    const mod = await import(SRC('ab-testing-framework.ts'));
    assert.strictEqual(typeof mod.createExperiment, 'function');
  });

  it('exports assignVariant function', async () => {
    const mod = await import(SRC('ab-testing-framework.ts'));
    assert.strictEqual(typeof mod.assignVariant, 'function');
  });
});
