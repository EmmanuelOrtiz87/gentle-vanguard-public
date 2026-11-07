#!/usr/bin/env node
/**
 * Probe de INFERENCIA REAL del modelo (no de catalogo).
 *
 * Por que existe (2026-11-06): la evidencia de salud de modelos hasta ahora
 * era un `GET /models` — "el proveedor es ALCANZABLE". Eso no dice si el
 * modelo RESPONDE. Un proveedor puede listar 45 modelos y no servir ninguno
 * (cuota, cliente restringido, sin suscripcion). El doctor ya hacia
 * `POST /chat/completions`, pero su resultado moria con el proceso.
 *
 * Este probe deja la evidencia donde el stack ya la sabe leer:
 *   .runtime/model-inference-evidence.json  (TTL, taxonomia compartida)
 *   token_usage                             (una fila real por inferencia OK)
 *
 * Con eso el watchtower puede dejar de suponer y el enforcer puede enrutar
 * solo a modelos CUALIFICADOS (inferencia real reciente y exitosa).
 *
 * Uso:
 *   npm run models:infer                       # sondea el modelo activo
 *   npm run models:infer -- --model opencode-zen-C/big-pickle
 *   npm run models:infer -- --check            # NO sondea: evalua evidencia
 *   npm run models:infer -- --json             # salida machine-readable
 *
 * Exit codes (contrato de la norma de verificaciones):
 *   0 = todos los objetivos respondieron OK
 *   1 = al menos un objetivo RESPONDIO con error (fallo comprobado)
 *   2 = INDETERMINADO (sin config/credencial, o fallo de transporte)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { createRequire } from 'module';
import type Database from 'better-sqlite3';
import {
  classifyProviderError,
  classifyProviderResponse,
} from '../ml/provider-response-classifier.js';
import {
  detectAuthKey,
  loadAuthFile,
  loadOpenCodeConfig,
  providerBaseURL,
  providerHeaders,
  type ProviderConfig,
} from '../ml/opencode-provider-config.js';
import {
  DEFAULT_INFERENCE_TTL_SECONDS,
  INFERENCE_EVIDENCE_VERSION,
  bareModelId,
  evaluateInferenceEntry,
  findInferenceEntry,
  inferenceEvidencePath,
  loadInferenceEvidence,
  providerBaseId,
  type InferenceEvidenceEntry,
  type InferenceEvidenceFile,
} from '../ml/model-inference-evidence.js';

const _require = createRequire(import.meta.url);
const ROOT = process.cwd();

const DEFAULT_TIMEOUT_MS = 20_000;
/**
 * Presupuesto para destinos LOCALES: cargan el modelo desde disco, no viajan
 * por la red. Medido: `qwen2.5-coder:14b` = 30,9 s en frio y 456 ms caliente.
 */
const DEFAULT_LOCAL_TIMEOUT_MS = 90_000;
/** Session id del probe: NO es el id de la sesion del agente (no suma al budget). */
const PROBE_SESSION_ID = 'probe:model-inference';

interface Target {
  provider: string;
  /** Id bare que entiende el provider (los catalogos de opencode usan ids bare). */
  model: string;
  /** Id completo `provider/model`, que es como se indexa la evidencia. */
  key: string;
}

interface ProbeOutcome extends InferenceEvidenceEntry {
  key: string;
}

function log(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function activeModel(): { model: string; provider: string } | null {
  const active = readJson<{ model?: string; provider?: string }>(
    `${ROOT}/.runtime/model-active.json`,
  );
  if (!active?.model) return null;
  const provider = active.provider || (active.model.includes('/') ? active.model.split('/')[0] : '');
  return { model: active.model, provider };
}

function parseArgs(argv: string[]): {
  json: boolean;
  check: boolean;
  registry: boolean;
  models: string[];
  ttl: number;
  timeoutMs: number;
  localTimeoutMs: number;
  writeDb: boolean;
  evidencePath: string | null;
} {
  const models: string[] = [];
  let ttl = DEFAULT_INFERENCE_TTL_SECONDS;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let localTimeoutMs = DEFAULT_LOCAL_TIMEOUT_MS;
  let evidencePath: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') continue;
    if (arg === '--check') continue;
    if (arg === '--no-db') continue;
    if (arg === '--registry') continue;
    if (arg === '--model') {
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        models.push(next);
        i += 1;
      }
      continue;
    }
    if (arg === '--evidence') {
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        evidencePath = next;
        i += 1;
      }
      continue;
    }
    if (arg === '--ttl') {
      const next = Number(argv[i + 1]);
      if (Number.isFinite(next) && next > 0) {
        ttl = next;
        i += 1;
      }
      continue;
    }
    if (arg === '--timeout') {
      const next = Number(argv[i + 1]);
      if (Number.isFinite(next) && next > 0) {
        timeoutMs = next;
        i += 1;
      }
      continue;
    }
    if (arg === '--local-timeout') {
      const next = Number(argv[i + 1]);
      if (Number.isFinite(next) && next > 0) {
        localTimeoutMs = next;
        i += 1;
      }
      continue;
    }
  }
  return {
    json: argv.includes('--json'),
    check: argv.includes('--check'),
    registry: argv.includes('--registry'),
    models,
    ttl,
    timeoutMs,
    localTimeoutMs,
    writeDb: !argv.includes('--no-db'),
    evidencePath,
  };
}

/**
 * Resuelve el provider REAL de un id bare.
 *
 * El registry usa alias que no existen en `opencode.json` (`opencode-go` frente
 * a `opencode-go-A/B/C`). Por eso el prefijo se normaliza a su base
 * (`providerBaseId`) y se busca el provider del catalogo que la declare.
 */
function resolveProviderForBare(
  bare: string,
  preferredBase: string,
  providers: Record<string, ProviderConfig>,
): string | undefined {
  const declaring = Object.entries(providers).filter(([, provider]) =>
    Boolean(provider.models && bare in provider.models),
  );
  if (!declaring.length) return undefined;
  const byBase = declaring.find(([id]) => providerBaseId(id) === providerBaseId(preferredBase));
  if (byBase) return byBase[0];
  return declaring[0][0];
}

/**
 * Candidatos que el enforcer PODRIA imponer: los del registry que son
 * gratuitos, con o sin `health.status` favorable.
 *
 * Se incluyen los `unknown` a proposito: su estado escrito a mano no es
 * evidencia, y son justamente los que el probe puede CALIFICAR (o descalificar)
 * con una inferencia real. Si solo se sondeara lo que el registry ya declara
 * `available`, la evidencia nunca podria contradecirlo.
 */
function registryCandidates(): string[] {
  const registry = readJson<{
    models?: Record<
      string,
      { health?: { status?: string }; costPer1kTokens?: { input?: number; output?: number } }
    >;
  }>(`${ROOT}/config/model-health-registry.json`);
  if (!registry?.models) return [];
  return Object.entries(registry.models)
    .filter(([, model]) => {
      const isFree =
        (model.costPer1kTokens?.input ?? 0) === 0 && (model.costPer1kTokens?.output ?? 0) === 0;
      const status = model.health?.status;
      return isFree && (status === 'available' || status === 'unknown');
    })
    .map(([id]) => id);
}

function resolveTargets(models: string[], includeRegistry: boolean): Target[] {
  const config = loadOpenCodeConfig();
  const providers = config?.provider ?? {};
  const active = activeModel();
  const targets: Target[] = [];

  const push = (provider: string, model: string): void => {
    const bare = bareModelId(model);
    const key = provider ? `${provider}/${bare}` : bare;
    if (!targets.some((t) => t.key === key)) targets.push({ provider, model: bare, key });
  };

  const requested = [...models];
  const explicit = models.length > 0;
  if (includeRegistry && !explicit) requested.push(...registryCandidates());
  if (requested.length === 0) {
    if (active) push(active.provider, active.model);
    return targets;
  }

  for (const raw of requested) {
    const value = raw.trim();
    if (!value) continue;
    const slash = value.indexOf('/');
    if (slash > 0) {
      const providerPart = value.slice(0, slash);
      const barePart = value.slice(slash + 1);
      if (providers[providerPart]) {
        push(providerPart, barePart);
        continue;
      }
      // Alias de provider (el registry usa `opencode-go`, el catalogo
      // `opencode-go-C`): se resuelve por el mismo base.
      const resolved = resolveProviderForBare(barePart, providerPart, providers);
      if (resolved) {
        push(resolved, barePart);
        continue;
      }
      push(providerPart, barePart);
      continue;
    }
    // Id bare: se resuelve contra el catalogo de providers. El provider
    // activo manda si declara el modelo; si no, el primero que lo declare.
    const resolved =
      resolveProviderForBare(value, active?.provider ?? '', providers) ?? active?.provider ?? '';
    push(resolved, value);
  }

  // El modelo activo siempre se sondea cuando el destino no fue explicito:
  // es el que el stack esta usando y el que el enforcer decide cambiar.
  if (!explicit && active) push(active.provider, active.model);
  return targets;
}

/**
 * true si el provider es local (ollama, lm-studio en loopback).
 *
 * Un destino local no paga un timeout de RED: paga la CARGA del modelo desde
 * disco. Medido en esta maquina: `qwen2.5-coder:14b` tarda 30,9 s en frio
 * (carga desde NVMe) y 456 ms caliente. Con un timeout de red de 6 s el modelo
 * local nunca llegaria a responder y la evidencia local seria siempre
 * INDETERMINADA.
 */
function isLocalProvider(baseURL: string): boolean {
  return /https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0)(:|\/|$)/i.test(baseURL);
}

async function probeTarget(
  target: Target,
  provider: ProviderConfig | undefined,
  key: string | null,
  timeoutMs: number,
  localTimeoutMs: number,
): Promise<ProbeOutcome> {
  const checkedAt = new Date().toISOString();
  const started = Date.now();

  if (!provider) {
    return {
      key: target.key,
      status: 'NOT_FOUND',
      responded: false,
      quota: false,
      detail: `provider '${target.provider}' no esta en opencode.json`,
      latencyMs: 0,
      checkedAt,
    };
  }

  const baseURL = providerBaseURL(provider);
  if (!baseURL) {
    return {
      key: target.key,
      status: 'NOT_FOUND',
      responded: false,
      quota: false,
      detail: 'el provider no declara baseURL',
      latencyMs: 0,
      checkedAt,
    };
  }

  // Un provider puede no necesitar credencial (ollama local, gateways con
  // auth propia). La ausencia de key NO es un fallo: se sondea igual y lo
  // decide la RESPUESTA (401 -> AUTH_FAILED).
  const url = `${baseURL.replace(/\/+$/, '')}/chat/completions`;
  const controller = new AbortController();
  // Un destino local paga la carga del modelo, no la latencia de la red.
  const budget = isLocalProvider(baseURL) ? localTimeoutMs : timeoutMs;
  const timer = setTimeout(() => controller.abort(), budget);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // El tier "go" de opencode exige un id de sesion para enrutar la
        // peticion; sin el, responde 400 MissingSessionID. Es sintetico y
        // sin contenido sensible (norma de probes remotos).
        'x-opencode-session': PROBE_SESSION_ID,
        ...providerHeaders(provider, key),
        'User-Agent': 'GentleVanguard-ModelInferenceProbe/1.0',
      },
      body: JSON.stringify({
        model: target.model,
        messages: [{ role: 'user', content: 'PING' }],
        max_tokens: 1,
        stream: false,
      }),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const text = await res.text();
      const classified = classifyProviderResponse(res.status, text);
      return {
        key: target.key,
        status: classified.status,
        responded: classified.responded,
        quota: classified.quota,
        detail: classified.detail,
        latencyMs,
        checkedAt,
      };
    }

    const payload = (await res.json().catch(() => null)) as {
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    } | null;
    return {
      key: target.key,
      status: 'OK',
      responded: true,
      quota: false,
      detail: 'inferencia real OK',
      latencyMs,
      checkedAt,
      promptTokens: payload?.usage?.prompt_tokens ?? 0,
      completionTokens: payload?.usage?.completion_tokens ?? 1,
    };
  } catch (error) {
    const classified = classifyProviderError(error);
    return {
      key: target.key,
      status: classified.status,
      responded: classified.responded,
      quota: classified.quota,
      detail: classified.detail,
      latencyMs: Date.now() - started,
      checkedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** true si dos ids `provider/model` apuntan al mismo slot de evidencia. */
function sameModelSlot(a: string, b: string): boolean {
  const split = (id: string): { provider: string; bare: string } => {
    const slash = id.indexOf('/');
    return slash > 0
      ? { provider: id.slice(0, slash), bare: id.slice(slash + 1).toLowerCase() }
      : { provider: '', bare: id.toLowerCase() };
  };
  const left = split(a);
  const right = split(b);
  if (left.bare !== right.bare) return false;
  if (!left.provider || !right.provider) return left.provider === right.provider;
  return providerBaseId(left.provider) === providerBaseId(right.provider);
}

/**
 * Registra la inferencia REAL en `token_usage`: el watchtower ya usa esa tabla
 * como prueba de exito reciente del proveedor. La fila lleva el id del probe
 * como session_id para no contaminar el budget de la sesion del agente.
 */
function recordUsage(outcomes: ProbeOutcome[]): number {
  const dbPath = `${ROOT}/.runtime/gentle-vanguard.db`;
  if (!existsSync(dbPath)) return 0;
  let db: Database.Database | undefined;
  try {
    const DatabaseCtor = _require('better-sqlite3') as typeof Database;
    db = new DatabaseCtor(dbPath);
    const insert = db.prepare(
      `INSERT INTO token_usage (session_id, prompt_tokens, completion_tokens, cost, model, timestamp)
       VALUES (?, ?, ?, 0, ?, datetime('now','localtime'))`,
    );
    let inserted = 0;
    for (const outcome of outcomes) {
      if (outcome.status !== 'OK') continue;
      insert.run(
        PROBE_SESSION_ID,
        outcome.promptTokens ?? 0,
        outcome.completionTokens ?? 1,
        outcome.key,
      );
      inserted += 1;
    }
    return inserted;
  } catch {
    return 0;
  } finally {
    db?.close();
  }
}

function writeEvidence(
  outcomes: ProbeOutcome[],
  ttlSeconds: number,
  targets: string[],
  path = inferenceEvidencePath(ROOT),
): string {
  const previous = loadInferenceEvidence(path);
  const results: Record<string, InferenceEvidenceEntry> = { ...(previous?.results ?? {}) };
  for (const outcome of outcomes) {
    const { key, ...entry } = outcome;
    // El mismo modelo puede haber sido sondeado bajo dos instancias del
    // catalogo (`opencode-go-A` y `opencode-go-C`). Son el MISMO slot: se
    // reemplaza la entrada anterior para no dejar dos (una vieja haria que un
    // exito reciente se lea como "sin veredicto").
    for (const existing of Object.keys(results)) {
      if (existing === key) continue;
      if (sameModelSlot(existing, key)) delete results[existing];
    }
    results[key] = entry;
  }
  const file: InferenceEvidenceFile = {
    version: INFERENCE_EVIDENCE_VERSION,
    generatedAt: new Date().toISOString(),
    ttlSeconds,
    targets,
    results,
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, 'utf-8');
  return path;
}

function verdictOf(outcomes: ProbeOutcome[]): 'PASS' | 'FAIL' | 'UNKNOWN' {
  if (outcomes.some((o) => o.responded && o.status !== 'OK')) return 'FAIL';
  if (outcomes.some((o) => o.status === 'OK')) return 'PASS';
  return 'UNKNOWN';
}

/**
 * Punto de entrada reutilizable: el wrapper de la tarea programada
 * (src/tools/refresh-model-inference-evidence.ts) lo invoca con argv propio
 * para mantener la evidencia del modelo activo fresca entre sesiones.
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  const targets = resolveTargets(args.models, args.registry);

  if (targets.length === 0) {
    if (args.json) {
      log(JSON.stringify({ status: 'indeterminate', reason: 'sin modelo objetivo' }, null, 2));
    } else {
      log('[model-inference-probe] INDETERMINADO: no hay modelo activo ni --model');
    }
    return 2;
  }

  // ── Modo --check: NO sondea. Evalua la evidencia existente contra su TTL.
  if (args.check) {
    const path = args.evidencePath ?? inferenceEvidencePath(ROOT);
    const file = loadInferenceEvidence(path);
    const entries = targets.map((t) => ({
      target: t.key,
      verdict: evaluateInferenceEntry(findInferenceEntry(file, t.key), file?.ttlSeconds),
    }));
    const overall = entries.some((e) => e.verdict === 'FAIL')
      ? 'FAIL'
      : entries.some((e) => e.verdict === 'PASS')
        ? 'PASS'
        : 'UNKNOWN';
    if (args.json) {
      log(JSON.stringify({ mode: 'check', overall, entries, evidencePath: path }, null, 2));
    } else {
      for (const entry of entries) {
        log(`[model-inference-probe] ${entry.verdict.padEnd(7)} ${entry.target}`);
      }
      log(
        `[model-inference-probe] evidencia -> ${path}` +
          (file ? ` (TTL ${file.ttlSeconds}s)` : ' (sin evidencia)'),
      );
    }
    return overall === 'FAIL' ? 1 : overall === 'PASS' ? 0 : 2;
  }

  // ── Modo sonda: inferencia real.
  const config = loadOpenCodeConfig();
  const providers = config?.provider ?? {};
  const auth = loadAuthFile();

  // Los objetivos se sondean EN PARALELO: el peor caso lo marca el timeout mas
  // largo, no la suma. Con 2-3 modelos, la sesion de arranque no paga la suma.
  const outcomes: ProbeOutcome[] = await Promise.all(
    targets.map(async (target) => {
      const provider = providers[target.provider];
      const credential = provider ? detectAuthKey(target.provider, provider, auth) : null;
      return probeTarget(
        target,
        provider,
        credential?.key ?? null,
        args.timeoutMs,
        args.localTimeoutMs,
      );
    }),
  );

  const evidencePath = writeEvidence(
    outcomes,
    args.ttl,
    targets.map((t) => t.key),
    args.evidencePath ?? undefined,
  );
  const recorded = args.writeDb ? recordUsage(outcomes) : 0;
  const overall = verdictOf(outcomes);

  if (args.json) {
    log(
      JSON.stringify(
        {
          mode: 'probe',
          overall,
          ttlSeconds: args.ttl,
          evidencePath,
          usageRecorded: recorded > 0,
          usageRows: recorded,
          results: outcomes.map((o) => ({
            model: o.key,
            status: o.status,
            responded: o.responded,
            quota: o.quota,
            latencyMs: o.latencyMs,
            detail: o.detail,
          })),
        },
        null,
        2,
      ),
    );
  } else {
    for (const outcome of outcomes) {
      const icon = outcome.status === 'OK' ? 'OK  ' : 'FAIL';
      log(
        `[model-inference-probe] ${icon} ${outcome.key}: ${outcome.status}` +
          `${outcome.detail ? ` (${outcome.detail.slice(0, 120)})` : ''} ${outcome.latencyMs}ms`,
      );
    }
    log(`[model-inference-probe] evidencia -> ${evidencePath} (TTL ${args.ttl}s)`);
    if (recorded > 0) log('[model-inference-probe] inferencia registrada en token_usage');
  }

  if (overall === 'FAIL') return 1;
  if (overall === 'PASS') return 0;
  return 2;
}

const invokedDirectly = process.argv[1]?.split(/[\\/]/).pop() === 'model-inference-probe.ts';
if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(
        `[model-inference-probe] fatal: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 2;
    });
}
