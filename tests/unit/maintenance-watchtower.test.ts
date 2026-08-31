import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
// F2.5 split: the dashboard probe lives in the watchtower checks module and
// the HTTP probe helper in watchtower/helpers.ts.
const WATCHTOWER = readFileSync(
  resolve(ROOT, 'src', 'core', 'watchtower', 'checks-dashboard.ts'),
  'utf8',
);
const WATCHTOWER_HELPERS = readFileSync(
  resolve(ROOT, 'src', 'core', 'watchtower', 'helpers.ts'),
  'utf8',
);

describe('maintenance-watchtower dashboard probe', () => {
  it('uses the public health endpoint and keeps strict 200-only validation', () => {
    assert.match(WATCHTOWER, /testHttp\(`http:\/\/127\.0\.0\.1:\$\{port\}\/api\/health`\)/);
    assert.doesNotMatch(WATCHTOWER, /testHttp\(`http:\/\/127\.0\.0\.1:\$\{port\}\/api\/metrics`\)/);
    assert.match(WATCHTOWER_HELPERS, /data\.includes\('200 OK'\)/);
  });
});
