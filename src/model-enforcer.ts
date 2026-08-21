#!/usr/bin/env npx tsx
/**
 * Model Enforcer - Garantiza uso del modelo gratuito disponible
 *
 * Cuando se detecta que un modelo tiene cuota agotada o no está disponible,
 * automáticamente reasigna todo el stack a usar opencode/deepseek-v4-flash-free
 * que es el único modelo gratuito y disponible.
 *
 * Uso: npx tsx src/model-enforcer.ts [--check] [--apply]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const REGISTRY_PATH = join(ROOT, 'config', 'model-health-registry.json');
const ACTIVE_MODEL_PATH = join(ROOT, '.runtime', 'model-active.json');

const FREE_MODEL = 'opencode/deepseek-v4-flash-free';
const FREE_PROVIDER = 'opencode';

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

function checkModelHealth(): { healthy: string[]; unhealthy: string[]; free: string[] } {
  const registry: ModelRegistry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));

  const healthy: string[] = [];
  const unhealthy: string[] = [];
  const free: string[] = [];

  for (const [id, model] of Object.entries(registry.models)) {
    const isHealthy = model.health.status === 'available';
    const isFree = model.costPer1kTokens.input === 0 && model.costPer1kTokens.output === 0;

    if (isFree) free.push(id);
    if (isHealthy && isFree) {
      healthy.push(id);
    } else {
      unhealthy.push(id);
    }
  }

  return { healthy, unhealthy, free };
}

function enforceFreeModel(): void {
  log('=== INICIANDO ENFORCEMENT DE MODELO GRATUITO ===');

  // 1. Verificar estado actual
  const status = checkModelHealth();
  log(`Modelos saludables y gratuitos: ${status.healthy.join(', ')}`);
  log(`Modelos con problemas: ${status.unhealthy.join(', ')}`);

  if (status.healthy.length === 0) {
    log('❌ ERROR: No hay modelos saludables disponibles');
    process.exit(1);
  }

  // 2. Actualizar registry para que el modelo gratuito sea el primario
  const registry: ModelRegistry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));

  if (registry.routingRules.orchestrator.primary !== FREE_MODEL) {
    log(`Cambiando primary: ${registry.routingRules.orchestrator.primary} → ${FREE_MODEL}`);
    registry.routingRules.orchestrator.primary = FREE_MODEL;
  }

  if (registry.routingRules.subagents.default !== FREE_MODEL) {
    log(`Cambiando default: ${registry.routingRules.subagents.default} → ${FREE_MODEL}`);
    registry.routingRules.subagents.default = FREE_MODEL;
  }

  // 3. Guardar cambios
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2), 'utf-8');
  log('✅ Registry actualizado');

  // 4. Guardar modelo activo
  const activeModel = {
    model: FREE_MODEL,
    provider: FREE_PROVIDER,
    enforcedAt: new Date().toISOString(),
    reason: 'Auto-enforcement: modelo gratuito y disponible',
    previousModel: process.env.GENTLE_VANGUARD_ACTIVE_MODEL || 'unknown',
  };

  writeFileSync(ACTIVE_MODEL_PATH, JSON.stringify(activeModel, null, 2), 'utf-8');
  log('✅ Modelo activo guardado');

  // 5. Exportar para el shell
  console.log('\n=== VARIABLES DE ENTORNO ===');
  console.log(`export GENTLE_VANGUARD_ACTIVE_MODEL="${FREE_MODEL}"`);
  console.log(`export GENTLE_VANGUARD_PROVIDER="${FREE_PROVIDER}"`);
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
  npx tsx src/model-enforcer.ts --check    # Verificar estado actual
  npx tsx src/model-enforcer.ts --apply     # Aplicar enforcement
  npx tsx src/model-enforcer.ts --force     # Forzar reasignación

Descripción:
  Garantiza que todo el stack use el modelo gratuito disponible
  (opencode/deepseek-v4-flash-free) cuando otros modelos
  tengan cuota agotada o no estén disponibles.
`);
  }
}

void main();
