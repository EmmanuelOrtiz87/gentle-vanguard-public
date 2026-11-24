#!/usr/bin/env node
/**
 * mcp-operability.ts — ¿cada capacidad declarada REALMENTE SIRVE?
 *
 * POR QUE (2026-11-18)
 * -------------------------------------------------------------------------
 * El stack tiene CUATRO ejes distintos para una capacidad, y hasta ahora
 * solo tres tenian verificacion:
 *
 *   1. DECLARADA    -> esta en la politica
 *   2. ALCANZABLE   -> hay un comando en el registro que la levanta
 *   3. DESCUBRIBLE  -> hay una intencion task -> servidor en el mapa
 *   4. OPERABLE     -> una llamada REAL devuelve el dato que promete
 *
 * El cuarto eje es el que importa al owner: "debemos poder operar con todas
 * las herramientas a disposicion". Medido 2026-11-18 antes de este modulo:
 * 14 de 16 respondian con dato real, `browse` fallaba porque su relay local
 * estaba parado (su modo MCP no lo auto-arranca, al contrario que los
 * comandos CLI relay-backed) y `mercadopago` respondia 401 (OAuth: el token
 * vive en el cliente, no es un fallo del stack).
 *
 * ESTA HERRAMIENTA NO ADIVINA: cada capacidad declara su sonda (tool + args
 * inocuas, de solo lectura) en `config/mcp-demand-map.json`, y el probe la
 * EJECUTA de verdad por el puente. La clasificacion distingue:
 *
 *   ok                 -> la tool respondio con dato
 *   ok-sin-dato        -> respondio bien, pero el conjunto esta vacio
 *   requiere-config    -> falta una credencial del owner (no es del stack)
 *   dependencia-caida  -> falta un servicio externo (el stack lo puede arreglar)
 *   intermitente       -> fallo UNICO: la segunda sonda respondio bien
 *   timeout            -> la sonda no termino a tiempo (no se puede afirmar nada)
 *   roto               -> fallo real Y reproducible (el stack lo tiene que arreglar)
 *
 * USO
 *   npm run mcp:probe            # tabla + exit 1 si hay roto o dependencia caida
 *   npm run mcp:probe -- --json
 *   npm run mcp:probe -- --server rea
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { callServer, resolveServer } from './mcp-call.js';
import { loadDemandMap, type DemandIntent } from './mcp-suggest.js';

const ROOT = resolve(process.cwd());

export type OperabilityStatus =
  | 'ok'
  | 'ok-sin-dato'
  | 'requiere-config'
  | 'dependencia-caida'
  | 'intermitente'
  | 'timeout'
  | 'roto';

export interface ProbeOutcome {
  id: string;
  server: string;
  tool: string;
  status: OperabilityStatus;
  ms: number;
  /** Cuantas sondas se hicieron: 2 cuando la primera fallo (se reintenta). */
  attempts: number;
  /** Extracto corto de lo devuelto: la prueba de que hay dato. */
  evidence: string;
  error?: string;
}

export interface ProbeReport {
  generatedAt: string;
  total: number;
  byStatus: Record<string, number>;
  outcomes: ProbeOutcome[];
}

/** Senales de que lo que falta es del OWNER (credencial), no del stack. */
const CONFIG_SIGNALS = [
  '401',
  'authentication',
  'oauth',
  'not configured',
  'missing credentials',
  'unauthorized',
  'api key',
  'token',
];

/** Senales de que falta un SERVICIO EXTERNO (el stack puede levantarlo). */
const DEPENDENCY_SIGNALS = [
  'not reachable',
  'connection refused',
  'econnrefused',
  'relay',
  'service unavailable',
  'failed to connect',
];

/**
 * Senales de que la sonda NO TERMINO.
 *
 * Un timeout no dice que la capacidad este rota: dice que no se pudo medir
 * (medido 2026-11-18: con la maquina cargada el probe del watchtower dio
 * `1 roto` y cuatro minutos despues `0 roto`, sin que cambiara nada). Un
 * detector que bloquea por una medicion no reproducible entrena al owner a
 * ignorar el detector: el timeout va a su propio estado.
 */
const TIMEOUT_SIGNALS = ['timeout', 'timed out', 'etimedout', 'esockettimedout'];

/**
 * Clasifica el resultado de una sonda.
 *
 * La distincion importa: "falta una credencial" no es un defecto del stack
 * (es configuracion del owner) y "falta un servicio" si lo es (el stack
 * puede levantarlo con el remedio declarado).
 *
 * `isError` importa: una tool puede devolver `isError: true` con el detalle
 * en el CONTENIDO y no en `error`. Medido 2026-11-18: el probe daba `ok` a
 * `context7` cuando la tool habia rechazado los argumentos ("libraryName:
 * expected string, received undefined"). Sin mirar el flag, un rechazo de
 * validacion se lee como una capacidad sana.
 */
export function classify(
  error: string | undefined,
  content: unknown,
  isError = false,
): OperabilityStatus {
  const text =
    `${error ?? ''} ${typeof content === 'string' ? content : JSON.stringify(content ?? '')}`.toLowerCase();
  // Context7 devuelve este rechazo sin isError: transportar texto no prueba
  // que el proveedor pueda servir documentación. No buscarlo en datos anidados.
  if (/^\s*monthly quota exceeded\b/i.test(evidenceOf(content))) return 'requiere-config';
  if (error || isError) {
    if (DEPENDENCY_SIGNALS.some((signal) => text.includes(signal))) return 'dependencia-caida';
    if (CONFIG_SIGNALS.some((signal) => text.includes(signal))) return 'requiere-config';
    if (TIMEOUT_SIGNALS.some((signal) => text.includes(signal))) return 'timeout';
    // Un rechazo de validacion de argumentos NO es una capacidad caida: es
    // una sonda mal declarada. Se reporta como roto porque el stack lo
    // tiene que arreglar (la sonda, no la capacidad).
    return 'roto';
  }
  // Sin error: hay dato, pero puede ser un conjunto vacio.
  if (isEmptyPayload(content)) return 'ok-sin-dato';
  return 'ok';
}

export interface ProbeAttempt {
  status: OperabilityStatus;
  error?: string;
}

/**
 * Decide el estado FINAL de una capacidad a partir de la primera sonda y,
 * si la primera fallo, de la segunda (el reintento de confirmacion).
 *
 * REGLA: **un fallo unico no bloquea**. Se reintenta una vez y:
 *   - la segunda responde bien        -> `intermitente` (WARN: no bloquea)
 *   - las dos fallan igual             -> `roto` (FAIL: el stack lo arregla)
 *   - la segunda no termina            -> `timeout` (WARN: no se puede afirmar)
 *
 * Medido 2026-11-18: el check `operability` dio FAIL (`1 roto`) y cuatro
 * minutos despues PASS (`0 roto`) sin ningun cambio en el stack. Bloquear por
 * una medicion que no se reproduce es un falso positivo que entrena al owner
 * a ignorar el detector.
 */
export function decideStatus(first: ProbeAttempt, second?: ProbeAttempt): OperabilityStatus {
  if (first.status !== 'roto' && first.status !== 'timeout') return first.status;
  if (!second) return first.status;
  const healthy = second.status === 'ok' || second.status === 'ok-sin-dato';
  if (healthy) return 'intermitente';
  if (first.status === 'roto' && second.status === 'roto') return 'roto';
  if (first.status === 'timeout' && second.status === 'roto') return 'roto';
  return 'timeout';
}

/** Un payload "vacio" es valido pero no prueba que la capacidad tenga contenido. */
export function isEmptyPayload(content: unknown): boolean {
  if (content === null || content === undefined) return true;
  if (typeof content === 'string') {
    const text = content.trim();
    if (text.length === 0) return true;
    // Las tools MCP devuelven texto; un JSON serializado sigue siendo dato
    // estructurado y hay que mirarlo como tal (medido: `{entities: [],
    // relations: []}` venia como string y se clasificaba `ok`).
    try {
      return isEmptyPayload(JSON.parse(text));
    } catch {
      return false;
    }
  }
  if (Array.isArray(content)) {
    if (content.length === 0) return true;
    // Las tools MCP devuelven un ARRAY de items de contenido. Si son todos
    // texto, el dato real es ese texto: hay que mirarlo como tal (medido:
    // `memory.read_graph` devuelve [{type:'text', text:'{"entities":[],...}'}]
    // y se clasificaba `ok` con el grafo vacio).
    const texts = content
      .map((item) => {
        const obj = item as { type?: string; text?: string };
        return obj?.type === 'text' && typeof obj.text === 'string' ? obj.text : undefined;
      })
      .filter((t): t is string => t !== undefined);
    if (texts.length === content.length) return isEmptyPayload(texts.join('\n'));
    return false;
  }
  if (typeof content === 'object') {
    const obj = content as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) return true;
    // Respuestas tipicas de collection vacia.
    for (const key of ['entities', 'chains', 'tools', 'results', 'items', 'pages', 'skills']) {
      if (Array.isArray(obj[key]) && obj[key].length === 0) return true;
      if (typeof obj[key] === 'number' && obj[key] === 0 && keys.length <= 3) return true;
    }
  }
  return false;
}

/** Expande `{ROOT}` en los argumentos de la sonda. */
export function expandArgs(
  args: Record<string, unknown> | undefined,
  root = ROOT,
): Record<string, unknown> {
  if (!args) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    out[key] = typeof value === 'string' ? value.replaceAll('{ROOT}', root) : value;
  }
  return out;
}

/** Extrae un extracto legible del contenido devuelto. */
export function evidenceOf(content: unknown): string {
  if (content === undefined || content === null) return '(sin contenido)';
  if (Array.isArray(content)) {
    const texts = content
      .map((item) => {
        const obj = item as { type?: string; text?: string };
        return obj?.type === 'text' && obj.text ? obj.text : '';
      })
      .filter(Boolean);
    return (texts.join(' | ') || JSON.stringify(content)).slice(0, 220).replace(/\s+/g, ' ');
  }
  if (typeof content === 'string') return content.slice(0, 220).replace(/\s+/g, ' ');
  return JSON.stringify(content).slice(0, 220).replace(/\s+/g, ' ');
}

export async function probeIntent(intent: DemandIntent, root = ROOT): Promise<ProbeOutcome> {
  const probe = intent.probe;
  if (!probe) {
    return {
      id: intent.id,
      server: intent.server,
      tool: '-',
      status: 'roto',
      ms: 0,
      attempts: 1,
      evidence: '',
      error: 'la intencion no declara sonda de operabilidad',
    };
  }
  const spec = resolveServer(intent.server, root);
  if (!spec) {
    return {
      id: intent.id,
      server: intent.server,
      tool: probe.tool,
      status: 'roto',
      ms: 0,
      attempts: 1,
      evidence: '',
      error: 'el servidor no se resuelve (no hay entrada canonica)',
    };
  }
  const args = expandArgs(probe.args, root);
  const outcome = await callServer(spec, { tool: probe.tool, args });
  const firstStatus = classify(outcome.error, outcome.content, outcome.isError === true);
  const firstError =
    outcome.error ??
    (outcome.isError || firstStatus === 'requiere-config'
      ? evidenceOf(outcome.content) || 'la tool requiere configuracion'
      : undefined);

  // CONFIRMACION: un fallo unico no bloquea. Se reintenta una vez la misma
  // sonda y solo un fallo REPRODUCIBLE se declara `roto`.
  if (firstStatus === 'roto' || firstStatus === 'timeout') {
    const second = await callServer(spec, { tool: probe.tool, args });
    const secondStatus = classify(second.error, second.content, second.isError === true);
    const secondError =
      second.error ??
      (second.isError ? evidenceOf(second.content) || 'la tool devolvio isError' : undefined);
    const status = decideStatus(
      { status: firstStatus, error: firstError },
      { status: secondStatus, error: secondError },
    );
    return {
      id: intent.id,
      server: intent.server,
      tool: probe.tool,
      status,
      ms: outcome.ms + second.ms,
      attempts: 2,
      evidence: status.startsWith('ok') ? evidenceOf(outcome.content) : '',
      error:
        status === 'intermitente'
          ? `fallo no reproducible (1a: ${firstError ?? 'sin detalle'} | 2a: ${secondError ?? 'respondio bien'})`
          : status === 'timeout'
            ? `la sonda no termino (1a: ${firstError ?? 'timeout'} | 2a: ${secondError ?? 'timeout'})`
            : `${firstError ?? 'sin detalle'} | reintento: ${secondError ?? 'sin detalle'}`,
    };
  }

  return {
    id: intent.id,
    server: intent.server,
    tool: probe.tool,
    status: firstStatus,
    ms: outcome.ms,
    attempts: 1,
    evidence: firstStatus.startsWith('ok') ? evidenceOf(outcome.content) : '',
    error: firstError,
  };
}

export async function probeAll(only?: string, root = ROOT): Promise<ProbeReport> {
  const map = loadDemandMap(root);
  const intents = only
    ? map.intents.filter((i) => i.server === only || i.id === only)
    : map.intents;
  const outcomes: ProbeOutcome[] = [];
  for (const intent of intents) {
    outcomes.push(await probeIntent(intent, root));
  }
  const byStatus: Record<string, number> = {};
  for (const outcome of outcomes) byStatus[outcome.status] = (byStatus[outcome.status] ?? 0) + 1;
  return {
    generatedAt: new Date().toISOString(),
    total: outcomes.length,
    byStatus,
    outcomes,
  };
}

function argOf(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')) {
    return process.argv[idx + 1];
  }
  return undefined;
}

async function main(): Promise<void> {
  const asJson = process.argv.includes('--json');
  const only = argOf('server');
  const report = await probeAll(only);

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Operabilidad MCP — ${report.total} capacidades\n`);
    for (const outcome of report.outcomes) {
      const label =
        outcome.status === 'ok'
          ? 'OK'
          : outcome.status === 'ok-sin-dato'
            ? 'OK-SIN-DATO'
            : outcome.status.toUpperCase();
      console.log(
        `  ${label.padEnd(18)} ${outcome.server.padEnd(24)} ${outcome.tool}  (${outcome.ms}ms, ${outcome.attempts} sonda/s)`,
      );
      if (outcome.evidence) console.log(`      ${outcome.evidence}`);
      if (outcome.error) console.log(`      ${outcome.error.slice(0, 200)}`);
    }
    console.log('');
    for (const [status, count] of Object.entries(report.byStatus)) {
      console.log(`  ${status.padEnd(20)} ${count}`);
    }
  }

  // Recibo: el probe deja evidencia con fecha (telemetria honesta).
  try {
    const dir = join(ROOT, '.runtime', 'mcp-operability');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `operability-${report.generatedAt.replace(/[:.]/g, '-')}.json`),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf-8',
    );
  } catch {
    /* el recibo es best-effort */
  }

  const blocking = (report.byStatus.roto ?? 0) + (report.byStatus['dependencia-caida'] ?? 0);
  process.exitCode = blocking > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  void main();
}
