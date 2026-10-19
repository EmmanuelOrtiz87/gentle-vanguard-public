#!/usr/bin/env node
/**
 * mem-cli — wrapper nativo del stack para la memoria persistente Engram.
 *
 * El agente usa las MCP tools `mem_*` de forma directa; este CLI permite
 * operar lo mismo desde scripts/CI/sesiones sin tools MCP en el contexto:
 * se conecta por stdio al servidor MCP de engram (`engram mcp`) con el SDK
 * oficial y ejecuta la tool elegida.
 *
 *   npx tsx src/knowledge/mem-cli.ts save --title "Fixed X" --type bugfix \
 *     --scope project --topic-key "agenda/sync" --content "..."
 *   npx tsx src/knowledge/mem-cli.ts summary --content "## Goal\n..."
 *   npx tsx src/knowledge/mem-cli.ts summary --file .runtime/session.md
 *   npx tsx src/knowledge/mem-cli.ts search "recordatorio cascada"
 *   npx tsx src/knowledge/mem-cli.ts context
 *
 * Env: GV_ENGRAM_BIN (default `engram`), MEM_PROJECT (default `gentle-vanguard`).
 * Errores: exit 1 con el detalle en stderr (nunca throw crudo).
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

interface Args {
  command: string;
  flags: Record<string, string>;
}

function parseArgs(argv: string[]): Args {
  const command = argv[0] || 'help';
  const flags: Record<string, string> = {};
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { flags[key] = next; i++; }
    else flags[key] = 'true';
  }
  return { command, flags };
}

const TYPE_ALLOW = ['bugfix', 'decision', 'architecture', 'discovery', 'pattern', 'config', 'preference'] as const;

const USAGE = `mem-cli — Engram desde la línea de comandos (nativo del stack)

Comandos:
  save     --title <t> --type <${TYPE_ALLOW.join('|')}> --content <c>
           [--scope project|personal|global] [--topic-key <k>]
  summary  --content <markdown> | --file <ruta>   (mem_session_summary)
  search   <query>                                (mem_search)
  context                                          (mem_context)
  help                                             esta ayuda`;

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  const transport = new StdioClientTransport({
    command: process.env.GV_ENGRAM_BIN || 'engram',
    args: ['mcp', '--tools=agent', `--project=${process.env.MEM_PROJECT || 'gentle-vanguard'}`],
    cwd: process.cwd(),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'gv-mem-cli', version: '1.0.0' });
  try {
    await client.connect(transport);
    const res = await client.callTool({ name, arguments: args });
    const text = Array.isArray(res?.content)
      ? res.content.map((c: { type: string; text?: string }) => (c.type === 'text' ? c.text : '')).join('\n')
      : '';
    if (res?.isError) throw new Error(text || `tool ${name} falló`);
    return text || JSON.stringify(res);
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const out = (s: string) => process.stdout.write(`${s}\n`);

  if (command === 'help' || !command) { out(USAGE); return; }

  if (command === 'save') {
    const title = flags.title;
    const type = (flags.type || 'discovery') as (typeof TYPE_ALLOW)[number];
    const content = flags.content ?? (flags.file ? readFileSync(flags.file, 'utf8') : '');
    if (!title || !content) { process.stderr.write('Faltan --title y --content|--file\n'); process.exitCode = 1; return; }
    if (!TYPE_ALLOW.includes(type)) { process.stderr.write(`--type inválido. Usar: ${TYPE_ALLOW.join(', ')}\n`); process.exitCode = 1; return; }
    const args: Record<string, unknown> = { title, type, content, scope: flags.scope || 'project' };
    if (flags['topic-key']) args.topic_key = flags['topic-key'];
    out(await callTool('mem_save', args));
    return;
  }

  if (command === 'summary') {
    const content = flags.content ?? (flags.file ? readFileSync(flags.file, 'utf8') : '');
    if (!content) { process.stderr.write('Faltan --content o --file\n'); process.exitCode = 1; return; }
    out(await callTool('mem_session_summary', { content }));
    return;
  }

  if (command === 'search' || command === 'context') {
    const q = process.argv.slice(3).filter((a) => !a.startsWith('--')).join(' ') || flags.q || '';
    out(await callTool(command === 'search' ? 'mem_search' : 'mem_context', command === 'search' ? { query: q } : {}));
    return;
  }

  process.stderr.write(`Comando desconocido: ${command}\n\n${USAGE}\n`);
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((e) => {
    process.stderr.write(`mem-cli: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  });
}
