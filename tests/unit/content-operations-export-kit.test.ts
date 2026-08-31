import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { exportKit } from '../../src/content-operations/export-kit.ts';

describe('content operations export kit', () => {
  it('creates a timestamped ZIP containing the selected tracked files', () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-export-'));
    mkdirSync(join(root, 'src', 'content-operations'), { recursive: true });
    writeFileSync(join(root, 'src', 'content-operations', 'job.ts'), 'export const job = true;');
    const output = exportKit({ root, now: new Date('2026-08-29T12:34:56.000Z') });
    const archive = readFileSync(output);

    assert.match(output, /gentle-vanguard-content-operations-20260829-123456\.zip$/);
    assert.equal(archive.readUInt32LE(0), 0x04034b50);
    assert.match(archive.toString('utf8'), /src\/content-operations\/job\.ts/);
  });

  it('rejects an empty content operations tree', () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-export-empty-'));
    assert.throws(
      () => exportKit({ root, outputDir: join(root, 'out') }),
      /No Content Operations files found/,
    );
  });
});
