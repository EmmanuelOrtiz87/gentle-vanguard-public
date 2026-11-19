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
 * Uso: node --import tsx src/tools/opencode-agent-model-guard.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface AgentModelClassification {
  ok: boolean;
  problems: Array<{ agent: string; model: string; reason: string }>;
  checked: number;
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
  for (const [agent, config] of Object.entries(agents)) {
    const model = config?.model;
    if (typeof model !== 'string' || !model.trim()) {
      problems.push({ agent, model: String(model), reason: 'agente sin modelo declarado' });
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
  return { ok: problems.length === 0, problems, checked };
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

function main(): number {
  const root = resolve(process.cwd());
  let agents: Record<string, AgentConfig> = {};
  let registry: Registry = {};
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
    ) as Registry & { models?: Registry };
    registry = raw.models ?? raw;
  } catch (error) {
    console.error(`✗ model-health-registry.json ilegible: ${(error as Error).message}`);
    return 2;
  }

  const fleet = classifyAgentModels(agents, registry);
  const chains = validateFallbackChains(registry);
  const problems = [...fleet.problems, ...chains.problems];
  const checked = fleet.checked + chains.checked;
  if (problems.length === 0) {
    console.log(
      `✓ opencode-agent-model-guard: ${fleet.checked} agente(s) y ${chains.checked} fallback(s) con capability tools`,
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
