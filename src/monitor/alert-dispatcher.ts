#!/usr/bin/env tsx
/**
 * Alert Dispatcher — consumidor central de MCAS (multi-channel-alert).
 *
 * GAP cerrado: MCAS soportaba cli/file/dashboard/webhook/Discord/Slack pero
 * NO tenía un solo consumidor en src — el watchtower y el budget guard
 * reportaban a archivo sin notificar al owner. Este dispatcher es el punto
 * de entrada único: fire-and-forget, NUNCA lanza al caller, con dedupe por
 * fingerprint (TTL) para que eventos repetidos no saturen los canales.
 *
 * Canales activos sin credenciales externas: file (.runtime/alert-system/)
 * + dashboard (.session/alerts/realtime.json) + CLI. Discord/Slack/webhook
 * se activan solos si existen las env vars correspondientes.
 */

import { createHash } from 'crypto';
import { sendAlert } from './multi-channel-alert.js';

type Severity = 'info' | 'warning' | 'critical' | 'emergency';

export interface DispatchAlertOptions {
  severity: Severity;
  category: string;
  message: string;
  details?: string;
  recommendation?: string;
  metrics?: Record<string, unknown>;
  /** Clave de dedupe (default: message). Eventos con la misma clave dentro del TTL se descartan. */
  dedupeKey?: string;
  /** TTL del dedupe en ms (default 10 min). 0 = sin dedupe. */
  dedupeTtlMs?: number;
}

const DEFAULT_TTL_MS = 10 * 60_000;
const seen = new Map<string, number>();

function fingerprint(opts: DispatchAlertOptions): string {
  const base = `${opts.category}|${opts.dedupeKey ?? opts.message}`;
  return createHash('sha256').update(base).digest('hex');
}

/** True si el evento es duplicado dentro del TTL. Purga entradas vencidas. */
export function isDuplicate(opts: DispatchAlertOptions, now = Date.now()): boolean {
  const ttl = opts.dedupeTtlMs ?? DEFAULT_TTL_MS;
  if (ttl <= 0) return false;
  const fp = fingerprint(opts);
  const at = seen.get(fp);
  if (at !== undefined && now - at < ttl) return true;
  // purge caducados (barato: el mapa es pequeño)
  for (const [k, t] of seen) {
    if (now - t >= ttl) seen.delete(k);
  }
  seen.set(fp, now);
  return false;
}

/** Reset del dedupe (tests). */
export function resetDedupe(): void {
  seen.clear();
}

/**
 * Dispara una alerta por MCAS sin bloquear ni lanzar. Safe para llamar desde
 * cualquier ruta crítica (budget gate, watchtower, spike guard, delegaciones).
 */
export function dispatchAlert(opts: DispatchAlertOptions): void {
  try {
    if (isDuplicate(opts)) return;
    void sendAlert({
      id: `disp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      severity: opts.severity,
      category: opts.category,
      message: opts.message,
      details: opts.details,
      recommendation: opts.recommendation,
      metrics: opts.metrics,
      timestamp: new Date().toISOString(),
    }).catch(() => {
      /* canales caídos: file ya registró lo que pudo */
    });
  } catch {
    /* nunca lanzar al caller */
  }
}
