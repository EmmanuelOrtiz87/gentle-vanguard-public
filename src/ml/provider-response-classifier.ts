/**
 * Taxonomia compartida de respuestas de proveedor de modelos.
 *
 * Por que existe (2026-11-06): el doctor (`src/tools/opencode-model-doctor.ts`)
 * tenia la clasificacion de fallos de proveedor EMBEBIDA en su funcion de
 * probe. El probe de inferencia (`src/tools/model-inference-probe.ts`) necesita
 * EXACTAMENTE la misma taxonomia para no inventar otra, y el stack no puede
 * tener dos verdades sobre por que un proveedor fallo.
 *
 * El cuerpo del proveedor va primero: el mensaje explica mas que el codigo
 * HTTP (un 403 con "creditserror" no es un problema de permisos, es de saldo).
 */

export type ProviderResponseStatus =
  | 'OK'
  | 'NOT_FOUND'
  | 'AUTH_FAILED'
  | 'CLIENT_RESTRICTED'
  | 'SUBSCRIPTION_REQUIRED'
  | 'RATE_LIMITED'
  | 'USAGE_LIMIT'
  | 'INSUFFICIENT_BALANCE'
  | 'INTERNAL_ERROR'
  | 'PARAM_LEAK'
  | 'OPT_IN_REQUIRED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

export interface ProviderResponseClassification {
  status: ProviderResponseStatus;
  detail?: string;
  /** true cuando el proveedor RESPONDIO (no es un fallo de transporte). */
  responded: boolean;
  /** true cuando el fallo es de cuota/limite (no se arregla esperando). */
  quota: boolean;
}

const DETAIL_LIMIT = 200;

function clip(text: string): string {
  return text.slice(0, DETAIL_LIMIT);
}

/**
 * Clasifica una respuesta HTTP de un proveedor OpenAI-compatible.
 * Prioridad: cuerpo primero, codigo HTTP como fallback.
 */
export function classifyProviderResponse(
  httpStatus: number,
  body: string,
): ProviderResponseClassification {
  const text = body ?? '';
  const lower = text.toLowerCase();

  if (httpStatus >= 200 && httpStatus < 300) {
    return { status: 'OK', responded: true, quota: false };
  }

  if (lower.includes('freetiererror') || lower.includes('only be used from within opencode')) {
    return { status: 'CLIENT_RESTRICTED', detail: clip(text), responded: true, quota: false };
  }
  if (lower.includes('active opencode go subscription is required')) {
    return { status: 'SUBSCRIPTION_REQUIRED', detail: clip(text), responded: true, quota: true };
  }
  if (
    lower.includes('insufficient balance') ||
    lower.includes('creditserror') ||
    lower.includes('no resource package')
  ) {
    return { status: 'INSUFFICIENT_BALANCE', detail: clip(text), responded: true, quota: true };
  }
  if (
    lower.includes('usage limit') ||
    lower.includes('monthly limit') ||
    lower.includes('weekly limit') ||
    lower.includes('5-hour')
  ) {
    return { status: 'USAGE_LIMIT', detail: clip(text), responded: true, quota: true };
  }
  if (lower.includes('internal server error')) {
    return { status: 'INTERNAL_ERROR', detail: clip(text), responded: true, quota: false };
  }
  if (
    lower.includes('unsupported request parameter') ||
    (lower.includes('provider') && lower.includes('litellm_settings'))
  ) {
    return { status: 'PARAM_LEAK', detail: clip(text), responded: true, quota: false };
  }
  if (lower.includes('opt in') || lower.includes('explicit opt')) {
    return { status: 'OPT_IN_REQUIRED', detail: clip(text), responded: true, quota: false };
  }

  if (httpStatus === 401 || httpStatus === 403) {
    return { status: 'AUTH_FAILED', detail: clip(text), responded: true, quota: false };
  }
  if (httpStatus === 404) {
    return { status: 'NOT_FOUND', detail: clip(text), responded: true, quota: false };
  }
  if (httpStatus === 429) {
    return { status: 'RATE_LIMITED', detail: clip(text), responded: true, quota: true };
  }
  return {
    status: 'UNKNOWN',
    detail: `HTTP ${httpStatus}: ${clip(text)}`,
    responded: true,
    quota: false,
  };
}

/** Clasifica un fallo de transporte (sin respuesta HTTP). */
export function classifyProviderError(error: unknown): ProviderResponseClassification {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes('aborted') || msg.includes('timeout')) {
    return { status: 'TIMEOUT', detail: clip(msg), responded: false, quota: false };
  }
  return { status: 'NETWORK_ERROR', detail: clip(msg), responded: false, quota: false };
}
