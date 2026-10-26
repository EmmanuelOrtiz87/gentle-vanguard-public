import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDeps } from '../../src/infrastructure/dependency-validator.ts';

test('dependency catalog includes jq for Engram lifecycle hooks with an install route', () => {
  const jq = getDeps().find((dep) => dep.binary === 'jq');
  assert.ok(jq, 'Engram bash hooks require jq to parse the host event and register the session');
  assert.equal(jq.category, 'stack');
  assert.ok(jq.description.includes('Engram'));
  assert.ok(jq.autoInstall?.length);
});

test('Engram install route uses the upstream module and its required major version suffix', () => {
  const engram = getDeps().find((dep) => dep.binary === 'engram');
  assert.deepEqual(engram?.autoInstall, ['go', 'install', 'github.com/Gentleman-Programming/engram/v3/cmd/engram@latest']);
});
