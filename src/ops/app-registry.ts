#!/usr/bin/env node

/**
 * app-registry.ts — el registro ÚNICO de apps del stack.
 *
 * POR QUÉ EXISTE (2026-11-11)
 * -------------------------------------------------------------------------
 * Antes había cinco fuentes de verdad sobre "qué apps tiene el stack":
 *
 *   1. `apps/command-center/server.ts` → `APPS_REGISTRY` (27 entradas) +
 *      `definitions()` (26) — HARDCODEADO y POSICIONAL.
 *   2. Los `sandbox.config.ts` de cada carpeta de app (6 apps cliente) — el Sandbox.
 *   3. `src/core/watchtower/checks-apps.ts` → `EXPECTED_APPS` (26 ids).
 *   4. `src/tools/verify-native-design.ts` → `surfaces` (28 dirs).
 *   5. `deploy/cloud/scripts/validate-stack.ts` → parsea el server.ts con
 *      `text.split(/id:\s*'/)` (37 entradas: 10 corruptas por los `id:` que
 *      se re-declaran dentro de `definitions()`).
 *
 * Y las 6 apps de clientes estaban en el Command Center **y** en el Sandbox:
 * dos centros de comando compitiendo por el mismo cliente.
 *
 * AHORA: `config/apps.registry.json` es la fuente de verdad (identidad, scope,
 * puertos y scripts) y los dos centros lo CONSUMEN y lo FILTRAN:
 *
 *   - Command Center → scope `native` (apps del stack).
 *   - Sandbox        → scope `client` (apps, sistemas, bots y demos de
 *                      clientes).
 *
 * Un id no puede estar en los dos centros. El registro no reemplaza a los
 * `sandbox.config.ts`: ésos siguen siendo el adaptador de ACCIONES del
 * Sandbox, pero la identidad (id, nombre, puertos) sale del registro.
 *
 * USO
 *   node --import tsx src/ops/app-registry.ts           # tabla + validaciones
 *   node --import tsx src/ops/app-registry.ts --json
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** `native` = app del stack (Command Center). `client` = app de cliente (Sandbox). */
export type AppScope = 'native' | 'client';

export interface AppRegistryEntry {
  id: string;
  name: string;
  description: string;
  scope: AppScope;
  /** Carpeta de la app, relativa a la raíz del repo. */
  dir: string;
  /** URL de la interfaz (opcional: hay apps sin UI propia). */
  url?: string;
  /** Puertos que la app ocupa. */
  ports: number[];
  /** Script nativo de arranque, relativo a `dir`. */
  start?: string;
  /** Script nativo de parada, relativo a `dir`. */
  stop?: string;
  note?: string;
}

export interface AppRegistryFile {
  version: number;
  updatedAt?: string;
  apps: AppRegistryEntry[];
}

const ROOT = resolve(import.meta.dirname, '..', '..');

export function registryPath(root = ROOT): string {
  return join(root, 'config', 'apps.registry.json');
}

export function loadAppRegistry(root = ROOT): AppRegistryEntry[] {
  const file = registryPath(root);
  if (!existsSync(file)) throw new Error(`no existe el registro de apps: ${file}`);
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as AppRegistryFile;
  if (!Array.isArray(parsed.apps)) throw new Error(`registro de apps mal formado: ${file}`);
  return parsed.apps;
}

/** Vista del Command Center: las apps NATIVAS del stack. */
export function nativeApps(root = ROOT): AppRegistryEntry[] {
  return loadAppRegistry(root).filter((app) => app.scope === 'native');
}

/** Vista del Sandbox: las apps de CLIENTES (sistemas, bots, demos). */
export function clientApps(root = ROOT): AppRegistryEntry[] {
  return loadAppRegistry(root).filter((app) => app.scope === 'client');
}

/**
 * Valida el registro. Devuelve los ERRORES (strings). Un registro inválido es
 * un defecto: lo que no está declarado o está declarado dos veces, no compila.
 */
export function validateAppRegistry(entries: AppRegistryEntry[], root = ROOT): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const portOwner = new Map<number, string>();

  for (const app of entries) {
    if (!app.id) errors.push('una app no tiene id');
    if (ids.has(app.id)) errors.push(`id duplicado: ${app.id}`);
    ids.add(app.id);
    if (app.scope !== 'native' && app.scope !== 'client') {
      errors.push(`${app.id}: scope inválido (${String(app.scope)}) — use native|client`);
    }
    if (!app.dir) errors.push(`${app.id}: sin dir`);
    else if (!existsSync(join(root, app.dir)))
      errors.push(`${app.id}: la carpeta no existe (${app.dir})`);
    for (const port of app.ports ?? []) {
      const previous = portOwner.get(port);
      if (previous) errors.push(`puerto ${port} repetido: ${previous} y ${app.id}`);
      else portOwner.set(port, app.id);
    }
    for (const [field, script] of [
      ['start', app.start],
      ['stop', app.stop],
    ] as const) {
      if (!script) continue;
      if (!existsSync(join(root, app.dir, script))) {
        errors.push(`${app.id}: el script ${field} no existe (${app.dir}/${script})`);
      }
    }
  }
  return errors;
}

function main(): void {
  const argv = process.argv.slice(2);
  const entries = loadAppRegistry();
  const errors = validateAppRegistry(entries);
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ total: entries.length, errors, apps: entries }, null, 2));
    return;
  }
  console.log(
    `[app-registry] ${entries.length} apps · ${nativeApps().length} nativas · ${clientApps().length} de clientes`,
  );
  for (const app of entries) {
    console.log(
      `  ${app.scope === 'native' ? 'CC ' : 'SBX'} ${app.id.padEnd(28)} ${String(app.ports.join(',')).padEnd(12)} ${app.dir}`,
    );
  }
  for (const error of errors) console.log(`  ERROR: ${error}`);
  if (errors.length === 0) console.log('  OK: el registro es consistente');
  else process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
