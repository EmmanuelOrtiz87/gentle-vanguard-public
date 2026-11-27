#!/usr/bin/env npx tsx
/**
 * Model Enforcer - Garantiza uso del modelo gratuito disponible
 *
 * Cuando se detecta que un modelo tiene cuota agotada o no está disponible,
 * automáticamente reasigna todo el stack a usar opencode-zen-C/big-pickle
 * que es el único modelo gratuito y disponible.
 *
 * Uso: npx tsx src/ml/model-enforcer.ts [--check] [--apply]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'node:url';
import { writeSessionConfig } from '../tools/opencode-session-scope.js';
import {
  inferenceEvidencePath,
  inferenceVerdictFor,
  loadInferenceEvidence,
  type InferenceEvidenceFile,
} from './model-inference-evidence.js';

const ROOT = process.cwd();
const REGISTRY_PATH = join(ROOT, 'config', 'model-health-registry.json');
const ACTIVE_MODEL_PATH = join(ROOT, '.runtime', 'model-active.json');
const PREFERENCE_PATH = join(ROOT, 'config', 'model-preference.json');

const FREE_MODEL = 'opencode-zen-C/big-pickle';
const FREE_PROVIDER = 'opencode';

interface ModelPreference {
  preferredModel?: string;
  preferredProvider?: string;
  fallbackModel?: string;
  /** Substrate cloud de suscripción: se usa cuando ningún modelo gratuito sirve. */
  substrateModel?: string;
}

function readPreference(): ModelPreference {
  try {
    return JSON.parse(readFileSync(PREFERENCE_PATH, 'utf-8')) as ModelPreference;
  } catch {
    return {};
  }
}

function getPreferredModel(): { model: string; provider: string } {
  const preference = readPreference();
  if (preference.preferredModel) {
    return {
      model: preference.preferredModel,
      provider: preference.preferredProvider ?? preference.preferredModel.split('/')[0],
    };
  }
  return { model: FREE_MODEL, provider: FREE_PROVIDER };
}

/**
 * Resolve the model to enforce. The emergency fallback used to be a hardcoded
 * constant that was NEVER validated against the healthy list: when the preferred
 * model was down, the enforcer happily enforced the very model it had just
 * classified as unhealthy. Order of resolution, every candidate validated:
 *   1. preferred model        — unless there is current negative evidence
 *   2. configured fallback    — unless there is current negative evidence
 *   3. first healthy cloud model with "tools" (local only as last resort)
 * A model with a failed inference or an unreachable provider is never enforced.
 *
 * Adicion (2026-11-06): la evidencia de INFERENCIA REAL manda sobre la
 * alcanzabilidad. Un modelo con inferencia probada y FALLIDA (cuota, sin
 * suscripcion, presupuesto excedido) queda DESCALIFICADO aunque el registry
 * lo declare disponible: "alcanzable" no es "responde". Y si ningun modelo
 * esta calificado, NO se cambia el routing (no hay un routing mejor: cambiarlo
 * solo genera churn) — el FAIL queda reportado por el watchtower.
 */
/** Proveedores locales: existen en la máquina del owner y pueden estar apagados. */
const LOCAL_PROVIDERS = new Set(['ollama', 'lm-studio', 'lm-studio2']);

/** ¿El candidato corre en la máquina local? (prefijo del id o provider del registry) */
function isLocalModel(registry: ModelRegistry, modelId: string): boolean {
  const provider = registry.models[modelId]?.provider ?? modelId.split('/')[0];
  return (
    LOCAL_PROVIDERS.has(provider) ||
    modelId.startsWith('ollama/') ||
    modelId.startsWith('lm-studio')
  );
}

export function resolveTargetModel(
  status: {
    healthy: string[];
    unhealthy: string[];
    qualified: string[];
    disqualified?: string[];
    unreachable?: string[];
  },
  preferred: { model: string; provider: string },
  registry: ModelRegistry,
): { target: { model: string; provider: string } | null; reason: string } {
  // La flota de agentes del stack USA HERRAMIENTAS: imponer un modelo sin la
  // capability "tools" deja a los agentes sin poder leer archivos ni ejecutar
  // nada (medido 2026-11-18: el enforcer Swanson al fleet a
  // ollama/qwen2.5-coder:14b, que solo declara "code", y el guard
  // opencode-agent-model-guard quedo en rojo). Un modelo solo sirve para
  // routing de agentes si declara la capacidad que los agentes necesitan.
  const usable = (model: string) => declaresTools(registry, model);

  // El modelo PREFERIDO (model-preference.json) es la ruta declarada: solo una
  // evidencia negativa VIGENTE (inferencia fallida, cuota o proveedor medido
  // inalcanzable) lo saca. Exigir `healthy` lo degradaba por su `health.status`
  // estático en `unknown` y el barrido terminaba en Ollama (drift medido
  // 2026-11-26: primario del orquestador reescrito a local en cada arranque).
  // `unreachable` es distinto de `unhealthy`: este ultimo tambien lista
  // modelos pagos o de estado estatico desconocido, que no son evidencia
  // negativa vigente.
  const unreachable = status.unreachable ?? [];
  if (
    usable(preferred.model) &&
    !(status.disqualified ?? []).includes(preferred.model) &&
    !unreachable.includes(preferred.model)
  ) {
    const qualified = status.qualified.includes(preferred.model);
    return {
      target: preferred,
      reason: qualified
        ? 'Preferred model available (calificado por inferencia real)'
        : 'Preferred model kept: sin evidencia negativa vigente',
    };
  }

  const configuredFallback = readPreference().fallbackModel;
  if (
    configuredFallback &&
    usable(configuredFallback) &&
    !(status.disqualified ?? []).includes(configuredFallback) &&
    !unreachable.includes(configuredFallback)
  ) {
    return {
      target: {
        model: configuredFallback,
        provider: registry.models[configuredFallback]?.provider ?? configuredFallback.split('/')[0],
      },
      reason: 'Fallback: preferred model unavailable, configured fallback healthy',
    };
  }

  // Canon 2026-11-26: el local es el caso EXCEPCIONAL, nunca la ruta. Antes el
  // primer candidato calificado podía ser Ollama (una inferencia local no
  // distingue "el servicio está prendido" de "es la ruta correcta") y el
  // enforcer escribía ollama como primario del orquestador en cada arranque.
  // Los barridos automáticos priorizan la nube; el local solo entra si no queda
  // ningún candidato nube sano (Ollama ni siquiera está siempre activo).
  const candidates = status.healthy.filter(usable);
  const cloudCandidates = candidates.filter((model) => !isLocalModel(registry, model));

  const firstQualified =
    cloudCandidates.find((model) => status.qualified.includes(model)) ?? cloudCandidates[0];
  if (firstQualified) {
    return {
      target: {
        model: firstQualified,
        provider: registry.models[firstQualified]?.provider ?? firstQualified.split('/')[0],
      },
      reason: status.qualified.includes(firstQualified)
        ? 'Fallback: first model qualified by real inference (with tools)'
        : 'Fallback: preferred and configured fallback unavailable, first healthy cloud model with tools',
    };
  }

  // Ningún free cloud utilizable: la siguiente ruta es el substrate cloud de
  // suscripción declarado (el que sostiene al orquestador), NUNCA el local.
  // El local es el último recurso: puede ni estar activo (canon 2026-11-26).
  const isPaidCloud = (id: string) => {
    const entry = registry.models[id];
    if (!entry || isLocalModel(registry, id) || !usable(id)) return false;
    if ((status.disqualified ?? []).includes(id)) return false;
    const cost = (entry.costPer1kTokens?.input ?? 0) + (entry.costPer1kTokens?.output ?? 0);
    return entry.tier === 'subscription' || cost > 0;
  };
  const substrate = readPreference().substrateModel;
  const paidPick =
    (substrate && isPaidCloud(substrate) ? substrate : undefined) ??
    Object.keys(registry.models).find(isPaidCloud);
  if (paidPick) {
    return {
      target: {
        model: paidPick,
        provider: registry.models[paidPick]?.provider ?? paidPick.split('/')[0],
      },
      reason: 'Fallback: sin modelos gratuitos utilizables, substrate cloud de suscripción',
    };
  }

  // Último recurso: un modelo local sano con tools (el owner puede tenerlo
  // prendido; si no, no hay routing mejor y el FAIL lo reporta el watchtower).
  const firstLocal = candidates[0];
  if (firstLocal) {
    return {
      target: {
        model: firstLocal,
        provider: registry.models[firstLocal]?.provider ?? firstLocal.split('/')[0],
      },
      reason:
        'Fallback: sin modelos nube utilizables, último recurso local calificado (with tools)',
    };
  }

  return { target: null, reason: 'No healthy model with the "tools" capability available' };
}

interface ModelEntry {
  provider: string;
  health: { status: string };
  tier?: string;
  costPer1kTokens?: { input: number; output: number };
  capabilities?: string[];
  fallbackChain?: string[];
}

/**
 * Capacidad que la flota de agentes necesita: sin "tools" el agente no puede
 * trabajar (no lee archivos, no ejecuta comandos).
 */
export const REQUIRED_AGENT_CAPABILITY = 'tools';

/** ¿El modelo declara la capability que necesitan los agentes? */
export function declaresTools(registry: ModelRegistry, modelId: string): boolean {
  const caps = registry.models[modelId]?.capabilities;
  return Array.isArray(caps) && caps.includes(REQUIRED_AGENT_CAPABILITY);
}

interface ModelRegistry {
  models: Record<string, ModelEntry>;
  routingRules: {
    orchestrator: { primary: string };
    subagents: { default: string };
  };
}

type LogEntry = {
  timestamp: string;
  action: string;
  details: string;
};

function log(message: string): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    action: 'ENFORCER',
    details: message,
  };
  console.log(`[${entry.timestamp}] ${message}`);
}

/**
 * Evidencia FRESCA de disponibilidad de proveedores.
 *
 * Lo que dice `config/model-health-registry.json` es `health.status`, pero ese
 * dato esta escrito a mano y envejece (el ultimo `lastChecked` era de agosto).
 * La ausencia de evidencia no es evidencia de salud. Este archivo lo escribe
 * `src/tools/model-health-probe.ts` con un timestamp real.
 */
interface ProviderEvidence {
  reachable: boolean;
  models: number;
  error?: string;
  checkedAt: string;
}

const EVIDENCE_PATH = join(ROOT, '.runtime', 'model-health-evidence.json');
/** Evidencia mas vieja que esto se considera ausente (no descalifica). */
const EVIDENCE_TTL_MS = 6 * 60 * 60 * 1000;

function loadProviderEvidence(): Record<string, ProviderEvidence> {
  try {
    const file = JSON.parse(readFileSync(EVIDENCE_PATH, 'utf-8')) as {
      providers?: Record<string, ProviderEvidence>;
    };
    return file.providers ?? {};
  } catch {
    return {};
  }
}

/**
 * El id del modelo puede venir del registry con un provider que no coincide
 * con el id de OpenCode (`opencode-go` vs `opencode-go-A`). Se prueban los
 * candidatos y gana el primero que tenga evidencia.
 */
function evidenceFor(
  modelId: string,
  registryProvider: string,
  evidence: Record<string, ProviderEvidence>,
): ProviderEvidence | undefined {
  const candidates = [
    registryProvider,
    modelId.split('/')[0],
    modelId.split('/').slice(0, 2).join('/'),
  ];
  for (const candidate of candidates) {
    if (candidate && evidence[candidate]) return evidence[candidate];
  }
  return undefined;
}

function checkModelHealth(): {
  healthy: string[];
  unhealthy: string[];
  free: string[];
  evidenceAgeHours: number | null;
  qualified: string[];
  disqualified: string[];
  unreachable: string[];
} {
  const registry: ModelRegistry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
  const evidence = loadProviderEvidence();
  const cutoff = Date.now() - EVIDENCE_TTL_MS;

  // Evidencia de INFERENCIA REAL (src/tools/model-inference-probe.ts):
  // un modelo que RESPONDIO con error esta descalificado aunque el registry
  // lo declare disponible. La ausencia de evidencia NO descalifica: solo la
  // prueba contraria (inferencia fallida y vigente) lo hace.
  const inference = loadInferenceEvidence(inferenceEvidencePath(ROOT));
  const now = Date.now();

  const healthy: string[] = [];
  const unhealthy: string[] = [];
  const free: string[] = [];
  const qualified: string[] = [];
  const disqualified: string[] = [];
  const unreachable: string[] = [];
  let evidenceAgeHours: number | null = null;

  for (const [id, model] of Object.entries(registry.models)) {
    const isHealthy = model.health.status === 'available';
    const cost = model.costPer1kTokens;
    const isFree = !cost || (cost.input === 0 && cost.output === 0);

    // La INFERENCIA REAL manda sobre la alcanzabilidad del catalogo.
    // Antes el orden era el inverso: una evidencia de proveedor vieja (por
    // ejemplo "ollama inalcanzable" de cuando el servidor local estaba caido)
    // vetaba el modelo y el loop continuaba ANTES de mirar la inferencia.
    // Un modelo que acaba de responder no puede ser "inalcanzable".
    const verdict = inferenceVerdictFor(inference, id, now);
    if (verdict === 'FAIL') {
      disqualified.push(id);
      if (isFree) free.push(id);
      unhealthy.push(id);
      continue;
    }
    if (verdict === 'PASS') {
      // Una inferencia REAL exitosa es salud. El `health.status` del registry
      // esta escrito a mano y envejece: no puede vetar una medicion vigente.
      // Sin esta regla, un modelo local que responde bien seguiria siendo
      // "unknown" y el stack se quedaria sin modelo mientras la cuota remota
      // esta agotada.
      qualified.push(id);
      if (isFree) {
        free.push(id);
        healthy.push(id);
      } else {
        unhealthy.push(id);
      }
      continue;
    }

    // Sin veredicto de inferencia: manda la evidencia de proveedor y el
    // estado estatico del registry.
    const providerEvidence = evidenceFor(id, model.provider, evidence);
    if (providerEvidence) {
      const ageHours = (Date.now() - Date.parse(providerEvidence.checkedAt)) / 3_600_000;
      if (evidenceAgeHours === null || ageHours < evidenceAgeHours) evidenceAgeHours = ageHours;
      const fresh = Date.parse(providerEvidence.checkedAt) > cutoff;
      if (fresh && !providerEvidence.reachable) {
        if (isFree) free.push(id);
        unhealthy.push(id);
        unreachable.push(id);
        continue;
      }
    }

    if (isFree) free.push(id);
    if (isHealthy && isFree) {
      healthy.push(id);
    } else {
      unhealthy.push(id);
    }
  }

  return { healthy, unhealthy, free, evidenceAgeHours, qualified, disqualified, unreachable };
}

function enforceFreeModel(): void {
  log('=== INICIANDO ENFORCEMENT DE MODELO GRATUITO ===');

  // 1. Verificar estado actual
  const status = checkModelHealth();
  log(`Modelos saludables y gratuitos: ${status.healthy.join(', ')}`);
  log(`Modelos con problemas: ${status.unhealthy.join(', ')}`);
  log(
    `Calificados por inferencia real: ${status.qualified.join(', ') || 'ninguno'}` +
      ` | Descalificados: ${status.disqualified.join(', ') || 'ninguno'}`,
  );
  if (status.evidenceAgeHours === null) {
    log(
      'Evidencia de proveedores: AUSENTE (sin probe) — el registry manda, pero su health.status es estatico',
    );
  } else {
    log(
      `Evidencia de proveedores: probe de hace ${status.evidenceAgeHours.toFixed(1)}h (un proveedor inalcanzable descalifica sus modelos)`,
    );
  }

  const preferred = getPreferredModel();
  // El registry se lee ANTES de resolver el objetivo: la seleccion depende de
  // las capacidades declaradas, no solo de la salud.
  const registry: ModelRegistry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
  const { target, reason } = resolveTargetModel(status, preferred, registry);

  // Sin ningun modelo disponible NO hay un routing mejor que el actual:
  // cambiarlo solo genera churn y deja el stack peor. El FAIL queda
  // reportado por el watchtower (model-provider-health / inference probe).
  if (!target) {
    log('❌ ERROR: No hay modelos saludables disponibles');
    log(
      `   Descalificados por inferencia real: ${status.disqualified.join(', ') || 'ninguno'}` +
        ` | Sin calificar: ${status.healthy.length === 0 ? 'todos' : '—'}`,
    );
    log('   Routing NO se modifica (no hay modelo alternativo probado)');
    process.exit(0);
  }

  log(`Modelo preferido: ${preferred.model}; seleccionado: ${target.model}`);
  if (target.model === preferred.model && !status.healthy.includes(target.model)) {
    log(`WARN: ${target.model} no figura como saludable — no hay modelo healthy disponible`);
  }

  // 2. Actualizar registry para que el modelo preferido sea el primario;
  // solo cae al modelo gratuito si el preferido no está disponible.

  if (registry.routingRules.orchestrator.primary !== target.model) {
    const previous = registry.routingRules.orchestrator.primary;
    log(`Cambiando primary: ${previous} → ${target.model}`);
    registry.routingRules.orchestrator.primary = target.model;
    // La cadena canonica se deriva como [primary, ...models[primary].fallbackChain].
    // Si el primary cambia y el nuevo no arrastra al anterior, la cadena pierde
    // cobertura y los agentes configurados con el modelo viejo quedan fuera
    // (medido 2026-11-18: el delegator quedo sin modelo valido en su cadena).
    const entry = registry.models[target.model];
    if (
      entry &&
      previous &&
      previous !== target.model &&
      !(entry.fallbackChain ?? []).includes(previous)
    ) {
      entry.fallbackChain = [previous, ...(entry.fallbackChain ?? [])];
      log(`Cadena canonica: ${previous} agregado al fallback de ${target.model}`);
    }
  }

  if (registry.routingRules.subagents.default !== target.model) {
    log(`Cambiando default: ${registry.routingRules.subagents.default} → ${target.model}`);
    registry.routingRules.subagents.default = target.model;
  }

  // 3. Guardar cambios
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2), 'utf-8');
  log('✅ Registry actualizado');

  // 4. Guardar modelo activo
  const activeModel = {
    model: target.model,
    provider: target.provider,
    enforcedAt: new Date().toISOString(),
    reason,
    previousModel: process.env.GENTLE_VANGUARD_ACTIVE_MODEL || 'unknown',
  };

  writeFileSync(ACTIVE_MODEL_PATH, JSON.stringify(activeModel, null, 2), 'utf-8');
  log('✅ Modelo activo guardado');
  try {
    const sessionPath = writeSessionConfig(ROOT);
    log(`OpenCode session model aligned to ${target.model}: ${sessionPath}`);
  } catch (error) {
    log(
      `WARN: could not prepare OpenCode session: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // 5. Exportar para el shell
  console.log('\n=== VARIABLES DE ENTORNO ===');
  console.log(`export GENTLE_VANGUARD_ACTIVE_MODEL="${target.model}"`);
  console.log(`export GENTLE_VANGUARD_PROVIDER="${target.provider}"`);
  console.log(`export GENTLE_VANGUARD_MODEL_ENFORCED="true"`);

  log('=== ENFORCEMENT COMPLETADO ===');
}

function checkCurrentStatus(): void {
  console.log('=== ESTADO ACTUAL DE MODELOS ===\n');

  const registry: ModelRegistry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
  const inference: InferenceEvidenceFile | null = loadInferenceEvidence(
    inferenceEvidencePath(ROOT),
  );
  const now = Date.now();

  console.log('Modelos en registro:');
  for (const [id, model] of Object.entries(registry.models)) {
    const isHealthy = model.health.status === 'available';
    const cost = model.costPer1kTokens;
    const isFree = !cost || (cost.input === 0 && cost.output === 0);
    const icon = isHealthy && isFree ? '✅' : '⚠️';
    const verdict = inferenceVerdictFor(inference, id, now);
    const inferenceLabel =
      verdict === 'PASS'
        ? 'calificado (inferencia real OK)'
        : verdict === 'FAIL'
          ? 'DESCALIFICADO (la inferencia real fallo)'
          : 'sin veredicto de inferencia';
    console.log(`  ${icon} ${id}`);
    console.log(`     Estado: ${model.health.status}`);
    console.log(
      `     Costo: $${model.costPer1kTokens?.input ?? 0}/$${model.costPer1kTokens?.output ?? 0} per 1k`,
    );
    console.log(`     Gratis: ${isFree ? 'SÍ ✓' : 'NO'}`);
    console.log(`     Inferencia real: ${inferenceLabel}`);
    console.log();
  }

  console.log('=== CONFIGURACIÓN DE ROUTING ===');
  console.log(`Primary: ${registry.routingRules.orchestrator.primary}`);
  console.log(`Default: ${registry.routingRules.subagents.default}`);
  console.log();

  console.log('=== MODELO ACTIVO ===');
  if (existsSync(ACTIVE_MODEL_PATH)) {
    const active = JSON.parse(readFileSync(ACTIVE_MODEL_PATH, 'utf-8'));
    console.log(`Modelo: ${active.model}`);
    console.log(`Provider: ${active.provider}`);
    console.log(`Desde: ${active.enforcedAt || active.changedAt}`);
    if (active.reason) console.log(`Razón: ${active.reason}`);
  } else {
    console.log('⚠️ No hay modelo activo configurado');
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case '--check':
      checkCurrentStatus();
      break;
    case '--apply':
      enforceFreeModel();
      break;
    case '--force':
      console.log('Forzando reasignación inmediata...');
      enforceFreeModel();
      break;
    default:
      console.log(`
Model Enforcer v1.0

Uso:
  npx tsx src/ml/model-enforcer.ts --check    # Verificar estado actual
  npx tsx src/ml/model-enforcer.ts --apply     # Aplicar enforcement
  npx tsx src/ml/model-enforcer.ts --force     # Forzar reasignación

Descripción:
  Garantiza que todo el stack use el modelo gratuito disponible
  (opencode-zen-C/big-pickle) cuando otros modelos
  tengan cuota agotada o no estén disponibles.
`);
  }
}

// CLI Guard: importar el modulo NO debe imponer el modelo. Un `import` en un
// test o en otro modulo ejecutaba el enforcement como efecto secundario
// (medido 2026-11-18: el test del filtro de capabilities imprimia el banner
// del enforcer al importarlo).
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main();
}
