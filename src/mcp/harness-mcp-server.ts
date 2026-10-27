#!/usr/bin/env node
/**
 * harness-mcp-server.ts — El bucle de auto-mejora del harness como servidor MCP.
 *
 * Hasta ahora el bucle se manejaba por CLI: un agente que quisiera medir una
 * edicion del harness tenia que saber la ruta del script, sus flags y su
 * formato de salida. Eso es una barrera de entrada alta para el caso mas
 * frecuente: "cambie una regla, no se si el agente la cumple".
 *
 * Como servidor MCP, cualquier cliente (los agentes de opencode, el runtime
 * con codegraph, otra herramienta) puede:
 *
 *   - harness_doctor        — pasar el gate de superficie (read-only)
 *   - harness_surface       — leer la superficie editable (paths y archivos)
 *   - harness_loop_run      — correr el bucle: propone, mide, compara, adopta
 *   - harness_experience    — leer las lecciones adoptadas
 *   - harness_promote_preview — ver QUE tocaria promover una leccion (nunca aplica)
 *
 * La promocion al repo NO es una tool: es 🟡 AMARILLO (decision del owner), y
 * por diseno no se puede disparar desde un agente. `harness_promote_preview`
 * solo informa.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { GV_SURFACE, readSurfaceTree } from '../core/harness-surface.js';
import { runHarnessLoop } from '../core/harness-loop.js';
import { createOllamaSubstrate } from '../eval/ollama-substrate.js';
import { createCliAgentSubstrate } from '../eval/cli-agent-substrate.js';

/** Entry JS del CLI de codex instalado global (mismo patron que harness-loop-run). */
function resolveCodexEntry(): string {
  const prefix = process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming');
  const entry = join(prefix, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  if (!existsSync(entry)) {
    throw new Error(`codex CLI no encontrado en ${entry}. Instalarlo con: npm i -g @openai/codex`);
  }
  return entry;
}
import { listExperiences, nexusDbPath } from '../knowledge/experience-library.js';

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), '..', '..');

const server = new McpServer(
  { name: 'harness-evolution', version: '1.0.0' },
  {
    capabilities: { tools: {} },
    instructions:
      'Herramientas del bucle de auto-mejora del harness: medir si una regla del harness mueve el comportamiento, comparar variantes a ciegas y listar las lecciones adoptadas. La promocion de una leccion al repo la decide el owner.',
  }
);

/** Gate de superficie: read-only, exit 1 si hay findings. */
server.tool(
  'harness_doctor',
  'Pasa el gate de superficie del harness (frontmatter, scripts, marcadores de veredicto). Read-only.',
  { strict: z.boolean().optional() },
  async ({ strict }) => {
    const { diagnose } = await import('../tools/harness-doctor.js');
    const tree = readSurfaceTree(GV_SURFACE, ROOT);
    const report = diagnose(GV_SURFACE, tree);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              ok: report.ok,
              errores: report.errors,
              warnings: report.warnings,
              alcance: report.scope,
              findings: strict ? report.findings : report.findings.slice(0, 20),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  'harness_surface',
  'Lee la superficie editable del harness: los paths que el bucle puede tocar y el contenido de un archivo concreto.',
  {
    path: z.string().optional().describe('path relativo de un archivo de la superficie'),
    limit: z.number().optional().describe('cantidad maxima de paths a listar (default 200)'),
  },
  async ({ path, limit }) => {
    const tree = readSurfaceTree(GV_SURFACE, ROOT);
    if (path) {
      const content = tree[path];
      if (content === undefined) {
        return {
          content: [{ type: 'text', text: `"${path}" no esta en la superficie editable.` }],
          isError: true,
        };
      }
      return { content: [{ type: 'text', text: content }] };
    }
    const paths = Object.keys(tree).sort().slice(0, limit ?? 200);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { total: Object.keys(tree).length, paths },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  'harness_loop_run',
  'Corre el bucle de auto-mejora: propone una regla (o usa las propuestas indicadas), ejecuta las variantes, compara a ciegas y mide con el juez. Tarda minutos.',
  {
    task: z.string().describe('la tarea, con sus datos embebidos si hace falta'),
    domain: z.string().describe('dominio de trabajo (kebab-case)'),
    k: z.number().optional().describe('k del bucle (default 1)'),
    mode: z.enum(['agg', 'seq']).optional().describe('agg: ancho (default) | seq: profundo'),
    judge_file: z.string().optional().describe('ruta a los checks del juez (JSON)'),
    propose_auto: z.boolean().optional().describe('que el proposer genere las reglas'),
    proposal_a: z.string().optional().describe('directorio de la propuesta invariante'),
    proposal_b: z.string().optional().describe('directorio de la propuesta de dominio'),
    model: z.string().optional().describe('modelo local de Ollama (default qwen2.5-coder:7b)'),
    substrate: z
      .enum(['ollama', 'codex'])
      .optional()
      .describe('ollama (local, default) | codex (CLI headless gpt-6-luna, consume cuota ChatGPT)'),
  },
  async ({ task, domain, k, mode, judge_file, propose_auto, proposal_a, proposal_b, model, substrate: substrateKind }) => {
    const baseTree = readSurfaceTree(GV_SURFACE, ROOT);
    const basePrompt = baseTree['AGENTS.md'] ?? '';
    const substrate =
      substrateKind === 'codex'
        ? createCliAgentSubstrate({
            command: [
              process.execPath,
              resolveCodexEntry(),
              'exec', '--json', '--ignore-user-config',
              '--skip-git-repo-check', '-C', ROOT,
              '-m', 'gpt-6-luna',
              '-s', 'read-only',
            ],
            root: ROOT,
          })
        : createOllamaSubstrate({ model: model ?? 'qwen2.5-coder:7b' });

    const { proposalFromDirectory, proposalFromEdits } = await import('../core/harness-loop.js');
    const proposals = propose_auto
      ? [
          proposalFromEdits('invariante', 'invariant', 'Propuesta transversal automatica', {}),
          proposalFromEdits('dominio', 'domain', 'Propuesta de dominio automatica', {}),
        ]
      : [
          proposalFromDirectory(
            'invariante',
            'invariant',
            'Edicion invariante',
            resolve(ROOT, proposal_a ?? '.')
          ),
          proposalFromDirectory(
            'dominio',
            'domain',
            'Edicion de dominio',
            resolve(ROOT, proposal_b ?? '.')
          ),
        ];

    const judge = judge_file
      ? (JSON.parse(readFileSync(resolve(ROOT, judge_file), 'utf-8')) as Record<string, unknown>)
      : undefined;

    const result = await runHarnessLoop({
      taskId: `${domain}-${k ?? 1}`,
      domain,
      task,
      k: k ?? 1,
      mode: mode ?? 'agg',
      baseTree,
      basePrompt,
      proposals,
      substrate,
      judge: judge as never,
      proposer: propose_auto ? { substrate, domain } : undefined,
      workDir: join(ROOT, '.runtime', 'harness-loop', `mcp-${domain}-${Date.now()}`),
      outDir: join(ROOT, '.runtime', 'harness-loop', `mcp-${domain}-${Date.now()}`),
      repoRoot: ROOT,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              runId: result.runId,
              ledger: result.ledger,
              pool: result.pool.candidates.map((c) => c.id),
              descartadas: result.pool.dropped,
              tripwire: result.tripwire,
              diversidad: result.diversity,
              juez: result.judge,
              seleccion: {
                elegida: result.selection.selectedLabel,
                via: result.selection.via,
                razon: result.selection.why,
              },
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  'harness_rules_audit',
  'Audita que reglas del stack son MEDIBLES (tienen una obligacion atada a un token literal). Estatico, sin modelo.',
  {},
  async () => {
    const { auditRules } = await import('../eval/rules-audit.js');
    const tree = readSurfaceTree(GV_SURFACE, ROOT);
    const audit = auditRules(tree);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              total: audit.total,
              medibles: audit.measurable,
              conObligacion: audit.withObligations,
              noMedibles: audit.unmeasurable.map((e) => ({
                path: e.path,
                obligaciones: e.obligations,
              })),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  'harness_experience',
  'Lista las lecciones adoptadas de un dominio (la biblioteca de experiencia del harness).',
  { domain: z.string().describe('dominio de trabajo') },
  async ({ domain }) => {
    const dbPath = nexusDbPath(ROOT);
    if (!existsSync(dbPath)) {
      return { content: [{ type: 'text', text: 'No hay base de experiencia.' }], isError: true };
    }
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath, { readonly: true });
    try {
      const records = listExperiences(db, { domain });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              records.map((r) => ({
                fecha: r.adoptedAt,
                clave: r.topicKey,
                confianza: r.confidence,
                cue: r.cue,
                lesson: r.lesson,
                evidence: r.evidence,
                archivos: r.edits,
              })),
              null,
              2
            ),
          },
        ],
      };
    } finally {
      db.close();
    }
  }
);

server.tool(
  'harness_promote_preview',
  'Muestra QUE archivos tocaria promover una leccion al repo. NUNCA escribe: la promocion la decide el owner.',
  {
    domain: z.string().describe('dominio de trabajo'),
    task_id: z.string().optional().describe('corrida concreta (default: la ultima)'),
  },
  async ({ domain, task_id }) => {
    const dbPath = nexusDbPath(ROOT);
    if (!existsSync(dbPath)) {
      return { content: [{ type: 'text', text: 'No hay base de experiencia.' }], isError: true };
    }
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath, { readonly: true });
    try {
      const records = listExperiences(db, { domain });
      const record = task_id
        ? records.find((r) => r.taskId === task_id)
        : records[records.length - 1];
      if (!record) {
        return {
          content: [{ type: 'text', text: `No hay experiencia para "${domain}".` }],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                corrida: record.taskId,
                confianza: record.confidence,
                archivos: record.edits,
                nota: 'La promocion la ejecuta el owner: npm run harness:experience:promote -- --domain <dominio> --apply',
              },
              null,
              2
            ),
          },
        ],
      };
    } finally {
      db.close();
    }
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
