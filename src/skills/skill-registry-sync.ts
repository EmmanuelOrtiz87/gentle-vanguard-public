#!/usr/bin/env node

/**
 * skill-registry-sync.ts — registro automático de skills.
 *
 * POR QUÉ EXISTE (2026-11-25)
 * -------------------------------------------------------------------------
 * `.atl/skill-registry.md` es DERIVADO (gitignored) y lo leen ~12 módulos
 * (embedder, router, MCP server, dashboard, evolution engine). El stack sabía
 * repararlo cuando FALTABA (`ensureSkillRegistry`) pero no cuando quedaba
 * VIEJO: agregar una skill, cambiar sus triggers o cambiar su mapeo a agente
 * en `config/auto-delegation.json` dejaba el registro desactualizado en
 * silencio, y con él el índice y los consumidores que dependen de él.
 *
 * Este comando es la pieza que hace el registro AUTOMÁTICO:
 *   - compara el catálogo real en disco contra el fingerprint estampado en el
 *     registro y lo reconstruye si difiere (alta, baja, triggers o agente);
 *   - `--check` no escribe: responde "¿está fresco?" con exit code (para gates);
 *   - lo corren el autostart (antes del scan de métricas de skills) y los
 *     embedders (incremental y full), así cualquier ajuste del canon de skills
 *     se registra solo, sin comando manual.
 *
 * NO decide nada sobre skills: no crea, borra ni edita SKILL.md. Sólo
 * regenera el índice derivado desde las fuentes de verdad.
 *
 * USO
 *   node --import tsx src/skills/skill-registry-sync.ts            # sincroniza
 *   node --import tsx src/skills/skill-registry-sync.ts --check    # exit 1 si stale
 *   node --import tsx src/skills/skill-registry-sync.ts --json
 */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { syncSkillRegistry, type RegistrySyncResult } from './skill-registry-builder.js';

export function describeSync(result: RegistrySyncResult): string {
  const delta: string[] = [];
  if (result.added.length > 0) delta.push(`+${result.added.length}`);
  if (result.removed.length > 0) delta.push(`-${result.removed.length}`);
  const suffix = delta.length > 0 ? ` (${delta.join(' / ')} skills)` : '';
  if (result.reason === 'up-to-date') return `[OK] Registro de skills al día (${result.skills} skills)`;
  const verb = result.reason === 'missing' ? 'creado' : 'resincronizado';
  return `[OK] Registro de skills ${verb}: ${result.skills} skills${suffix}`;
}

function main(): void {
  const argv = process.argv.slice(2);
  const check = argv.includes('--check');
  const asJson = argv.includes('--json');
  const quiet = argv.includes('--quiet');
  const root = resolve(import.meta.dirname, '..', '..');
  const result = syncSkillRegistry({ projectRoot: root, write: !check });

  if (asJson) {
    console.log(JSON.stringify({ ...result, check }, null, 2));
  } else if (!quiet) {
    if (check && result.changed) {
      console.log(
        `[STALE] Registro de skills desactualizado (${result.reason}): ${result.skills} skills en disco${describeDelta(result)}`,
      );
      console.log('  FIX: npm run skills:registry:sync');
    } else {
      console.log(describeSync(result));
      if (result.changed) console.log(`  ${describeDelta(result).trim() || 'fingerprint distinto'}`);
    }
  }

  if (check && result.changed) process.exitCode = 1;
}

function describeDelta(result: RegistrySyncResult): string {
  const parts: string[] = [];
  if (result.added.length > 0) {
    parts.push(`nuevas: ${result.added.slice(0, 8).join(', ')}${result.added.length > 8 ? ` … (+${result.added.length - 8})` : ''}`);
  }
  if (result.removed.length > 0) {
    parts.push(`retiradas: ${result.removed.slice(0, 8).join(', ')}${result.removed.length > 8 ? ` … (+${result.removed.length - 8})` : ''}`);
  }
  return parts.join(' · ');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
