#!/usr/bin/env tsx
/**
 * Token Spike Guard (TSG) - Guardián de Picos de Tokens con Auto-Actions
 *
 * Versión: 2.0.0
 *
 * Monitorea uso de tokens en tiempo real y toma acciones automáticas:
 * - Alertas progresivas (warning -> soft -> hard -> critical)
 * - Auto-checkpoint en umbrales críticos
 * - Sugerencias de nueva sesión
 * - Kill switch de emergencia
 *
 * Usage:
 *   npx tsx src/tokens/token-spike-guard.ts --attach    # Adjuntar a sesión actual
 *   npx tsx src/tokens/token-spike-guard.ts --monitor   # Monitoreo continuo
 *   npx tsx src/tokens/token-spike-guard.ts --status    # Ver estado actual
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { dispatchAlert } from '../monitor/alert-dispatcher.js';
import { join, resolve } from 'path';
import { run } from '../core/run-command';

const ROOT = resolve(process.cwd());
const LOG_DIR = join(ROOT, '.runtime', 'token-guard-logs');
const STATE_FILE = join(ROOT, '.runtime', 'token-guard-state.json');

mkdirSync(LOG_DIR, { recursive: true });

// ─── Configuration ─────────────────────────────────────────────────────────────
/**
 * Umbrales CALIBRADOS (2026-11-06) contra el volumen real del stack.
 *
 * Metrica: tokens ACUMULADOS DE LA SESION (input + output + reasoning), leidos
 * de `token_transactions` en Nexus. Antes esta metrica nunca llegaba al guard:
 * el fallback consultaba la columna `timestamp`, que NO existe en esa tabla
 * (es `created_at`), asi que SQLite tiraba y el guard reportaba 0 siempre.
 *
 * Distribucion medida (680 sesiones reales --<=400 transacciones-- de los
 * ultimos 60 dias, 99.278 transacciones en total):
 *
 *   p50 = 40.526      p75 = 374.026      p90 = 2.610.670
 *   p95 = 8.088.169   p98 = 45.379.291   p99 = 78.500.612
 *   max = 106.215.700
 *
 * Los umbrales viejos (12M "critical" y 15M "emergency") caian POR DEBAJO del
 * p99: un 4% de las sesiones reales disparaba "critical" y un 3.5% "emergency
 * con cierre forzado". Eso es ruido, no proteccion.
 */
const CONFIG = {
  thresholds: {
    warning500k: 500000, // p77 - Informacional (21.8% de las sesiones reales)
    warning1M: 1000000, // p84 - Early warning (15.4%)
    warning3M: 3000000, // p90 - Checkpoint sugerido (9.0%)
    soft4M: 4000000, // p91 - Soft limit, sugerir nueva sesion (7.6%)
    hard8M: 8000000, // p95 - Hard limit, checkpoint automatico (5.0%)
    critical60M: 60000000, // p98.5 - Critical, kill switch (1.6%)
    emergency120M: 120000000, // > max observado - Emergency, force close (0.0%)
  },

  actions: {
    warning500k: { alert: true, log: true, notify: false },
    warning1M: { alert: true, log: true, notify: true, suggestCheckpoint: true },
    warning3M: {
      alert: true,
      log: true,
      notify: true,
      suggestCheckpoint: true,
      suggestNewSession: true,
    },
    soft4M: { alert: true, log: true, notify: true, createCheckpoint: true },
    hard8M: {
      alert: true,
      log: true,
      notify: true,
      createCheckpoint: true,
      suggestNewSession: true,
      warnUser: true,
    },
    critical60M: {
      alert: true,
      log: true,
      notify: true,
      createCheckpoint: true,
      forceNewSession: false,
      sendKillSwitch: true,
    },
    emergency120M: {
      alert: true,
      log: true,
      notify: true,
      createCheckpoint: true,
      forceNewSession: true,
      emergencyExit: true,
    },
  },

  monitorInterval: 10000, // 10 segundos
  burnRateWindow: 60, // 1 minuto para calcular burn rate

  alerting: {
    channels: ['cli', 'dashboard', 'file'],
  },
};

/** Umbrales exponidos para verificarlos desde tests (contrato de calibracion). */
export const TOKEN_THRESHOLDS = CONFIG.thresholds;

/** Config completa expuesta (umbrales + acciones) para verificarla desde tests. */
export const TOKEN_GUARD_CONFIG = CONFIG;

// ─── Logger ─────────────────────────────────────────────────────────────────────
function log(
  level: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL',
  message: string,
  meta?: Record<string, unknown>,
): void {
  const timestamp = new Date().toISOString();
  const prefixes = { INFO: 'ℹ️ ', WARN: '⚠️ ', ERROR: '❌', CRITICAL: '🆘' };
  const line = `[${timestamp}] ${prefixes[level]} [${level}] ${message}`;

  console.log(line);
  if (meta) console.log('  ', JSON.stringify(meta, null, 2));

  appendFileSync(join(LOG_DIR, 'guard.log'), line + '\n', 'utf-8');
}

// ─── State Management ───────────────────────────────────────────────────────────
interface GuardState {
  sessionId: string;
  startTime: number;
  checkpoints: number[];
  lastAlertLevel: string | null;
  lastAlertTime: number;
  totalTokensAtStart: number;
  currentBurnRate: number;
  projectedTimeToLimit: number | null;
}

function loadState(): GuardState {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch {}

  return {
    sessionId: process.env.SESSION_ID || 'unknown',
    startTime: Date.now(),
    checkpoints: [],
    lastAlertLevel: null,
    lastAlertTime: 0,
    totalTokensAtStart: 0,
    currentBurnRate: 0,
    projectedTimeToLimit: null,
  };
}

function saveState(state: GuardState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

// ─── Token Collection ─────────────────────────────────────────────────────────────
interface TokenMetrics {
  input: number;
  output: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total: number;
}

/**
 * SQL del fallback contra Nexus.
 *
 * `token_transactions` tiene la columna `created_at` (NO `timestamp`: esa
 * columna no existe y SQLite tiraba "no such column", el catch devolvia 0 y el
 * guard jamas midio nada). La metrica es POR SESION, no diaria: los umbrales
 * estan calibrados sobre tokens acumulados de una sesion.
 */
export const NEXUS_TOKEN_SQL = `
  SELECT
    SUM(COALESCE(input_tokens, 0))     AS input,
    SUM(COALESCE(output_tokens, 0))    AS output,
    SUM(COALESCE(reasoning_tokens, 0)) AS reasoning
  FROM token_transactions
  WHERE session_id = ?
`;

/** Id de la sesion actual: env -> estado -> archivos de sesion. */
function resolveSessionId(): string | null {
  const fromEnv = process.env.SESSION_ID?.trim();
  if (fromEnv && fromEnv !== 'unknown') return fromEnv;

  const fromState = loadState().sessionId?.trim();
  if (fromState && fromState !== 'unknown') return fromState;

  for (const source of [
    join(ROOT, '.session', 'token-usage.json'),
    join(ROOT, '.session', 'session-current.json'),
  ]) {
    try {
      if (!existsSync(source)) continue;
      const parsed = JSON.parse(readFileSync(source, 'utf-8'));
      const id = parsed?.sessionId ?? parsed?.id;
      if (typeof id === 'string' && id && id !== 'unknown') return id;
    } catch {}
  }
  return null;
}

/** Lectura minima de SQLite que necesita el guard (facilita el test). */
export interface NexusReader {
  prepare: (sql: string) => { get: (...args: any[]) => unknown };
}

/**
 * Lee los tokens acumulados de UNA sesion desde Nexus.
 * Si no hay id conocido, usa la sesion mas reciente (la que esta corriendo).
 */
export function readSessionTokens(db: NexusReader, sessionId: string | null): TokenMetrics {
  const row = (
    sessionId
      ? db.prepare(NEXUS_TOKEN_SQL).get(sessionId)
      : db
          .prepare(
            `SELECT
             SUM(COALESCE(input_tokens, 0))     AS input,
             SUM(COALESCE(output_tokens, 0))    AS output,
             SUM(COALESCE(reasoning_tokens, 0)) AS reasoning
           FROM token_transactions
           WHERE session_id = (
             SELECT session_id FROM token_transactions
             WHERE session_id IS NOT NULL AND session_id <> ''
             ORDER BY created_at DESC LIMIT 1
           )`,
          )
          .get()
  ) as { input?: number; output?: number; reasoning?: number } | undefined;

  const input = row?.input || 0;
  const output = row?.output || 0;
  const reasoning = row?.reasoning || 0;
  return { input, output, reasoning, total: input + output + reasoning };
}

/**
 * Interpreta las tres formas reales que tienen las fuentes de archivo.
 *
 * Antes el parser buscaba `input` / `output` en la raiz del JSON, pero los
 * archivos del stack usan otra forma:
 *   - `.session/token-usage.json`      -> totalInputTokens / totalOutputTokens / totalTokens
 *   - `.session/session-current.json`   -> totalInputTokens / totalOutputTokens / totalTokens
 *   - `reports/stack-live-observability-latest.json` -> token.current_session.{input_tokens,output_tokens}
 * Como no encontraba ninguna de esas claves, `tokens.input` era `undefined` y el
 * guard reportaba CERO en las tres fuentes: nunca midio nada.
 */
export function parseTokenSource(data: unknown): TokenMetrics | null {
  if (!data || typeof data !== 'object') return null;
  const root = data as Record<string, unknown>;

  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

  // Shape 1: tokenMetrics / tokens anidados.
  const nested = (root.tokenMetrics ?? root.tokens) as Record<string, unknown> | undefined;
  if (nested && typeof nested === 'object') {
    const input = num(nested.input ?? nested.input_tokens ?? nested.totalInputTokens);
    const output = num(nested.output ?? nested.output_tokens ?? nested.totalOutputTokens);
    const reasoning = num(nested.reasoning ?? nested.reasoning_tokens);
    const total = num(nested.total ?? nested.totalTokens) || input + output + reasoning;
    if (input || output || reasoning || total) {
      return { input, output, reasoning, total };
    }
  }

  // Shape 2: contadores en la raiz (token-usage.json / session-current.json).
  const rootInput = num(root.totalInputTokens ?? root.inputTokens ?? root.input_tokens);
  const rootOutput = num(root.totalOutputTokens ?? root.outputTokens ?? root.output_tokens);
  const rootTotal = num(root.totalTokens ?? root.total_tokens) || rootInput + rootOutput;
  if (rootInput || rootOutput || rootTotal) {
    return { input: rootInput, output: rootOutput, reasoning: 0, total: rootTotal };
  }

  // Shape 3: observability -> token.current_session.{input_tokens,output_tokens,total_tokens}
  const token = root.token as Record<string, unknown> | undefined;
  const current = token?.current_session as Record<string, unknown> | undefined;
  if (current && typeof current === 'object') {
    const input = num(current.input_tokens);
    const output = num(current.output_tokens);
    const total = num(current.total_tokens) || input + output;
    if (input || output || total) {
      return { input, output, reasoning: 0, total };
    }
  }

  return null;
}

/**
 * Varias fuentes, una metrica: se queda con la MAYOR.
 * Mismo criterio que `core/metrics-aggregator.ts`: nunca sub-reportar consumo.
 */
export function pickMostComplete(candidates: (TokenMetrics | null)[]): TokenMetrics {
  const valid = candidates.filter((c): c is TokenMetrics => Boolean(c));
  if (!valid.length) return { input: 0, output: 0, reasoning: 0, total: 0 };
  return valid.reduce((a, b) => (b.total > a.total ? b : a));
}

async function getCurrentTokens(): Promise<TokenMetrics> {
  const sources = [
    join(ROOT, 'reports', 'stack-live-observability-latest.json'),
    join(ROOT, '.session', 'session-current.json'),
    join(ROOT, '.session', 'token-usage.json'),
  ];

  const candidates: (TokenMetrics | null)[] = [];
  for (const source of sources) {
    try {
      if (!existsSync(source)) continue;
      candidates.push(parseTokenSource(JSON.parse(readFileSync(source, 'utf-8'))));
    } catch {}
  }

  // Nexus (tokens acumulados de la sesion actual)
  try {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(join(ROOT, '.runtime', 'gentle-vanguard.db'), { readonly: true });
    candidates.push(readSessionTokens(db, resolveSessionId()));
    db.close();
  } catch {}

  return pickMostComplete(candidates);
}

// ─── Burn Rate Calculation ──────────────────────────────────────────────────────
function calculateBurnRate(
  current: TokenMetrics,
  previous: TokenMetrics,
  timeDeltaSeconds: number,
): number {
  if (timeDeltaSeconds <= 0) return 0;

  const tokenDelta = current.total - previous.total;
  const burnRatePerSecond = tokenDelta / timeDeltaSeconds;
  const burnRatePerMinute = burnRatePerSecond * 60;

  return Math.max(0, burnRatePerMinute);
}

function projectTimeToLimit(
  current: number,
  burnRatePerMinute: number,
  limit: number,
): number | null {
  if (burnRatePerMinute <= 0) return null;

  const tokensRemaining = limit - current;
  const minutesRemaining = tokensRemaining / burnRatePerMinute;

  return Math.max(0, minutesRemaining);
}

// ─── Checkpoint Actions ───────────────────────────────────────────────────────────
async function createCheckpoint(reason: string): Promise<boolean> {
  log('INFO', `Creating checkpoint: ${reason}`);

  try {
    // run() resolves the npm .cmd shim safely on Windows (raw spawn('npm')
    // fails with EINVAL without a shell).
    const checkpoint = run('npm', ['run', 'checkpoint:create'], {
      cwd: ROOT,
      stdio: 'pipe',
    });

    return new Promise((resolve) => {
      checkpoint.on('close', (code) => {
        if (code === 0) {
          log('INFO', 'Checkpoint created successfully');
          resolve(true);
        } else {
          log('ERROR', `Checkpoint failed with code ${code}`);
          resolve(false);
        }
      });

      setTimeout(() => {
        checkpoint.kill();
        log('WARN', 'Checkpoint timeout');
        resolve(false);
      }, 30000);
    });
  } catch (err) {
    log('ERROR', 'Failed to create checkpoint', { error: String(err) });
    return false;
  }
}

// ─── Alert Actions ────────────────────────────────────────────────────────────────
interface AlertActions {
  alert?: boolean;
  log?: boolean;
  notify?: boolean;
  suggestCheckpoint?: boolean;
  suggestNewSession?: boolean;
  createCheckpoint?: boolean;
  warnUser?: boolean;
  forceNewSession?: boolean;
  sendKillSwitch?: boolean;
  emergencyExit?: boolean;
}

async function sendAlert(
  level: string,
  tokens: TokenMetrics,
  actions: AlertActions,
  burnRate: number,
  projection: number | null,
): Promise<void> {
  const emoji = level.includes('emergency')
    ? '🆘'
    : level.includes('critical')
      ? '🔴'
      : level.includes('hard')
        ? '🟠'
        : level.includes('soft')
          ? '🟡'
          : level.includes('3M')
            ? '🔵'
            : 'ℹ️';

  const message = `
╔══════════════════════════════════════════════════════════════════════════╗
║ ${emoji} TOKEN SPIKE GUARD ALERT: ${level.toUpperCase().padEnd(52)} ║
╠══════════════════════════════════════════════════════════════════════════╣
║ Tokens Used:      ${tokens.total.toLocaleString().padStart(12)} / ${(Math.max(...Object.values(CONFIG.thresholds)) || 15000000).toLocaleString().padStart(12)}  ║
║ Burn Rate:        ${(burnRate > 0 ? `+${burnRate.toFixed(0)}/min` : 'N/A').padStart(12)}                           ║
║ Time to Limit:    ${(projection !== null ? `~${projection.toFixed(1)} min` : 'N/A').padStart(12)}                           ║
╠══════════════════════════════════════════════════════════════════════════╣
║ ACTIONS TRIGGERED:                                                      ║
${actionsToString(actions)}
╚══════════════════════════════════════════════════════════════════════════╝
`;

  console.log(message);

  // Push al owner vía MCAS (dispatcher central, dedupe por nivel — esta
  // función ya solo corre en transiciones de nivel, no en cada ciclo).
  dispatchAlert({
    severity: level.startsWith('emergency')
      ? 'emergency'
      : level.startsWith('critical')
        ? 'critical'
        : level.startsWith('hard')
          ? 'critical'
          : 'warning',
    category: 'token-spike',
    message: `Token spike ${level}: ${tokens.total.toLocaleString()} tokens en la sesión (burn ${burnRate.toFixed(0)}/min)`,
    details:
      Object.entries(actions)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(', ') || undefined,
    recommendation: 'Cerrar o compactar la sesión para liberar presupuesto de contexto.',
    metrics: { level, total: tokens.total, burnRate, projection },
    dedupeKey: level,
    dedupeTtlMs: 0,
  });

  // Enviar a cada canal
  for (const channel of CONFIG.alerting.channels) {
    if (channel === 'file') {
      appendFileSync(join(LOG_DIR, 'alerts.log'), message, 'utf-8');
    } else if (channel === 'dashboard') {
      // Guardar para dashboard
      const dashboardPath = join(ROOT, '.session', 'alerts', 'token-guard.json');
      mkdirSync(join(ROOT, '.session', 'alerts'), { recursive: true });
      writeFileSync(
        dashboardPath,
        JSON.stringify(
          {
            level,
            tokens,
            actions,
            burnRate,
            projection,
            timestamp: Date.now(),
          },
          null,
          2,
        ),
        'utf-8',
      );
    }
  }
}

function actionsToString(actions: AlertActions): string {
  const lines: string[] = [];
  if (actions.suggestCheckpoint) lines.push('║ ✓ Suggest checkpoint');
  if (actions.createCheckpoint) lines.push('║ ✓ Auto-create checkpoint');
  if (actions.suggestNewSession) lines.push('║ ✓ Suggest new session');
  if (actions.forceNewSession) lines.push('║ ✓ ⚠️  Force new session');
  if (actions.warnUser) lines.push('║ ✓ ⚠️  WARN user');
  if (actions.sendKillSwitch) lines.push('║ ✓ 🛑 Kill switch armed');
  if (actions.emergencyExit) lines.push('║ ✓ 🆘 EMERGENCY EXIT');
  return lines.length > 0 ? lines.join('\n') + '\n' : '║ (monitoring only)\n';
}

// ─── Main Guard Logic ─────────────────────────────────────────────────────────────
/** Loop de monitoreo exportado (daemon GB-20261105-c). Corre hasta kill. */
export async function runGuardLoop(): Promise<void> {
  log('INFO', 'Token Spike Guard v2.0.0 starting...');

  const state = loadState();
  // El id de sesion real (env -> archivos de sesion). Sin esto, el estado
  // queda en 'unknown' y el guard mide la sesion mas reciente a ciegas.
  state.sessionId = resolveSessionId() ?? state.sessionId;
  let lastMetrics: TokenMetrics | null = null;
  let lastTime = Date.now();

  const guardLoop = async () => {
    try {
      const metrics = await getCurrentTokens();
      const now = Date.now();
      const timeDelta = (now - lastTime) / 1000;

      // Calcular burn rate
      if (lastMetrics) {
        state.currentBurnRate = calculateBurnRate(metrics, lastMetrics, timeDelta);
      }

      // Predecir tiempo al siguiente limite
      const thresholds = Object.entries(CONFIG.thresholds)
        .filter(([_, value]) => value > metrics.total)
        .sort((a, b) => a[1] - b[1]);

      if (thresholds.length > 0) {
        const [, nextValue] = thresholds[0];
        state.projectedTimeToLimit = projectTimeToLimit(
          metrics.total,
          state.currentBurnRate,
          nextValue,
        );
      }

      // Determinar nivel de alerta
      let alertLevel: string | null = null;
      let actions: AlertActions = {};

      if (metrics.total >= CONFIG.thresholds.emergency120M) {
        alertLevel = 'emergency120M';
        actions = CONFIG.actions.emergency120M;
      } else if (metrics.total >= CONFIG.thresholds.critical60M) {
        alertLevel = 'critical60M';
        actions = CONFIG.actions.critical60M;
      } else if (metrics.total >= CONFIG.thresholds.hard8M) {
        alertLevel = 'hard8M';
        actions = CONFIG.actions.hard8M;
      } else if (metrics.total >= CONFIG.thresholds.soft4M) {
        alertLevel = 'soft4M';
        actions = CONFIG.actions.soft4M;
      } else if (metrics.total >= CONFIG.thresholds.warning3M) {
        alertLevel = 'warning3M';
        actions = CONFIG.actions.warning3M;
      } else if (metrics.total >= CONFIG.thresholds.warning1M) {
        alertLevel = 'warning1M';
        actions = CONFIG.actions.warning1M;
      } else if (metrics.total >= CONFIG.thresholds.warning500k) {
        alertLevel = 'warning500k';
        actions = CONFIG.actions.warning500k;
      }

      // Solo alertar si cambió el nivel (evitar spam)
      if (alertLevel && alertLevel !== state.lastAlertLevel) {
        await sendAlert(
          alertLevel,
          metrics,
          actions,
          state.currentBurnRate,
          state.projectedTimeToLimit,
        );

        // Ejecutar acciones
        if (actions.createCheckpoint) {
          await createCheckpoint(`Token guard: ${alertLevel}`);
          state.checkpoints.push(Date.now());
        }

        state.lastAlertLevel = alertLevel;
        state.lastAlertTime = now;
      }

      // Log periódico del estado (cada minuto)
      if (now - state.lastAlertTime > 60000) {
        log(
          'INFO',
          `Status: ${metrics.total.toLocaleString()} tokens, burn rate: ${state.currentBurnRate.toFixed(0)}/min`,
        );
      }

      saveState(state);
      lastMetrics = metrics;
      lastTime = now;
    } catch (err) {
      log('ERROR', 'Guard loop error', { error: String(err) });
    }
  };

  // Ejecutar inmediatamente y luego cada 10s
  await guardLoop();
  setInterval(guardLoop, CONFIG.monitorInterval);

  log('INFO', `Guard monitoring every ${CONFIG.monitorInterval / 1000}s. Press Ctrl+C to stop.`);
}

// ─── CLI ──────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--attach')) {
    log('INFO', 'Attaching to current session...');
    await runGuardLoop();
  } else if (args.includes('--monitor')) {
    log('INFO', 'Starting monitor mode...');
    await runGuardLoop();
  } else if (args.includes('--status')) {
    const state = loadState();
    const metrics = await getCurrentTokens();

    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║           TOKEN SPIKE GUARD STATUS v2.0.0                       ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log(`Session ID:         ${resolveSessionId() ?? state.sessionId}`);
    console.log(
      `Runtime:            ${((Date.now() - state.startTime) / 1000 / 60).toFixed(1)} minutes`,
    );
    console.log(`Tokens Used:        ${metrics.total.toLocaleString()}`);
    console.log(`Burn Rate:          ${state.currentBurnRate.toFixed(0)} tokens/min`);
    console.log(`Last Alert Level:   ${state.lastAlertLevel || 'None'}`);
    console.log(`Checkpoints:        ${state.checkpoints.length}`);
    console.log(
      `Projected Time:     ${state.projectedTimeToLimit !== null ? state.projectedTimeToLimit.toFixed(1) + ' min' : 'N/A'}`,
    );
    console.log('');

    console.log('Thresholds:');
    Object.entries(CONFIG.thresholds).forEach(([key, value]) => {
      const status =
        metrics.total >= value
          ? '✅ REACHED'
          : `⏳ ${Math.round((1 - metrics.total / value) * 100)}% remaining`;
      console.log(`  ${key.padEnd(15)}: ${(value / 1000000).toFixed(1)}M ${status}`);
    });
    console.log('');
  } else {
    console.log('Token Spike Guard v2.0.0');
    console.log('');
    console.log('Usage:');
    console.log('  --attach         Attach to current session');
    console.log('  --monitor        Run continuous monitoring');
    console.log('  --status         Show current status');
    console.log('');
    console.log('Thresholds:');
    Object.entries(CONFIG.thresholds).forEach(([key, value]) => {
      console.log(`  ${key.padEnd(15)}: ${(value / 1000000).toFixed(1)}M tokens`);
    });
    console.log('');
    console.log('Auto-Actions:');
    console.log('  500K:    Log + Alert');
    console.log('  1M:      + Suggest checkpoint');
    console.log('  3M:      + Suggest new session');
    console.log('  4M:      + Create checkpoint');
    console.log('  8M:      + Warn user');
    console.log('  12M:     + Kill switch armed');
    console.log('  15M:     + Emergency exit');
  }
}

// Solo CLI cuando es entry-point directo (importar como librería no arranca nada).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    log('ERROR', 'Fatal error', { error: String(err) });
    process.exit(1);
  });
}

export { getCurrentTokens, calculateBurnRate, createCheckpoint };
