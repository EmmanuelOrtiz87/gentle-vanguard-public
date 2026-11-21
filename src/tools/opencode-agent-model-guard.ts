/**
 * opencode-agent-model-guard.ts — guard anti-drift de los modelos de agentes.
 *
 * El defecto real, ocurrido DOS veces el 2026-11-14 (GB-2026-11-14 §2.5):
 * opencode.json fue reescrito al cerrar OpenCode con TODOS los agentes
 * apuntando a `ollama/qwen2.5-coder:14b` — un modelo que NO emite tool_calls
 * por /v1. La flota entera queda sin herramientas SIN UN SOLO ERROR ("no lee
 * mis archivos"). El swap es silencioso: OpenCode persiste su selección de
 * modelo al cerrar.
 *
 * El invariante medible: TODO modelo usado por un agente de opencode.json
 * debe estar registrado en config/model-health-registry.json Y declarar la
 * capability "tools" (la misma verdad que ollama:doctor prueba con una
 * llamada real). Sin registro o sin tools => deriva => el push no sale.
 *
 * Regla de honestidad: esto NO impide cambiar de modelo a propósito — cambiar
 * el modelo es una línea en el registry (su capability es un hecho medido,
 * no un permiso). Impide el swap que nadie hizo a propósito.
 *
 * CANON 2026-11-21 — herencia: un agente SIN `model` hereda el modelo de la
 * sesión y NO es un problema. El pin estático por agente anulaba la herencia y
 * ataba los 23 agentes a ollama aunque la sesión corriera en otro modelo (el
 * owner no siempre tiene ollama vivo). El invariante se muda al target que se
 * hereda: `routingRules.orchestrator.primary` y `routingRules.subagents.default`
 * deben estar registrados y declarar "tools", o toda la flota hereda un modelo
 * sin tool calling.
 *
 * Uso: node --import tsx src/tools/opencode-agent-model-guard.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { restoreOpencodeCanon } from './opencode-canon-restore.js';
import { pathToFileURL } from 'node:url';

export interface AgentModelClassification {
  ok: boolean;
  problems: Array<{ agent: string; model: string; reason: string }>;
  checked: number;
  /**
   * Agentes SIN pin de modelo: heredan el modelo de la sesión (canon
   * 2026-11-21). No son un problema — el pin estático era el que rompía la
   * herencia y ataba la flota a que ollama estuviera vivo.
   */
  inherited?: number;
}

type RegistryEntry = { capabilities?: string[]; fallbackChain?: string[] };
type Registry = Record<string, RegistryEntry>;
type AgentConfig = { model?: string };

/**
 * Clasifica los modelos de los agentes contra el registry. Pura y exportada
 * para el contratest: la verdad vive en el registry, no acá.
 */
export function classifyAgentModels(
  agents: Record<string, AgentConfig>,
  registry: Registry,
): AgentModelClassification {
  const problems: AgentModelClassification['problems'] = [];
  let checked = 0;
  let inherited = 0;
  for (const [agent, config] of Object.entries(agents)) {
    const model = config?.model;
    if (typeof model !== 'string' || !model.trim()) {
      // Sin pin = herencia del modelo de la sesión (canon 2026-11-21). El pin
      // estático por agente anulaba la herencia y ataba la flota a un único
      // proveedor (ollama) incluso cuando la sesión corre en otro modelo.
      inherited++;
      continue;
    }
    checked++;
    const entry = registry[model];
    if (!entry) {
      problems.push({
        agent,
        model,
        reason:
          'modelo no registrado en config/model-health-registry.json — regístralo con sus capacidades reales antes de asignarlo a un agente',
      });
      continue;
    }
    const caps = Array.isArray(entry.capabilities) ? entry.capabilities : [];
    if (!caps.includes('tools')) {
      problems.push({
        agent,
        model,
        reason: `el modelo declara capabilities ${JSON.stringify(caps)} sin "tools": los agentes no pueden ejecutar herramientas con él (defecto GB-2026-11-14 §2.5: flota silenciosamente sin tool calling)`,
      });
    }
  }
  return { ok: problems.length === 0, problems, checked, inherited };
}

/**
 * Fallback chains are used mid-task when a model fails; a tool-less target
 * silently disables tool calling for the agent that fell back to it.
 */
export function validateFallbackChains(registry: Registry): AgentModelClassification {
  const problems: AgentModelClassification['problems'] = [];
  let checked = 0;
  for (const [model, entry] of Object.entries(registry)) {
    const chain = Array.isArray(entry.fallbackChain) ? entry.fallbackChain : [];
    for (const fallback of chain) {
      checked++;
      const target = registry[fallback];
      if (!target) {
        problems.push({
          agent: `fallback:${model}`,
          model: fallback,
          reason: 'fallback no registrado en config/model-health-registry.json',
        });
        continue;
      }
      const caps = Array.isArray(target.capabilities) ? target.capabilities : [];
      if (!caps.includes('tools')) {
        problems.push({
          agent: `fallback:${model}`,
          model: fallback,
          reason: `el fallback declara capabilities ${JSON.stringify(caps)} sin "tools": si el primario falla, el agente pierde tool calling`,
        });
      }
    }
  }
  return { ok: problems.length === 0, problems, checked };
}

/**
 * La herencia mueve la responsabilidad del modelo a la sesión: si el target que
 * los subagentes heredan (`routingRules.orchestrator.primary` /
 * `routingRules.subagents.default`) no declara tools, la flota entera pierde
 * tool calling sin un solo error — el mismo defecto GB-2026-11-14 §2.5, ahora
 * por la puerta de la herencia (canon 2026-11-21).
 */
export function validateInheritanceTargets(
  targets: string[],
  registry: Registry,
): AgentModelClassification {
  const problems: AgentModelClassification['problems'] = [];
  let checked = 0;
  for (const target of targets) {
    checked++;
    const entry = registry[target];
    if (!entry) {
      problems.push({
        agent: 'inherit',
        model: target,
        reason:
          'target de herencia no registrado en config/model-health-registry.json — la sesión podría caer a un modelo sin tools',
      });
      continue;
    }
    const caps = Array.isArray(entry.capabilities) ? entry.capabilities : [];
    if (!caps.includes('tools')) {
      problems.push({
        agent: 'inherit',
        model: target,
        reason: `el target de herencia declara capabilities ${JSON.stringify(caps)} sin "tools": todos los agentes que heredan pierden tool calling`,
      });
    }
  }
  return { ok: problems.length === 0, problems, checked };
}

function main(): number {
  const root = resolve(process.cwd());
  // Auto-sanea su entrada (bitácora 2026-11-21): verificar el árbol drift-eado
  // sería certificar mentiras. Restaurar desde HEAD antes de leer.
  const canon = restoreOpencodeCanon(root);
  if (canon.action !== 'clean') console.log(`[opencode-agent-model-guard] ${canon.detail}`);
  let agents: Record<string, AgentConfig> = {};
  let registry: Registry = {};
  let inheritTargets: string[] = [];
  try {
    const oc = JSON.parse(readFileSync(resolve(root, 'opencode.json'), 'utf8')) as {
      agent?: Record<string, AgentConfig>;
    };
    agents = oc.agent ?? {};
  } catch (error) {
    console.error(`✗ opencode.json ilegible: ${(error as Error).message}`);
    return 2;
  }
  try {
    const raw = JSON.parse(
      readFileSync(resolve(root, 'config', 'model-health-registry.json'), 'utf8'),
    ) as Registry & {
      models?: Registry;
      routingRules?: {
        orchestrator?: { primary?: string };
        subagents?: { default?: string };
      };
    };
    registry = raw.models ?? raw;
    // Los targets de herencia viven FUERA de `models`: si el guard solo mira
    // el mapa de modelos, la herencia queda sin verificar.
    const targets = [raw.routingRules?.orchestrator?.primary, raw.routingRules?.subagents?.default];
    inheritTargets = targets.filter((t): t is string => typeof t === 'string' && t.trim() !== '');
  } catch (error) {
    console.error(`✗ model-health-registry.json ilegible: ${(error as Error).message}`);
    return 2;
  }

  const fleet = classifyAgentModels(agents, registry);
  const chains = validateFallbackChains(registry);
  const inheritance = validateInheritanceTargets(inheritTargets, registry);
  const problems = [...fleet.problems, ...chains.problems, ...inheritance.problems];
  const checked = fleet.checked + chains.checked + inheritance.checked;
  const inherited = fleet.inherited ?? 0;
  if (problems.length === 0) {
    console.log(
      `✓ opencode-agent-model-guard: ${fleet.checked} agente(s) pinneado(s) y ${chains.checked} fallback(s) con capability tools; ${inherited} agente(s) heredan el modelo de la sesión (${inheritTargets.join(', ') || 'sin target declarado'})`,
    );
    return 0;
  }
  console.log(
    `✗ opencode-agent-model-guard: ${problems.length}/${checked} asignaciones en deriva:`,
  );
  for (const problem of problems) {
    console.log(`   · ${problem.agent} → ${problem.model}: ${problem.reason}`);
  }
  console.log(
    '   Arreglo: revertir opencode.json (git checkout -- opencode.json) o registrar el modelo con su capability real.',
  );
  return 1;
}

// entrypoint: detecta cuando el script corre directamente (vs importado por tests).
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main());
}
