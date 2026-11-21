/**
 * Uncommitted actor inventory (GB-2026-11-21 slice A3 — bitácora 2026-11-20).
 *
 * Fricción medida: actor paralelo sin créditos (MiniMax Code ×3) dejó obra sin
 * commit a mitad de noche en el worktree compartido — aparecieron cambios que
 * la sesión activa no hizo, detectados por el TREE-FENCE del prepush, no por
 * un paso de apertura. Clase: worktree compartido multi-herramienta con
 * créditos finitos — el inventario de actores y archivos ajenos sin commit
 * debe ser PASO DE APERTURA (como guard:snapshot), no un descubrimiento a
 * mitad de operación.
 *
 * Este step de autostart clasifica cada entrada de `git status --porcelain`
 * en dos grupos:
 *  - regenerable: artefactos que el propio stack regenera en cada sesión
 *    (.runtime/, .session/, rules/adaptive/, métricas, tokens, snapshots);
 *    su presencia es esperada y no es obra ajena.
 *  - ajeno: tracked modificado o untracked que NO es regenerable — posible
 *    obra de un actor paralelo o trabajo previo sin cerrar. Se lista con la
 *    ruta y el protocolo de recuperación probado (bitácora): inventario →
 *    intención → completar → commit atribuido → push.
 *
 * PASIVO por decisión de diseño (igual que apps-health-report): informa,
 * NUNCA borra ni hace stash — el guardrail de destrucción manda. Evidencia
 * JSON en .runtime/uncommitted-actor-inventory.json.
 *
 * Uso:
 *   npx tsx src/ops/uncommitted-actor-inventory.ts          # reporte
 *   npx tsx src/ops/uncommitted-actor-inventory.ts --json    # solo JSON
 */
import { runSync } from '../core/run-command.js';
import { resolve, join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';

export interface ActorEntry {
  path: string;
  state: 'modified' | 'untracked' | 'staged' | 'deleted';
}

export interface InventoryReport {
  generatedAt: string;
  branch: string;
  total: number;
  regenerables: ActorEntry[];
  foreign: ActorEntry[];
  foreignCount: number;
  note: string;
}

/** Prefijos/globs que el stack regenera por sí solo en cada sesión/autostart. */
const REGENERABLE_PREFIXES = [
  '.runtime/',
  '.session/',
  'rules/adaptive/', // auto-norm-learner.ts (autostart)
  'docs/sessions/metrics/', // token:monthly
  'reports/audits/', // token:efficiency
  'assets/tokens.json', // gv:tokens pipeline
  '.runtime/opencode/', // opencode-drift-heal
];
/** Archivos sueltos regenerables fuera de los prefijos. */
const REGENERABLE_FILES = new Set(['assets/tokens.json']);

export function classifyLine(line: string): ActorEntry | null {
  if (!line.trim()) return null;
  if (line.startsWith('## ')) return null; // línea de rama de git status -b
  const state3 = line.slice(0, 2); // formato porcelain: XY + espacio + path
  const path = line
    .slice(3)
    .trim()
    .replace(/^"(.*)"$/, '$1');
  if (!path) return null;
  const untracked = state3 === '??';
  const staged = state3[0] !== ' ' && state3[0] !== '?';
  const deleted = state3.includes('D');
  return {
    path,
    state: untracked ? 'untracked' : deleted ? 'deleted' : staged ? 'staged' : 'modified',
  };
}

export function isRegenerable(path: string): boolean {
  if (REGENERABLE_FILES.has(path)) return true;
  return REGENERABLE_PREFIXES.some(
    (p) => path.startsWith(p) || path.startsWith(p.replace(/\//g, '\\')),
  );
}

export function buildInventory(porcelain: string, branch: string): InventoryReport {
  const entries = porcelain
    .split(/\r?\n/)
    .map(classifyLine)
    .filter((e): e is ActorEntry => e !== null);
  const regenerables = entries.filter((e) => isRegenerable(e.path));
  const foreign = entries.filter((e) => !isRegenerable(e.path));
  return {
    generatedAt: new Date().toISOString(),
    branch,
    total: entries.length,
    regenerables,
    foreign,
    foreignCount: foreign.length,
    note:
      foreign.length > 0
        ? 'Archivos NO regenerables sin commit: posible obra de actor paralelo (otra herramienta con creditos finitos) o trabajo previo sin cerrar. Protocolo probado (bitacora 2026-11-20): inventario -> intencion -> completar -> commit atribuido -> push. NO borrar ni stash sin decision del owner (guardrail de destruccion).'
        : 'Arbol limpio salvo regenerables: sin obra ajena detectada.',
  };
}

async function main(): Promise<number> {
  const jsonOnly = process.argv.includes('--json');
  const status = runSync('git', ['status', '--porcelain', '-b'], { windowsHide: true });
  if (status.status !== 0) {
    console.error('uncommitted-actor-inventory: git status fallo');
    return 1;
  }
  const lines = (status.stdout || '').toString().split(/\r?\n/);
  const branchLine = lines.find((l) => l.startsWith('## '));
  const branch = branchLine ? branchLine.slice(3).split('...')[0].trim() : 'unknown';
  const porcelain = lines.filter((l) => l && !l.startsWith('## ')).join('\n');
  const report = buildInventory(porcelain, branch);

  const outDir = join(process.cwd(), '.runtime');
  try {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'uncommitted-actor-inventory.json'),
      JSON.stringify(report, null, 2),
    );
  } catch {
    // best-effort: la evidencia no bloquea
  }

  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  console.error(
    `[actors] rama ${report.branch}: ${report.total} entradas — ${report.foreignCount} ajena(s) sin commit, ${report.regenerables.length} regenerable(s)`,
  );
  for (const f of report.foreign.slice(0, 12)) {
    console.error(`[actors]   ajeno (${f.state}): ${f.path}`);
  }
  if (report.foreignCount > 12) console.error(`[actors]   … y ${report.foreignCount - 12} mas`);
  console.error(`[actors] ${report.note}`);
  console.error(`[actors] evidencia: .runtime/uncommitted-actor-inventory.json`);
  return 0;
}

// CLI Guard pattern (normalizado para rutas Windows)
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename ?? process.argv[1])
) {
  main()
    .then((code) => process.exit(code))
    .catch(() => process.exit(1));
}
