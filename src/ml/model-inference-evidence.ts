/**
 * Evidencia de INFERENCIA real por modelo (lectura + veredicto).
 *
 * Por que existe (2026-11-06): el probe de salud (`src/tools/model-health-probe.ts`)
 * solo consulta `GET /models`: prueba que el CATALOGO es alcanzable, no que el
 * modelo RESPONDA. El doctor (`src/tools/opencode-model-doctor.ts`) ya hacia
 * inferencia real (`POST /chat/completions`), pero su resultado se perdia al
 * terminar el proceso: nadie mas lo podia leer.
 *
 * Este modulo es la unica fuente de verdad sobre "este modelo respondio de
 * verdad, hace X segundos". Lo leen el watchtower (clase B) y el enforcer
 * (para no enrutar a un modelo que no responde).
 *
 * Reglas:
 *  - La AUSENCIA de evidencia NO es un PASS: es INDETERMINADO.
 *  - Un error de TRANSPORTE (timeout, red) NO es un FAIL del modelo: no hubo
 *    respuesta que clasificar.
 *  - Un error DEL PROVEEDOR con respuesta (cuota, auth, restricted) es FAIL:
 *    el modelo contesto y no pudo servir.
 */

import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import type { ProviderResponseStatus } from './provider-response-classifier.js';

/** TTL por defecto de la evidencia de inferencia (15 minutos). */
export const DEFAULT_INFERENCE_TTL_SECONDS = 900;

export const INFERENCE_EVIDENCE_VERSION = 1;

export interface InferenceEvidenceEntry {
  status: ProviderResponseStatus;
  /** true cuando el proveedor RESPONDIO (no fue un fallo de transporte). */
  responded: boolean;
  /** true cuando el fallo es de cuota/limite. */
  quota: boolean;
  detail?: string;
  latencyMs?: number;
  checkedAt: string;
  promptTokens?: number;
  completionTokens?: number;
}

export interface InferenceEvidenceFile {
  version: number;
  generatedAt: string;
  ttlSeconds: number;
  targets: string[];
  results: Record<string, InferenceEvidenceEntry>;
}

/** PASS = respondio; FAIL = respondio con error; UNKNOWN = no hay veredicto. */
export type InferenceVerdict = 'PASS' | 'FAIL' | 'UNKNOWN';

export function inferenceEvidencePath(root = process.cwd()): string {
  return join(resolve(root), '.runtime', 'model-inference-evidence.json');
}

export function loadInferenceEvidence(
  path = inferenceEvidencePath(),
): InferenceEvidenceFile | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<InferenceEvidenceFile>;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      version: parsed.version ?? INFERENCE_EVIDENCE_VERSION,
      generatedAt: parsed.generatedAt ?? '',
      ttlSeconds: parsed.ttlSeconds ?? DEFAULT_INFERENCE_TTL_SECONDS,
      targets: parsed.targets ?? [],
      results: parsed.results ?? {},
    };
  } catch {
    return null;
  }
}

/** Ultimo segmento de un id `provider/model` (los providers usan ids bare). */
export function bareModelId(modelId: string): string {
  return (modelId.split('/').at(-1) ?? modelId).trim().toLowerCase();
}

/**
 * Id base de un provider: `opencode-go-C` y `opencode-go` son el mismo
 * proveedor (el sufijo es la instancia del catalogo). Sin esta normalizacion
 * la evidencia de `opencode-go-C/gpt-5.6-luna` no casaria con el id de
 * registry `opencode-go/gpt-5.6-luna`.
 */
export function providerBaseId(providerId: string): string {
  return providerId.trim().toLowerCase().replace(/-[a-z]$/, '');
}

function splitModelId(modelId: string): { provider: string; bare: string } {
  const slash = modelId.indexOf('/');
  if (slash <= 0) return { provider: '', bare: modelId.trim().toLowerCase() };
  return {
    provider: modelId.slice(0, slash).trim().toLowerCase(),
    bare: modelId.slice(slash + 1).trim().toLowerCase(),
  };
}

/**
 * Busca la entrada de un modelo. Acepta el id completo (`provider/model`), el
 * id bare, o cualquiera de los dos en otra caja: la evidencia se escribe con
 * el id que el enforcer y el watchtower ya usan, no con uno nuevo.
 *
 * Prioridad: exacto > mismo provider base + mismo modelo > mismo modelo.
 *
 * Entre candidatos del mismo slot (mismo provider base + mismo modelo) gana el
 * MAS FRESCO: el mismo modelo puede haber sido sondeado bajo dos instancias
 * del catalogo (`opencode-go-A` y `opencode-go-C`) y quedarse una entrada vieja
 * haria que un exito reciente se leyera como "sin veredicto".
 */
export function findInferenceEntry(
  file: InferenceEvidenceFile | null,
  modelId: string,
): InferenceEvidenceEntry | undefined {
  if (!file || !modelId) return undefined;
  const results = file.results ?? {};
  const direct = results[modelId];
  if (direct) return direct;

  const { provider, bare } = splitModelId(modelId);
  let fallback: InferenceEvidenceEntry | undefined;
  let fallbackAt = Number.NEGATIVE_INFINITY;

  for (const [key, entry] of Object.entries(results)) {
    const candidate = splitModelId(key);
    if (candidate.bare !== bare) continue;
    const at = Date.parse(entry.checkedAt);
    const fresh = Number.isFinite(at) ? at : 0;
    // Con provider en el pedido, la evidencia debe ser del MISMO provider
    // (mismo id o mismo base: `opencode-go` ~ `opencode-go-C`). Sin eso, dos
    // modelos distintos que comparten el ultimo segmento se confunden.
    if (provider && candidate.provider) {
      if (providerBaseId(candidate.provider) !== providerBaseId(provider)) continue;
      if (fresh >= fallbackAt) {
        fallback = entry;
        fallbackAt = fresh;
      }
      continue;
    }
    // El pedido no trae provider: el id bare es la unica ancla.
    if (!provider && fresh >= fallbackAt) {
      fallback = entry;
      fallbackAt = fresh;
    }
  }
  return fallback;
}

/**
 * Veredicto de una entrada contra su TTL.
 *  - entrada ausente o vencida -> UNKNOWN (no hay veredicto, no hay PASS)
 *  - no respondio (timeout/red) -> UNKNOWN (no hay respuesta que clasificar)
 *  - respondio OK               -> PASS
 *  - respondio con error        -> FAIL
 */
export function evaluateInferenceEntry(
  entry: InferenceEvidenceEntry | undefined,
  ttlSeconds = DEFAULT_INFERENCE_TTL_SECONDS,
  now = Date.now(),
): InferenceVerdict {
  if (!entry) return 'UNKNOWN';
  const checkedAt = Date.parse(entry.checkedAt);
  if (!Number.isFinite(checkedAt)) return 'UNKNOWN';
  const ageMs = now - checkedAt;
  if (ageMs < 0 || ageMs > ttlSeconds * 1000) return 'UNKNOWN';
  if (!entry.responded) return 'UNKNOWN';
  return entry.status === 'OK' ? 'PASS' : 'FAIL';
}

/** Veredicto de inferencia para un modelo concreto. */
export function inferenceVerdictFor(
  file: InferenceEvidenceFile | null,
  modelId: string,
  now = Date.now(),
): InferenceVerdict {
  if (!file) return 'UNKNOWN';
  const entry = findInferenceEntry(file, modelId);
  return evaluateInferenceEntry(entry, file.ttlSeconds, now);
}
