#!/usr/bin/env node
/**
 * Unit Tests: run-command hidden spawning
 *
 * Regression guard for the "visible cmd.exe window" class of bugs:
 * runNpxTsx must run the script IN the spawned node process itself
 * (`node --import tsx <script>`). The old `node <tsx-cli.mjs> <script>` form
 * made the tsx CLI re-spawn the script as a grandchild WITHOUT windowsHide —
 * on Windows every hidden/detached launcher leaked a visible console window
 * (flashing one-shots, lingering daemons that broke the stack when closed).
 *
 * The PID-equality assertion below fails if a CLI-wrapper grandchild is ever
 * reintroduced: the probe script's process.pid would differ from child.pid.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNpxTsx, runNpxTsxSync } from '../../src/core/run-command.ts';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');

test('runNpxTsx: spawned child IS the script process (no CLI-wrapper grandchild)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gv-run-command-'));
  try {
    const outFile = join(dir, 'out.json');
    const helper = join(dir, 'pid-probe.mjs');
    writeFileSync(
      helper,
      `import { writeFileSync } from 'node:fs';\n` +
        `writeFileSync(${JSON.stringify(outFile)}, JSON.stringify({ pid: process.pid }));\n`,
    );

    const child = runNpxTsx(helper, [outFile], { cwd: ROOT });
    assert.ok(child.pid, 'child has a pid');
    const code = await new Promise<number>((res) => child.on('close', (c) => res(c ?? -1)));
    assert.strictEqual(code, 0, 'helper exits cleanly');

    const probe = JSON.parse(readFileSync(outFile, 'utf-8')) as { pid: number };
    assert.strictEqual(
      probe.pid,
      child.pid,
      'script pid must equal spawned child pid — a grandchild means the tsx CLI wrapper (and its visible console) is back',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runNpxTsxSync: executes the script and captures stdout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gv-run-command-'));
  try {
    const helper = join(dir, 'echo-probe.mjs');
    writeFileSync(helper, `console.log('HIDDEN-SPAWN-OK');\n`);

    const result = runNpxTsxSync(helper, [], { cwd: ROOT });
    assert.strictEqual(result.status, 0, `helper exits cleanly: ${result.stderr}`);
    assert.match(result.stdout, /HIDDEN-SPAWN-OK/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
