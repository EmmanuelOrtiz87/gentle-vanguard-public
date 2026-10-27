/**
 * ollama-substrate.ts — Substrate local del bucle, sobre Ollama.
 *
 * Por que existe: el bucle de auto-mejora necesita MUCHAS corridas
 * comparables (4k rollouts por tarea en el presupuesto de Harness^2). Con un
 * proveedor de consumo, eso se topa con cuota, saldo y latencia: el primer
 * bucle real del stack se frenó porque la cuenta de opencode quedó sin
 * fondos. Un modelo LOCAL elimina esa dependencia: sin costo, sin cuota y sin
 * que el comportamiento cambie por culpa de una regla de tier.
 *
 * No es un modelo de frontera, y no pretende serlo: para COMPARAR variantes
 * de harness importa que el modelo sea el MISMO en todas y que no varíe con
 * el presupuesto. Un modelo local y fijo cumple eso mejor que uno de nube.
 *
 * Se habla la API compatible con OpenAI (`/v1/chat/completions`), que Ollama
 * expone de forma nativa: no hace falta SDK, ni Python, ni CLI.
 */

import { createHash } from 'node:crypto';

import type { Substrate, SubstrateRunRequest, SubstrateRunResult } from '../core/harness-loop.js';

export interface OllamaSubstrateOptions {
  /** Base del servidor de Ollama. */
  baseUrl?: string;
  /** Modelo local (ej. `qwen2.5-coder:7b`). */
  model?: string;
  /** Timeout por llamada, en ms. */
  timeoutMs?: number;
  /** Temperatura de muestreo. */
  temperature?: number;
  /** Tokens maximos de respuesta. */
  maxTokens?: number;
}

/** Modelos que el harness sugiere por defecto, del mas chico al mas capaz. */
export const DEFAULT_OLLAMA_MODEL = 'qwen2.5-coder:7b';

/** Compone el id de corrida a partir de la variante y la entrega. */
function runIdFor(variantName: string, render: string): string {
  return createHash('sha1').update(`${variantName}|${render.length}`).digest('hex').slice(0, 16);
}

/**
 * Substrate que corre cada variante contra un modelo local de Ollama.
 *
 * El prompt de sistema es el harness que se esta probando (con su delta) y la
 * tarea va como mensaje de usuario: es exactamente la misma division que usa
 * el substrate de opencode, para que las dos rutas sean comparables.
 */
export function createOllamaSubstrate(options: OllamaSubstrateOptions = {}): Substrate {
  const baseUrl = (options.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const model = options.model ?? DEFAULT_OLLAMA_MODEL;
  const temperature = options.temperature ?? 0.3;
  const maxTokens = options.maxTokens ?? 4096;

  return {
    name: `ollama:${model}`,
    async run(request: SubstrateRunRequest): Promise<SubstrateRunResult> {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        request.timeoutMs ?? options.timeoutMs ?? 180_000
      );
      const started = Date.now();

      try {
        const response = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: request.systemPrompt },
              { role: 'user', content: request.task },
            ],
            stream: false,
            temperature,
            max_tokens: maxTokens,
          }),
          signal: controller.signal,
        });

        const raw = await response.text();
        if (!response.ok) {
          return {
            ok: false,
            delivered: false,
            sessionId: `ollama-${request.variantName}`,
            runId: runIdFor(request.variantName, raw),
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
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const render = (parsed.choices?.[0]?.message?.content ?? '').trim();
        const elapsedMs = Date.now() - started;
        return {
          ok: Boolean(render),
          delivered: render.length > 0,
          sessionId: `ollama-${request.variantName}`,
          runId: runIdFor(request.variantName, render),
          render,
          completed: render.length > 0,
          error: render ? undefined : 'Ollama devolvio una respuesta vacia.',
          rollout: [
            `# substrate ollama`,
            `modelo=${model} elapsed_ms=${elapsedMs}`,
            raw.slice(0, 8000),
          ].join('\n'),
          inputTokens: parsed.usage?.prompt_tokens ?? 0,
          outputTokens: parsed.usage?.completion_tokens ?? 0,
          // El costo de un modelo local es electricidad: se reporta 0 y se
          // mide en tiempo, no en dolares.
          costUsd: 0,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          delivered: false,
          sessionId: `ollama-${request.variantName}`,
          runId: runIdFor(request.variantName, message),
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

/** Lista los modelos disponibles en el servidor de Ollama. */
export async function listOllamaModels(
  baseUrl = 'http://127.0.0.1:11434'
): Promise<Array<{ name: string; sizeGb: number }>> {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/tags`);
  if (!response.ok) return [];
  const parsed = (await response.json()) as {
    models?: Array<{ name?: string; size?: number }>;
  };
  return (parsed.models ?? [])
    .filter((m): m is { name: string; size: number } => Boolean(m.name))
    .map((m) => ({ name: m.name, sizeGb: Number(((m.size ?? 0) / 1e9).toFixed(1)) }));
}
