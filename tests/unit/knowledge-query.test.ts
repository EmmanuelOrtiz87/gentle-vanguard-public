import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('knowledge-query', () => {
  it('src/knowledge/knowledge-base-init.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'knowledge', 'knowledge-base-init.ts')));
  });

  it('src/knowledge/knowledge-base-manager.ts exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'src', 'knowledge', 'knowledge-base-manager.ts')));
  });

  it('uses the canonical vault path and sync entrypoint', () => {
    const config = JSON.parse(
      readFileSync(resolve(ROOT, 'config', 'knowledge-base-config.json'), 'utf8'),
    ) as { vault_path: string; sync: { modes: string[] } };
    const sync = readFileSync(resolve(ROOT, 'src', 'knowledge', 'knowledge-base-sync.ts'), 'utf8');
    assert.equal(config.vault_path, 'knowledge-base');
    assert.deepEqual(config.sync.modes, ['export', 'import', 'session-summary']);
    assert.match(sync, /\['export', exportFile\]/);
    assert.match(sync, /--dry-run/);
    assert.doesNotMatch(sync, /search', '--limit', '50', '--json/);
  });
});
