#!/usr/bin/env node
/**
 * Stack MCP Server — exposes Gentle-Vanguard stack operations as MCP tools.
 *
 * Inspired by the MCP SDK v1 pattern (sequential-thinking-server.ts in the
 * same directory) — McpServer + StdioServerTransport. Tools are read-only or
 * side-effect-bounded: most return JSON, the heavy ones (audit) delegate to
 * the audit module with bounded timeouts.
 *
 * Tools:
 *   stack_info              - stack facts (version, apps count, agents count)
 *   stack_apps_list         - discover apps + their scripts (no exec)
 *   stack_apps_affected     - list apps changed vs a git ref
 *   stack_apps_audit        - run per-app audit (typecheck+test) on N apps
 *   stack_validate          - one-shot validate summary (apps audit + platform)
 *   stack_opencode_agents   - list 21 agents synced to .opencode/agents
 *
 * Usage:
 *   npx tsx src/mcp/stack-mcp-server.ts
 *   (configure as MCP server in .opencode/mcp.json or .zcode/config.json)
 *
 * Por que es nativo y no wrappea otros MCPs (codegraph/engram):
 * - Stack operations son read-mostly y rapidas (< 3min). No necesitan estado
 *   de sesion. Un MCP dedicado a "stack-wide" queries tiene sentido propio.
 * - Codegraph ya cubre code-symbols queries, engram cubre memory queries.
 *   Este cubre STACK queries (apps, validate, info, agents). No solapa.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runNpxTsxSync } from '../core/run-command';

const ROOT = resolve(process.cwd());
const APPS_DIR = join(ROOT, 'apps');
const OPENCODE_AGENTS_DIR = join(ROOT, '.opencode', 'agents');
const STACK_FACTS_PATH = join(ROOT, 'config', 'stack-facts.json');

// ─── Helpers ───────────────────────────────────────────────────────────────

function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string, meta?: Record<string, unknown>): void {
  const ts = new Date().toISOString();
  const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
  console.error(`[${ts}] [${level}] [stack-mcp] ${msg}${metaStr}`);
}

function readJsonSafe<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

interface AppInfo {
  app: string;
  hasPackageJson: boolean;
  scripts: string[];
}

function discoverApps(): AppInfo[] {
  if (!existsSync(APPS_DIR)) return [];
  return readdirSync(APPS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== '.runtime' && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort()
    .map((app) => {
      const pkgPath = join(APPS_DIR, app, 'package.json');
      const hasPackageJson = existsSync(pkgPath);
      let scripts: string[] = [];
      if (hasPackageJson) {
        const pkg = readJsonSafe<{ scripts?: Record<string, string> }>(pkgPath);
        scripts = pkg ? Object.keys(pkg.scripts ?? {}) : [];
      }
      return { app, hasPackageJson, scripts };
    });
}

function getStackFacts(): Record<string, unknown> {
  // config/stack-facts.json es el snapshot canonico del estado del stack.
  const facts = readJsonSafe<Record<string, unknown>>(STACK_FACTS_PATH);
  if (facts) return facts;
  // fallback: datos sinteticos si el facts file no existe (run nuevo)
  return {
    note: 'stack-facts.json no encontrado; datos sinteticos',
    version: 'unknown',
    appsDetected: discoverApps().length,
  };
}

function listAgents(): string[] {
  if (!existsSync(OPENCODE_AGENTS_DIR)) return [];
  return readdirSync(OPENCODE_AGENTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();
}

function runStackAudit(args: string[]): { stdout: string; stderr: string; status: number } {
  try {
    const r = runNpxTsxSync('src/ops/stack-audit-apps.ts', args, {
      cwd: ROOT,
      timeout: 360_000, // 6 min para audit real
    });
    return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status ?? -1 };
  } catch (err) {
    return { stdout: '', stderr: (err as Error).message, status: -1 };
  }
}

// ─── MCP Server ─────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'gentle-vanguard-stack',
  version: '1.0.0',
  description: 'Stack-wide operations: apps, audit, validate, info, agents',
});

// Tool: stack_info
server.tool(
  'stack_info',
  'Stack facts: version, app count, agent count, key paths.',
  {},
  async () => {
    const facts = getStackFacts();
    const apps = discoverApps();
    const agents = listAgents();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              facts,
              appsDetected: apps.length,
              appsWithPackageJson: apps.filter((a) => a.hasPackageJson).length,
              opencodeAgentsSynced: agents.length,
              roots: { appsDir: APPS_DIR, agentsDir: OPENCODE_AGENTS_DIR },
              timestamp: new Date().toISOString(),
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// Tool: stack_apps_list
server.tool(
  'stack_apps_list',
  'Discover all apps in apps/ with their package.json scripts. Read-only, no execution.',
  {},
  async () => {
    const apps = discoverApps();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              total: apps.length,
              apps,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// Tool: stack_apps_affected
server.tool(
  'stack_apps_affected',
  'List apps changed vs a git ref (default HEAD~1). Returns apps/<name> matches; fails open to all if package.json or shared/* changed.',
  {
    ref: z
      .string()
      .optional()
      .describe('Git ref to compare against (default HEAD~1). E.g. HEAD~3, origin/develop.'),
  },
  async ({ ref }) => {
    const r = runStackAudit(['--json', '--affected', ref || 'HEAD~1', '--check', 'none']);
    if (r.status !== 0) {
      return {
        content: [{ type: 'text', text: `audit fallo (exit=${r.status}): ${r.stderr.slice(0, 300)}` }],
        isError: true,
      };
    }
    // Resumir: solo devolver la lista de apps afectadas (no todo el shape)
    try {
      const parsed = JSON.parse(r.stdout);
      const affected = (parsed.audits || []).map((a: { app: string }) => a.app);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ref: ref || 'HEAD~1',
                total: affected.length,
                affected,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch {
      return { content: [{ type: 'text', text: r.stdout }] };
    }
  },
);

// Tool: stack_apps_audit
server.tool(
  'stack_apps_audit',
  'Run per-app audit (typecheck + test) on apps. Returns PASS/WARN/FAIL summary per app. Heavy: 6 min for all 14 apps.',
  {
    only: z
      .string()
      .optional()
      .describe('Comma-separated kinds: typecheck,test,lint (default typecheck,test).'),
    app: z.string().optional().describe('Limit to one app name (filters via plan).'),
    affected: z
      .string()
      .optional()
      .describe('Git ref to compare against; only audits apps changed vs ref.'),
    json: z.boolean().optional().describe('Return raw JSON output instead of formatted text.'),
  },
  async ({ only, app, affected, json }) => {
    const args: string[] = [];
    if (only) args.push('--check', only);
    if (affected) args.push('--affected', affected);
    if (json !== false) args.push('--json');
    const r = runStackAudit(args);
    if (r.status !== 0 && r.status !== 1) {
      return {
        content: [
          {
            type: 'text',
            text: `audit fallo (exit=${r.status}): ${r.stderr.slice(0, 300)}`,
          },
        ],
        isError: true,
      };
    }
    let text = r.stdout;
    // Si vino --json, intenta resumir para consumo del agente
    if (json !== false) {
      try {
        const parsed = JSON.parse(text);
        const summary = {
          only: parsed.only,
          affected: parsed.affected,
          counts: {
            total: parsed.audits?.length ?? 0,
            pass: parsed.passed ?? 0,
            warn: parsed.warned ?? 0,
            fail: parsed.failed ?? 0,
          },
          failing: (parsed.audits || [])
            .filter((a: { status: string }) => a.status === 'FAIL')
            .map((a: { app: string; checks: Array<{ kind: string; status: string; message: string }> }) => ({
              app: a.app,
              fails: a.checks
                .filter((c) => c.status === 'FAIL')
                .map((c) => ({ kind: c.kind, message: c.message.slice(0, 200) })),
            })),
          warnings: (parsed.audits || [])
            .filter((a: { status: string }) => a.status === 'WARN')
            .map((a: { app: string }) => a.app),
        };
        text = JSON.stringify(summary, null, 2);
      } catch {
        /* keep raw stdout si el JSON no parsea */
      }
    }
    if (app) {
      // Filtro post-hoc a una sola app (no exponemos --app porque complica el modulo)
      try {
        const parsed = JSON.parse(r.stdout);
        const one = (parsed.audits || []).find(
          (a: { app: string }) => a.app === app,
        );
        if (!one) {
          return {
            content: [
              {
                type: 'text',
                text: `app '${app}' no encontrada en el audit (total ${parsed.audits?.length ?? 0}). Apps: ${(parsed.audits || []).map((a: { app: string }) => a.app).join(', ')}`,
              },
            ],
            isError: true,
          };
        }
        text = JSON.stringify(one, null, 2);
      } catch {
        /* ignore */
      }
    }
    return {
      content: [{ type: 'text', text }],
      isError: r.status === 1,
    };
  },
);

// Tool: stack_validate
server.tool(
  'stack_validate',
  'Quick validate summary: apps audit plan + counts. Fast (~500ms, no npm execution).',
  {},
  async () => {
    const apps = discoverApps();
    const agents = listAgents();
    const facts = getStackFacts();
    const audit = runStackAudit(['--json', '--plan']);
    let auditSummary: { total: number; pass: number; warn: number; fail: number } | null = null;
    if (audit.status === 0 || audit.status === 1) {
      try {
        const p = JSON.parse(audit.stdout);
        auditSummary = {
          total: p.audits?.length ?? 0,
          pass: p.passed ?? 0,
          warn: p.warned ?? 0,
          fail: p.failed ?? 0,
        };
      } catch {
        /* ignore */
      }
    }
    const summary = {
      stackVersion: facts.version ?? 'unknown',
      appsDetected: apps.length,
      appsWithPackageJson: apps.filter((a) => a.hasPackageJson).length,
      appsWithoutAuditScripts: apps
        .filter((a) => a.hasPackageJson)
        .filter(
          (a) =>
            !a.scripts.some((s) => ['typecheck', 'test', 'lint'].includes(s)),
        )
        .map((a) => a.app),
      opencodeAgentsSynced: agents.length,
      auditSummary,
      timestamp: new Date().toISOString(),
    };
    return {
      content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
    };
  },
);

// Tool: stack_opencode_agents
server.tool(
  'stack_opencode_agents',
  'List the 21+ OpenCode agents synced to .opencode/agents.',
  {},
  async () => {
    const agents = listAgents();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              total: agents.length,
              agents,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ─── Bootstrap ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log('INFO', 'Starting Stack MCP Server...');

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log('INFO', `Stack MCP Server running on stdio (${discoverApps().length} apps, ${listAgents().length} agents)`);
}

main().catch((error) => {
  log('ERROR', 'Fatal error', { error: (error as Error).message });
  process.exit(1);
});
