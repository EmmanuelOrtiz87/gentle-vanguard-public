#!/usr/bin/env node
/**
 * Refresh semanal del grafo nativo de graphify (Ast, sin LLM) + gate de regresion.
 *
 * Por que existe (2026-11-18): `graphify-out/graph.json` estaba 8 dias
 * congelado mientras `config/agent-prompts/CODEGRAPH.md` lo declaraba
 * "source of truth" y solo el hook PostToolUse de ZCode lo actualizaba (las
 * demas herramientas no pasan por el). Nadie consumia su frescura.
 *
 * Cadencia: lazy step del autostart con umbral de 7 dias — no reconstruye en
 * cada sesion (el build es barato pero innecesario), y se recupera solo si el
 * grafo quedo viejo o ausente.
 *
 * Gate de regresion (2026-11-19): reconstruir sin medir el resultado convierte
 * un build parcial en "grafo fresco" — un grafo sano tiene miles de nodos y
 * perder >20% es sintoma de un parser roto o de un build que salteo archivos.
 * Se compara contra el ultimo baseline bueno (`.runtime/graphify/graph-baseline.json`)
 * y la caida solo emite WARN: no bloquea ni regenera el baseline, asi el
 * proximo build sigue comparandose contra el ultimo tamano sano.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runSync } from '../core/run-command.js';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const GRAPH_PATH = join(ROOT, 'graphify-out', 'graph.json');
const BASELINE_PATH = join(ROOT, '.runtime', 'graphify', 'graph-baseline.json');
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const BUILD_TIMEOUT_MS = 180_000;

/** Caida de nodos que se considera regresion (no ruido de refactor). */
export const REGRESSION_RATIO = 0.2;
/** Por debajo de este tamano la proporcion no es significativa. */
export const REGRESSION_MIN_NODES = 50;

const asJson = process.argv.slice(2).includes('--json');

export interface GraphStats {
  nodes: number;
  links: number;
}

export interface GraphBaseline extends GraphStats {
  measuredAt: string;
}

function result(status: string, message: string, data: Record<string, unknown> = {}): void {
  const ts = new Date().toISOString().slice(0, 19);
  if (asJson) console.log(JSON.stringify({ status, message, timestamp: ts, ...data }));
  else console.log(`[${status}] ${message}`);
}

export function readGraphStats(path = GRAPH_PATH): GraphStats | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as {
      nodes?: unknown;
      links?: unknown;
      edges?: unknown;
    };
    if (!Array.isArray(parsed.nodes)) return null;
    const links = Array.isArray(parsed.links)
      ? parsed.links.length
      : Array.isArray(parsed.edges)
        ? parsed.edges.length
        : 0;
    return { nodes: parsed.nodes.length, links };
  } catch {
    return null;
  }
}

export function readBaseline(path = BASELINE_PATH): GraphBaseline | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<GraphBaseline>;
    if (typeof parsed.nodes !== 'number' || !Number.isFinite(parsed.nodes)) return null;
    return {
      nodes: parsed.nodes,
      links: typeof parsed.links === 'number' ? parsed.links : 0,
      measuredAt: typeof parsed.measuredAt === 'string' ? parsed.measuredAt : '',
    };
  } catch {
    return null;
  }
}

/**
 * Compara el grafo actual contra el ultimo baseline sano. Sin baseline la
 * primera medicion solo establece la referencia: no hay regresion que juzgar.
 */
export function evaluateGraphDelta(
  current: GraphStats,
  baseline: GraphBaseline | null,
  ratio = REGRESSION_RATIO,
  minNodes = REGRESSION_MIN_NODES,
): { regressed: boolean; dropPct: number; message: string } {
  if (!baseline || baseline.nodes < minNodes) {
    return {
      regressed: false,
      dropPct: 0,
      message: `sin baseline previo: ${current.nodes} nodos establecen la referencia`,
    };
  }
  const drop = (baseline.nodes - current.nodes) / baseline.nodes;
  const dropPct = Math.round(drop * 1000) / 10;
  if (drop > ratio) {
    return {
      regressed: true,
      dropPct,
      message: `grafo cayo ${dropPct}% (${baseline.nodes} -> ${current.nodes} nodos, umbral ${Math.round(ratio * 100)}%)`,
    };
  }
  return {
    regressed: false,
    dropPct,
    message: `${current.nodes} nodos (${dropPct >= 0 ? '-' : '+'}${Math.abs(dropPct)}% vs baseline)`,
  };
}

function writeBaseline(stats: GraphStats): void {
  const payload: GraphBaseline = { ...stats, measuredAt: new Date().toISOString() };
  mkdirSync(dirname(BASELINE_PATH), { recursive: true });
  writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + '\n');
}

function main(): void {
  const exists = existsSync(GRAPH_PATH);
  const ageMs = exists ? Date.now() - statSync(GRAPH_PATH).mtimeMs : Number.POSITIVE_INFINITY;
  const ageDays = exists ? Math.round((ageMs / 86_400_000) * 10) / 10 : null;

  if (exists && ageMs <= STALE_AFTER_MS) {
    result('OK', `graphify graph is fresh (${ageDays}d old)`, { action: 'fresh', ageDays });
  } else {
    const reason = exists ? `${ageDays}d old (threshold 7d)` : 'graph.json absent';
    try {
      const build = runSync(
        process.execPath,
        ['--import', 'tsx', join(ROOT, 'src', 'cli', 'graphify.ts'), 'build'],
        { cwd: ROOT, stdio: 'pipe', timeout: BUILD_TIMEOUT_MS },
      );
      if (build.error && build.status === null) throw build.error;
      if (build.status !== 0) {
        throw new Error(
          `build exited ${build.status}: ${String(build.stderr ?? '').slice(0, 200)}`,
        );
      }
      result('OK', `graphify graph rebuilt (${reason})`, { action: 'rebuilt', ageDays, reason });
    } catch (e) {
      result('WARN', `graphify rebuild failed: ${e instanceof Error ? e.message : String(e)}`, {
        action: 'rebuild_error',
        ageDays,
        reason,
      });
      return;
    }
  }

  const stats = readGraphStats();
  if (!stats) {
    result('WARN', 'graphify graph unreadable (graph.json sin nodes[])', { action: 'unreadable' });
    return;
  }
  const baseline = readBaseline();
  const delta = evaluateGraphDelta(stats, baseline);
  if (delta.regressed) {
    result('WARN', `graphify regression: ${delta.message}`, {
      action: 'regression',
      nodes: stats.nodes,
      baselineNodes: baseline?.nodes,
      dropPct: delta.dropPct,
    });
    return;
  }
  writeBaseline(stats);
  result('OK', `graphify stats: ${delta.message}`, {
    action: 'stats',
    nodes: stats.nodes,
    links: stats.links,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
