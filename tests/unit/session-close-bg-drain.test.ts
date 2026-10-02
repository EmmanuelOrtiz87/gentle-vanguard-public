import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const PHASES = resolve(ROOT, 'src', 'session', 'session-close', 'phases.ts');

describe('session-close BG drain safety net', () => {
  it('phases.ts file exists', () => {
    assert.ok(existsSync(PHASES));
  });

  it('phaseCleanup calls the helper CLI (--list)', () => {
    const src = readFileSync(PHASES, 'utf-8');
    assert.ok(src.includes('background-tasks.ts'), 'must reference the helper script');
    assert.ok(src.includes("'--list'"), 'must pass --list for the read-side');
  });

  it('phaseCleanup also reaps OS leaks (--reap-os --apply)', () => {
    const src = readFileSync(PHASES, 'utf-8');
    assert.ok(src.includes("'--reap-os'"), 'must call --reap-os');
    assert.ok(src.includes("'--apply'"), 'must pass --apply to actually kill');
  });

  it('uses SKIP (not FAIL) on error — safety net, not a gate', () => {
    // The catch block uses the LAST occurrence of "phase: 'bg-tasks-drain'"
    const src = readFileSync(PHASES, 'utf-8');
    const idx = src.lastIndexOf("phase: 'bg-tasks-drain'");
    assert.ok(idx > 0);
    const window = src.slice(idx, idx + 500);
    assert.ok(window.includes("status: 'SKIP'"), 'error path must SKIP, not FAIL');
  });

  it('result rows are added under the cleanup phase', () => {
    const src = readFileSync(PHASES, 'utf-8');
    assert.ok(src.includes("phase: 'bg-tasks-drain'"), 'must add bg-tasks-drain result');
    assert.ok(src.includes("phase: 'bg-tasks-reap-os'"), 'must add bg-tasks-reap-os result');
  });
});
