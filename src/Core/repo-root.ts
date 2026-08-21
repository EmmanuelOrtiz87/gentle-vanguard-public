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
import { pathToFileURL } from 'url';
import { resolve } from 'path';
import * as path from 'path';

/**
 * Busca la raíz del repositorio subiendo directorios hasta encontrar
 * config/timeout-config.json (marcador de raíz consistente).
 *
 * @returns {string} Ruta absoluta a la raíz del repositorio
 */
function findRepoRoot(): string {
  let current = resolve(process.cwd());

  // Busca hacia arriba hasta encontrar config/timeout-config.json
  while (current !== path.dirname(current)) {
    const configPath = path.join(current, 'config', 'timeout-config.json');
    if (fs.existsSync(configPath)) {
      return current;
    }
    current = path.dirname(current);
  }

  // Fallback: usa cwd si no encontramos el repo (debería no pasar en producción)
  console.warn(
    '[REPO-ROOT] No se encontró marcador de raíz (config/timeout-config.json), usando cwd como fallback',
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
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href || process.argv[1]?.includes('repo-root');
if (isMainModule) {
  console.log(`[REPO-ROOT] ROOT: ${ROOT}`);
  console.log(`[REPO-ROOT] cwd: ${process.cwd()}`);
}
