#!/usr/bin/env node

/**
 * dashboard-watchdog-policy.ts — Politica del watchdog del dashboard WS.
 *
 * POR QUE ESTA SEPARADO (2026-11-03)
 * `dashboard-ws-launcher.ts` ejecuta `launch()` al ser importado (no tiene
 * guard de entrypoint), asi que no se puede importar desde un test. Y
 * `dashboard-ws-autostart.ts` tiene el bucle de supervision en linea. Este
 * modulo concentra las DOS decisiones que importan, puras y testeables:
 *
 *   1) `watchdogIsAlive`  — hay un watchdog externo que_vele_vigila?
 *   2) `decideBudget`     — el watchdog sigue, reinicia o entra en modo
 *                           degradado?
 *
 * LAS DOS INVARIANTES
 *
 *   A) NUNCA hay un dashboard sin watchdog. Si el watchdog externo no esta
 *      vivo, hay que relanzarlo: el autoheal del watchtower lanza el SERVER,
 *      no el watchdog, asi que si nadie lo relanza el dashboard queda sin
 *      nadie que lo reinicie cuando se cuelgue.
 *
 *   B) El watchdog NUNCA se suicida. Antes, al agotar su presupuesto de
 *      reinicios hacia `return` (el proceso salia) y el dashboard quedaba
 *      sin supervisor de forma permanente y silenciosa. Ahora entra en modo
 *      degradado: sigue vigilando con menos presion y recupera el presupuesto
 *      completo en cuanto el server vuelve a estar sano.
 */

/** Estado del presupuesto de reinicios del watchdog. */
interface WatchBudgetState {
  /** Reinicios consumidos en la ventana actual. */
  restarts: number;
  /** true si ya esta en modo degradado (presupuesto agotado). */
  degraded: boolean;
}

type WatchBudgetAction = 'restart' | 'degrade';

interface WatchBudgetDecision {
  action: WatchBudgetAction;
  /** Nuevo valor de `restarts` a persistir. */
  restarts: number;
  /** Nuevo valor de `degraded` a persistir. */
  degraded: boolean;
  /** true si la transicion es NUEVA (para loguear una sola vez). */
  enteredDegraded: boolean;
}

/**
 * Decide que hacer con el presupuesto de reinicios.
 *
 * - Con presupuesto disponible: reiniciar (y consumir uno).
 * - Sin presupuesto: entrar en modo degradado. NO morir. Se reactiva el
 *   presupuesto completo cuando el server vuelve a estar sano.
 */
export function decideBudget(
  state: WatchBudgetState,
  maxRestarts: number,
): WatchBudgetDecision {
  if (state.restarts < maxRestarts) {
    return {
      action: 'restart',
      restarts: state.restarts + 1,
      degraded: state.degraded,
      enteredDegraded: false,
    };
  }
  return {
    action: 'degrade',
    restarts: 0,
    degraded: true,
    enteredDegraded: !state.degraded,
  };
}

/**
 * Hay un watchdog externo vivo?
 *
 * - Sin PID file: NO (hay que arrancarlo).
 * - PID file con un PID que no esta vivo: NO (hay que relanzarlo).
 * - PID file con un PID vivo: SI.
 *
 * `isAlive` es inyectable para que el test no dependa de procesos reales.
 */
export function watchdogIsAlive(
  pidFile: string,
  isAlive: (pid: number) => boolean,
  readFile: (path: string) => string | null,
): boolean {
  const raw = readFile(pidFile);
  if (raw === null) return false;
  const pid = Number(raw.trim());
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    return isAlive(pid);
  } catch {
    return false;
  }
}

/**
 * Que hacer con el puerto cuando hay que (re)arrancar el dashboard WS.
 *
 * - `reuse`   — arrancar en ESE puerto.
 * - `adopt`   — hay un server sano ahi: no hacer nada, adoptarlo.
 * - `find-free` — el puerto esta ocupado por algo que no se puede matar:
 *   buscar el siguiente puerto libre.
 */
type PortAction = 'reuse' | 'adopt' | 'find-free';

interface PortDecisionInput {
  /** El puerto esta ocupado. */
  busy: boolean;
  /** El servidor que lo ocupa responde la API HTTP. */
  healthy: boolean;
  /** Se pudo matar al daemon wedged registrado. */
  killed: boolean;
}

/**
 * Decide el destino del servidor WS.
 *
 * EL BUG QUE ESTA CUBRIENDO (2026-11-03): con el puerto ocupado y la API
 * muerta, el autostart hacia `getFreePort()` y se MUDABA al siguiente puerto
 * (8080 -> 8081). El daemon wedged seguia ocupando el puerto CANONICO y el
 * dashboard quedaba sirviendo en un puerto que nadie bekendeia (el proxy de
 * Vite y la URL conocida seguian apuntando al 8080).
 *
 * Ahora: si el daemon wedged es el REGISTER del stack, se mata y se REUSA el
 * mismo puerto. Solo se busca otro puerto cuando lo que ocupa el puerto no
 * se puede matar (un proceso ajeno no se toca).
 */
export function decidePortAction(input: PortDecisionInput): PortAction {
  if (!input.busy) return 'reuse';
  if (input.healthy) return 'adopt';
  return input.killed ? 'reuse' : 'find-free';
}
