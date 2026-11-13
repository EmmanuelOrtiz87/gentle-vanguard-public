#!/usr/bin/env node
/**
 * rea-toggle.ts — Control de activación selectiva de REA MCP en OpenCode.
 *
 * REA expone 134 herramientas MCP. Mantenerlo habilitado por defecto inyecta
 * ~40.000 tokens de esquemas JSON en cada llamada al modelo, lo que acelera el
 * consumo de cuota en tareas cotidianas de desarrollo.
 *
 * Uso:
 *   npx tsx src/integrations/rea-toggle.ts status
 *   npx tsx src/integrations/rea-toggle.ts enable
 *   npx tsx src/integrations/rea-toggle.ts disable
 *   npx tsx src/integrations/rea-toggle.ts toggle
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function getOpenCodeConfigPath(): string {
  return join(homedir(), '.config', 'opencode', 'opencode.json');
}

export function toggleRea(action?: 'enable' | 'disable' | 'toggle' | 'status'): boolean {
  const p = getOpenCodeConfigPath();
  if (!existsSync(p)) {
    console.error(`[rea-toggle] Config de OpenCode no encontrada en ${p}`);
    return false;
  }

  const raw = readFileSync(p, 'utf8');
  let config: { mcp?: Record<string, { enabled?: boolean; [k: string]: unknown }> };
  try {
    config = JSON.parse(raw);
  } catch (err) {
    console.error(
      `[rea-toggle] Error al parsear ${p}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }

  if (!config.mcp || !config.mcp.rea) {
    console.log('[rea-toggle] El servidor MCP rea no está configurado en OpenCode.');
    return false;
  }

  const currentlyEnabled = Boolean(config.mcp.rea.enabled);

  if (action === 'status' || !action) {
    console.log(
      `[rea-toggle] Estado de REA MCP en OpenCode: ${currentlyEnabled ? 'HABILITADO (134 tools activas)' : 'DESHABILITADO (ahorro de ~40k tokens/turno)'}`,
    );
    return currentlyEnabled;
  }

  let nextState = currentlyEnabled;
  if (action === 'enable') nextState = true;
  else if (action === 'disable') nextState = false;
  else if (action === 'toggle') nextState = !currentlyEnabled;

  config.mcp.rea.enabled = nextState;
  writeFileSync(p, JSON.stringify(config, null, 2), 'utf8');

  console.log(
    `[rea-toggle] REA MCP en OpenCode ahora está: ${nextState ? 'HABILITADO (134 tools activas para ingeniería inversa)' : 'DESHABILITADO (modo desarrollo óptimo, ahorro de tokens)'}`,
  );
  return nextState;
}

const arg = process.argv[2] as 'enable' | 'disable' | 'toggle' | 'status' | undefined;
toggleRea(arg || 'status');
