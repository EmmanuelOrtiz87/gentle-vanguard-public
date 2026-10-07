#!/usr/bin/env tsx
/**
 * route-change.ts — Auto-routing: detecta que paths cambio en un commit/range
 * y sugiere a DONDE debe sincronizarse.
 *
 * Tres destinos:
 *   - stack   (no sync): cambios internos al stack privado (src/, .lefthook.yml, etc.)
 *   - landing (sync -> gentlevanguard): cambios en apps/academy-landing/**
 *   - public-mirror (sync -> emmanuel-public legacy): cambios en docs/, LICENSE, etc.
 *   - apps-violation (warning ADR-0017): cambios en apps/<otro>/** (deberian quedarse en privado)
 *
 * Uso:
 *   npx tsx src/ops/route-change.ts                # analiza HEAD vs HEAD~1
 *   npx tsx src/ops/route-change.ts --staged       # analiza archivos staged
 *   npx tsx src/ops/route-change.ts --ref <sha>    # analiza cambios en <sha> vs <sha>~1
 *   npx tsx src/ops/route-change.ts --json         # output en JSON
 *
 * Exit codes:
 *   0 = ruta identificada (puede haber warnings)
 *   1 = no se pudo determinar / error
 *   2 = violacion ADR-0017 (apps/<otro>/** cambiado)
 */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const args = process.argv.slice(2);

type Route = 'stack' | 'landing' | 'public-mirror' | 'apps-violation' | 'mixed' | 'unknown';

interface RoutingResult {
  route: Route;
  changedFiles: string[];
  suggestion: string;
  warning?: string;
}

function log(icon: string, msg: string): void {
  console.log(`${icon} ${msg}`);
}

function getChangedFiles(): string[] {
  let cmd: string[];
  if (args.includes('--staged')) {
    cmd = ['diff', '--cached', '--name-only'];
  } else if (args.includes('--ref')) {
    const refIdx = args.indexOf('--ref');
    const ref = args[refIdx + 1];
    if (!ref) return [];
    cmd = ['diff', '--name-only', `${ref}~1`, ref];
  } else {
    // Default: HEAD vs HEAD~1
    cmd = ['diff', '--name-only', 'HEAD~1', 'HEAD'];
  }
  const r = spawnSync('git', cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  if (r.status !== 0) return [];
  return (r.stdout ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
}

function route(files: string[]): RoutingResult {
  const hasLanding = files.some((f) => f.startsWith('apps/academy-landing/'));
  const hasOtherApp = files.some((f) => /^apps\/[^/]+\//.test(f) && !f.startsWith('apps/academy-landing/'));
  const hasPublicMirrorPath = files.some((f) =>
    /^(docs\/|demos\/|LICENSE|CONTRIBUTING\.md|SECURITY\.md|CHANGELOG\.md|README-PUBLIC\.md|gentle-vanguard-presentation\.html|build\/public\/|skills\/SKILL_INDEX\.md|config\/.*\.example\.json|config\/README\.md)/.test(f),
  );
  const hasStackInternal = files.some((f) => f.startsWith('src/') || f.startsWith('.github/') || f.startsWith('config/'));

  // Estrategia 2026-09-20: TODAS las apps viven en apps/ del repo privado y se
  // commitean acá (se eliminó la regla previa ADR-0017 de "apps no cruzan").
  // La frontera real está en sync-to-public.ts (borra apps/ al sincronizar) y en
  // el instalador (payload.ts excluye apps/). Ya NO bloquea el push.
  if (hasOtherApp) {
    return {
      route: 'stack',
      changedFiles: files,
      suggestion: 'STACK: apps/ se committea en el repo privado (estrategia 2026-09-20). sync-to-public excluye apps/ automáticamente.',
      warning: `Apps tocadas: ${files.filter((f) => /^apps\/[^/]+\//.test(f)).join(',')}`,
    };
  }

  // Landing changes → sync a gentlevanguard
  if (hasLanding && !hasPublicMirrorPath) {
    return {
      route: 'landing',
      changedFiles: files,
      suggestion: 'SYNC LANDING: npx tsx src/ops/sync-landing-gentlevanguard.ts',
    };
  }

  // Public mirror paths → sync legacy
  if (hasPublicMirrorPath && !hasLanding) {
    return {
      route: 'public-mirror',
      changedFiles: files,
      suggestion: 'SYNC PUBLIC (legacy): workflow sync-public.yml se dispara automaticamente (si los paths matchean).',
    };
  }

  // Mixto
  if (hasLanding && hasPublicMirrorPath) {
    return {
      route: 'mixed',
      changedFiles: files,
      suggestion: 'SYNC BOTH: landing -> gentlevanguard, public-mirror -> emmanuel-public (legacy).',
    };
  }

  // Solo stack
  if (hasStackInternal && !hasLanding && !hasPublicMirrorPath) {
    return {
      route: 'stack',
      changedFiles: files,
      suggestion: 'STACK: no requiere sync. Cambio interno del stack privado.',
    };
  }

  return {
    route: 'unknown',
    changedFiles: files,
    suggestion: 'UNKNOWN: revisar manualmente',
  };
}

function main(): number {
  const files = getChangedFiles();
  if (files.length === 0) {
    log('?', 'Sin cambios detectados (verifica --staged o --ref)');
    return 1;
  }

  const result = route(files);

  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  const icon = { stack: '📦', landing: '🌐', 'public-mirror': '📤', 'apps-violation': '⛔', mixed: '🔀', unknown: '?' }[result.route];

  console.log('');
  console.log(`${icon}  Route: ${result.route.toUpperCase()}`);
  console.log(`   Files: ${files.length}`);
  if (files.length <= 8) {
    for (const f of files) console.log(`     - ${f}`);
  } else {
    for (const f of files.slice(0, 5)) console.log(`     - ${f}`);
    console.log(`     ... +${files.length - 5} mas`);
  }
  console.log(`   → ${result.suggestion}`);
  if (result.warning) {
    console.log('');
    console.log(`   ⚠️  ${result.warning}`);
  }
  console.log('');

  return 0;
}

main();
