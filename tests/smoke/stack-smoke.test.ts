import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = resolve(import.meta.dirname, '..', '..');
const isPublicDistribution = !existsSync(resolve(ROOT, 'src/session/session-autostart.ts'));

function countFiles(directory: string, extension: string): number {
  if (!existsSync(directory)) return 0;

  return readdirSync(directory, { withFileTypes: true }).reduce((count, entry) => {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) return count + countFiles(entryPath, extension);
    return count + (entry.isFile() && entry.name.endsWith(extension) ? 1 : 0);
  }, 0);
}

describe('Gentle-Vanguard stack smoke', () => {
  it('has a core session entrypoint', () => {
    assert.equal(
      existsSync(resolve(ROOT, 'src/session/session-autostart.ts')) ||
        existsSync(resolve(ROOT, 'scripts/gentle-vanguard/bootstrap.ts')),
      true,
    );
  });

  it('has a dashboard entrypoint or public documentation', () => {
    assert.equal(
      existsSync(resolve(ROOT, 'src/ops/dashboard-start.ts')) ||
        existsSync(resolve(ROOT, 'docs/technical/STACK-DOCUMENTATION.md')),
      true,
    );
  });

  it('has the expected TypeScript source structure', () => {
    const sourceCount = countFiles(resolve(ROOT, 'src'), '.ts');
    if (isPublicDistribution) {
      assert.equal(existsSync(resolve(ROOT, 'docs/technical/STACK-DOCUMENTATION.md')), true);
    } else {
      assert.ok(sourceCount >= 20);
    }
  });

  it('package.json exists and has scripts', () => {
    const packageJson = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    assert.ok(Object.keys(packageJson.scripts ?? {}).length >= 10);
  });

  it('has session-autostart configuration or public documentation', () => {
    assert.equal(
      existsSync(resolve(ROOT, 'config/session-autostart.config.json')) ||
        existsSync(resolve(ROOT, 'docs/getting-started/README.md')),
      true,
    );
  });

  it('has model-router configuration or public documentation', () => {
    assert.equal(
      existsSync(resolve(ROOT, 'config/model-router.json')) ||
        existsSync(resolve(ROOT, 'docs/technical/STACK-DOCUMENTATION.md')),
      true,
    );
  });

  it('has opencode.json', () => {
    assert.equal(existsSync(resolve(ROOT, 'opencode.json')), true);
  });

  it('has unit tests', () => {
    assert.ok(countFiles(resolve(ROOT, 'tests/unit'), '.test.ts') >= 5);
  });

  it('has GitHub workflows', () => {
    assert.ok(countFiles(resolve(ROOT, '.github/workflows'), '.yml') >= 5);
  });
});
