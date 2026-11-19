#!/usr/bin/env node
/**
 * codegraph-remeasure — hace EJECUTABLE la re-medición comprometida al reactivar
 * CodeGraph (config/codegraph.config.json: reMeasureAt 2026-12-18).
 *
 * POR QUÉ (2026-11-18)
 * La reactivación dejó el compromiso escrito como texto: si las invocaciones
 * SEMÁNTICAS siguen ~0 con el wiring de adopción activo, se re-desactiva con el
 * experimento documentado. Un compromiso que solo vive en un JSON no se cumple;
 * este comando lo convierte en medición repetible.
 *
 * CLASIFICACIÓN (por nombre de tool, determinista)
 *   semantic   : context / search / impact / callers / callees / explore / node
 *                — las preguntas que justifican el índice (grep+read no las da).
 *   structural : files / status — listado; es lo único que se usó en 365 días
 *                antes del disable (5 usos), y NO justifica el índice.
 *
 * VEREDICTO
 *   - Antes de reMeasureAt: señal temprana, no decide.
 *   - En/tras reMeasureAt: semanticHits == 0 → recomendación de re-disable
 *     (exit 1 con --strict, para gates); > 0 → permanece con evidencia.
 *
 * USO
 *   node --import tsx src/ops/codegraph-remeasure.ts            # reporte
 *   node --import tsx src/ops/codegraph-remeasure.ts --json     # máquina
 *   node --import tsx src/ops/codegraph-remeasure.ts --strict   # exit 1 si toca re-disable
 *   node --import tsx src/ops/codegraph-remeasure.ts --record   # registra el veredicto en el config
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HOSTS, matchesServer, scanHost } from '../tools/mcp-usage-audit.js';

export const SEMANTIC_RE = /codegraph[_-]+(context|search|impact|callers|callees|explore|node)$/i;
export const STRUCTURAL_RE = /codegraph[_-]+(files|status)$/i;

export type ToolClass = 'semantic' | 'structural' | 'other';

export function classifyCodegraphTool(tool: string): ToolClass {
  if (SEMANTIC_RE.test(tool)) return 'semantic';
  if (STRUCTURAL_RE.test(tool)) return 'structural';
  return 'other';
}

/**
 * La raiz del repo se deriva del config, no del `process.cwd()`.
 *
 * Medido: el host "MCP bridge (stack)" escanea `<raiz>/.runtime/mcp-calls.jsonl`.
 * Con la raiz implicita (cwd), un fixture en un directorio temporal terminaba
 * escaneando el `.runtime` REAL del repo: el test dependia del estado de la
 * maquina y fallo con `structuralHits` 2 en vez de 1 (una invocacion real de
 * `codegraph_files` en el log del puente). Un test que depende de la maquina
 * no es un test: la raiz sigue al config.
 */
export function repoRootFrom(configPath: string): string {
  const dir = dirname(configPath);
  return basename(dir) === 'config' ? dirname(dir) : dir;
}

export interface RemeasureResult {
  since: string;
  until: string;
  reMeasureAt: string;
  decisionDue: boolean;
  semanticHits: number;
  structuralHits: number;
  lastSemanticAt: string | null;
  hostsUsingSemantic: string[];
  verdict: 'pendiente' | 'permanece' | 're-disable-recomendado';
  note: string;
}

export function remeasureCodegraph(
  configPath = join(process.cwd(), 'config', 'codegraph.config.json'),
  now = Date.now(),
  home = homedir(),
): RemeasureResult {
  if (!existsSync(configPath)) throw new Error(`config no encontrado: ${configPath}`);
  const config = JSON.parse(readFileSync(configPath, 'utf-8')) as {
    reenabledAt?: string;
    reMeasureAt?: string;
  };
  if (!config.reenabledAt || !config.reMeasureAt) {
    throw new Error('config sin reenabledAt/reMeasureAt: no hay compromiso que medir');
  }
  const since = Date.parse(config.reenabledAt);
  const reMeasure = Date.parse(config.reMeasureAt);
  let semantic = 0;
  let structural = 0;
  let lastSemantic = 0;
  const semanticHosts = new Set<string>();
  const matcher = matchesServer('codegraph');
  const repoRoot = repoRootFrom(configPath);
  for (const spec of HOSTS) {
    const { hits } = scanHost(spec, home, since, repoRoot);
    for (const [tool, info] of hits) {
      if (!matcher(tool)) continue;
      const kind = classifyCodegraphTool(tool);
      if (kind === 'semantic') {
        semantic += info.count;
        semanticHosts.add(spec.host);
        if (info.lastHit > lastSemantic) lastSemantic = info.lastHit;
      }
      if (kind === 'structural') structural += info.count;
    }
  }
  const decisionDue = now >= reMeasure;
  const verdict: RemeasureResult['verdict'] = decisionDue
    ? semantic === 0
      ? 're-disable-recomendado'
      : 'permanece'
    : 'pendiente';
  const note = decisionDue
    ? semantic === 0
      ? '0 invocaciones semanticas en el periodo del wiring activo — ejecutar npm run codegraph:disable (experimento documentado en el config).'
      : `${semantic} invocaciones semanticas con wiring activo — CodeGraph permanece con evidencia.`
    : `senal temprana (la decision es el ${config.reMeasureAt}): ${semantic} semanticas / ${structural} estructurales desde la reactivacion.`;
  return {
    since: new Date(since).toISOString(),
    until: new Date(now).toISOString(),
    reMeasureAt: config.reMeasureAt,
    decisionDue,
    semanticHits: semantic,
    structuralHits: structural,
    lastSemanticAt: lastSemantic ? new Date(lastSemantic).toISOString() : null,
    hostsUsingSemantic: [...semanticHosts].sort(),
    verdict,
    note,
  };
}

/**
 * Registra el veredicto en el config (protocolo del watchtower: el sub-check
 * `remeasure commitment` pasa cuando el config declara remeasureResolvedAt).
 */
export function recordOutcome(configPath: string, result: RemeasureResult): void {
  const config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
  config.remeasureResolvedAt = result.until;
  config.remeasureVerdict = result.verdict;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

// Stryker disable all: main() es presentación CLI (console.log + guard de ejecución);
// el contrato testado son las funciones exportadas — mutar formato de impresión
// produce equivalentes sin señal (medido: 65 supervivientes de ruido, 2026-11-18).
function main(): void {
  const json = process.argv.includes('--json');
  const strict = process.argv.includes('--strict');
  const record = process.argv.includes('--record');
  const configPath = join(process.cwd(), 'config', 'codegraph.config.json');
  const result = remeasureCodegraph(configPath);
  if (record && result.decisionDue) recordOutcome(configPath, result);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `codegraph re-measure · periodo ${result.since.slice(0, 10)} → ${result.until.slice(0, 10)} · decisión comprometida: ${result.reMeasureAt}`,
    );
    console.log(`  semánticas: ${result.semanticHits} · estructurales: ${result.structuralHits}`);
    if (result.lastSemanticAt) {
      console.log(
        `  última semántica: ${result.lastSemanticAt} · hosts: ${result.hostsUsingSemantic.join(', ') || '—'}`,
      );
    }
    console.log(`  veredicto: ${result.verdict}`);
    console.log(`  ${result.note}`);
  }
  if (strict && result.verdict === 're-disable-recomendado') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
// Stryker restore all
