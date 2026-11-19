import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { syncPublicDependabot } from '../../src/infrastructure/public-dependabot.js';

it('exports security-only public proposals without changing private limits or other settings', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-dependabot-'));
  try {
    const source = join(root, 'private');
    const target = join(root, 'public');
    mkdirSync(join(source, '.github'), { recursive: true });
    const original = readFileSync(new URL('../../.github/dependabot.yml', import.meta.url), 'utf8');
    const configPath = join(source, '.github/dependabot.yml');
    writeFileSync(configPath, original);
    syncPublicDependabot(source, target);
    const expected = load(original) as { updates: Record<string, unknown>[] };
    for (const update of expected.updates) update['open-pull-requests-limit'] = 0;
    assert.deepEqual(load(readFileSync(join(target, '.github/dependabot.yml'), 'utf8')), expected);
    assert.equal(readFileSync(configPath, 'utf8'), original);
    syncPublicDependabot(source, target);
    assert.deepEqual(load(readFileSync(join(target, '.github/dependabot.yml'), 'utf8')), expected);
    writeFileSync(configPath, 'version: 1\nupdates: []\n');
    assert.throws(() => syncPublicDependabot(source, target), /Expected Dependabot version 2/);
    assert.deepEqual(load(readFileSync(join(target, '.github/dependabot.yml'), 'utf8')), expected);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
