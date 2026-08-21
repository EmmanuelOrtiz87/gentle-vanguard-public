#!/usr/bin/env node

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isExcludedPath, stagePayload, PAYLOAD_ENTRIES } from '../../src/installer/payload.ts';

function makeFakeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'gv-payload-test-'));
  // Required executable entries
  mkdirSync(join(root, 'src', 'core'), { recursive: true });
  writeFileSync(join(root, 'src', 'core', 'demo.ts'), 'export const demo = 1;\n');
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(join(root, 'config', 'installer-manifest.json'), '{}\n');
  writeFileSync(join(root, 'package.json'), '{"version":"0.0.0-test"}\n');
  writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
  writeFileSync(join(root, 'tsconfig.json'), '{}\n');
  writeFileSync(join(root, '.lefthook.yml'), 'pre-commit:\n');
  writeFileSync(join(root, 'opencode.json'), '{}\n');
  writeFileSync(join(root, 'README-PUBLIC.md'), '# GV\n');
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'guide.md'), '# Guide\n');
  mkdirSync(join(root, 'tests', 'smoke'), { recursive: true });
  writeFileSync(join(root, 'tests', 'smoke', 'smoke.ps1'), 'ok\n');
  mkdirSync(join(root, 'scripts', 'database'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'database', 'db-health.ts'), 'ok\n');
  mkdirSync(join(root, 'scripts', 'recovery'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'recovery', 'recover.ts'), 'ok\n');
  mkdirSync(join(root, 'apps', 'web-dashboard'), { recursive: true });
  writeFileSync(join(root, 'apps', 'web-dashboard', 'index.html'), '<html></html>\n');
  // Forbidden payloads that must never leak into an installer
  mkdirSync(join(root, 'keys'), { recursive: true });
  writeFileSync(join(root, 'keys', 'master.key'), 'SECRET');
  writeFileSync(join(root, 'provenance-private.pem'), 'PRIVATE');
  writeFileSync(join(root, '.env'), 'API_KEY=x');
  mkdirSync(join(root, '.runtime'), { recursive: true });
  writeFileSync(join(root, '.runtime', 'gentle-vanguard.db'), 'DB');
  mkdirSync(join(root, 'node_modules', 'left-pad'), { recursive: true });
  writeFileSync(join(root, 'node_modules', 'left-pad', 'index.js'), 'x');
  return root;
}

test('isExcludedPath refuses keys, key material, env files and runtime state', () => {
  for (const p of [
    'keys/master.key',
    'keys\\master.key',
    'secrets/api.key',
    'cert.pem',
    '.env',
    '.runtime/gentle-vanguard.db',
    '.session/state.json',
    '.telemetry/spans/x.json',
    'node_modules/left-pad/index.js',
    'dist/bundle.js',
  ]) {
    assert.equal(isExcludedPath(p), true, `expected exclusion for ${p}`);
  }
});

test('isExcludedPath allows normal distribution paths', () => {
  for (const p of ['src/core/demo.ts', 'config/installer-manifest.json', 'docs/guide.md']) {
    assert.equal(isExcludedPath(p), false, `expected inclusion for ${p}`);
  }
});

test('stagePayload copies required entries and never copies secret paths', () => {
  const repo = makeFakeRepo();
  const stage = join(repo, '_stage');
  try {
    const result = stagePayload(repo, stage);
    assert.ok(result.copiedEntries.includes('src'));
    assert.ok(existsSync(join(stage, 'src', 'core', 'demo.ts')));
    assert.ok(existsSync(join(stage, 'package.json')));
    assert.ok(existsSync(join(stage, 'apps', 'web-dashboard', 'index.html')));
    // Secret/state exclusions
    assert.equal(existsSync(join(stage, 'keys')), false, 'keys/ must not be staged');
    assert.equal(existsSync(join(stage, '.runtime')), false, '.runtime must not be staged');
    assert.equal(existsSync(join(stage, 'node_modules')), false, 'node_modules must not be staged');
    assert.equal(existsSync(join(stage, '.env')), false, '.env must not be staged');
    assert.ok(!result.copiedEntries.some((entry) => isExcludedPath(entry)));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('stagePayload throws when a required entry is missing', () => {
  const repo = makeFakeRepo();
  const stage = join(repo, '_stage2');
  try {
    rmSync(join(repo, 'pnpm-lock.yaml'));
    assert.throws(() => stagePayload(repo, stage), /Required payload entry missing: pnpm-lock.yaml/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('payload entry list has no excluded paths by construction', () => {
  for (const entry of PAYLOAD_ENTRIES) {
    assert.equal(isExcludedPath(entry.path), false, `entry ${entry.path} must not be an excluded path`);
  }
});
