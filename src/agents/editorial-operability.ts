/**
 * Probe de operabilidad del agente editorial (eje "operable" del stack).
 *
 * Ejecuta una delegación mínima real por la cadena completa (route-and-delegate →
 * editorial-agent) y verifica el envelope. Es el E2E que faltaba cuando la ruta nació
 * rota (lección 2026-11-19): un agente sin probe no se considera confiable.
 *
 * Costo controlado: 1 llamada al proveedor cada 24 h (timestamp en .runtime) — sesiones
 * intermedias reportan el estado previo sin gastar cuota. Nunca bloquea la sesión:
 * step lazy, required:false, skipOnFailure.
 *
 * Uso: npm run agents:probe  |  autostart lazy step "agent-operability".
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { cachedVerdict } from './editorial-probe-cache.js';
import { editorialDelegationTimeoutSeconds } from '../orchestration/route-and-delegate.js';

const REPO = process.cwd();
const RUNTIME = join(REPO, '.runtime', 'agent-probe');
const LAST = join(RUNTIME, 'editorial.last.json');

function report(state: string, detail: Record<string, unknown>, exitCode: number): never {
  mkdirSync(RUNTIME, { recursive: true });
  writeFileSync(LAST, JSON.stringify({ at: new Date().toISOString(), state, ...detail }, null, 1));
  console.log(JSON.stringify({ state, ...detail }));
  process.exit(exitCode);
}

// 1. Frecuencia: si hay sonda fresca (<24 h), reportar sin gastar cuota.
//    NO se reescribe el registro: el resumen reportado pisaba el veredicto y el
//    step quedaba fallando en cada arranque (bug 2026-11-24, ver editorial-probe-cache).
if (existsSync(LAST)) {
  try {
    const verdict = cachedVerdict(JSON.parse(readFileSync(LAST, 'utf8')), Date.now());
    if (verdict) {
      console.log(
        JSON.stringify({ state: verdict.state, hoursAgo: verdict.hoursAgo, cached: true }),
      );
      process.exit(verdict.state === 'operable' ? 0 : 1);
    }
  } catch {
    /* timestamp ilegible: re-probar */
  }
}

// 2. Delegación mínima real por la cadena completa del orquestador — con un único
//    reintento (principio del stack: un fallo único no se declara roto)
const task =
  'Humaniza esta frase de prueba para el probe de operabilidad, conservando el dato y el marcador [[123456]] tal cual.';
const context =
  'La factura 123 fue emitida el 2026-11-19 por 12,5 EUR y sigue [[123456]] pendiente de cobro.';

function delegateOnce(): ReturnType<typeof spawnSync> {
  return spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      'src/orchestration/route-and-delegate.ts',
      '--task',
      task,
      '--context',
      context,
    ],
    {
      cwd: REPO,
      encoding: 'utf8',
      // El cap del spawn cubre el presupuesto REAL de la ruta (generación +
      // revisión) más margen; un cap menor mataba corridas válidas y el
      // veredicto `broken` medía el cap, no la ruta (misma clase que el bug
      // del circuit, 2026-11-26).
      timeout: (editorialDelegationTimeoutSeconds('rewrite') + 60) * 1000,
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
      // Sin AGENT_MODEL fijo: la sonda mide la resolucion canonica del stack
      // (env -> registryModel(operacion) -> fallback). El pin `gpt-5.6-sol` quedo
      // fuera del model-health-registry y el CLI de Codex colgaba 240 s por
      // intento (medido 2026-11-24).
      // GV_DELEGATION_PROBE: la sonda es observabilidad determinista — no debe
      // consumir el anti-loop (3 fallos la dejaban auto-bloqueada para siempre).
      env: { ...process.env, ORCHESTRATOR_REASONING_EFFORT: 'low', GV_DELEGATION_PROBE: '1' },
    },
  );
}

function parseEnvelope(res: ReturnType<typeof spawnSync>): any | null {
  const stdout = String(res.stdout ?? '');
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return null;
  }
}

let result = delegateOnce();
let route = parseEnvelope(result);
if (!route) {
  // Reintento único tras pausa breve
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15_000);
  result = delegateOnce();
  route = parseEnvelope(result);
}
if (!route) {
  report(
    'broken',
    {
      reason: 'sin envelope JSON del orquestador tras reintento (posible cuota/proveedor colgado)',
      exitCode: result.status,
      signal: result.signal,
      stderrTail: String(result.stderr ?? '').slice(-200),
    },
    1,
  );
}

const editorial = route?.delegation?.editorial;
const routedOk = route?.recommended === 'editorial-agent';
const delivered =
  route?.delegation?.success === true &&
  editorial?.output?.status === 'draft' &&
  typeof editorial?.output?.text === 'string' &&
  editorial.output.text.trim().length > 0;
const markerKept = delivered && editorial.output.text.includes('[[123456]]');

if (!routedOk || !delivered) {
  report(
    'broken',
    {
      reason: !routedOk
        ? 'el orquestador no derivó al editorial-agent'
        : 'el subagente no entregó draft',
      recommended: route?.recommended,
      providerFailures: editorial?.providerFailures,
      verification: editorial?.verification,
      claimState: editorial?.claimState,
      semanticState: editorial?.semanticState,
      consolidated: editorial?.consolidated?.verdict,
      model: editorial?.model,
    },
    1,
  );
}

report(
  'operable',
  {
    model: editorial.model,
    routed: true,
    delivered: true,
    markerKept,
    verification: editorial.verification,
    claimState: editorial.claimState,
    semanticState: editorial.semanticState,
    consolidated: editorial.consolidated?.verdict,
    durationMs: route?.delegation?.duration,
  },
  0,
);
