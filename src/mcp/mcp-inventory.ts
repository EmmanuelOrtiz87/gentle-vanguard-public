#!/usr/bin/env node
/**
 * MCP inventory — inventario REAL de tools de los servers MCP activos (BL-MVI62UGZ-M4AX
 * residuo BL-MVI6ZNMA-P8GM). Nada se adivina: conecta cada server stdio habilitado con el
 * SDK MCP (client) y lista sus tools vía tools/list.
 *
 * Output:
 *   .runtime/mcp-inventory/mcp-inventory-latest.json   — captura actual
 *   .runtime/mcp-inventory/baseline.json               — baseline (con --baseline)
 *
 * Modos:
 *   default            — captura y reporta
 *   --diff             — además compara vs baseline y exit 1 si hay drift de tools (gate)
 *   --baseline         — al terminar, guarda la captura como baseline
 *   --emit-allowlist   — imprime los nombres de tools (para pegar en policy YAML)
 *   --include-heavy    — incluye servers que abren browser/UX (chrome-devtools)
 *
 * subprocesses: spawn por StdioClientTransport (SDK), windowsHide interna; nunca exec
 * con string ni cmd.exe.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(process.cwd());
const OUT_DIR = join(ROOT, '.runtime', 'mcp-inventory');
const LATEST = join(OUT_DIR, 'mcp-inventory-latest.json');
const BASELINE = join(OUT_DIR, 'baseline.json');
const CONNECT_TIMEOUT_MS = 45000;

interface ServerSpec {
  name: string;
  source: 'mcp-registry' | 'opencode';
  command: string;
  args: string[];
  heavy?: boolean;
  remoteOauth?: boolean;
}

interface InventoryServer {
  name: string;
  source: string;
  command: string;
  tools: string[];
  error?: string;
}

// ------------------------------------------------------------- servers config

export function parseArgString(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  // split manual (sin regex, windowsHide-safe): respeta tokens entre comillas
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (const ch of raw) {
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (ch === ' ' && !inQuote) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function loadServerSpecs(root: string, includeHeavy: boolean): ServerSpec[] {
  const specs: ServerSpec[] = [];
  const regPath = join(root, 'config', 'mcp-registry.json');
  if (existsSync(regPath)) {
    const reg = JSON.parse(readFileSync(regPath, 'utf-8')) as { servers: Array<Record<string, unknown>> };
    for (const s of reg.servers) {
      if (!s.enabled || s.transport !== 'stdio') continue;
      specs.push({ name: String(s.name), source: 'mcp-registry', command: String(s.command), args: (s.args as string[]) ?? [] });
    }
  }
  const ocPath = join(root, 'opencode.json');
  if (existsSync(ocPath)) {
    const oc = JSON.parse(readFileSync(ocPath, 'utf-8')) as { mcp?: Record<string, Record<string, unknown>> };
    for (const [name, s] of Object.entries(oc.mcp ?? {})) {
      if (!s.enabled) continue;
      if (s.type === 'remote') {
        specs.push({ name, source: 'opencode', command: '(remote)', args: [], remoteOauth: true });
        continue;
      }
      const heavy = name === 'chrome-devtools';
      if (heavy && !includeHeavy) continue;
      let command = String(s.command);
      // opencode.json declara args como string ("codegraph serve --mcp") o array
      // (["--import","tsx",...]); normalizar ambos formatos.
      const rawArgs: unknown = s.args;
      let args = Array.isArray(rawArgs) ? (rawArgs as unknown[]).map((v) => String(v)) : parseArgString(rawArgs);
      if (args.length === 0 && command.includes(' ')) {
        // opencode.json declara comando compuesto ("codegraph serve --mcp") como string
        const parts = command.split(/\s+/);
        command = parts[0];
        args = parts.slice(1);
      }
      specs.push({ name, source: 'opencode', command, args, heavy });
    }
  }
  return specs;
}

// ----------------------------------------------------------------- dedupe logic

/**
 * Firma de identidad de un server stdio: comando normalizado + args.
 * mcp-registry y opencode.json pueden declarar EL MISMO server (p.ej. gv-analytics-atlassian);
 * spawnearlo dos veces en paralelo hace fallar al segundo (contenido del server con
 * estado al importar: vault/db SQLite). El inventario resuelve 1 vez y comparte el
 * resultado entre entries con la misma firma.
 */
export function signatureOf(spec: ServerSpec): string {
  const cmd = spec.command.replace(/[\\/]+/g, '/').toLowerCase();
  return `${cmd}|${spec.args.join(' ')}`;
}

export function dedupeServerSpecs(specs: readonly ServerSpec[]): Array<{ spec: ServerSpec; isPrimary: boolean; primaryName: string }> {
  const bySignature = new Map<string, { spec: ServerSpec; index: number }>();
  const out: Array<{ spec: ServerSpec; isPrimary: boolean; primaryName: string }> = [];
  for (const spec of specs) {
    const sig = signatureOf(spec);
    const first = bySignature.get(sig);
    if (first) {
      out.push({ spec, isPrimary: false, primaryName: first.spec.name });
    } else {
      bySignature.set(sig, { spec, index: specs.indexOf(spec) });
      out.push({ spec, isPrimary: true, primaryName: spec.name });
    }
  }
  return out;
}

// ----------------------------------------------------------------- diff logic

export function diffToolsets(baseline: string[], current: string[]): { added: string[]; removed: string[] } {
  const b = new Set(baseline);
  const c = new Set(current);
  return {
    added: current.filter((t) => !b.has(t)).sort(),
    removed: baseline.filter((t) => !c.has(t)).sort(),
  };
}

// ------------------------------------------------------------------ discovery

async function listToolsFor(spec: ServerSpec): Promise<InventoryServer> {
  const base: InventoryServer = { name: spec.name, source: spec.source, command: `${spec.command} ${spec.args.join(' ')}`.trim(), tools: [] };
  if (spec.remoteOauth) return { ...base, tools: [], error: 'remote-oauth (no inventoria automático)' };
  try {
    const transport = new StdioClientTransport({ command: spec.command, args: spec.args, stderr: 'ignore' });
    const client = new Client({ name: 'gv-mcp-inventory', version: '1.0.0' });
    const timeout = setTimeout(() => transport.close(), CONNECT_TIMEOUT_MS);
    try {
      await client.connect(transport);
      const res = await client.listTools();
      base.tools = (res.tools ?? []).map((t) => t.name).sort();
      await client.close();
    } catch (e: unknown) {
      base.error = e instanceof Error ? e.message.split('\n')[0] : String(e);
    } finally {
      clearTimeout(timeout);
    }
    return base;
  } catch (e: unknown) {
    return { ...base, error: e instanceof Error ? e.message.split('\n')[0] : String(e) };
  }
}

// ----------------------------------------------------------------------- main

async function main(argv: readonly string[]): Promise<number> {
  const flags = new Set<string>();
  for (const a of argv) if (a.indexOf('--') === 0) flags.add(a.slice(2));
  const includeHeavy = flags.has('include-heavy');
  const specs = loadServerSpecs(ROOT, includeHeavy);
  console.error(`[mcp-inventory] ${specs.length} servers stdio a inventariar`);

  const servers: InventoryServer[] = [];
  const deduped = dedupeServerSpecs(specs);
  const resolvedByName = new Map<string, InventoryServer>();
  for (const { spec, isPrimary, primaryName } of deduped) {
    if (!isPrimary) {
      const shared = resolvedByName.get(primaryName);
      if (!shared) continue; // defensa: primary omitido por filtro heavy
      const inv: InventoryServer = { name: spec.name, source: spec.source, command: shared.command, tools: [...shared.tools] };
      servers.push(inv);
      console.error(`  ✔ ${inv.name} — ${inv.tools.length} tools (instancia compartida de ${primaryName})`);
      continue;
    }
    const inv = await listToolsFor(spec);
    resolvedByName.set(spec.name, inv);
    servers.push(inv);
    if (spec.remoteOauth) console.error(`  ∼ ${inv.name} — requiere OAuth; inventario diferido`);
    else if (inv.error) console.error(`  ∅ ${inv.name} — error: ${inv.error}`);
    else console.error(`  ✔ ${inv.name} — ${inv.tools.length} tools`);
  }

  const capturedAt = new Date().toISOString();
  const deferred = servers.filter((s) => s.error?.startsWith('remote-oauth')).length;
  const failed = servers.filter((s) => s.error && !s.error.startsWith('remote-oauth'));
  const coverage = { verified: servers.filter((s) => !s.error).length, deferred, failed: failed.length };
  const payload = { capturedAt, servers, coverage };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(LATEST, JSON.stringify(payload, null, 2), 'utf-8');

  if (flags.has('emit-allowlist')) {
    const names = servers.flatMap((s) => (s.error ? [] : s.tools)).sort();
    console.log(names.join(', '));
  }

  let code = failed.length > 0 ? 1 : 0;
  if (failed.length > 0) console.error(`[mcp-inventory] captura incompleta: ${failed.length} servidor(es) no disponibles`);
  if (deferred > 0) console.error(`[mcp-inventory] cobertura diferida: ${deferred} conexión(es) requieren OAuth`);
  if (flags.has('diff')) {
    if (!existsSync(BASELINE)) {
      if (code !== 0) {
        console.error('[mcp-inventory] baseline no creada: captura fallida');
        return code;
      }
      writeFileSync(BASELINE, JSON.stringify(payload, null, 2), 'utf-8');
      console.error('[mcp-inventory] baseline inicial creada con herramientas verificadas');
      return 0;
    }
    const base = JSON.parse(readFileSync(BASELINE, 'utf-8')) as { servers: InventoryServer[] };
    const b = new Map(base.servers.map((s) => [`${s.source}:${s.name}`, s.tools]));
    const current = new Set(servers.map((s) => `${s.source}:${s.name}`));
    for (const old of base.servers) {
      if (old.name === 'chrome-devtools' && !includeHeavy) continue;
      if (!current.has(`${old.source}:${old.name}`)) {
        console.error(`[mcp-inventory] DRIFT servidor eliminado: ${old.source}:${old.name}`);
        code = 1;
      }
    }
    for (const s of servers) {
      const prev = b.get(`${s.source}:${s.name}`);
      if (s.error) continue; // fallos locales ya bloquean; OAuth se informa como diferido
      if (!prev) {
        console.error(`[mcp-inventory] DRIFT servidor nuevo: ${s.source}:${s.name}`);
        code = 1;
        continue;
      }
      const d = diffToolsets(prev, s.tools);
      if (d.added.length > 0 || d.removed.length > 0) {
        console.error(`[mcp-inventory] DRIFT ${s.source}:${s.name} added=[${d.added.join(', ')}] removed=[${d.removed.join(', ')}]`);
        code = 1;
      }
    }
    if (code === 0) console.error('[mcp-inventory] sin drift de tools vs baseline');
  }

  if (flags.has('baseline')) {
    if (code !== 0) {
      console.error('[mcp-inventory] baseline conservada: resolver fallos antes de actualizar');
      return code;
    }
    writeFileSync(BASELINE, JSON.stringify(payload, null, 2), 'utf-8');
    console.error(`[mcp-inventory] baseline actualizada (${servers.length} servers)`);
  }

  return code;
}

const invoked = ['mcp-inventory.ts', 'mcp-inventory.js'].includes(process.argv[1]?.split(/[\\/]/).pop() ?? '');
if (invoked) {
  main(process.argv.slice(2))
    .then((c) => { process.exitCode = c; })
    .catch((e: unknown) => {
      console.error(`[mcp-inventory] fatal: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    });
}
