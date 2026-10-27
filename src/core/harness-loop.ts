/**
 * harness-loop.ts — Bucle Propose-Probe-Compose del harness.
 *
 * Portado del metodo de Harness^2 (google-research/harness2, Apache-2.0) al
 * stack GV. Ver `docs/research/2026-10-23-harness2-recursive-agent-harnessing.md`.
 *
 * El bucle NO necesita ground truth. Compara COMPORTAMIENTO entre
 * ejecuciones y deja que el judge (que corre despues, fuera del bucle) mida
 * la calidad. Eso evita la objecion circular de todo sistema de auto-mejora:
 * "¿como sabes que tu cambio es mejor?" -> "executas la misma tarea bajo dos
 * harnesses y comparas el comportamiento observable".
 *
 * Etapas (modo `agg`, paralelo; k = 1):
 *
 *   base-1   corrida de referencia con el harness actual        (1 rollout)
 *   inv-1    candidata invariante (mejora transversal)           (1 rollout)
 *   dom-1    candidata especifica del dominio                    (1 rollout)
 *   agg-1    composicion de las dos candidatas anteriores        (1 rollout)
 *            ------------------------------------------------------
 *            4 rollouts = 4k    |    3 sesiones = 3k
 *
 * El pool de seleccion son las TRES FINALES (inv-1, dom-1, agg-1). Las
 * corridas base quedan FUERA del pool: no hay abstención por construccion.
 *
 * El bucle es agnostico del substrate: recibe un `Substrate` que sabe correr
 * una tarea bajo un prompt de sistema dado. Hay dos implementaciones:
 *   - `createOpencodeSubstrate`  — llamadas reales de modelo via el CLI
 *   - `createScriptedSubstrate`  — respuestas deterministas, para testear la
 *                                  mecanica del bucle sin gastar tokens
 */

import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import {
  GV_SURFACE,
  diffLines,
  diffSurface,
  surfaceDiversity,
  textDiversity,
  type HarnessSurface,
  type HarnessTree,
} from './harness-surface.js';
import {
  buildSelectionPool,
  selectBlind,
  assertSelectionClean,
  type SelectionPool,
  type SelectionResult,
} from '../eval/blind-selection.js';
import { HarnessLedger, type LedgerMode, type LedgerSummary } from '../eval/harness-ledger.js';
import { loadVerdictExemptions } from './harness-allowlist.js';
import { proposeHarnessEdit } from '../eval/harness-proposer.js';
import {
  judgeCompliance,
  summarizeJudge,
  type JudgeSpec,
  type JudgeVerdict,
} from '../eval/harness-judge.js';
import {
  createSemanticJudge,
  type SemanticVerdict,
} from '../eval/harness-semantic-judge.js';
import {
  addExperience,
  saveHarnessSnapshot,
  writeDomainIndex,
  writeExperienceNote,
  listExperiences,
  type ExperienceEntry,
} from '../knowledge/experience-library.js';
import type Database from 'better-sqlite3';

/* ── Substrate ── */

export interface SubstrateRunRequest {
  /** Nombre de la variante (se usa como `command` en el substrate). */
  variantName: string;
  /** Prompt de sistema: el harness de esta variante. */
  systemPrompt: string;
  /** Texto de la tarea. */
  task: string;
  /** Directorio de trabajo. */
  workDir: string;
  timeoutMs: number;
  /**
   * Sesion ATRIBUIDA por el metodo.
   *
   * El substrate puede usar una sesion fisica distinta (cada invocacion del
   * CLI de opencode es una sesion nueva), pero el metodo cuenta sesiones de
   * PROPUESTA. El ledger registra la sesion atribuida, no la fisica: el
   * conteo que importa es "cuantas sesiones de propuesta’existence", y esa
   * identidad es la que hace auditable el presupuesto.
   */
  attributedSessionId?: string;
}

export interface SubstrateRunResult {
  ok: boolean;
  delivered: boolean;
  sessionId: string;
  runId: string;
  /** Artefacto entregable (la respuesta del agente). */
  render: string;
  /** El agente llego a un final de paso completo (reason = stop). */
  completed: boolean;
  /** Motivo legible del fallo, si lo hubo. */
  error?: string;
  /** Trayectoria completa. */
  rollout: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/**
 * Substrate de ejecucion.
 *
 * La abstraccion es deliberada: Harness^2 separa el METODO (este archivo) del
 * substrate (quien ejecuta). Cambiar de CLI de agente no debe tocar el bucle.
 */
export interface Substrate {
  readonly name: string;
  run(request: SubstrateRunRequest): Promise<SubstrateRunResult>;
}

/* ── Identidad de corrida ── */

/**
 * Identificador de corrida reproducible-ish: `harness-<dominio>-<task>-<modo>-<k>-<hash>`.
 *
 * El hash incluye un timestamp, asi que dos corridas del mismo bucle tienen
 * IDs distintos; el ledger es el que garantiza que no se repitan.
 */
export function createRunId(options: {
  domain: string;
  taskId: string;
  mode: LedgerMode;
  k: number;
  timestamp?: string;
}): string {
  const ts = options.timestamp ?? new Date().toISOString().replace(/[:.]/g, '-');
  const digest = createHash('sha1')
    .update(`${options.domain}|${options.taskId}|${options.mode}|${options.k}|${ts}`)
    .digest('hex')
    .slice(0, 8);
  return `harness-${options.domain}-${options.taskId}-${options.mode}-k${options.k}-${digest}`;
}

/* ── Propuestas ── */

/**
 * Una propuesta de edicion del harness.
 *
 * `build` recibe el arbol base y devuelve el arbol editado. El contrato de
 * edicion es "omitido-es-heredado": si la propuesta no toca un path, el path
 * base se conserva intacto.
 */
export interface HarnessProposal {
  label: string;
  kind: 'invariant' | 'domain';
  description: string;
  build(base: HarnessTree): HarnessTree;
}

/** Propuesta que reemplaza o agrega paths concretos. */
export function proposalFromEdits(
  label: string,
  kind: 'invariant' | 'domain',
  description: string,
  edits: Record<string, string>
): HarnessProposal {
  return {
    label,
    kind,
    description,
    build(base) {
      return { ...base, ...edits };
    },
  };
}

/**
 * Propuesta que superpone un directorio sobre el arbol base.
 *
 * Los paths del directorio se interpretan relativos a la raiz del harness.
 */
export function proposalFromDirectory(
  label: string,
  kind: 'invariant' | 'domain',
  description: string,
  dir: string
): HarnessProposal {
  return {
    label,
    kind,
    description,
    build(base) {
      const overlay = readTreeFromDir(dir);
      return { ...base, ...overlay };
    },
  };
}

/** Lee un directorio completo como arbol de harness (rel -> contenido). */
export function readTreeFromDir(dir: string): HarnessTree {
  const tree: HarnessTree = {};
  if (!existsDir(dir)) return tree;
  for (const rel of walkFiles(dir)) {
    tree[rel] = readFileSync(join(dir, rel), 'utf-8');
  }
  return tree;
}

function existsDir(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function walkFiles(dir: string, prefix = '', out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(abs, rel, out);
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

/**
 * Compone dos arboles candidatos en uno final.
 *
 * La composicion real de Harness^2 la hace un modelo. Aqui es determinista y
 * explicita: se toman las EDICIONES del primer candidato sobre la base y, para
 * los paths que ese no toco, las EDICIONES del segundo. Los conflictos se
 * resuelven a favor del primero y quedan registrados, nunca en silencio.
 *
 * Importante: se comparan contra la BASE, no contra el arbol entero. Si se
 * compararan contra el arbol, todo path presente en el primer candidato
 * "ganaria" y las ediciones del segundo sobre paths que el primero no toco se
 * perderian: la composicion seria el primer candidato con otro nombre.
 */
export function composeTrees(
  base: HarnessTree,
  first: HarnessTree,
  second: HarnessTree
): { tree: HarnessTree; conflicts: string[] } {
  const conflicts: string[] = [];
  const tree: HarnessTree = { ...base };

  /**
   * Paths que un candidato cambio (o agrego) respecto de la base.
   *
   * Un path que el candidato no trae NO es una eliminacion: las propuestas
   * son superposiciones (`{...base, ...edits}`), asi que lo que no esta, no
   * se toco.
   */
  const editsOf = (candidate: HarnessTree): Set<string> => {
    const edits = new Set<string>();
    for (const [rel, content] of Object.entries(candidate)) {
      if (base[rel] !== content) edits.add(rel);
    }
    return edits;
  };

  const firstEdits = editsOf(first);
  const secondEdits = editsOf(second);

  for (const rel of firstEdits) {
    if (secondEdits.has(rel) && second[rel] !== first[rel]) {
      conflicts.push(rel);
    }
    tree[rel] = first[rel] as string;
  }
  for (const rel of secondEdits) {
    if (firstEdits.has(rel)) continue;
    tree[rel] = second[rel] as string;
  }
  return { tree, conflicts };
}

/* ── Substrate opencode ── */

export interface OpencodeSubstrateOptions {
  /** Ruta al opencode.json del repo. */
  configPath?: string;
  /** Agente de opencode que ejecuta la tarea. */
  agent?: string;
  /** Binario del CLI. */
  bin?: string;
  /** Timeout por corrida. */
  timeoutMs?: number;
  /**
   * Modelo a ejecutar, en formato `provider/model`.
   *
   * Por defecto se usa el del agente del repo. Hace falta porque el repo
   * apunta a un modelo del free tier de opencode, y el proveedor lo rechaza
   * desde el CLI ("free tier can only be used from within OpenCode"): el
   * override permite ejecutar el bucle con un modelo habilitado sin tocar la
   * configuracion del repo.
   */
  model?: string;
  /**
   * Niega las herramientas al agente de la variante (default: true).
   *
   * El bucle compara COMPORTAMIENTOS del harness, no la capacidad de usar
   * herramientas: si la variante puede ejecutar comandos, cada corrida
   * depende de lo que encuentra en el repo y las comparaciones dejan de ser
   * comparables. Con las herramientas denegadas, la variante responde al
   * prompt con el harness que esta probando, y nada mas.
   */
  denyTools?: boolean;
  /**
   * Directorio del PROYECTO que ve opencode (default: el workDir).
   *
   * Importante: opencode se cuelga al arrancar en un directorio NUEVO (se
   * queda en el bootstrap, sin iniciar la sesion). El proyecto tiene que ser
   * uno ya inicializado: por eso el bucle corre contra la raiz del repo, que
   * es donde vive el harness que se esta probando.
   */
  projectDir?: string;
}

/**
 * Agente PADRE declarado en el opencode.json del repo.
 *
 * El padre es el que ejecuta el comando y el que hace la llamada final: si
 * se queda con el modelo del free tier, el proveedor responde 403 y la
 * corrida vuelve vacia despues de que la variante ya entrego.
 */
function repoDefaultAgent(configPath: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as {
      default_agent?: string;
    };
    return parsed.default_agent ?? null;
  } catch {
    return null;
  }
}

/**
 * Substrate que ejecuta la tarea con el CLI de opencode.
 *
 * El prompt de sistema viaja como `command.<variante>.template` en
 * `OPENCODE_CONFIG_CONTENT`: ese es el mecanismo nativo de opencode para
 * variar el harness sin tocar el archivo de configuracion del repo.
 */
export function createOpencodeSubstrate(options: OpencodeSubstrateOptions = {}): Substrate {
  const bin = options.bin ?? 'opencode';
  const agent = options.agent ?? 'sdd-explore';
  const configPath = options.configPath ?? resolve(process.cwd(), 'opencode.json');
  const timeoutMs = options.timeoutMs ?? 120_000;

  return {
    name: 'opencode',
    async run(request) {
      const config: Record<string, unknown> = {
        permission: { '*': 'deny', task: { '*': 'deny', [agent]: 'allow' } },
        command: {
          [request.variantName]: { agent, subtask: true, template: request.systemPrompt },
        },
      };
      // El override de modelo viaja en la config EN LINEA, que es la que
      // gana: no se toca el opencode.json del repo.
      //
      // El modelo va en TODOS los agentes, no solo en el de la variante: hay
      // dos sesiones (la del comando/subagente y la sesion PADRE que ejecuta
      // el comando), y cada agente del repo puede traer su propio modelo. Si
      // uno queda con el del free tier, el proveedor responde 403 y la
      // corrida se cuelga o vuelve vacia DESPUES de que la variante ya
      // entrego su resultado.
      if (options.model) {
        config.model = options.model;
        const agents: Record<string, Record<string, unknown>> = {};
        // El agente del comando (la variante) y el agente PADRE (el que
        // ejecuta el comando). El resto de los agentes del repo se dejan
        // como estan: redefinirlos todos rompe sus permisos y sus pasos.
        agents[agent] = { model: options.model };
        const parent = repoDefaultAgent(configPath);
        if (parent && parent !== agent) agents[parent] = { model: options.model };
        config.agent = agents;
      }
      if (options.denyTools !== false) {
        const agents = (config.agent as Record<string, Record<string, unknown>> | undefined) ?? {};
        const agentBlock = agents[agent] ?? {};
        agentBlock.permission = { '*': 'deny' };
        agents[agent] = agentBlock;
        config.agent = agents;
      }
      const configContent = JSON.stringify(config);

      const result = await runProcess(
        bin,
        [
          'run',
          '--command',
          request.variantName,
          '--format',
          'json',
          '--dir',
          options.projectDir ?? request.workDir,
          request.task,
        ],
        { OPENCODE_CONFIG: configPath, OPENCODE_CONFIG_CONTENT: configContent },
        request.timeoutMs ?? options.timeoutMs ?? timeoutMs
      );

      return parseOpencodeOutput(result.stdout, result.stderr, result.status === 0, request.variantName);
    },
  };
}

interface ProcessResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runProcess(
  bin: string,
  args: string[],
  extraEnv: Record<string, string>,
  timeoutMs: number
): Promise<ProcessResult> {
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (result: ProcessResult): void => {
      if (settled) return;
      settled = true;
      resolvePromise(result);
    };

    const child = spawn(bin, args, {
      env: { ...process.env, ...extraEnv },
      windowsHide: true,
      // stdin IGNORADO, no heredado: opencode, cuando su stdin no es una TTY,
      // lo interpreta como "el prompt viene por el pipe" y se queda ESPERANDO
      // datos que nunca llegan. Con stdin ignorado recibe EOF inmediato y usa
      // el prompt que va en los argumentos.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      // El timeout RESUELVE la promesa: si el kill no cerrara el proceso,
      // la corrida se quedaria colgada para siempre y el bucle no avanzaria.
      finish({ status: -1, stdout, stderr: `${stderr}\n[timeout ${timeoutMs}ms]` });
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      finish({ status: -1, stdout, stderr: `${stderr}\n${error.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish({ status: code ?? -1, stdout, stderr });
    });
  });
}

/**
 * Quita el envoltorio que opencode pone alrededor de la salida del subagente.
 *
 * La entrega llega como `<task id="..." state="completed">\n<task_result>\n...
 * </task_result>\n</task>`. Ese envoltorio es ruido de transporte: el
 * artefacto que se compara es lo que dijo la variante.
 */
export function unwrapTaskOutput(output: string): string {
  return output
    .replace(/^\s*<task\b[^>]*>\s*/i, '')
    .replace(/<\/task>\s*$/i, '')
    .replace(/^\s*<task_result>\s*/i, '')
    .replace(/\s*<\/task_result>\s*$/i, '')
    .trim();
}

/**
 * Parsea la salida NDJSON de `opencode run --format json`.
 *
 * La extraccion es defensiva: el formato de los eventos puede variar entre
 * versiones y un campo ausente no debe tumbar el bucle. Lo que SI debe
 * marcar el fallo es un evento de error.
 */
export function parseOpencodeOutput(
  stdout: string,
  stderr: string,
  ok: boolean,
  variantName = ''
): SubstrateRunResult {
  const events: Array<Record<string, unknown>> = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      events.push(JSON.parse(trimmed) as Record<string, unknown>);
    } catch {
      /* linea no-JSON: se ignora, no es un evento */
    }
  }

  let render = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let sessionId = '';
  let sawError = false;
  let completed = false;

  for (const event of events) {
    const type = String(event.type ?? '');
    const part = (event.part ?? {}) as Record<string, unknown>;
    if (type === 'error') sawError = true;
    if (type === 'step_finish' && part.reason === 'stop') completed = true;
    if (typeof event.session_id === 'string') sessionId = event.session_id;

    // Tokens: el campo varia entre versiones; se aceptan las formas conocidas.
    const tokens = (part.tokens ?? part.usage ?? {}) as Record<string, unknown>;
    const inTok = Number(tokens.input ?? tokens.input_tokens ?? 0);
    const outTok = Number(tokens.output ?? tokens.output_tokens ?? 0);
    if (Number.isFinite(inTok)) inputTokens += inTok;
    if (Number.isFinite(outTok)) outputTokens += outTok;

    // Artefacto entregable: la salida de la subagente.
    if (type === 'tool_use' && part.tool === 'task') {
      const state = (part.state ?? {}) as Record<string, unknown>;
      const output = state.output;
      if (typeof output === 'string' && output.trim()) render = unwrapTaskOutput(output);
    }
  }

  if (!render) {
    // Fallback: el texto del asistente. opencode emite dos formas segun la
    // version: `type: "message"` con `part.type: "text"`, y `type: "text"`
    // con `part.text`. Con solo la primera, la corrida terminaba con entrega
    // vacia aunque el modelo hubiera respondido.
    for (const event of events) {
      const part = (event.part ?? {}) as Record<string, unknown>;
      const isText =
        (event.type === 'message' && part.type === 'text') || event.type === 'text';
      if (isText && typeof part.text === 'string' && part.text.trim()) {
        render = part.text;
      }
    }
  }

  // Motivo del fallo, en orden de especificidad: primero el rechazo del
  // proveedor (que tiene un remedy distinto), depois el fallo generico.
  //
  // El rechazo del free tier de opencode es un caso conocido del stack: la
  // invocacion por CLI la bloquea el proveedor, y el mensaje crudo dice
  // "free tier can only be used from within OpenCode". Sin esto, el bucle
  // veria una corrida vacia sin saber por que.
  let error: string | undefined;
  if (/FreeTierError|statusCode.{0,8}403/i.test(stdout) || /free tier can only be used/i.test(stdout)) {
    error =
      'El proveedor de opencode rechazo la llamada desde el CLI (free tier: solo dentro de la app OpenCode). ' +
      'Usar el substrate scriptado para iterar la mecanica, o un proveedor que acepte la CLI.';
  } else if (/\[timeout\s*\d+ms\]/.test(stderr)) {
    error = 'La corrida supero el timeout configurado del substrate.';
  } else if (sawError) {
    error = 'La corrida de opencode emitio un evento de error.';
  } else if (!stdout.trim() && !stderr.trim()) {
    error = 'opencode no emitio ninguna salida (fallo de substrate, no del harness).';
  } else if (!ok) {
    // Salida no cero sin un error reconocible: la causa esta en la ultima
    // linea de la salida. Sin esto, el fallo aparecia como "not-ok" sin
    // motivo, que es un fallo silencioso.
    const tail = (stdout.trim() || stderr.trim()).split(/\r?\n/).filter(Boolean).slice(-3).join(' | ');
    error = `opencode termino con codigo distinto de 0: ${tail.slice(0, 400)}`;
  }

  // La TRAYECTORIA es la traza del COMPORTAMIENTO. Se le saca el eco del
  // prompt del variante: (1) infla el contexto del selector con 10k chars
  // por candidata, y (2) le muestra el prompt de cada variante, lo que
  // permite identificar cual es cual y rompe la ceguera. El input queda en el
  // snapshot del harness, que si es auditable.
  const rollout = stdout
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) return line;
      try {
        const event = JSON.parse(trimmed) as Record<string, unknown>;
        const part = (event.part ?? {}) as Record<string, unknown>;
        if (part.tool === 'task') {
          const state = (part.state ?? {}) as Record<string, unknown>;
          const input = (state.input ?? {}) as Record<string, unknown>;
          if (typeof input.prompt === 'string') {
            input.prompt = '<prompt de la variante omitido: vive en el snapshot del harness>';
            state.input = input;
            part.state = state;
            event.part = part;
          }
        }
        return JSON.stringify(event);
      } catch {
        return line;
      }
    })
    .join('\n')
    .trim();

  return {
    ok: ok && !sawError,
    delivered: Boolean(render.trim()),
    sessionId: sessionId || 'unknown-session',
    runId: createHash('sha1')
      .update(`${variantName}|${sessionId}|${stdout.length}`)
      .digest('hex')
      .slice(0, 16),
    render: render.trim(),
    completed,
    error,
    rollout: rollout || stderr.trim(),
    inputTokens,
    outputTokens,
    costUsd: 0,
  };
}

/* ── Substrate de guion (tests) ── */

export interface ScriptedResponse {
  render: string;
  ok?: boolean;
  delivered?: boolean;
  completed?: boolean;
  rollout?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  sessionId?: string;
}

/**
 * Substrate determinista: responde segun el nombre de variante.
 *
 * Permite testear la MECANICA del bucle (ledger, pool, seleccion, adopcion)
 * sin llamadas de modelo. Es la misma razon por la que Harness^2 separa el
 * metodo del substrate.
 */
export function createScriptedSubstrate(
  responses: Record<string, ScriptedResponse>
): Substrate {
  return {
    name: 'scripted',
    async run(request) {
      const response = responses[request.variantName];
      if (!response) {
        return {
          ok: false,
          delivered: false,
          sessionId: `scripted-${request.variantName}`,
          runId: `scripted-${request.variantName}`,
          render: '',
          completed: false,
          rollout: `sin respuesta guionizada para ${request.variantName}`,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
        };
      }
      return {
        ok: response.ok ?? true,
        delivered: response.delivered ?? true,
        sessionId:
          response.sessionId ?? request.attributedSessionId ?? `scripted-${request.variantName}`,
        runId: `scripted-${request.variantName}-${response.render.length}`,
        render: response.render,
        completed: response.completed ?? true,
        rollout: response.rollout ?? `trayectoria guionizada de ${request.variantName}`,
        inputTokens: response.inputTokens ?? 0,
        outputTokens: response.outputTokens ?? 0,
        costUsd: response.costUsd ?? 0,
      };
    },
  };
}

/* ── Selector con modelo ── */

/**
 * Prompt del selector.
 *
 * Describe el TRABAJO, nunca su medicion: no se nombra ninguna metrica,
 * ninguna puntuacion y ningun mecanismo de evaluacion. Ademas, el selector
 * ve los entregables ANONIMOS (sin la etiqueta de origen), asi que la
 * comparacion no puede apoyarse en saber cual variante produjo cada uno.
 */
export const SELECTOR_SYSTEM_PROMPT = [
  'Recibes varios entregables anonimos de la misma tarea, sin saber cual',
  'produce cada uno. Todos estan completos: no hay que pedir mas informacion.',
  '',
  'Elegi el entregable que cumple mejor el trabajo pedido.',
  '',
  'Responde EXACTAMENTE con este formato y nada mas:',
  '',
  '```choice',
  'A',
  '```',
  '<why>una frase con el motivo de la eleccion</why>',
].join('\n');

export interface ModelSelectorOptions {
  /** Modelo/substrate que hace la comparacion. */
  substrate: Substrate;
  /** Etiqueta de la corrida del selector en el ledger. */
  variantName?: string;
  /** Timeout por llamada. */
  timeoutMs?: number;
}

/**
 * Selector que compara el pool con el mismo substrate del bucle.
 *
 * Recibe el pool y devuelve el texto crudo de su decision; el parseo lo hace
 * `parseSelection` y, si no es parseable, el llamador aplica el fallback.
 */
export function createModelSelector(options: ModelSelectorOptions): (pool: SelectionPool) => Promise<string> {
  const variantName = options.variantName ?? 'selector';
  return async (pool: SelectionPool) => {
    // Solo los ARTEFACTOS: la trayectoria es ruido de transporte y multiplica
    // el contexto del selector por diez. El archivo del pool conserva todo.
    const task = pool.candidates
      .map((candidate) => `## Candidata ${candidate.id}\n\n${(candidate.render ?? candidate.content).trim()}`)
      .join('\n\n---\n\n');
    const result = await options.substrate.run({
      variantName,
      systemPrompt: SELECTOR_SYSTEM_PROMPT,
      task,
      workDir: process.cwd(),
      timeoutMs: options.timeoutMs ?? 180_000,
      attributedSessionId: `sess-selector-${variantName}`,
    });
    if (!result.render.trim() && result.error) {
      throw new Error(`El selector no devolvio entrega: ${result.error}`);
    }
    return result.render;
  };
}

/* ── Bucle ── */

export interface HarnessLoopOptions {
  /** Identificador de la tarea (estable, define la semilla). */
  taskId: string;
  /** Dominio de trabajo (agrupa la experiencia). */
  domain: string;
  /** Texto de la tarea que se ejecuta en cada corrida. */
  task: string;
  /** k del bucle. 1 es el minimo con pool real (3 finales). */
  k?: number;
  mode?: LedgerMode;
  /** Arbol del harness actual (base). */
  baseTree: HarnessTree;
  /** Prompt de sistema de la base. */
  basePrompt: string;
  /** Propuestas candidatas: al menos una invariante y una de dominio. */
  proposals: HarnessProposal[];
  /** Substrate de ejecucion. */
  substrate: Substrate;
  /** Directorio de trabajo de las corridas. */
  workDir: string;
  /** Directorio de salidas (pool, ledger, adopcion). */
  outDir: string;
  /** Raiz del repo. */
  repoRoot?: string;
  /** Base de datos para la biblioteca de experiencia. */
  db?: Database.Database;
  /** Seleccion: recibe el pool y devuelve la decision cruda. */
  selector?: (pool: SelectionPool) => string | Promise<string>;
  /**
   * Checks del juez, que se evalua DESPUES de que la seleccion se cierra.
   *
   * No participa de la seleccion: es la medicion objetiva del efecto de la
   * edicion del harness. Ver `src/eval/harness-judge.ts`.
   */
  judge?: JudgeSpec;
  /**
   * Proponente automatico: genera la edicion del harness en vez de tomarla
   * de un directorio externo. Ver `src/eval/harness-proposer.ts`.
   *
   * Las llamadas del proposer quedan FUERA del presupuesto de 4k (que cuenta
   * las ejecuciones comparables), igual que el selector: se registran aparte.
   */
  proposer?: {
    substrate: Substrate;
    domain: string;
    allowedPaths?: readonly string[];
    context?: Record<string, string>;
  };
  /**
   * Juez semantico: un modelo verifica el cumplimiento de la regla que recibio
   * cada variante. Corre DESPUES de la seleccion, como el juez de frases.
   * Ver `src/eval/harness-semantic-judge.ts`.
   */
  semanticJudge?: {
    substrate: Substrate;
    timeoutMs?: number;
  };
  /** Tema de la leccion adoptada. */
  topicKey?: string;
  /** Confianza de la leccion. */
  confidence?: 'low' | 'medium' | 'high';
  /**
   * Timeout por corrida, en ms (default 180000).
   *
   * Con el agente sin herramientas, una variante responde en ~40s. El margen
   * cubre los modelos con razonamiento sin dejar una corrida colgada.
   */
  timeoutMs?: number;
  /** Timestamp fijo (tests). */
  now?: string;
}

export interface ProbeRun {
  label: string;
  stage: 'base' | 'candidate' | 'composition';
  /** Sesion de propuesta atribuida (la que cuenta el ledger). */
  sessionId: string;
  /** Sesion fisica devuelta por el substrate (trazabilidad). */
  physicalSessionId: string;
  runId: string;
  ok: boolean;
  delivered: boolean;
  /** El agente llego a un final de paso completo. */
  completed: boolean;
  /** Motivo legible del fallo, si lo hubo. */
  error?: string;
  render: string;
  rollout: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  tree: HarnessTree;
}

export interface HarnessLoopResult {
  runId: string;
  taskId: string;
  domain: string;
  k: number;
  mode: LedgerMode;
  baseRuns: ProbeRun[];
  candidateRuns: ProbeRun[];
  finalRuns: ProbeRun[];
  pool: SelectionPool;
  selection: SelectionResult;
  adopted: boolean;
  adoptedTree?: HarnessTree;
  experience?: ExperienceEntry;
  ledger: LedgerSummary;
  /** Fugas de veredicto detectadas en los artefactos del selector. */
  tripwire: { violations: string[]; warnings: string[]; exempted: string[] };
  /** Veredicto del juez (posterior a la seleccion). */
  judge: { verdicts: JudgeVerdict[]; resumen: ReturnType<typeof summarizeJudge> } | null;
  /** Veredicto del juez semantico (posterior a la seleccion). */
  juezSemantico: SemanticVerdict[] | null;
  /** Llamadas de apoyo (propagadas por el loop, no son ejecuciones comparables). */
  supportCalls: { proposer: number; selector: number; semanticJudge: number };
  /** Diversidad de las candidatas (Jaccard de lineas). */
  diversity: {
    ediciones: ReturnType<typeof textDiversity>;
    arboles: ReturnType<typeof surfaceDiversity>;
    artefactos: ReturnType<typeof textDiversity>;
  } | null;
  outDir: string;
}

/**
 * Ejecuta el bucle PPC completo.
 *
 * k=1 produce: 1 base + 2 candidatas (inv + dom) + 1 composicion = 4 rollouts
 * y 3 sesiones, que es exactamente la identidad del presupuesto (4k / 3k).
 */
export async function runHarnessLoop(
  options: HarnessLoopOptions
): Promise<HarnessLoopResult> {
  const k = options.k ?? 1;
  const mode = options.mode ?? 'agg';
  const repoRoot = options.repoRoot ?? process.cwd();
  const now = options.now ?? new Date().toISOString();
  const runId = createRunId({
    domain: options.domain,
    taskId: options.taskId,
    mode,
    k,
    timestamp: now,
  });

  mkdirSync(options.workDir, { recursive: true });
  mkdirSync(options.outDir, { recursive: true });

  const ledger = HarnessLedger.create({ taskId: options.taskId, k, mode });
  const baseRuns: ProbeRun[] = [];
  const candidateRuns: ProbeRun[] = [];
  const finalRuns: ProbeRun[] = [];
  /** Que cambio probo cada variante: la EXPERIENCIA lo necesita para ser util. */
  const descriptions = new Map<string, string>();
  /**
   * Llamadas de APOYO (no son ejecuciones comparables).
   *
   * El presupuesto de 4k cuenta las ejecuciones que compiten por la adopcion.
   * El proposer, el selector y el juez semantico son llamadas de apoyo: se
   * cuentan aparte para que la identidad del presupuesto no mienta.
   */
  const supportCalls = { proposer: 0, selector: 0, semanticJudge: 0 };

  // ── PROPOSE + PROBE: rondas ───────────────────────────────────────────
  //
  // Por cada ronda r: la corrida BASE y la candidata INVARIANTE comparten la
  // sesion de propuesta (el proponente primero observa la base y despues
  // propone). Por eso P = 3k y no 4k: hay 4k ROLLOUTS pero 3k SESIONES de
  // propuesta. La candidata de DOMINIO y la composicion usan sesiones
  // propias.
  //
  // Los dos modos de Harness^2 se diferencian en QUE es la base de la ronda
  // siguiente:
  //   agg (ancho):  las k composiciones son INDEPENDIENTES; cada ronda
  //                 arranca de la base original y compone sobre su propio
  //                 par de candidatas.
  //   seq (profundo): las composiciones ACUMULAN; la composicion de la ronda
  //                 t es la base de la ronda t+1.
  const proposals = [...options.proposals];
  const invariant = proposals.find((p) => p.kind === 'invariant');
  const domainScoped = proposals.find((p) => p.kind === 'domain');
  if (!invariant || !domainScoped) {
    throw new Error(
      'El bucle requiere al menos una propuesta invariante y una especifica del dominio ' +
        `(se recibieron ${proposals.length}: ${proposals.map((p) => `${p.label}(${p.kind})`).join(', ')}).`
    );
  }

  /** Base de la ronda: en `seq` es la composicion acumulada. */
  let roundBase = options.baseTree;

  /**
   * Compone la ronda: base + invariante + dominio, y la corre.
   *
   * En `agg` la base es la original (composiciones independientes); en `seq`
   * es la base acumulada (la composicion de la ronda anterior).
   */
  const composeRound = async (
    round: number,
    baseForRound: HarnessTree
  ): Promise<{ run: ProbeRun; tree: HarnessTree; description: string }> => {
    const first = candidateRuns.find((run) => run.label === `inv-${round}`) as ProbeRun;
    const second = candidateRuns.find((run) => run.label === `dom-${round}`) as ProbeRun;
    const composed = composeTrees(baseForRound, first.tree, second.tree);
    const description = `Composicion de ${first.label} y ${second.label}`;
    const composePrompt = buildVariantPrompt(
      options.basePrompt,
      {
        label: `agg-${round}`,
        kind: 'invariant',
        description,
        build: () => composed.tree,
      },
      composed.tree,
      // Igual que las candidatas: el diff contra la base original.
      options.baseTree
    );
    const run = await probe(
      options,
      ledger,
      `agg-${round}`,
      'composition',
      composePrompt,
      composed.tree,
      `sess-${runId}-agg-${round}`
    );
    return { run, tree: composed.tree, description };
  };

  for (let round = 1; round <= k; round += 1) {
    const baseSession = `sess-${runId}-base-${round}`;

    const baseTree = roundBase;
    const baseRun = await probe(
      options,
      ledger,
      `base-${round}`,
      'base',
      options.basePrompt,
      baseTree,
      baseSession
    );
    baseRuns.push(baseRun);
    descriptions.set(`base-${round}`, 'Estado base del harness, sin cambios');

    // En cada ronda, el proposer automatico propone la edicion; si no puede
    // (no devuelve JSON, o propone fuera de la superficie), se usa la
    // propuesta externa de esa ronda.
    const proposed = options.proposer
      ? await proposeHarnessEdit(
          {
            substrate: options.proposer.substrate,
            domain: options.proposer.domain,
            kind: 'invariant',
            allowedPaths: options.proposer.allowedPaths,
            context: options.proposer.context,
          },
          options.task
        )
      : null;
    if (options.proposer) supportCalls.proposer += 1;
    const invariantTree = proposed
      ? { ...baseTree, ...proposed.edits }
      : invariant.build(baseTree);
    descriptions.set(
      `inv-${round}`,
      proposed
        ? `Propuesta automatica (${proposed.path}): ${proposed.rationale || 'sin rationale'}`
        : invariant.description
    );
    const invariantRun = await probe(
      options,
      ledger,
      `inv-${round}`,
      'candidate',
      // El diff se calcula contra la BASE ORIGINAL, no contra la base de la
      // ronda: en `seq` la base de la ronda ya trae las ediciones acumuladas,
      // y si se diffeara contra ella, esas ediciones no aparecerian en el
      // prompt (la variante "heredaria" la regla sin verla nunca).
      buildVariantPrompt(
        options.basePrompt,
        proposed
          ? { label: 'inv', kind: 'invariant', description: descriptions.get(`inv-${round}`) as string, build: () => invariantTree }
          : invariant,
        invariantTree,
        options.baseTree
      ),
      invariantTree,
      baseSession
    );
    candidateRuns.push(invariantRun);

    const domainProposal = options.proposer
      ? await proposeHarnessEdit(
          {
            substrate: options.proposer.substrate,
            domain: options.proposer.domain,
            kind: 'domain',
            allowedPaths: options.proposer.allowedPaths,
            context: options.proposer.context,
          },
          options.task
        )
      : null;
    if (options.proposer) supportCalls.proposer += 1;
    const domainTree = domainProposal
      ? { ...baseTree, ...domainProposal.edits }
      : domainScoped.build(baseTree);
    descriptions.set(
      `dom-${round}`,
      domainProposal
        ? `Propuesta automatica (${domainProposal.path}): ${domainProposal.rationale || 'sin rationale'}`
        : domainScoped.description
    );
    const domainRun = await probe(
      options,
      ledger,
      `dom-${round}`,
      'candidate',
      buildVariantPrompt(
        options.basePrompt,
        domainProposal
          ? {
              label: 'dom',
              kind: 'domain',
              description: descriptions.get(`dom-${round}`) as string,
              build: () => domainTree,
            }
          : domainScoped,
        domainTree,
        options.baseTree
      ),
      domainTree,
      `sess-${runId}-dom-${round}`
    );
    candidateRuns.push(domainRun);
    descriptions.set(`dom-${round}`, domainScoped.description);

    // En `seq` la composicion de esta ronda es la base de la SIGUIENTE, asi
    // que tiene que ocurrir DENTRO de la ronda: si se compusiera al final,
    // la ronda 2 todavia no tendria que heredar.
    if (mode === 'seq') {
      const composed = await composeRound(round, roundBase);
      finalRuns.push(composed.run);
      descriptions.set(`agg-${round}`, composed.description);
      roundBase = composed.tree;
    }
  }

  // ── COMPOSE: composicion de las candidatas de cada ronda ──────────────
  //
  // En `agg` las composiciones son INDEPENDIENTES: todas arrancan de la base
  // original y se hacen al final, con el pool completo disponible.
  if (mode === 'agg') {
    for (let round = 1; round <= k; round += 1) {
      const composed = await composeRound(round, options.baseTree);
      finalRuns.push(composed.run);
      descriptions.set(`agg-${round}`, composed.description);
    }
  }

  // ── IDENTIDAD DEL PRESUPUESTO ────────────────────────────────────────
  //
  // Antes de que nada llegue al selector: si el presupuesto no cuadra (4k
  // rollouts, 3k sesiones, distribucion por etapa), el bucle para. Una
  // candidata que nunca se produjo no puede competir por la adopcion.
  ledger.assertIdentity();

  // El pool son las FINALES: las candidatas y las composiciones. Las corridas
  // base quedan fuera: no hay abstención por construccion.
  const poolCandidates = [...candidateRuns, ...finalRuns].map((run) => ({
    label: run.label,
    ok: run.ok,
    delivered: run.delivered,
    render: run.render,
    rollout: run.rollout,
  }));

  // ── TRIPWIRE: ningun veredicto de evaluador en el contexto ───────────
  //
  // Mismas exenciones que el doctor: un solo oraculo para la misma regla.
  const treesForCheck: Record<string, HarnessTree> = { base: options.baseTree };
  for (const run of [...candidateRuns, ...finalRuns]) treesForCheck[run.label] = run.tree;
  const exemptions = loadVerdictExemptions(repoRoot);
  const tripwireTrees = assertSelectionClean(treesForCheck, exemptions);

  // El tripwire corre en DOS caminos: los arboles de harness (arriba) y los
  // ARTEFACTOS que la candidata entrega (dentro de buildSelectionPool). Una
  // candidata que escribe `pass_rate: 0.97` contamina por el texto.
  const pool = buildSelectionPool(poolCandidates, {
    taskId: options.taskId,
    k,
    mode,
    outDir: join(options.outDir, 'pool'),
  });

  const selector =
    options.selector ??
    (() => '```choice\nA\n```\n<why>Sin selector configurado: se elige la primera candidata por defecto.</why>');

  // Sin fallback de base: el pool son las FINALES (regla 1 del metodo), la
  // base no esta en el pool y por lo tanto no puede ser el fallback.
  const selection = await selectBlind(pool, selector);
  if (options.selector) supportCalls.selector += 1;

  // ── MEDICION POSTERIOR: el juez ────────────────────────────────────────
  //
  // El juez corre DESPUES de que la seleccion se cierra: su veredicto no
  // vuelve al pool ni cambia QUE variante se adopta. Es la medicion objetiva
  // de si la edicion del harness movio el comportamiento, y por eso corre
  // antes de la adopcion: la leccion guardada lleva que reglas quedaron
  // VERIFICADAS, que es lo que la promocion va a subir al repo.
  const editTexts: Record<string, string> = {};
  for (const run of [...candidateRuns, ...finalRuns]) {
    const diff = diffSurface(GV_SURFACE, options.baseTree, run.tree);
    const parts: string[] = [];
    for (const rel of [...diff.modified, ...diff.added]) {
      parts.push(
        `### ${rel}\n${diffLines(options.baseTree[rel] ?? '', run.tree[rel] ?? '')}`
      );
    }
    editTexts[run.label] = parts.join('\n');
  }
  const diversity = {
    ediciones: textDiversity(editTexts),
    arboles: surfaceDiversity(
      Object.fromEntries([...candidateRuns, ...finalRuns].map((run) => [run.label, run.tree]))
    ),
    artefactos: textDiversity(
      Object.fromEntries([...candidateRuns, ...finalRuns].map((run) => [run.label, run.render]))
    ),
  };

  // Texto de la REGLA que recibio cada variante.
  //
  // Para el juez semantico va SOLO lo que la variante AGREGO (las lineas `+`
  // del diff, sin los marcadores), no el archivo entero: al darle el archivo
  // completo, el juez se aferra a una regla cualquiera del archivo (medido:
  // juzgo contra "Testing First" en vez de contra la regla nueva) y da un
  // veredicto sobre algo que no se le pidio.
  const ruleTexts: Record<string, string> = {};
  for (const run of [...candidateRuns, ...finalRuns]) {
    const diff = diffSurface(GV_SURFACE, options.baseTree, run.tree);
    const parts: string[] = [];
    for (const rel of [...diff.modified, ...diff.added]) {
      const before = options.baseTree[rel];
      const after = run.tree[rel] ?? '';
      if (before === undefined) {
        parts.push(`### ${rel} (archivo nuevo)\n\n${after}`);
        continue;
      }
      const added = diffLines(before, after)
        .split('\n')
        .filter((line) => line.startsWith('+ '))
        .map((line) => line.slice(2))
        .join('\n');
      parts.push(`### ${rel} (lineas agregadas)\n\n${added}`);
    }
    ruleTexts[run.label] = parts.join('\n\n');
  }
  const judge = options.judge
    ? (() => {
        const verdicts = judgeCompliance(
          [...baseRuns, ...candidateRuns, ...finalRuns].map((run) => ({
            label: run.label,
            render: run.render,
          })),
          options.judge as JudgeSpec,
          // La tarea entra al juez: un mustNotContain de la base que la tarea
          // ya menciona es dato, no fuga (bitacora §4.18).
          options.task
        );
        return { verdicts, resumen: summarizeJudge(verdicts) };
      })()
    : null;

  // Ediciones VERIFICADAS: las que toco una variante cuya regla el juez
  // confirmo como cumplida. Una regla que se midio y no se cumplio no se
  // promueve: quedaria en el repo como norma que el stack no obedece.
  //
  // El juez de frases es el que manda (determinista, reproducible). El
  // semantico tambien verifica, y es el UNICO que puede: una regla NUEVA
  // (propuesta automaticamente) no tiene un check literal escrito de antemano.
  // ── MEDICION POSTERIOR: juez semantico ────────────────────────────────
  //
  // Un modelo verifica si cada variante CUMPLIO la regla que recibio. Corre
  // DESPUES de la seleccion (igual que el juez de frases) y cada variante se
  // evalua sola: si el juez viera todas juntas, compararia en vez de
  // verificar.
  const semanticVerdicts = options.semanticJudge
    ? await createSemanticJudge({
        substrate: options.semanticJudge.substrate,
        timeoutMs: options.semanticJudge.timeoutMs,
      })(
        [...candidateRuns, ...finalRuns]
          .filter((run) => (ruleTexts[run.label] ?? '').trim().length > 0)
          .map((run) => ({
            label: run.label,
            kind: run.stage,
            rule: ruleTexts[run.label] ?? '',
            artifact: run.render,
          }))
      )
    : null;
  if (semanticVerdicts) supportCalls.semanticJudge += semanticVerdicts.length;
  const verifiedEdits = new Set<string>();
  const verifiedBy = new Map<string, string[]>();
  const markVerified = (label: string, by: string): void => {
    const run = [...candidateRuns, ...finalRuns].find((r) => r.label === label);
    if (!run) return;
    const diff = diffSurface(GV_SURFACE, options.baseTree, run.tree);
    for (const rel of [...diff.modified, ...diff.added]) {
      verifiedEdits.add(rel);
      const sources = verifiedBy.get(rel) ?? [];
      if (!sources.includes(by)) sources.push(by);
      verifiedBy.set(rel, sources);
    }
  };
  if (judge) {
    for (const verdict of judge.verdicts) {
      if (verdict.ok) markVerified(verdict.label, 'frases');
    }
  }
  if (semanticVerdicts) {
    for (const verdict of semanticVerdicts) {
      if (verdict.complies) markVerified(verdict.label, 'semantico');
    }
  }

  // ── ADOPT ─────────────────────────────────────────────────────────────
  let adopted = false;
  let adoptedTree: HarnessTree | undefined;
  let experience: ExperienceEntry | undefined;

  const winner = [...candidateRuns, ...finalRuns].find(
    (run) => run.label === selection.selectedLabel
  );
  if (selection.via !== 'fallback-base' && winner) {
    adopted = true;
    adoptedTree = winner.tree;
    const diff = diffSurface(GV_SURFACE, options.baseTree, winner.tree);
    const snapshotPath = saveHarnessSnapshot(
      options.domain,
      options.taskId,
      winner.tree,
      repoRoot
    );
    // La EXPERIENCIA tiene que transferir a otra corrida: para eso el cue
    // nombra QUE se toco y la lesson QUE seAprendio. Un texto generico
    // ("cuando se propone editar el harness") cumple el contrato y no
    // enseña nada, asi que el contrato ahora lo rechaza.
    const touched = [...diff.modified, ...diff.added];
    const touchedText = touched.length > 0 ? touched.slice(0, 6).join(', ') : 'la superficie completa';
    const winnerWhat = descriptions.get(winner.label) ?? winner.label;
    const compared = pool.candidates.map((c) => c.id).join(', ');
    experience = {
      topicKey: options.topicKey ?? `learning/${options.domain}`,
      domain: options.domain,
      cue: `Cuando se edita ${touchedText} del harness para el dominio "${options.domain}".`,
      lesson: `Para ${touchedText}, la variante "${winner.label}" (${winnerWhat}) entrego el mejor comportamiento en la comparacion ciega de la corrida ${runId}: gano a ${pool.candidates.length} finales sin que el selector viera ningun score.`,
      evidence: `Corrida ${runId}: comparacion ciega entre ${compared} (${pool.candidates.length} finales, ${pool.dropped.length} descartadas) eligio "${winner.label}" (${selection.via}); la variante toco ${touched.length} archivo(s) de la superficie.`,
      confidence: options.confidence ?? 'medium',
      edits: touched,
      verifiedEdits: [...verifiedEdits],
      taskId: options.taskId,
      harnessSnapshot: snapshotPath,
    };
    if (options.db) {
      const record = addExperience(options.db, experience, now);
      writeExperienceNote(options.domain, options.taskId, record, repoRoot);
      writeDomainIndex(
        options.domain,
        listExperiences(options.db, { domain: options.domain }),
        repoRoot
      );
    }
  }

  // ── MEDICION POSTERIOR: diversidad ─────────────────────────────────────
  // Diversidad: si todos dicen lo mismo, el bucle esta decorando en vez de
  // explorando (Harness^2: el colapso a un mismo cuerpo es el anti-patron).
  // Se mide en los tres planos que importan:
  //   - EDICIONES: que tan distintas son las propuestas entre si (el diff de
  //     cada variante contra la base). Medir la diversidad de los ARBOLES no
  //     sirve: con 1744 archivos, dos arboles que difieren en UNA regla dan
  //     J=0.9999 y el numero no distingue nada.
  //   - ARBOLES: el estado completo de cada variante.
  //   - ARTEFACTOS: si las respuestas colapsaron a la misma prosa.


  writeFileSync(
    join(options.outDir, 'selection.md'),
    [
      `# Seleccion — ${runId}`,
      '',
      `- **Elegida:** ${selection.selectedLabel ?? '(ninguna)'}`,
      `- **Via:** ${selection.via}`,
      `- **Razon:** ${selection.why ?? '-'}`,
      '',
      '## Respuesta cruda del selector',
      '',
      selection.raw?.trim() || '(sin respuesta cruda)',
      '',
    ].join('\n'),
    'utf-8'
  );

  writeFileSync(
    join(options.outDir, 'ledger.json'),
    JSON.stringify(
      {
        runId,
        taskId: options.taskId,
        summary: ledger.summary(),
        tripwire: { violations: pool.violations, warnings: pool.warnings, exempted: tripwireTrees.exempted },
        seleccion: {
          elegida: selection.selectedLabel,
          via: selection.via,
          razon: selection.why,
          respuestaCruda: selection.raw,
        },
      },
      null,
      2
    ),
    'utf-8'
  );

  return {
    runId,
    taskId: options.taskId,
    domain: options.domain,
    k,
    mode,
    baseRuns,
    candidateRuns,
    finalRuns,
    pool,
    selection,
    adopted,
    adoptedTree,
    experience,
    ledger: ledger.summary(),
    tripwire: { violations: pool.violations, warnings: pool.warnings, exempted: tripwireTrees.exempted },
    judge,
    juezSemantico: semanticVerdicts,
    supportCalls,
    diversity,
    outDir: options.outDir,
  };
}

/** Ejecuta una corrida y la registra en el ledger. */
async function probe(
  options: HarnessLoopOptions,
  ledger: HarnessLedger,
  label: string,
  stage: 'base' | 'candidate' | 'composition',
  systemPrompt: string,
  tree: HarnessTree,
  attributedSessionId: string
): Promise<ProbeRun> {
  const result = await options.substrate.run({
    variantName: label,
    systemPrompt,
    task: options.task,
    workDir: options.workDir,
    timeoutMs: options.timeoutMs ?? 180_000,
    attributedSessionId,
  });

  // El ledger cuenta la sesion ATRIBUIDA (la sesion de propuesta), no la
  // fisica del substrate: cada invocacion del CLI es una sesion distinta,
  // pero el metodo cuenta cuantas sesiones de propuesta existen.
  //
  // El runId es el CRUDO del substrate: si dos etapas registraran el mismo
  // runId, el presupuesto estaria contando dos veces una corrida que solo
  // ocurrio una vez. Ese guard es el que hace auditable el conteo.
  ledger.record({
    label,
    stage,
    sessionId: attributedSessionId,
    runId: result.runId,
    tokens: result.inputTokens + result.outputTokens,
    costUsd: result.costUsd,
  });

  return {
    label,
    stage,
    sessionId: attributedSessionId,
    physicalSessionId: result.sessionId,
    runId: result.runId,
    ok: result.ok,
    delivered: result.delivered,
    completed: result.completed,
    error: result.error,
    render: result.render,
    rollout: result.rollout,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: result.costUsd,
    tree,
  };
}

/**
 * Construye el prompt de sistema de una variante.
 *
 * El prompt de la base se conserva y se anade el delta de la propuesta. Regla
 * de Harness^2 que se respeta aqui: el prompt describe el TRABAJO, nunca su
 * medicion. Por eso no se menciona ningun score, rubric ni benchmark.
 */
export function buildVariantPrompt(
  basePrompt: string,
  proposal: HarnessProposal,
  edited: HarnessTree,
  base: HarnessTree
): string {
  const diff = diffSurface(GV_SURFACE, base, edited);
  const touched = [...diff.modified, ...diff.added];
  if (touched.length === 0) return basePrompt;
  const changes = touched
    .map((rel) => {
      const after = edited[rel] ?? '';
      const before = base[rel];
      // Lo que se inyecta es el CAMBIO, no el archivo entero: el modelo
      // sigue lo que es saliente, y una regla al final de un archivo largo
      // se pierde. Los archivos NUEVOS van completos (todo es cambio).
      const body =
        before === undefined ? after : diffLines(before, after) || after;
      return `### ${rel}\n\n${body}`;
    })
    .join('\n\n');
  return [
    basePrompt,
    '',
    '## Ajuste de trabajo',
    '',
    proposal.description,
    '',
    changes,
  ].join('\n');
}

/** Reexporta la superficie para consumidores del bucle. */
export { GV_SURFACE };
export type { HarnessSurface, HarnessTree };