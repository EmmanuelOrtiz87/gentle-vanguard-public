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
import { join } from 'path';

const ROOT = process.cwd();
const REGISTRY_PATH = join(ROOT, 'config', 'model-health-registry.json');
const ACTIVE_MODEL_PATH = join(ROOT, '.runtime', 'model-active.json');
const PREFERENCE_PATH = join(ROOT, 'config', 'model-preference.json');
const OPENCODE_CONFIG_PATH = join(ROOT, 'opencode.json');

const FREE_MODEL = 'opencode-zen-C/big-pickle';
const FREE_PROVIDER = 'opencode';

interface ModelPreference {
  preferredModel?: string;
  preferredProvider?: string;
  fallbackModel?: string;
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
 *   1. preferred model        — only if healthy
 *   2. configured fallback    — only if healthy
 *   3. first healthy free model in the registry
 * A model listed as unhealthy/unknown is never enforced.
 */
function resolveTargetModel(
  status: { healthy: string[]; unhealthy: string[] },
  preferred: { model: string; provider: string },
): { target: { model: string; provider: string }; reason: string } {
  if (status.healthy.includes(preferred.model)) {
    return { target: preferred, reason: 'Preferred subscription model available' };
  }

  const configuredFallback = readPreference().fallbackModel;
  if (configuredFallback && status.healthy.includes(configuredFallback)) {
    return {
      target: { model: configuredFallback, provider: configuredFallback.split('/')[0] },
      reason: 'Fallback: preferred model unavailable, configured fallback healthy',
    };
  }

  const firstHealthy = status.healthy[0];
  if (firstHealthy) {
    return {
      target: { model: firstHealthy, provider: firstHealthy.split('/')[0] },
      reason: 'Fallback: preferred and configured fallback unavailable, first healthy free model',
    };
  }

  return {
    target: { model: FREE_MODEL, provider: FREE_PROVIDER },
    reason: 'Fallback: no healthy model available',
  };
}

interface ModelEntry {
  provider: string;
  health: { status: string };
  costPer1kTokens: { input: number; output: number };
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
} {
  const registry: ModelRegistry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
  const evidence = loadProviderEvidence();
  const cutoff = Date.now() - EVIDENCE_TTL_MS;

  const healthy: string[] = [];
  const unhealthy: string[] = [];
  const free: string[] = [];
  let evidenceAgeHours: number | null = null;

  for (const [id, model] of Object.entries(registry.models)) {
    const isHealthy = model.health.status === 'available';
    const isFree = model.costPer1kTokens.input === 0 && model.costPer1kTokens.output === 0;

    // Evidencia fresca e INALCANZABLE descalifica el modelo, aunque el
    // registry lo declare disponible.
    const providerEvidence = evidenceFor(id, model.provider, evidence);
    if (providerEvidence) {
      const ageHours = (Date.now() - Date.parse(providerEvidence.checkedAt)) / 3_600_000;
      if (evidenceAgeHours === null || ageHours < evidenceAgeHours) evidenceAgeHours = ageHours;
      const fresh = Date.parse(providerEvidence.checkedAt) > cutoff;
      if (fresh && !providerEvidence.reachable) {
        if (isFree) free.push(id);
        unhealthy.push(id);
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

  return { healthy, unhealthy, free, evidenceAgeHours };
}

function enforceFreeModel(): void {
  log('=== INICIANDO ENFORCEMENT DE MODELO GRATUITO ===');

  // 1. Verificar estado actual
  const status = checkModelHealth();
  log(`Modelos saludables y gratuitos: ${status.healthy.join(', ')}`);
  log(`Modelos con problemas: ${status.unhealthy.join(', ')}`);
  if (status.evidenceAgeHours === null) {
    log(
      'Evidencia de proveedores: AUSENTE (sin probe) — el registry manda, pero su health.status es estatico',
    );
  } else {
    log(
      `Evidencia de proveedores: probe de hace ${status.evidenceAgeHours.toFixed(1)}h (un proveedor inalcanzable descalifica sus modelos)`,
    );
  }

  if (status.healthy.length === 0) {
    log('❌ ERROR: No hay modelos saludables disponibles');
    process.exit(1);
  }

  const preferred = getPreferredModel();
  const { target, reason } = resolveTargetModel(status, preferred);
  log(`Modelo preferido: ${preferred.model}; seleccionado: ${target.model}`);
  if (target.model === preferred.model && !status.healthy.includes(target.model)) {
    log(`WARN: ${target.model} no figura como saludable — no hay modelo healthy disponible`);
  }

  // 2. Actualizar registry para que el modelo preferido sea el primario;
  // solo cae al modelo gratuito si el preferido no está disponible.
  const registry: ModelRegistry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));

  // Keep the native OpenCode agent definitions aligned with routing. Otherwise
  // the registry can select the subscription model while static subagents
  // silently continue using the old free-model override.
  try {
    const opencode = JSON.parse(readFileSync(OPENCODE_CONFIG_PATH, 'utf-8')) as {
      agent?: Record<string, { model?: string; provider?: string }>;
    };
    for (const agent of Object.values(opencode.agent ?? {})) {
      if (agent.model) agent.model = target.model;
      if (agent.provider) agent.provider = target.provider;
    }
    writeFileSync(OPENCODE_CONFIG_PATH, JSON.stringify(opencode, null, 2) + '\n', 'utf-8');
    log(`OpenCode agent models aligned to ${target.model}`);
  } catch (error) {
    log(
      `WARN: could not align opencode.json: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (registry.routingRules.orchestrator.primary !== target.model) {
    log(`Cambiando primary: ${registry.routingRules.orchestrator.primary} → ${target.model}`);
    registry.routingRules.orchestrator.primary = target.model;
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

  console.log('Modelos en registro:');
  for (const [id, model] of Object.entries(registry.models)) {
    const isHealthy = model.health.status === 'available';
    const isFree = model.costPer1kTokens.input === 0 && model.costPer1kTokens.output === 0;
    const icon = isHealthy && isFree ? '✅' : '⚠️';
    console.log(`  ${icon} ${id}`);
    console.log(`     Estado: ${model.health.status}`);
    console.log(
      `     Costo: $${model.costPer1kTokens.input}/$${model.costPer1kTokens.output} per 1k`,
    );
    console.log(`     Gratis: ${isFree ? 'SÍ ✓' : 'NO'}`);
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

void main();
