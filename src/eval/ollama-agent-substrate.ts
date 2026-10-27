/**
 * ollama-agent-substrate.ts — Substrate local con herramientas de LECTURA.
 *
 * El substrate de texto (`ollama-substrate.ts`) mide el efecto de una
 * edicion del harness SOBRE EL PROMPT. Pero el stack real es un agente con
 * contexto: lee reglas, consulta archivos, conoce convenciones. Medir solo
 * el prompt deja fuera la mitad de lo que hace que un harness funcione.
 *
 * El problema de darle herramientas es que rompe el control experimental: si
 * la variante puede ejecutar comandos, cada corrida depende de lo que
 * encuentra y las comparaciones dejan de ser comparables.
 *
 * La salida de este modulo: **herramientas de solo lectura** (leer un
 * archivo, listar un directorio, buscar un patron), con la lectura confinada
 * a la raiz del repo. La variante puede VER el stack, pero no puede
 * modificarlo: la comparacion sigue controlada y la medicion es fiel.
 *
 * El loop de herramientas es el clasico: se manda el request, si el modelo
 * pide herramientas se ejecutan, se appendea el resultado y se vuelve a
 * mandar, hasta un maximo de pasos.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

import type { Substrate, SubstrateRunRequest, SubstrateRunResult } from '../core/harness-loop.js';

/** Forma de una herramienta exponible al modelo. */
interface ToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}

export interface OllamaAgentSubstrateOptions {
  /** Base del servidor de Ollama. */
  baseUrl?: string;
  /** Modelo local. */
  model?: string;
  /** Timeout por llamada HTTP. */
  timeoutMs?: number;
  /**
   * Timeout total de la corrida (con pasos).
   *
   * Con herramientas, una corrida usa MUCHAS llamadas: un modelo de 14b con
   * razonamiento puede tardar minutos. Medido: el 14b aborto a los 300s
   * cargando el modelo y pensando; el 7b responde en ~40s pero se pierde en
   * el loop (repite la busqueda y termina inventando un comando).
   */
  runTimeoutMs?: number;
  /** Temperatura de muestreo. */
  temperature?: number;
  /** Maximo de pasos del loop de herramientas (1 = sin herramientas). */
  maxSteps?: number;
  /** Raiz desde la que se puede leer (por defecto, el cwd). */
  root?: string;
  /** Maximo de caracteres que devuelve una lectura. */
  maxReadChars?: number;
}

/** Instrucciones de uso de las herramientas (van en el system prompt). */
const TOOL_USAGE = [
  '## Herramientas del repo',
  '',
  'Para consultar el repo usá las herramientas:',
  '- `search_files(pattern)`: busca un texto en los archivos del repo.',
  '- `read_file(path)`: lee un archivo.',
  '- `list_dir(path)`: lista el contenido de una carpeta.',
  '',
  'Las herramientas son SOLO LECTURA y estan disponibles cuando la tarea las',
  'necesita. Si la tarea YA incluye los datos que pedis informar, no leas',
  'archivos: usá esos datos y RESPONDÉ directamente. Si consultás, leé el',
  'resultado y despues RESPONDÉ: la respuesta final es texto para el usuario,',
  'nunca una llamada a una herramienta. Las herramientas funcionan: si un',
  'resultado llega truncado, ya lo recibiste — no lo repitas ni digas que no',
  'podes leer archivos.',
].join('\n');

/** Una llamada de herramienta del modelo. */
interface ToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

/**
 * Interpreta una llamada de herramienta escrita como TEXTO.
 *
 * Los modelos locales suelen devolver `{"name":"read_file","arguments":{...}}`
 * en el contenido en vez de en `tool_calls`. Se acepta con las dos formas de
 * argumentos (objeto o string JSON) y se ignora cualquier otra cosa.
 */
export function parseToolCallFromText(text: string): ToolCall | null {
  const trimmed = text.trim();
  // Los modelos locales envuelven la llamada en un bloque cercado
  // (```json ... ```) y a veces emiten la llamada DOS veces seguidas
  // (dos objetos JSON concatenados). Se saca la valla y se extrae el
  // PRIMER objeto balanceado (conteo de llaves, respetando strings):
  // del primer "{" al último "}" no sirve con objetos concatenados.
  const unfenced = trimmed.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '').trim();
  const start = unfenced.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let end = -1;
  let inString = false;
  let escaped = false;
  for (let i = start; i < unfenced.length; i += 1) {
    const ch = unfenced[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1 || end <= start) return null;
  let parsed: { name?: unknown; arguments?: unknown; path?: unknown };
  try {
    parsed = JSON.parse(unfenced.slice(start, end + 1)) as typeof parsed;
  } catch {
    return null;
  }
  const name = typeof parsed.name === 'string' ? parsed.name : '';
  if (!name) return null;
  const args =
    typeof parsed.arguments === 'string'
      ? parsed.arguments
      : JSON.stringify(parsed.arguments ?? { path: parsed.path ?? '' });
  return { id: `text-${name}`, function: { name, arguments: args } };
}

/** Confina una ruta dentro de la raiz permitted. */
function safePath(root: string, candidate: string): string | null {
  const target = isAbsolute(candidate) ? candidate : resolve(root, candidate);
  const rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return target;
}

/** Herramientas de lectura expuestas al modelo. */
function toolDefinitions(root: string): ToolDefinition[] {
  const definitions: ToolDefinition[] = [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description:
          'Lee un archivo de texto del repo y devuelve su contenido. La ruta es relativa a la raiz del repo.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Ruta relativa del archivo' } },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_dir',
        description: 'Lista los archivos y directorios de una carpeta del repo.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Ruta relativa del directorio' } },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_files',
        description:
          'Busca un texto en los archivos del repo y devuelve las coincidencias (ruta:linea).',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Texto a buscar (sin regex)' },
            limit: { type: 'number', description: 'Maximo de coincidencias (default 20)' },
          },
          required: ['pattern'],
        },
      },
    },
  ];
  return definitions.map((tool) => ({
    ...tool,
    function: { ...tool.function, description: `${tool.function.description} (raiz: ${root})` },
  }));
}

/** Ejecuta una herramienta de lectura. */
function runTool(
  root: string,
  name: string,
  args: Record<string, unknown>,
  maxReadChars: number
): string {
  try {
    if (name === 'read_file') {
      const path = safePath(root, String(args.path ?? ''));
      if (!path) return 'ERROR: ruta fuera de la raiz permitida.';
      const content = readFileSync(path, 'utf-8');
      return content.length > maxReadChars
        ? `${content.slice(0, maxReadChars)}\n... (truncado, ${content.length} chars en total)`
        : content;
    }
    if (name === 'list_dir') {
      const path = safePath(root, String(args.path ?? '.'));
      if (!path) return 'ERROR: ruta fuera de la raiz permitida.';
      return readdirSync(path, { withFileTypes: true })
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort()
        .join('\n');
    }
    if (name === 'search_files') {
      const pattern = String(args.pattern ?? '');
      if (!pattern) return 'ERROR: falta el patron a buscar.';
      const limit = Number(args.limit ?? 20);
      const hits: string[] = [];
      const walk = (dir: string, prefix: string): void => {
        if (hits.length >= limit) return;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (hits.length >= limit) return;
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          const abs = join(dir, entry.name);
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            walk(abs, rel);
          } else if (/\.(md|ts|tsx|js|mjs|json|ya?ml|txt|py|sh)$/i.test(entry.name)) {
            try {
              const content = readFileSync(abs, 'utf-8');
              content.split('\n').forEach((line, i) => {
                if (hits.length < limit && line.includes(pattern)) {
                  hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 200)}`);
                }
              });
            } catch {
              /* binario o ilegible: se ignora */
            }
          }
        }
      };
      walk(root, '');
      return hits.length > 0 ? hits.join('\n') : `Sin coincidencias para "${pattern}".`;
    }
    return `ERROR: herramienta desconocida "${name}".`;
  } catch (error) {
    return `ERROR: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Substrate local con herramientas de SOLO LECTURA.
 *
 * `workDir` (el directorio de trabajo de la corrida) NO se usa como raiz de
 * lectura: la raiz es el repo, que es donde vive el harness que se quiere
 * medir. Lo que cambia entre variantes es el PROMPT (que lleva el diff de la
 * edicion), no lo que pueden ver.
 */
export function createOllamaAgentSubstrate(
  options: OllamaAgentSubstrateOptions = {}
): Substrate {
  const baseUrl = (options.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const model = options.model ?? 'qwen2.5-coder:7b';
  const temperature = options.temperature ?? 0.3;
  const maxSteps = options.maxSteps ?? 4;
  const root = resolve(options.root ?? process.cwd());
  const maxReadChars = options.maxReadChars ?? 4_000;

  return {
    name: `ollama-agent:${model}`,
    async run(request: SubstrateRunRequest): Promise<SubstrateRunResult> {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        options.runTimeoutMs ?? request.timeoutMs ?? options.timeoutMs ?? 300_000
      );
      const started = Date.now();

      const messages: Array<Record<string, unknown>> = [
        { role: 'system', content: `${request.systemPrompt}\n\n${TOOL_USAGE}` },
        { role: 'user', content: request.task },
      ];
      const tools = toolDefinitions(root);
      const trace: string[] = [];
      const seenCalls = new Set<string>();
      let toolCallsExecuted = 0;
      let refusalCorrected = false;
      let inputTokens = 0;
      let outputTokens = 0;
      let render = '';

      try {
        for (let step = 0; step < Math.max(1, maxSteps); step += 1) {
          const response = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              model,
              messages,
              tools,
              tool_choice: 'auto',
              stream: false,
              temperature,
              max_tokens: 2048,
            }),
            signal: controller.signal,
          });

          const raw = await response.text();
          if (!response.ok) {
            return {
              ok: false,
              delivered: false,
              sessionId: `ollama-agent-${request.variantName}`,
              runId: createHash('sha1').update(`${request.variantName}|${raw}`).digest('hex').slice(0, 16),
              render: '',
              completed: false,
              error: `Ollama respondio ${response.status}: ${raw.slice(0, 300)}`,
              rollout: raw.slice(0, 4000),
              inputTokens: 0,
              outputTokens: 0,
              costUsd: 0,
            };
          }

          const parsed = JSON.parse(raw) as {
            choices?: Array<{ message?: { content?: string; tool_calls?: ToolCall[] } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          inputTokens += parsed.usage?.prompt_tokens ?? 0;
          outputTokens += parsed.usage?.completion_tokens ?? 0;

          const message = parsed.choices?.[0]?.message;
          let calls = message?.tool_calls ?? [];
          render = (message?.content ?? '').trim();

          // Fallback tolerante: muchos modelos locales NO usan el campo
          // `tool_calls` y escriben la llamada como TEXTO (un JSON con
          // name/arguments). Medido con qwen2.5-coder:7b: emitio
          // `{"name":"read_file","arguments":{...}}` como contenido. Sin este
          // fallback, el agente "responde" con una llamada en vez de
          // ejecutarla.
          if (calls.length === 0 && /"name"\s*:/.test(render)) {
            const asText = parseToolCallFromText(render);
            if (asText) {
              calls = [asText];
              render = '';
            }
          }
          trace.push(`[paso ${step + 1}] ${calls.length > 0 ? `${calls.length} herramienta(s)` : 'respuesta final'}`);

          if (calls.length === 0) {
            // Correctivo por negacion: el modelo local a veces "responde" que
            // no puede leer archivos DESPUES de haber ejecutado herramientas
            // (medido con qwen2.5-coder:14b bajo el prompt completo del
            // harness). Si ya ejecuto al menos una herramienta con resultado,
            // la negacion es falsa: se corrige UNA vez y se le pide responder
            // con lo que ya tiene. Sin esto, la corrida se descarta entera.
            const refusal = /^(lo siento|no puedo|disculpa)/i.test(render);
            if (refusal && toolCallsExecuted > 0 && !refusalCorrected) {
              refusalCorrected = true;
              trace.push('  respuesta = negacion falsa (ya ejecuto herramientas): correctivo');
              messages.push({ role: 'assistant', content: render });
              messages.push({
                role: 'user',
                content:
                  'Esa negacion es incorrecta: las herramientas SI funcionaron y ya recibiste ' +
                  'sus resultados en esta conversacion (y la tarea ya incluye los datos que ' +
                  'necesitas). No tenes que volver a leer nada: RESPONDE AHORA la entrega ' +
                  'final en texto, usando los datos de la tarea y de los resultados que ya ' +
                  'tienes. Sin preambulos, sin disculpas.',
              });
              continue;
            }
            break;
          }

          toolCallsExecuted += calls.length;

          messages.push({ role: 'assistant', content: render, tool_calls: calls });
          for (const call of calls) {
            const name = call.function?.name ?? '';
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(call.function?.arguments ?? '{}') as Record<string, unknown>;
            } catch {
              args = {};
            }
            // Corte por repeticion: un modelo que pide la misma cosa dos
            // veces no esta progresando (medido con el 7b). Sin este corte, la
            // corrida gasta todos los pasos en lo mismo y la entrega final
            // termina siendo una llamada, no una respuesta.
            const signature = `${name}:${JSON.stringify(args)}`;
            if (seenCalls.has(signature)) {
              trace.push(`  ${signature} -> repetida: se corta`);
              messages.push({
                role: 'user',
                content:
                  'Ya consultaste eso y ya tenes el resultado. Si el resultado te muestra un ' +
                  'archivo, LEELO ahora con read_file(path). Despues de leer, RESPONDE con la ' +
                  'entrega final en texto: nunca repitas la misma busqueda y nunca inventes un ' +
                  'comando que no hayas leido.',
              });
              continue;
            }
            seenCalls.add(signature);
            const result = runTool(root, name, args, maxReadChars);
            trace.push(`  ${name}(${JSON.stringify(args).slice(0, 120)}) -> ${result.length} chars`);
            messages.push({
              role: 'tool',
              tool_call_id: call.id ?? name,
              content: result.slice(0, maxReadChars),
            });
          }
        }

        const elapsed = Date.now() - started;
        return {
          ok: Boolean(render),
          delivered: render.length > 0,
          sessionId: `ollama-agent-${request.variantName}`,
          runId: createHash('sha1').update(`${request.variantName}|${render}`).digest('hex').slice(0, 16),
          render,
          completed: render.length > 0,
          error: render ? undefined : 'Ollama no devolvio entrega.',
          rollout: [`# substrate ollama-agent`, `modelo=${model} elapsed_ms=${elapsed}`, ...trace].join('\n'),
          inputTokens,
          outputTokens,
          costUsd: 0,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          delivered: false,
          sessionId: `ollama-agent-${request.variantName}`,
          runId: createHash('sha1').update(`${request.variantName}|${message}`).digest('hex').slice(0, 16),
          render: '',
          completed: false,
          error: `No se pudo llamar a Ollama (${baseUrl}): ${message}`,
          rollout: message,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

/** Exporta el helper de rutas seguras (testeable). */
export { safePath as safeToolPath };
