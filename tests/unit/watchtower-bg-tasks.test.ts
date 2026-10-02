import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const CHECK = resolve(ROOT, 'src', 'core', 'watchtower', 'checks-bg-tasks.ts');
const INDEX = resolve(ROOT, 'src', 'core', 'watchtower', 'index.ts');
const WATCHTOWER = resolve(ROOT, 'src', 'core', 'maintenance-watchtower.ts');

describe('watchtower BG tasks check', () => {
  it('check module file exists', () => {
    assert.ok(existsSync(CHECK));
  });

  it('exports checkBgTasks function', () => {
    const src = readFileSync(CHECK, 'utf-8');
    assert.ok(src.includes('export async function checkBgTasks'), 'must export checkBgTasks');
    assert.ok(src.includes('addResult('), 'must call addResult for the result row');
  });

  it('re-exports the check from watchtower/index.ts', () => {
    const src = readFileSync(INDEX, 'utf-8');
    assert.ok(src.includes('checks-bg-tasks'), 'index must re-export checks-bg-tasks');
  });

  it('is wired into maintenance-watchtower runAllChecks', () => {
    const src = readFileSync(WATCHTOWER, 'utf-8');
    assert.ok(src.includes('import { checkBgTasks }'), 'maintenance-watchtower must import checkBgTasks');
    assert.ok(src.includes('checkBgTasks,'), 'runAllChecks must include checkBgTasks');
  });

  it('status thresholds are documented in source', () => {
    const src = readFileSync(CHECK, 'utf-8');
    assert.ok(src.includes('PENDING_WARN'), 'must define PENDING_WARN threshold');
    assert.ok(src.includes('PENDING_FAIL'), 'must define PENDING_FAIL threshold');
    assert.ok(src.includes('OS_LEAK_WARN'), 'must define OS_LEAK_WARN threshold');
    assert.ok(src.includes('OS_LEAK_FAIL'), 'must define OS_LEAK_FAIL threshold');
  });

  it('uses both signals (state file + OS)', () => {
    const src = readFileSync(CHECK, 'utf-8');
    assert.ok(src.includes('loadState'), 'must read state file');
    assert.ok(src.includes('listOsLeakCandidates'), 'must query OS processes');
  });
});
