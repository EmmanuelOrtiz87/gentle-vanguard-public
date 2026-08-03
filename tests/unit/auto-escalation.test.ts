import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SRC = (name: string) => pathToFileURL(resolve(ROOT, 'src', name)).href;

describe('auto-escalation', () => {
  it('source file exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src/auto-escalation.ts')));
  });

  it('imports without error', async () => {
    const mod = await import(SRC('auto-escalation.ts'));
    assert.ok(mod);
  });

  it('exports escalate function', async () => {
    const mod = await import(SRC('auto-escalation.ts'));
    assert.strictEqual(typeof mod.escalate, 'function');
  });

  it('exports getEscalationStatus function', async () => {
    const mod = await import(SRC('auto-escalation.ts'));
    assert.strictEqual(typeof mod.getEscalationStatus, 'function');
  });
});
