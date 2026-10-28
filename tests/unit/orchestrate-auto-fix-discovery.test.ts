import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findFirstFile,
  findFirstFileWithExtension,
  findInDir,
} from '../../src/orchestration/orchestrate-auto-fix.ts';

describe('orchestrator validator discovery', () => {
  it('matches wildcard filenames while skipping dependency and build trees', () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-validator-discovery-'));
    try {
      const sourceDir = join(root, 'scripts', 'hooks');
      const dependencyDir = join(root, 'node_modules', 'fixture');
      const backupDir = join(root, '.backups', 'old-stack', 'scripts', 'hooks');
      mkdirSync(sourceDir, { recursive: true });
      mkdirSync(dependencyDir, { recursive: true });
      mkdirSync(backupDir, { recursive: true });
      writeFileSync(join(sourceDir, 'broken-links-audit.ps1'), '');
      writeFileSync(join(dependencyDir, 'broken-links-dependency.ps1'), '');
      writeFileSync(join(backupDir, 'broken-links-stale.ps1'), '');

      assert.equal(findFirstFile(root, 'broken-links*.ps1'), join(sourceDir, 'broken-links-audit.ps1'));
      assert.equal(findFirstFile(root, 'broken-links*.ps1', false), null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('matches file patterns and extensions and locates matching parent folders', () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-validator-discovery-'));
    try {
      const docsDir = join(root, 'docs', 'gentle-vanguard-audit');
      const scriptsDir = join(root, 'src', 'security');
      mkdirSync(docsDir, { recursive: true });
      mkdirSync(scriptsDir, { recursive: true });
      writeFileSync(join(docsDir, 'README.md'), '');
      writeFileSync(join(scriptsDir, 'security-orchestrator.ts'), '');

      assert.equal(
        findFirstFileWithExtension(root, 'security-orchestrator.*', ['.ps1', '.ts']),
        join(scriptsDir, 'security-orchestrator.ts'),
      );
      assert.equal(findInDir(root, 'gentle-vanguard-audit'), join(docsDir, 'README.md'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
