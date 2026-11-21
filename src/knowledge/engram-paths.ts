/**
 * Resolución de rutas del store de Engram.
 *
 * El store real vive en `ENGRAM_DATA_DIR` o `~/.engram/engram.db` (272 MB con
 * WAL al 2026-11-18); `.engram/` en el repo es solo el directorio de export de
 * chunks. Los scripts heredados asumían `<repo>/.engram-data/engram.db`, una
 * ruta que no existe: backup y sync reportaban éxito sin tocar la base.
 */
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function resolveEngramDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.ENGRAM_DATA_DIR?.trim();
  return configured ? resolve(configured) : join(homedir(), '.engram');
}

export function resolveEngramDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveEngramDataDir(env), 'engram.db');
}
