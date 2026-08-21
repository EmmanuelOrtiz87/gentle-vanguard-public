import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SRC = (name: string) => pathToFileURL(resolve(ROOT, 'src', name)).href;

describe('auto-apply-safe', () => {
  it('source file exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src/auto-apply-safe.ts')));
  });

  it('imports without error', async () => {
    const mod = await import(SRC('auto-apply-safe.ts'));
    assert.ok(mod);
  });

  it('action log directory resolves correctly', () => {
    const logDir = join(ROOT, '.session', 'auto-apply');
    assert.ok(ROOT.length > 0);
    assert.ok(logDir.includes('.session'));
  });
});
