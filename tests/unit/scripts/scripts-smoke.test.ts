import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');

function countFiles(directory: string, extension: string): number {
  if (!existsSync(directory)) return 0;

  return readdirSync(directory, { withFileTypes: true }).reduce((count, entry) => {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) return count + countFiles(entryPath, extension);
    return count + (entry.isFile() && entry.name.endsWith(extension) ? 1 : 0);
  }, 0);
}

describe('TypeScript automation scripts', () => {
  it('has a scripts directory', () => {
    assert.equal(existsSync(resolve(ROOT, 'scripts')), true);
  });

  it('keeps active scripts PowerShell-free', () => {
    assert.equal(countFiles(resolve(ROOT, 'scripts'), '.ps1'), 0);
    assert.equal(
      countFiles(resolve(ROOT, '.opencode/skills/presentations-maintenance/scripts'), '.ps1'),
      0,
    );
    assert.equal(countFiles(resolve(ROOT, '.github/scripts'), '.ps1'), 0);
  });

  it('has session-autostart pipeline config', () => {
    assert.equal(existsSync(resolve(ROOT, 'config/session-autostart.config.json')), true);
  });

  it('has utility automation in TypeScript', () => {
    const ts = countFiles(resolve(ROOT, 'src'), '.ts');
    assert.ok(ts >= 5);
  });

  it('exposes presentation maintenance through Node/TS', () => {
    const packageJson = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    assert.match(packageJson.scripts['presentations:maintenance'], /node|tsx/);
    assert.equal(existsSync(resolve(ROOT, 'docs/operations/PS1-LEGACY-POLICY.md')), true);
  });

  it('has security automation as TypeScript', () => {
    assert.equal(existsSync(resolve(ROOT, 'src/infrastructure/audit-pipeline.ts')), true);
  });
});
