import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findOpenSpan, listSpanFilesNewestFirst } from '../../src/monitor/span-files.js';

let dir: string;
const nowNs = () => String(BigInt(Date.now()) * 1_000_000n);

function writeSpan(file: string, records: object[]): void {
  writeFileSync(join(dir, file), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

describe('span-files', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gv-spans-'));
  });

  it('lists files newest first by date in the name', () => {
    writeFileSync(join(dir, 'spans-2026-11-01.jsonl'), '');
    writeFileSync(join(dir, 'spans-2026-11-19.jsonl'), '');
    writeFileSync(join(dir, 'other.jsonl'), '');
    const files = listSpanFilesNewestFirst(dir);
    assert.deepStrictEqual(
      files.map((f) => f.split(/[\\/]/).pop()),
      ['spans-2026-11-19.jsonl', 'spans-2026-11-01.jsonl'],
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it('finds the open span in the newest file, not the alphabetically first', () => {
    const old = {
      name: 'session-start',
      traceId: 't-old',
      spanId: 's-old',
      startTimeUnixNano: nowNs(),
    };
    const current = {
      name: 'session-start',
      traceId: 't-new',
      spanId: 's-new',
      startTimeUnixNano: nowNs(),
    };
    writeSpan('spans-2026-06-01.jsonl', [old]);
    writeSpan('spans-2026-11-19.jsonl', [current]);
    const found = findOpenSpan(dir);
    assert.ok(found);
    assert.strictEqual(found?.traceId, 't-new');
    rmSync(dir, { recursive: true, force: true });
  });

  it('ignores a start whose end record closed it in another file', () => {
    const start = {
      name: 'session-start',
      traceId: 't1',
      spanId: 's1',
      startTimeUnixNano: nowNs(),
    };
    writeSpan('spans-2026-11-18.jsonl', [start]);
    writeSpan('spans-2026-11-19.jsonl', [{ ...start, endTimeUnixNano: nowNs(), attributes: [] }]);
    assert.strictEqual(findOpenSpan(dir), null);
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not re-close a span that already carries an end in the same file', () => {
    const start = {
      name: 'session-start',
      traceId: 't1',
      spanId: 's1',
      startTimeUnixNano: nowNs(),
    };
    const end = { ...start, endTimeUnixNano: nowNs() };
    const open = { name: 'session-start', traceId: 't2', spanId: 's2', startTimeUnixNano: nowNs() };
    writeSpan('spans-2026-11-19.jsonl', [start, end, open]);
    const found = findOpenSpan(dir);
    assert.strictEqual(found?.traceId, 't2');
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses to close a long-abandoned span', () => {
    const staleNs = String((BigInt(Date.now()) - BigInt(7 * 24 * 3600 * 1000)) * 1_000_000n);
    writeSpan('spans-2026-11-12.jsonl', [
      { name: 'session-start', traceId: 't1', spanId: 's1', startTimeUnixNano: staleNs },
    ]);
    assert.strictEqual(findOpenSpan(dir), null);
    rmSync(dir, { recursive: true, force: true });
  });

  it('skips malformed lines instead of failing', () => {
    writeFileSync(
      join(dir, 'spans-2026-11-19.jsonl'),
      `{"broken":\n${JSON.stringify({ name: 'session-start', traceId: 't9', spanId: 's9', startTimeUnixNano: nowNs() })}\n`,
    );
    const found = findOpenSpan(dir);
    assert.strictEqual(found?.traceId, 't9');
    rmSync(dir, { recursive: true, force: true });
  });
});
