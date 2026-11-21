/**
 * pidfile-reaper.test.ts — el reaper clasifica pidfiles y nunca toca un vivo.
 *
 * R1 · El PID propio (vivo) se clasifica `live`.
 * R2 · Un PID inexistente se clasifica `stale`.
 * R3 · Contenido no numérico / vacío se clasifica `corrupt`.
 * R4 · scanPidfiles lee solo `.runtime/*.pid` de un directorio dado.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { classifyPidfile, scanPidfiles } from '../../src/ops/pidfile-reaper.ts';

test('R1 · el PID del proceso actual es live', () => {
  const result = classifyPidfile(String(process.pid));
  assert.equal(result.state, 'live');
  assert.equal(result.pid, process.pid);
});

test('R2 · un PID inexistente es stale', () => {
  // 2^22+ es un PID que ningún proceso vivo ocupa en un sistema hogareño.
  const result = classifyPidfile('4194303');
  assert.equal(result.state, 'stale');
  assert.equal(result.pid, 4194303);
});

test('R3 · contenido vacío o no numérico es corrupt', () => {
  assert.deepEqual(classifyPidfile(''), { pid: null, state: 'corrupt' });
  assert.deepEqual(classifyPidfile('no-es-un-pid'), { pid: null, state: 'corrupt' });
  assert.deepEqual(classifyPidfile('0'), { pid: null, state: 'corrupt' });
});

test('R4 · scanPidfiles lee solo .pid de la carpeta indicada', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pidfiles-'));
  try {
    writeFileSync(join(dir, 'vivo.pid'), String(process.pid));
    writeFileSync(join(dir, 'muerto.pid'), '4194303');
    writeFileSync(join(dir, 'notas.txt'), 'ignorar');
    const statuses = scanPidfiles(dir);
    assert.deepEqual(
      statuses.map((s) => `${s.file}:${s.state}`),
      ['muerto.pid:stale', 'vivo.pid:live'],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
