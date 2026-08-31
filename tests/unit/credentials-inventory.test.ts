import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryCredentials } from '../../src/security/credentials-inventory.js';

test('inventories names and references without exposing fixture values', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-credential-inventory-'));
  mkdirSync(join(root, 'config'));
  writeFileSync(
    join(root, 'config', 'app.json'),
    JSON.stringify({ token: '${GITHUB_PAT}', password: 'synthetic-never-output' }),
  );
  writeFileSync(join(root, '.env'), 'GITHUB_PAT=synthetic-never-output');
  const result = inventoryCredentials({
    root,
    env: { TELEGRAM_BOT_TOKEN: 'synthetic-never-output', PATH: 'safe' },
  });
  const output = JSON.stringify(result);
  assert.equal(result.readOnly, true);
  assert.equal(result.valuesInspected, false);
  assert.match(output, /GITHUB_PAT/);
  assert.match(output, /TELEGRAM_BOT_TOKEN/);
  assert.doesNotMatch(output, /synthetic-never-output/);
  assert.doesNotMatch(output, /\.env/);
});

test('respects explicit exclusions and redacts sensitive path components', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-credential-inventory-'));
  mkdirSync(join(root, 'private-secrets'));
  mkdirSync(join(root, 'config'));
  writeFileSync(join(root, 'private-secrets', 'values.json'), '{"OPENAI_API_KEY":"not-read-out"}');
  writeFileSync(join(root, 'config', 'provider.json'), '{"OPENAI_API_KEY":"${OPENAI_API_KEY}"}');
  const result = inventoryCredentials({ root, exclusions: ['private-secrets'], env: {} });
  assert.equal(result.credentials.length, 1);
  assert.match(result.credentials[0].location, /repo:\/config\/provider\.json/);
  assert.doesNotMatch(result.credentials[0].location, /private-secrets/);
});
