import { describe, it } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SCRIPT = resolve(ROOT, 'scripts', 'utilities', 'background-tasks.ts');
const RUNTIME_DIR = resolve(ROOT, '.runtime');
const STATE_FILE = resolve(RUNTIME_DIR, 'bg-tasks.json');

function runScript(args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('npx', ['tsx', SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 60_000,
    shell: true,
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function ensureRuntimeDir(): void {
  if (!existsSync(RUNTIME_DIR)) mkdirSync(RUNTIME_DIR, { recursive: true });
}

describe('background-tasks helper CLI', () => {
  it('script file exists', () => {
    assert.ok(existsSync(SCRIPT));
  });

  it('--list runs without crashing (no state file)', () => {
    // Make sure no leftover state file
    if (existsSync(STATE_FILE)) rmSync(STATE_FILE);
    const r = runScript(['--list']);
    assert.strictEqual(r.status, 0);
    assert.ok(r.stdout.includes('No lingering'));
  });

  it('--list --all shows drained entries', () => {
    ensureRuntimeDir();
    const sample: { version: number; entries: Array<Record<string, unknown>> } = {
      version: 1,
      entries: [
        {
          taskId: 'bg_test_drained',
          description: 'test task',
          spawnedAt: new Date().toISOString(),
          spawnMode: 'auto-promoted',
          drained: true,
          drainedAt: new Date().toISOString(),
          exitStatus: 'succeeded',
        },
      ],
    };
    writeFileSync(STATE_FILE, JSON.stringify(sample));
    const r = runScript(['--list', '--all']);
    assert.strictEqual(r.status, 0);
    assert.ok(r.stdout.includes('bg_test_drained'));
    rmSync(STATE_FILE);
  });

  it('--drain-hint emits task_output instructions', () => {
    ensureRuntimeDir();
    const sample = {
      version: 1,
      entries: [
        {
          taskId: 'bg_test_pending',
          description: 'pending test',
          spawnedAt: new Date().toISOString(),
          spawnMode: 'auto-promoted',
          drained: false,
        },
      ],
    };
    writeFileSync(STATE_FILE, JSON.stringify(sample));
    const r = runScript(['--drain-hint']);
    assert.strictEqual(r.status, 0);
    assert.ok(
      r.stdout.includes('task_output(task_id="bg_test_pending")'),
      'expected task_output hint for pending task',
    );
    rmSync(STATE_FILE);
  });

  it('--reap-os dry-run does not kill anything', () => {
    const r = runScript(['--reap-os']);
    assert.strictEqual(r.status, 0);
    // Should NOT contain "exit=" markers (no actual kills happened)
    assert.ok(!r.stdout.includes('exit=') || r.stdout.includes('Dry-run'));
  });

  it('source file references all required layers', () => {
    const src = readFileSync(SCRIPT, 'utf-8');
    assert.ok(src.includes('listOsBgCandidates'), 'must list OS-level candidates');
    assert.ok(src.includes('drain-hint'), 'must expose --drain-hint');
    assert.ok(src.includes('--apply'), 'must guard reap behind --apply');
  });
});
