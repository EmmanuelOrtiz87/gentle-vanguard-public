#!/usr/bin/env node
/**
 * rea-toggle.ts — Control de activación selectiva de REA MCP.
 *
 * POR QUE (2026-11-18)
 * -------------------------------------------------------------------------
 * La version anterior leia `config.mcp.rea` del opencode.json, pero OpenCode
 * guarda los servers en `config.mcp.servers.rea`: el toggle NUNCA funciono y
 * `rea:status` respondia "el servidor MCP rea no esta configurado" con el
 * server declarado y activo. Un toggle que no togglea es peor que no tenerlo.
 *
 * Ademas la politica de ciclo de vida declara `rea: on-demand` (es heavyweight:
 * node + Java/Ghidra, 229 tools, ~40k tokens de esquema por turno) y el estado
 * real no se podia verificar en ninguna superficie.
 *
 * Ahora el estado se lee del CENSO (src/tools/mcp-lifecycle.ts), que recorre
 * todas las superficies y mide el uso real con el detector calibrado.
 *
 * USO
 *   npx tsx src/integrations/rea-toggle.ts status
 *   npx tsx src/integrations/rea-toggle.ts enable
 *   npx tsx src/integrations/rea-toggle.ts disable
 *   npx tsx src/integrations/rea-toggle.ts toggle
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildCensus } from '../tools/mcp-lifecycle.js';

const SERVER = 'rea';

function openCodePath(): string {
  return join(homedir(), '.config', 'opencode', 'opencode.json');
}

/** Estado real de rea en cada superficie, leido del censo. */
export function reaStatus(root = resolve(process.cwd())): {
  surfaces: Array<{ surface: string; state: string }>;
  usage: { invocations: number; lastHitAt: string | null };
} {
  const census = buildCensus(root, homedir());
  const row = census.servers.find((s) => s.aliases.includes(SERVER));
  return {
    surfaces: row?.surfaces ?? [],
    usage: row?.usage ?? { invocations: 0, lastHitAt: null },
  };
}

/**
 * Activa o desactiva rea en el host de OpenCode (su superficie historica).
 * Con `enabled: false` el server sigue declarado pero no se levanta al iniciar
 * sesion: es el mecanismo "a demanda" que ya usaba opencode.
 */
export function toggleRea(action?: 'enable' | 'disable' | 'toggle' | 'status'): boolean {
  const status = reaStatus();
  const states = status.surfaces.map((s) => `${s.surface}=${s.state}`);
  const enabled = status.surfaces.some((s) => s.state === 'present-enabled');

  if (action === 'status' || !action) {
    console.log(`[rea-toggle] REA MCP — superficies: ${states.join(' · ') || 'sin superficies'}`);
    console.log(
      `[rea-toggle] uso medido: ${status.usage.invocations} invocacion(es)${status.usage.lastHitAt ? ` · ultimo ${status.usage.lastHitAt.slice(0, 10)}` : ''}`,
    );
    console.log(
      '[rea-toggle] politica: on-demand (heavyweight: node + Java/Ghidra, ~40k tokens de esquema por turno)',
    );
    return enabled;
  }

  const p = openCodePath();
  if (!existsSync(p)) {
    console.error(`[rea-toggle] Config de OpenCode no encontrada en ${p}`);
    return false;
  }
  const raw = readFileSync(p, 'utf-8');
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    console.error(
      `[rea-toggle] Error al parsear ${p}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
  const mcp = (config.mcp ?? {}) as Record<string, unknown>;
  const servers = (mcp.servers ?? {}) as Record<string, Record<string, unknown>>;
  if (!servers[SERVER]) {
    console.log(
      '[rea-toggle] El servidor MCP rea no esta configurado en OpenCode (mcp.servers.rea).',
    );
    return false;
  }

  let nextState = enabled;
  if (action === 'enable') nextState = true;
  else if (action === 'disable') nextState = false;
  else if (action === 'toggle') nextState = !enabled;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  copyFileSync(p, `${p}.bak-${stamp}`);
  servers[SERVER].enabled = nextState;
  config.mcp = { ...mcp, servers };
  writeFileSync(p, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
  console.log(
    `[rea-toggle] REA MCP en OpenCode ahora esta: ${nextState ? 'HABILITADO' : 'DESHABILITADO (a demanda)'}`,
  );
  console.log(`[rea-toggle] backup: ${p}.bak-${stamp}`);
  return nextState;
}

const arg = process.argv[2] as 'enable' | 'disable' | 'toggle' | 'status' | undefined;
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  toggleRea(arg || 'status');
}
