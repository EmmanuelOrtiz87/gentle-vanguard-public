import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { syncPublicBootstrapEntrypoints } from '../../src/infrastructure/sync-to-public.js';

const sources = [
  'src/infrastructure/bootstrap.ts',
  'src/infrastructure/bootstrap-machine.ts',
  'src/ops/setup-multi-machine.ts',
];

describe('public bootstrap compatibility entrypoints', () => {
  it('replaces stale copies, forwards arguments and preserves the canonical CLI exit code', () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-bootstrap-export-'));
    try {
      for (const source of sources) {
        mkdirSync(join(root, source, '..'), { recursive: true });
        writeFileSync(join(root, source), '');
      }
      mkdirSync(join(root, 'src/core'), { recursive: true });
      writeFileSync(join(root, 'package.json'), '{"type":"module"}');
      writeFileSync(
        join(root, 'src/core/run-command.js'),
        'export function runNpxTsxSync(script, args) { console.log(JSON.stringify({script,args})); return {status:7}; }',
      );
      syncPublicBootstrapEntrypoints(root, root);
      for (const source of sources) {
        const name = source.split('/').at(-1)!;
        const entry = join(root, 'scripts/gentle-vanguard', name);
        writeFileSync(entry, 'stale');
        syncPublicBootstrapEntrypoints(root, root);
        const result = spawnSync(
          process.execPath,
          [
            '--import',
            pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href,
            entry,
            '--source',
            'path with spaces',
          ],
          { encoding: 'utf8', windowsHide: true },
        );
        assert.equal(result.status, 7, result.stderr);
        assert.deepEqual(JSON.parse(result.stdout), {
          script: join(root, source),
          args: ['--source', 'path with spaces'],
        });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails before overwriting existing entrypoints when canonical source is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-bootstrap-missing-'));
    try {
      const entry = join(root, 'scripts/gentle-vanguard/bootstrap.ts');
      mkdirSync(join(entry, '..'), { recursive: true });
      writeFileSync(entry, 'preserve');
      assert.throws(
        () => syncPublicBootstrapEntrypoints(root, root),
        /Public bootstrap source missing/,
      );
      assert.equal(readFileSync(entry, 'utf8'), 'preserve');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
