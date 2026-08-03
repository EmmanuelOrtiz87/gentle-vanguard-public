import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('karpathy-guidelines', () => {
  it('src/hooks/karpathy-enforcer-hook.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'hooks', 'karpathy-enforcer-hook.ts')));
  });

  it('docs/agents/AGENTS.md references tool detection', () => {
    const content = readFileSync(resolve(ROOT, 'docs', 'agents', 'AGENTS.md'), 'utf-8');
    assert.ok(content.includes('Tool Detection'), 'Expected tool detection section in AGENTS.md');
  });
});
