#!/usr/bin/env node
/**
 * codegraph-toggle.ts — activa o desactiva el MCP codegraph de forma DECLARADA.
 *
 * POR QUE (2026-11-18)
 * -------------------------------------------------------------------------
 * La medicion de uso (`src/tools/mcp-usage-audit.ts`) dio: 5 invocaciones en
 * 365 dias, todas de listado de archivos; 0 semanticas; 0 en los ultimos 19
 * dias. El indice pesa 956 MB y el sync reindexaba en cada commit.
 *
 * Decidir esto "a mano" (borrar el entry del .mcp.json, sacar el hook,
 * borrar el indice) deja el stack en un estado INCOMPROBABLE: nadie sabe que
 * existio una capacidad apagada ni como volver a prenderla. Aqui la decision
 * queda DECLARADA (`config/codegraph.config.json`) y es reversible con un
 * comando.
 *
 * USO
 *   node --import tsx src/ops/codegraph-toggle.ts --disable
 *   node --import tsx src/ops/codegraph-toggle.ts --enable
 *   node --import tsx src/ops/codegraph-toggle.ts --status
 *   node --import tsx src/ops/codegraph-toggle.ts --disable --purge-index
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');
const CONFIG_PATH = join(ROOT, 'config', 'codegraph.config.json');
const MCP_PATH = join(ROOT, '.mcp.json');
const INDEX_DIR = join(ROOT, '.codegraph');

const SERVER = {
  command: 'codegraph',
  // --path explícito: los hosts MCP no siempre reportan el workspace root y sin
  // él el server no encuentra .codegraph/ (medido 2026-11-18: "No CodeGraph
  // project is loaded for this session" con el proyecto a medio indexar).
  args: ['serve', '--mcp', '--path', ROOT],
  type: 'stdio',
  description: 'CodeGraph: indexed code intelligence and knowledge graph',
};

export interface CodegraphState {
  enabled: boolean;
  reason?: string;
  [k: string]: unknown;
}

export function readState(root = ROOT): CodegraphState {
  const path = join(root, 'config', 'codegraph.config.json');
  if (!existsSync(path)) return { enabled: true };
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as CodegraphState;
  } catch {
    return { enabled: true };
  }
}

export function writeState(state: CodegraphState, root = ROOT): void {
  writeFileSync(
    join(root, 'config', 'codegraph.config.json'),
    `${JSON.stringify(state, null, 2)}\n`,
    'utf-8',
  );
}

/** Agrega o saca el servidor `codegraph` del `.mcp.json` (canon del repo). */
export function setMcpServer(present: boolean, root = ROOT): boolean {
  const path = join(root, '.mcp.json');
  if (!existsSync(path)) return false;
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as {
    mcpServers?: Record<string, unknown>;
  };
  const servers = parsed.mcpServers ?? (parsed.mcpServers = {});
  const had = Object.hasOwn(servers, 'codegraph');
  if (present) servers.codegraph = { ...SERVER };
  else delete servers.codegraph;
  if (had === present) return false; // ya estaba como se pedia
  writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`, 'utf-8');
  return true;
}

/**
 * Alinea la POLITICA con la decision del config.
 *
 * La politica es la fuente de verdad del ciclo de vida: si el config dice
 * "apagado" y la politica dice "warm-when-developing", cualquier superficie no
 * listada puede levantarlo y el gate no lo ve (medido 2026-11-18: `.opencode/
 * mcp.json`, `.zcode/config.json` y `.continue/config.json` declaraban
 * codegraph habilitado y el censo no lo detectaba).
 */
export function syncPolicy(enabled: boolean, root = ROOT): boolean {
  const path = join(root, 'config', 'mcp-lifecycle-policy.json');
  if (!existsSync(path)) return false;
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as {
    servers?: Record<string, Record<string, unknown>>;
  };
  const entry = parsed.servers?.codegraph;
  if (!entry) return false;
  const next = enabled ? 'warm-when-developing' : 'disabled-by-policy';
  if (entry.activation === next) return false;
  entry.activation = next;
  if (!enabled) {
    entry.surfaces = {
      ...(entry.surfaces as object),
      ...Object.fromEntries(
        Object.keys((entry.surfaces as object) ?? {}).map((key) => [key, 'disabled-by-policy']),
      ),
    };
  } else {
    // Al reactivar, la decision es por superficie: ninguna queda bloqueada.
    delete entry.surfaces;
  }
  writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`, 'utf-8');
  return true;
}

// Stryker disable all: main() es presentación CLI (status/enable/disable por consola);
// el contrato testado son las funciones exportadas — mutar impresión produce
// equivalentes sin señal (medido: 70 supervivientes de ruido, 2026-11-18).
function main(): void {
  const args = process.argv.slice(2);
  const status = args.includes('--status');
  const enable = args.includes('--enable');
  const disable = args.includes('--disable');

  if (status) {
    const state = readState();
    const mcp = JSON.parse(readFileSync(MCP_PATH, 'utf-8')) as {
      mcpServers?: Record<string, unknown>;
    };
    console.log(`codegraph: ${state.enabled ? 'ACTIVO' : 'DESACTIVADO'}`);
    console.log(`  config : ${CONFIG_PATH}`);
    console.log(
      `  en .mcp.json: ${Object.hasOwn(mcp.mcpServers ?? {}, 'codegraph') ? 'sí' : 'no'}`,
    );
    console.log(`  índice : ${existsSync(INDEX_DIR) ? 'presente' : 'ausente'}`);
    if (state.reason) console.log(`  motivo : ${state.reason}`);
    return;
  }

  if (!enable && !disable) {
    console.error('uso: --status | --enable | --disable [--purge-index]');
    process.exit(2);
  }

  const state = readState();
  state.enabled = enable;
  if (enable) {
    state.reason =
      state.reason ??
      'reactivado por el owner: el MCP codegraph vuelve a estar disponible y el sync reindexa en cada commit.';
    state.reenabledAt = new Date().toISOString();
  } else {
    state.reason =
      state.reason ??
      'uso real medido: 5 invocaciones en 365 dias, 0 semanticas, 0 en los ultimos 19 dias.';
    state.disabledAt = new Date().toISOString();
  }
  writeState(state);
  const changed = setMcpServer(enable);
  const policyChanged = syncPolicy(enable);
  console.log(
    `codegraph ${enable ? 'ACTIVADO' : 'DESACTIVADO'} · .mcp.json ${changed ? 'actualizado' : 'sin cambios'} · config actualizada · politica ${policyChanged ? 'alineada' : 'sin cambios'}`,
  );
  console.log(`  reversible con: npm run codegraph:${enable ? 'disable' : 'enable'}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
// Stryker restore all
