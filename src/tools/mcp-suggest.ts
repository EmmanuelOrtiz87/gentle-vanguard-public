#!/usr/bin/env node
/**
 * mcp-suggest.ts — que servidor MCP uso para esta tarea?
 *
 * POR QUE (2026-11-18)
 * -------------------------------------------------------------------------
 * El stack tiene 16 servidores MCP declarados, pero un agente nuevo (o un
 * subagente) no sabe cual usar para que tarea. Peor: la unica forma de
 * averiguarlo era precargar el servidor y leer su esquema. Para `rea` eso son
 * 170 tools y ~109k tokens de contexto por turno: 12x todo lo precargado.
 *
 * El mapa de demanda (`config/mcp-demand-map.json`) declara, por intencion de
 * tarea, QUE SERVIDOR y QUE TOOL la resuelven. Este comando es el que lo
 * consulta y devuelve la instruccion ACCIONABLE:
 *
 *   npm run mcp:suggest -- "analizar un apk"
 *     -> rea (a demanda) via: npm run mcp:call -- --server rea --tool open_binary
 *
 * REGLAS
 *   - El COMANDO sale siempre del registro canonico (`config/mcp-registry.json`)
 *     o del canon del repo (`.mcp.json`). El mapa no inventa comandos: si un
 *     servidor del mapa no se puede resolver, se dice (gate `--check`).
 *   - La respuesta declara el MODO: `precargado` (ya esta en el contexto del
 *     host, no hay que hacer nada) o `a demanda` (hay que ir por el puente).
 *   - Un servidor apagado por politica se declara como tal, con el motivo.
 *
 * USO
 *   npm run mcp:suggest -- "leer la documentacion de react"
 *   npm run mcp:suggest -- "cambios de alto impacto" --json
 *   npm run mcp:suggest -- --list
 *   npm run mcp:suggest -- --check     # invariantes (exit 1 si algo no cierra)
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { activationFor, loadPolicy, resolvePolicyKey } from '../mcp/mcp-policy.js';
import { resolveServer } from './mcp-call.js';

const ROOT = resolve(process.cwd());

export interface DemandIntent {
  id: string;
  task: string;
  keywords: string[];
  server: string;
  tools: string[];
  preloaded: boolean;
  note?: string;
  unavailable?: boolean;
  /**
   * Sonda de OPERABILIDAD: una llamada real, inocua y de solo lectura que
   * prueba que la capacidad sirve (no solo que existe). `{ROOT}` se expande
   * a la raiz del repo. Sin sonda, la capacidad no se puede verificar como
   * operable: es el cuarto eje (declarado -> alcanzable -> descubrible ->
   * operable) y el gate `mcp:probe` lo mide.
   */
  probe?: {
    tool: string;
    args?: Record<string, unknown>;
  };
}

export interface DemandMap {
  version: string;
  description: string;
  intents: DemandIntent[];
}

export interface Suggestion {
  id: string;
  task: string;
  server: string;
  tools: string[];
  mode: 'precargado' | 'a-demanda' | 'apagado-por-politica' | 'no-resoluble';
  score: number;
  matched: string[];
  command?: string;
  note?: string;
}

export function loadDemandMap(root = ROOT): DemandMap {
  const path = join(root, 'config', 'mcp-demand-map.json');
  if (!existsSync(path)) return { version: '0', description: '', intents: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as DemandMap;
    return { ...parsed, intents: Array.isArray(parsed.intents) ? parsed.intents : [] };
  } catch {
    return { version: '0', description: '', intents: [] };
  }
}

/**
 * Normaliza texto para comparar: sin acentos, sin mayusculas, sin puntuacion.
 * `analizar un APK` y `ANALIZAR UN APK` tienen que matchear lo mismo.
 */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Puntua una intencion contra la consulta.
 *
 * El score NO es un modelo: es conteo explicito de señales, para que el
 * resultado sea auditable. Un numero magico sin explicación no se puede
 * depurar cuando el agente elige mal.
 *
 * EL MATCH ES POR TOKEN COMPLETO, no por subcadena: `rea` esta dentro de
 * `react`, y con subcadena "leer la documentacion de react" puntuaba 10 para
 * rea (medido) cuando la intencion correcta es context7. Un nombre de servidor
 * de 3 letras no puede matchear dentro de otra palabra.
 */
export function scoreIntent(
  intent: DemandIntent,
  query: string,
): { score: number; matched: string[] } {
  const tokens = normalize(query).split(' ').filter(Boolean);
  const matched: string[] = [];
  let score = 0;

  /** Match por token completo; las frases multi-palabra exigen consecutividad. */
  const phraseHit = (phrase: string): boolean => {
    const parts = normalize(phrase).split(' ').filter(Boolean);
    if (parts.length === 0) return false;
    if (parts.length === 1) return tokens.includes(parts[0]);
    for (let i = 0; i + parts.length <= tokens.length; i++) {
      if (parts.every((part, index) => tokens[i + index] === part)) return true;
    }
    return false;
  };

  // 1. Match de la tarea: la señal mas fuerte.
  const taskWords = normalize(intent.task)
    .split(' ')
    .filter((word) => word.length > 4);
  const taskHits = taskWords.filter((word) => tokens.includes(word)).length;
  if (taskHits > 0) {
    score += taskHits * 3;
    matched.push(`tarea:${taskHits} token(s)`);
  }

  // 2. Keywords explicitas: la señal que el mapa declara a proposito.
  for (const keyword of intent.keywords) {
    if (phraseHit(keyword)) {
      score += 6;
      matched.push(keyword);
    }
  }

  // 3. Match del nombre del servidor: si el owner nombra el server, gana.
  if (phraseHit(intent.server)) {
    score += 10;
    matched.push(`servidor:${intent.server}`);
  }

  // 4. Match de una tool concreta: señal de que se sabe lo que se busca.
  for (const tool of intent.tools) {
    if (phraseHit(tool)) {
      score += 4;
      matched.push(`tool:${tool}`);
      break;
    }
  }

  return { score, matched };
}

/** Modo de uso segun la politica: precargado, a demanda o apagado. */
export function modeFor(server: string, preloadedInMap: boolean, root = ROOT): Suggestion['mode'] {
  const policy = loadPolicy(root);
  const activation = activationFor(policy, server, 'repo');
  if (activation === 'disabled-by-policy') return 'apagado-por-politica';
  // Precargado = la politica lo declara always-on en la superficie repo.
  if (activation === 'always-on') return 'precargado';
  if (preloadedInMap) return 'precargado';
  return 'a-demanda';
}

/** Sugerencias ordenadas para una consulta en lenguaje natural. */
export function suggest(query: string, root = ROOT): Suggestion[] {
  const map = loadDemandMap(root);
  const out: Suggestion[] = [];
  for (const intent of map.intents) {
    const { score, matched } = scoreIntent(intent, query);
    if (score <= 0) continue;
    const resolvable = Boolean(resolveServer(intent.server, root));
    const mode = resolvable ? modeFor(intent.server, intent.preloaded, root) : 'no-resoluble';
    const suggestion: Suggestion = {
      id: intent.id,
      task: intent.task,
      server: intent.server,
      tools: intent.tools,
      mode,
      score,
      matched,
      note: intent.note,
    };
    if (mode === 'a-demanda') {
      suggestion.command = `npm run mcp:call -- --server ${intent.server} --tool ${intent.tools[0]}`;
    } else if (mode === 'no-resoluble') {
      suggestion.note = `no hay entrada canonica para "${intent.server}" en el registro ni en .mcp.json: el mapa declara una capacidad que el stack no puede lanzar`;
    }
    out.push(suggestion);
  }
  return out.sort((a, b) => b.score - a.score || a.server.localeCompare(b.server));
}

export interface CheckResult {
  ok: boolean;
  intents: number;
  problems: string[];
}

/**
 * Invariantes del mapa de demanda.
 *
 *   1. Todo servidor del mapa se puede LANZAR (registro o canon): un mapa que
 *      declara una capacidad inalcanzable es un mapa que miente.
 *   2. Todo servidor declarado en la POLITICA aparece en el mapa: una
 *      capacidad del stack sin intencion declarada es capacidad no
 *      descubrible.
 *   3. Los nombres de servidor del mapa son los de la politica (no alias):
 *      si el mapa usa un alias, la resolucion por politica falla.
 */
export function checkDemandMap(root = ROOT): CheckResult {
  const map = loadDemandMap(root);
  const policy = loadPolicy(root);
  const problems: string[] = [];
  const mapped = new Set<string>();

  for (const intent of map.intents) {
    const spec = resolveServer(intent.server, root);
    if (!spec) {
      problems.push(
        `intencion "${intent.id}": el servidor "${intent.server}" no se resuelve (registro ni .mcp.json)`,
      );
    }
    if (mapped.has(intent.server)) {
      problems.push(
        `intencion "${intent.id}": el servidor "${intent.server}" esta duplicado en el mapa`,
      );
    }
    mapped.add(intent.server);
    if (intent.tools.length === 0) {
      problems.push(`intencion "${intent.id}": no declara tools`);
    }
    if (!intent.probe?.tool) {
      problems.push(
        `intencion "${intent.id}": no declara sonda de operabilidad (probe.tool): sin ella no se puede verificar que la capacidad SIRVE`,
      );
    }
  }

  for (const server of Object.keys(policy.servers)) {
    const key = resolvePolicyKey(policy, server) ?? server;
    if (![...mapped].some((m) => m === server || m === key)) {
      problems.push(
        `el servidor "${server}" esta en la politica pero no tiene intencion en el mapa de demanda`,
      );
    }
  }

  return { ok: problems.length === 0, intents: map.intents.length, problems };
}

function main(): void {
  const asJson = process.argv.includes('--json');
  const asList = process.argv.includes('--list');
  const asCheck = process.argv.includes('--check');
  const query = process.argv
    .slice(2)
    .filter((a) => !a.startsWith('--'))
    .join(' ')
    .trim();

  if (asCheck) {
    const result = checkDemandMap();
    if (asJson) console.log(JSON.stringify(result, null, 2));
    else if (result.ok)
      console.log(`[mcp-suggest] OK — ${result.intents} intenciones, todas resolubles`);
    else {
      console.error(`[mcp-suggest] ${result.problems.length} problema(s):`);
      for (const problem of result.problems) console.error(`  - ${problem}`);
    }
    process.exit(result.ok ? 0 : 1);
  }

  if (asList) {
    const map = loadDemandMap();
    if (asJson) {
      console.log(JSON.stringify(map, null, 2));
    } else {
      console.log(`[mcp-suggest] mapa de demanda — ${map.intents.length} intenciones\n`);
      for (const intent of map.intents) {
        const mode = modeFor(intent.server, intent.preloaded);
        console.log(`  ${intent.id.padEnd(24)} ${intent.server.padEnd(24)} ${mode}`);
        console.log(`    ${intent.task}`);
      }
    }
    return;
  }

  if (!query) {
    console.error('uso: npm run mcp:suggest -- "<tarea>" [--json] | --list | --check');
    process.exit(2);
  }

  const suggestions = suggest(query);
  if (asJson) {
    console.log(JSON.stringify({ query, suggestions }, null, 2));
    return;
  }

  if (suggestions.length === 0) {
    console.log(`[mcp-suggest] sin coincidencia para "${query}".`);
    console.log('  Lista completa: npm run mcp:suggest -- --list');
    return;
  }

  console.log(`[mcp-suggest] "${query}" →\n`);
  for (const suggestion of suggestions.slice(0, 5)) {
    const modeLabel =
      suggestion.mode === 'precargado'
        ? 'PRECARGADO (ya en el contexto: no hacer nada)'
        : suggestion.mode === 'a-demanda'
          ? 'a demanda'
          : suggestion.mode === 'apagado-por-politica'
            ? 'APAGADO por politica'
            : 'NO RESOLUBLE';
    console.log(`  ${suggestion.server}  [${modeLabel}]  score=${suggestion.score}`);
    console.log(`    para: ${suggestion.task}`);
    console.log(`    tools: ${suggestion.tools.join(', ')}`);
    if (suggestion.command) console.log(`    ${suggestion.command}`);
    if (suggestion.note) console.log(`    nota: ${suggestion.note}`);
    console.log('');
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main();
}
