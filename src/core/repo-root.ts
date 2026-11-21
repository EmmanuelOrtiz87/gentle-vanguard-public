/**
 * repo-root.ts — Módulo compartido para resolver la raíz del repositorio
 *
 * Proporciona ROOT consistente sin importar desde qué directorio se ejecute el código.
 * Busca hacia arriba hasta encontrar un marcador de raíz (config/timeout-config.json).
 *
 * Usage:
 *   import { ROOT } from './core/repo-root';
 *   const configPath = join(ROOT, 'config', 'mi-config.json');
 */

import * as fs from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
import { resolve } from 'path';
import * as path from 'path';
import { log } from '../utils/logger.js';

const logger = log('REPO-ROOT');

/**
 * Busca la raíz del repositorio subiendo directorios hasta encontrar
 * config/timeout-config.json (marcador de raíz consistente).
 *
 * @returns {string} Ruta absoluta a la raíz del repositorio
 */
/**
 * Marcadores de raíz del repositorio, en orden de preferencia.
 * `config/orchestrator.json` es el canónico del stack; `timeout-config.json`
 * se mantiene como marcador legacy para installs parciales.
 */
const ROOT_MARKERS: ReadonlyArray<ReadonlyArray<string>> = [
  ['config', 'orchestrator.json'],
  ['config', 'timeout-config.json'],
];

/**
 * Sube desde `startDir` hasta encontrar un marcador de raíz.
 * @returns La ruta de la raíz, o null si no hay marcador hacia arriba.
 */
function walkUpForMarker(startDir: string): string | null {
  let current = resolve(startDir);
  while (true) {
    for (const marker of ROOT_MARKERS) {
      if (fs.existsSync(path.join(current, ...marker))) {
        return current;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Resuelve la raíz del repositorio.
 *
 * Orden de resolución:
 * 1. `GENTLE_VANGUARD_BASE_DIR` — declaración explícita del operador (misma
 *    variable que usa el resto del stack: launcher, Docker, web-crawler).
 * 2. Desde el propio módulo (`__dirname`) — determinista e independiente del cwd.
 *    Necesario para artefactos compilados: `dist/src/core/` sube a la raíz real
 *    porque `dist/` no contiene `config/orchestrator.json`.
 * 3. Desde `process.cwd()` — cubre el caso de un entrypoint externo al repo.
 * 4. Fallback: cwd, con warning (no debería pasar en producción).
 */
function findRepoRoot(): string {
  const declared = process.env.GENTLE_VANGUARD_BASE_DIR;
  if (declared && fs.existsSync(resolve(declared))) {
    return resolve(declared);
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));

  const fromModule = walkUpForMarker(moduleDir);
  if (fromModule) return fromModule;

  const fromCwd = walkUpForMarker(process.cwd());
  if (fromCwd) return fromCwd;

  logger.warn(
    `[REPO-ROOT] No se encontró marcador de raíz (${ROOT_MARKERS[0].join('/')}), usando cwd como fallback`,
  );
  return resolve(process.cwd());
}

/**
 * Raíz del repositorio Gentle-Vanguard.
 * Usar esta constante en lugar de resolve(process.cwd())
 */
export const ROOT = findRepoRoot();

/**
 * Helper para construir paths desde la raíz del repo.
 *
 * @param paths - Segmentos de path a unir
 * @returns {string} Ruta absoluta desde la raíz
 *
 * @example
 *   const configPath = repoPath('config', 'settings.json');
 *   // => '/workspace/config/settings.json'
 */
export function repoPath(...paths: string[]): string {
  return path.join(ROOT, ...paths);
}

// CLI para debugging
// @ts-ignore — check if this is the main module (ESM compatible)
const isMainModule =
  (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) ||
  process.argv[1]?.includes('repo-root');
if (isMainModule) {
  console.log(`[REPO-ROOT] ROOT: ${ROOT}`);
  console.log(`[REPO-ROOT] cwd: ${process.cwd()}`);
}
