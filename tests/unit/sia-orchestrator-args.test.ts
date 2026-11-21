#!/usr/bin/env node
/**
 * Unit Tests: sia-orchestrator parseArgs — la acción POSICIONAL se respeta.
 *
 * Contratest del bug cazado en vivo (2026-11-21): el uso documentado es
 * `sia:run init ...` pero parseArgs ignoraba el posicional silenciosamente y
 * TODO comando ejecutaba `status` — el CLI documentado nunca funcionó como
 * documentado. Invariantes: posicional válido gana al default 'status';
 * `--action` explícito sigue ganando; posicional inválido no fabrica acciones.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const CLI = resolve(ROOT, 'src', 'orchestration', 'sia-orchestrator.ts');

test('acción posicional se parsea (init con --task-spec crea la sesión)', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'gv-sia-args-'));
  try {
    const out = execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        CLI,
        'init',
        '--session-id',
        'args-test',
        '--task-spec',
        't',
        '--output-dir',
        outDir,
      ],
      { encoding: 'utf-8', timeout: 60_000 },
    );
    assert.match(out, /status: init/);
    assert.ok(existsSync(join(outDir, 'args-test', 'state.json')), 'la sesión debe existir');
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('status sobre sesión inexistente falla HONESTO (no crea nada)', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'gv-sia-args-'));
  try {
    const r = spawnSync(
      process.execPath,
      ['--import', 'tsx', CLI, 'status', '--session-id', 'fantasma', '--output-dir', outDir],
      { encoding: 'utf-8', timeout: 60_000 },
    );
    assert.notEqual(r.status, 0);
    assert.match(String(r.stdout), /Session not found/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
