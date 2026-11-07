/**
 * Descubrimiento local (GB-20261107, pedido del owner): "que tome cualquiera
 * de los dos — ollama o LM Studio — sin importar el modelo que carguemos".
 *
 * Ambos exponen HTTP local y listan modelos:
 *   - ollama:    GET /api/tags        → { models: [{ name }] }
 *   - LM Studio: GET /v1/models       → { data: [{ id }] } (OpenAI-compatible)
 *
 * Semántica deliberada:
 *   - LM Studio solo SIRVE modelos cargados → se descubren TODOS los cargados
 *     (cargá el que quieras, el stack lo encuentra).
 *   - ollama lista TODOS los instalados (cargar uno = 30s de RAM): se
 *     descubre solo el modelo ACTIVO del stack, si está instalado.
 *   - Cualquier fallo de transporte → lista vacía (sin throw: la ausencia de
 *     un servidor local nunca rompe el sondeo).
 */

export interface LocalModelRef {
  provider: "ollama" | "lm-studio";
  /** Id EXACTO que el server espera en el campo model del /chat/completions. */
  modelId: string;
}

export interface LocalEndpoint {
  provider: "ollama" | "lm-studio";
  /** Endpoint de listado (ollama /api/tags, LM Studio /v1/models). */
  url: string;
}

export const LOCAL_ENDPOINTS: readonly LocalEndpoint[] = [
  { provider: "ollama", url: "http://127.0.0.1:11434/api/tags" },
  { provider: "lm-studio", url: "http://127.0.0.1:1234/v1/models" },
];

const DISCOVERY_TIMEOUT_MS = 3000;

/**
 * Descubre modelos locales. `activeOllamaModel` = id del modelo activo del
 * stack (p.ej. "qwen2.5-coder:14b"); para ollama solo ese califica. Para
 * LM Studio califica todo lo cargado.
 */
export async function discoverLocalModels(
  activeOllamaModel: string | null,
  endpoints: readonly LocalEndpoint[] = LOCAL_ENDPOINTS,
  fetchImpl: typeof fetch = fetch,
): Promise<LocalModelRef[]> {
  const out: LocalModelRef[] = [];
  for (const ep of endpoints) {
    try {
      const res = await fetchImpl(ep.url, { signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS) });
      if (!res.ok) continue;
      const body = (await res.json()) as {
        models?: Array<{ name?: string }>;
        data?: Array<{ id?: string }>;
      };
      if (ep.provider === "ollama") {
        const names = (body.models ?? []).map((m) => m.name).filter((n): n is string => Boolean(n));
        if (activeOllamaModel && names.includes(activeOllamaModel)) {
          out.push({ provider: "ollama", modelId: activeOllamaModel });
        }
      } else {
        for (const id of (body.data ?? []).map((m) => m.id)) {
          // Los modelos de embeddings no son chat: sondearlos solo genera
          // INTERNAL_ERROR de ruido en la evidencia.
          if (id && !/embed/i.test(id)) out.push({ provider: "lm-studio", modelId: id });
        }
      }
    } catch {
      // server caído o timeout: se salta sin ruido
    }
  }
  return out;
}
