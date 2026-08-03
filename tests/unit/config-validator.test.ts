import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

function assertValidJSON(filePath: string): void {
  const content = readFileSync(filePath, 'utf-8');
  JSON.parse(content);
}

describe('config-validator', () => {
  it('auto-delegation.json valid', () => {
    assertValidJSON(resolve(ROOT, 'config', 'auto-delegation.json'));
  });

  it('orchestrator.json valid', () => {
    assertValidJSON(resolve(ROOT, 'config', 'orchestrator.json'));
  });

  it('session-autostart.config.json valid', () => {
    assertValidJSON(resolve(ROOT, 'config', 'session-autostart.config.json'));
  });
});
