#!/usr/bin/env node
/**
 * skill-registry-builder.ts — construye el REGISTRO de skills derivado.
 *
 * QUÉ ES ESTE ARCHIVO
 * ------------------
 * `.atl/skill-registry.md` es un artefacto DERIVADO y gitignored: la tabla
 * `| Agent | Skill | Triggers |` que el embedder lee para indexar las skills.
 * Es la pieza que falta cuando alguien limpia `.atl/`: no hay ningún comando
 * en el repo que la reconstruya, el embedder aborta con "Registry not found"
 * y los gates que dependen del indice semantico fallan con ENOENT.
 *
 * DECISIÓN DE DISEÑO
 * ------------------
 * Un artefacto derivado no puede depender de un archivo que nadie regenera.
 * Por eso el registro se puede RE CONSTRUIR desde las fuentes de verdad:
 *   - el catálogo real de skills (`skills/`, `.agents/skills/`, `.opencode/skills/`)
 *     con su SKILL.md (frontmatter: name, description, triggers, aliases);
 *   - el mapeo skill→agente de `config/auto-delegation.json` (`skillToAgentProfile`).
 * Y por eso los embedders se AUTOREPARAN: si el registro no está, lo
 * reconstruyen y siguen (antes abortaban).
 *
 * El formato de la tabla lo consume `parseSkillRegistry` (en skill-embedder.ts).
 * El test `tests/unit/skill-registry-builder.test.ts` hace round-trip: genera
 * un registro y lo relee con ese parser, así el formato no puede derivar sin
 * que alguien lo note.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { load as loadYaml } from 'js-yaml';

export interface SkillEntry {
  agent: string;
  triggers: string[];
  description?: string;
  aliases?: string[];
}

interface SkillFrontmatter {
  name?: unknown;
  description?: unknown;
  triggers?: unknown;
  aliases?: unknown;
  metadata?: { trigger?: unknown };
}

/** Normaliza un valor de frontmatter a lista de strings. */
function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

/** Lee name/description/triggers/aliases del frontmatter de un SKILL.md. */
export function parseSkillDocument(content: string, fallbackName: string): {
  name: string;
  description: string;
  triggers: string[];
  aliases: string[];
} {
  const block = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/i)?.[1];
  if (!block) return { name: fallbackName, description: '', triggers: [], aliases: [] };
  let metadata: SkillFrontmatter = {};
  try {
    metadata = (loadYaml(block) as SkillFrontmatter | null) ?? {};
  } catch {
    return { name: fallbackName, description: '', triggers: [], aliases: [] };
  }
  const triggers = [...stringList(metadata.triggers), ...stringList(metadata.metadata?.trigger)];
  return {
    name: typeof metadata.name === 'string' && metadata.name.trim() ? metadata.name.trim() : fallbackName,
    description: typeof metadata.description === 'string' ? metadata.description.trim() : '',
    triggers: [...new Set(triggers)],
    aliases: [...new Set(stringList(metadata.aliases))],
  };
}

/** Raíces canónicas de skills, en orden de precedencia (la última gana). */
export function skillRoots(projectRoot: string): string[] {
  return [
    join(projectRoot, '.opencode', 'skills'),
    join(projectRoot, '.agents', 'skills'),
    join(projectRoot, 'skills'),
  ];
}

export interface SkillRegistryOptions {
  /** Raíz del repo (donde están `skills/` y `.atl/`). */
  projectRoot: string;
  /** Config de delegación (mapeo skill→agente). */
  delegationConfigPath?: string;
  /** Destino del registro. */
  registryPath?: string;
  /** Escribir el archivo (false = sólo calcular). */
  write?: boolean;
}

export interface SkillRegistryResult {
  registryPath: string;
  skills: number;
  wrote: boolean;
  rows: Array<{ skill: string; agent: string; triggers: string[] }>;
}

/** Lee el mapeo skill→agente de `config/auto-delegation.json`. */
function readAgentMappings(delegationConfigPath: string): Record<string, string> {
  if (!existsSync(delegationConfigPath)) return {};
  try {
    const config = JSON.parse(readFileSync(delegationConfigPath, 'utf8')) as {
      skillToAgentProfile?: Record<string, string>;
    };
    return config.skillToAgentProfile ?? {};
  } catch {
    return {};
  }
}

/**
 * Construye las filas del registro desde el catálogo real en disco.
 * Una skill que no está en el mapeo queda con el agente `KNOWLEDGE`.
 */
export function collectRegistryRows(options: SkillRegistryOptions): Array<{
  skill: string;
  agent: string;
  triggers: string[];
}> {
  const { projectRoot } = options;
  const delegationConfigPath =
    options.delegationConfigPath ?? join(projectRoot, 'config', 'auto-delegation.json');
  const mappings = readAgentMappings(delegationConfigPath);
  const discovered = new Map<string, { agent: string; triggers: string[] }>();

  for (const root of skillRoots(projectRoot)) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      // Los directorios que empiezan con `_` son COPIAS INTERNAS (por ejemplo
      // `_deprecated-impeccable-truncated`): no son skills.
      if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
      const skillMd = join(root, entry.name, 'SKILL.md');
      if (!existsSync(skillMd)) continue;
      const parsed = parseSkillDocument(readFileSync(skillMd, 'utf8'), entry.name);
      const previous = discovered.get(parsed.name);
      const agent = mappings[parsed.name] ?? mappings[entry.name] ?? previous?.agent ?? 'KNOWLEDGE';
      const triggers = [...new Set([...(previous?.triggers ?? []), ...parsed.triggers])];
      discovered.set(parsed.name, { agent, triggers });
    }
  }

  return [...discovered.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([skill, info]) => ({ skill, agent: info.agent, triggers: info.triggers }));
}

/** Renderiza el registro en el markdown que parsea `parseSkillRegistry`. */
function renderSkillRegistry(rows: Array<{ skill: string; agent: string; triggers: string[] }>): string {
  const table = rows
    .map((row) => `| ${row.agent} | ${row.skill} | ${row.triggers.join(', ')} |`)
    .join('\n');
  return `# Skill Registry (DERIVADO — artefacto local, gitignored)

Generado por \`src/skills/skill-registry-builder.ts\` desde el catálogo real de
skills (\`skills/\`, \`.agents/skills/\`, \`.opencode/skills/\`) y el mapeo
skill→agente de \`config/auto-delegation.json\`.

Regenerar: \`npm run skills:registry:rebuild\`

## Skill-Agent Mapping

| Agent | Skill | Triggers |
|---|---|---|
${table}

## Compact Rules

- Una skill por fila; los triggers son literales, separados por coma.
- El agente sale de \`config/auto-delegation.json\` (\`skillToAgentProfile\`).
- El parser que lee esta tabla es \`parseSkillRegistry\` (skill-embedder.ts).
`;
}

/**
 * Construye (y opcionalmente escribe) el registro de skills.
 * Es idempotente: correrlo dos veces produce el mismo archivo.
 */
export function buildSkillRegistry(options: SkillRegistryOptions): SkillRegistryResult {
  const registryPath =
    options.registryPath ?? join(options.projectRoot, '.atl', 'skill-registry.md');
  const rows = collectRegistryRows(options);
  if (options.write === false) return { registryPath, skills: rows.length, wrote: false, rows };
  mkdirSync(join(options.projectRoot, '.atl'), { recursive: true });
  writeFileSync(registryPath, renderSkillRegistry(rows), 'utf8');
  return { registryPath, skills: rows.length, wrote: true, rows };
}

/**
 * Garantiza que el registro exista. Si falta, lo reconstruye.
 * Es el punto de autoreparación que usan los embedders.
 */
export function ensureSkillRegistry(options: SkillRegistryOptions): SkillRegistryResult {
  const registryPath =
    options.registryPath ?? join(options.projectRoot, '.atl', 'skill-registry.md');
  if (existsSync(registryPath)) {
    return { registryPath, skills: 0, wrote: false, rows: [] };
  }
  return buildSkillRegistry({ ...options, registryPath, write: true });
}
