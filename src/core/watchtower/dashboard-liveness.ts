/**
 * dashboard-liveness.ts — ¿Está el dashboard VIVO o VIVO PERO MUERTO?
 *
 * EL BUG QUE ESTE MÓDULO ARREGLA (2026-11-02)
 * El dashboard WS estaba "vivo" en el puerto 8080 desde el 31/10 y su API HTTP
 * no respondía NADA (ni /api/health/live, ni /api/metrics, ni siquiera un 404
 * en 20s: el event loop estaba bloqueado). El puerto aceptaba conexiones TCP,
 * así que toda la cadena de supervision decía "está bien":
 *
 *   1. el check del watchtower: puerto abierto + HTTP muerto → WARN 'verify'
 *      (nunca 'restart');
 *   2. el autoheal del watchtower: `testPort()` → "WS alive, watchdog skipped";
 *   3. el launcher: puerto ocupado → "in use by another process" → exit 1.
 *
 * Tres capas, un mismo error de razonamiento: **PUERTO ABIERTO ≠ SERVICIO
 * SIRVIENDO**. Para un daemon HTTP, si la API no responde el daemon está
 * caido, diga lo que diga el socket. Con ese razonamiento, un dashboard
 * wedged quedaba wedged PARA SIEMPRE: nadie lo reiniciaba y nadie lo mataba.
 *
 * LA REGLA
 *   healthy → HTTP responde.
 *   wedged  → el puerto acepta pero la API no responde: hay que MATAR el
 *             proceso y relanzar (el event loop está bloqueado: reiniciar
 *             sin matar no sirve, el proceso nuevo no puede tomar el puerto).
 *   down    → ni puerto ni API: hay que arrancar de cero.
 *
 * ANTIFLAP
 * Un daemon sano puede tardar un par de segundos en responder (el dashboard
 * cachea un refresh de salud del repo). Por eso el reinicio exige FALLOS
 * CONSECUTIVOS: un solo probe lento no reinicia nada.
 */

export type DashboardLiveness = 'healthy' | 'wedged' | 'down';

export interface LivenessInput {
  /** La API HTTP respondio (health/live). */
  httpOk: boolean;
  /** El puerto TCP acepta conexiones. */
  portOpen: boolean;
}

export interface RecoveryInput extends LivenessInput {
  /** Fallos consecutivos acumulados (persistos entre corridas). */
  consecutiveFailures: number;
  /** Fallos consecutivos exigidos para actuar. */
  threshold?: number;
}

export interface RecoveryDecision {
  action: 'none' | 'restart';
  liveness: DashboardLiveness;
  /** Hay que matar al dueno del puerto antes de relanzar. */
  killPortOwner: boolean;
  reason: string;
}

/** Fallas consecutivas minimas antes de actuar (antiflap). */
export const DEFAULT_FAILURE_THRESHOLD = 2;

/** Clasifica el estado del daemon a partir de las dos sondas. */
export function classifyLiveness(input: LivenessInput): DashboardLiveness {
  if (input.httpOk) return 'healthy';
  if (input.portOpen) return 'wedged';
  return 'down';
}

/**
 * Decide que hacer con el daemon.
 *
 * `consecutiveFailures` debe venir de un contador PERSISTIDO entre corridas:
 * el watchtower corre cada N minutos, y un unico probe lento no es evidencia
 * de que el daemon este muerto.
 */
export function decideRecovery(input: RecoveryInput): RecoveryDecision {
  const threshold = Math.max(1, input.threshold ?? DEFAULT_FAILURE_THRESHOLD);
  const liveness = classifyLiveness(input);

  if (liveness === 'healthy') {
    return {
      action: 'none',
      liveness,
      killPortOwner: false,
      reason: 'API HTTP respondiendo',
    };
  }

  const livenessLabel =
    liveness === 'wedged'
      ? 'puerto abierto pero la API HTTP no responde (event loop bloqueado)'
      : 'puerto cerrado y API HTTP sin responder';

  if (input.consecutiveFailures < threshold) {
    return {
      action: 'none',
      liveness,
      killPortOwner: false,
      reason: `${livenessLabel} — fallo ${input.consecutiveFailures}/${threshold}, se espera antes de actuar`,
    };
  }

  return {
    action: 'restart',
    liveness,
    killPortOwner: liveness === 'wedged',
    reason: `${livenessLabel} — ${input.consecutiveFailures} fallos consecutivos: se reinicia`,
  };
}
