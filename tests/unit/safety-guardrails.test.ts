import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('safety-guardrails', () => {
  it('src/security/safety-guardrails.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'security', 'safety-guardrails.ts')));
  });

  it('src/security/prompt-injection-guard.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'security', 'prompt-injection-guard.ts')));
  });
});
