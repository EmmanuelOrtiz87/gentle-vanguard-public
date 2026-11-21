#!/usr/bin/env node
/**
 * Unit Tests: resolución del store real de Engram.
 *
 * Regresión de P0-1 (auditoría 2026-11-18): backup y sync apuntaban a
 * `<repo>/.engram-data/engram.db`, una ruta inexistente, y reportaban éxito sin
 * leer la base. El store vive en ENGRAM_DATA_DIR o ~/.engram/engram.db.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveEngramDataDir, resolveEngramDbPath } from '../../src/knowledge/engram-paths.ts';

test('sin ENGRAM_DATA_DIR usa ~/.engram', () => {
  assert.equal(resolveEngramDataDir({}), join(homedir(), '.engram'));
  assert.equal(resolveEngramDbPath({}), join(homedir(), '.engram', 'engram.db'));
});

test('ENGRAM_DATA_DIR vacío o solo espacios usa el default (igual que el CLI)', () => {
  assert.equal(resolveEngramDataDir({ ENGRAM_DATA_DIR: '' }), join(homedir(), '.engram'));
  assert.equal(resolveEngramDataDir({ ENGRAM_DATA_DIR: '   ' }), join(homedir(), '.engram'));
});

test('ENGRAM_DATA_DIR explícito se resuelve como base del store', () => {
  const dir = join(process.cwd(), '.engram-data');
  assert.equal(resolveEngramDataDir({ ENGRAM_DATA_DIR: dir }), resolve(dir));
  assert.equal(resolveEngramDbPath({ ENGRAM_DATA_DIR: dir }), join(resolve(dir), 'engram.db'));
});
