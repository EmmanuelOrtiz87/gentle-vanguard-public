/**
 * Test negativo del gate anti conflict-markers (patron gates-selftest):
 * un gate que nunca falla no vale nada — se verifica que muerde.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findConflictMarkers, main } from './conflict-marker-gate.js';

test('detecta markers de inicio, separador y fin en un conflicto real', () => {
  const conflicted = [
    'const a = 1;',
    '<<<<<<< HEAD',
    'const b = 2;',
    '=======',
    'const b = 3;',
    '>>>>>>> feature/x',
    'export { a, b };',
  ].join('\n');
  assert.deepEqual(findConflictMarkers(conflicted), [2, 4, 6]);
});

test('una regla markdown ======= sola NO es marker', () => {
  assert.deepEqual(findConflictMarkers('Título\n=======\nTexto'), []);
});

test('el gate muerde: main() = 1 con staged con markers, 0 sin ellos', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gv-conflict-gate-'));
  const origCwd = process.cwd();
  try {
    const setup = (args: string[]) => {
      const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
      if (r.status !== 0) throw new Error(`git ${args.join(' ')} falló: ${r.stderr}`);
    };
    setup(['init']);
    setup(['config', 'user.email', 't@t.local']);
    setup(['config', 'user.name', 'T']);
    writeFileSync(join(dir, 'clean.txt'), 'sin markers\n');
    setup(['add', 'clean.txt']);
    process.chdir(dir);
    assert.equal(main(), 0, 'repo limpio pasa');

    writeFileSync(join(dir, 'broken.ts'), '<<<<<<< HEAD\n');
    setup(['add', 'broken.ts']);
    assert.equal(main(), 1, 'marker staged muerde');
  } finally {
    process.chdir(origCwd);
    rmSync(dir, { recursive: true, force: true });
  }
});
