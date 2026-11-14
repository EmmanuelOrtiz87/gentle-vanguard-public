#!/usr/bin/env node
/**
 * MCP inventory — inventario REAL de tools de los servers MCP activos (BL-MVI62UGZ-M4AX
 * residuo BL-MVI6ZNMA-P8GM). Nada se adivina: conecta cada server habilitado y lista
 * sus tools vía tools/list.
 *
 * Transportes soportados:
 *   - stdio (mcp-registry + opencode.json): spawn por StdioClientTransport (SDK).
 *   - remote con headers (auth bearer): StreamableHTTPClientTransport + sustitución {env:VAR}.
 *   - remote con OAuth de OpenCode: token/refresh leídos de ~/.local/share/opencode/
 *     mcp-auth.json (refresh automático vía RFC 8414 si venció); sin credencial queda
 *     diferido como remote-oauth, nunca cuenta como fallo.
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
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
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
  url?: string;
  headers?: Record<string, string>;
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

/**
 * Sustituye `{env:VAR}` en valores de headers de servers remotos (opencode.json).
 * El token nunca vive en el archivo de config: vive en el entorno del usuario.
 */
export function expandEnvValue(raw: string): string {
  return raw.replace(
    /\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g,
    (_, name: string) => process.env[name] ?? '',
  );
}

function remoteHeaders(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>))
    out[k] = expandEnvValue(String(v));
  return Object.keys(out).length > 0 ? out : undefined;
}

export function loadServerSpecs(root: string, includeHeavy: boolean): ServerSpec[] {
  const specs: ServerSpec[] = [];
  const regPath = join(root, 'config', 'mcp-registry.json');
  if (existsSync(regPath)) {
    const reg = JSON.parse(readFileSync(regPath, 'utf-8')) as {
      servers: Array<Record<string, unknown>>;
    };
    for (const s of reg.servers) {
      if (!s.enabled || s.transport !== 'stdio') continue;
      specs.push({
        name: String(s.name),
        source: 'mcp-registry',
        command: String(s.command),
        args: (s.args as string[]) ?? [],
      });
    }
  }
  const ocPath = join(root, 'opencode.json');
  if (existsSync(ocPath)) {
    const oc = JSON.parse(readFileSync(ocPath, 'utf-8')) as {
      mcp?: Record<string, Record<string, unknown>>;
    };
    // El formato actual anida los servers en `mcp.servers` (reestructuración
    // 2026-11-13, commit 568c70ee7); el formato viejo los colgaba de `mcp` —
    // soportar ambos para que el inventario no quede silenciosamente vacío.
    const ocMcp = (oc.mcp?.servers ?? oc.mcp ?? {}) as Record<string, Record<string, unknown>>;
    for (const [name, s] of Object.entries(ocMcp)) {
      if (!s.enabled) continue;
      if (s.type === 'remote') {
        // Remote con headers configurados (auth bearer) SÍ se inventaría vía HTTP;
        // sin headers queda diferido como remote-oauth.
        const headers = remoteHeaders(s.headers);
        specs.push({
          name,
          source: 'opencode',
          command: '(remote)',
          args: [],
          remoteOauth: !headers,
          url: typeof s.url === 'string' ? s.url : undefined,
          headers,
        });
        continue;
      }
      const heavy = name === 'chrome-devtools';
      if (heavy && !includeHeavy) continue;
      // opencode.json (formato 2026-11-13) puede declarar `command` como array
      // (["codegraph","serve","--mcp"]) o como string compuesto
      const cmdRaw: unknown = s.command;
      let command: string;
      let args: string[];
      if (Array.isArray(cmdRaw)) {
        const parts = cmdRaw.map((v) => String(v));
        command = parts[0] ?? '';
        args = parts.slice(1);
      } else {
        command = String(cmdRaw);
        // opencode.json declara args como string ("codegraph serve --mcp") o array
        // (["--import","tsx",...]); normalizar ambos formatos.
        const rawArgs: unknown = s.args;
        args = Array.isArray(rawArgs)
          ? (rawArgs as unknown[]).map((v) => String(v))
          : parseArgString(rawArgs);
        if (args.length === 0 && command.includes(' ')) {
          // opencode.json declara comando compuesto ("codegraph serve --mcp") como string
          const parts = command.split(/\s+/);
          command = parts[0];
          args = parts.slice(1);
        }
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

export function dedupeServerSpecs(
  specs: readonly ServerSpec[],
): Array<{ spec: ServerSpec; isPrimary: boolean; primaryName: string }> {
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

export function diffToolsets(
  baseline: string[],
  current: string[],
): { added: string[]; removed: string[] } {
  const b = new Set(baseline);
  const c = new Set(current);
  return {
    added: current.filter((t) => !b.has(t)).sort(),
    removed: baseline.filter((t) => !c.has(t)).sort(),
  };
}

// ------------------------------------------------------------------ discovery

interface OpenCodeAuthEntry {
  tokens?: { accessToken?: string; refreshToken?: string; expiresAt?: number };
  clientInfo?: { clientId?: string };
  serverUrl?: string;
}

function loadOpenCodeAuth(serverName: string): OpenCodeAuthEntry | undefined {
  const path = join(homedir(), '.local', 'share', 'opencode', 'mcp-auth.json');
  if (!existsSync(path)) return undefined;
  try {
    const store = JSON.parse(readFileSync(path, 'utf-8')) as { [name: string]: OpenCodeAuthEntry };
    return store[serverName];
  } catch {
    return undefined;
  }
}

/**
 * Token OAuth vigente de un server remoto guardado por OpenCode
 * (~/.local/share/opencode/mcp-auth.json tras `opencode mcp auth <server>`).
 * Si el access token venció pero hay refreshToken, lo refresca vía el
 * token_endpoint descubierto en /.well-known/oauth-authorization-server
 * (RFC 8414 / OAuth MCP). Devuelve undefined si no hay credencial utilizable —
 * el inventario reporta diferido, nunca fallo.
 */
export async function resolveRemoteOAuthToken(serverName: string): Promise<string | undefined> {
  const entry = loadOpenCodeAuth(serverName);
  const tokens = entry?.tokens;
  if (!tokens?.accessToken) return undefined;
  const expired = typeof tokens.expiresAt === 'number' && Date.now() / 1000 > tokens.expiresAt;
  if (!expired) return tokens.accessToken;
  if (!tokens.refreshToken) return undefined;

  const serverUrl = entry?.serverUrl;
  if (!serverUrl) return undefined;
  try {
    const url = new URL(serverUrl);
    // RFC 8414: /.well-known/oauth-authorization-server[/path] — el path del MCP
    // (p.ej. /mcp) puede formar parte del discovery.
    const origins = [
      `${url.origin}/.well-known/oauth-authorization-server${url.pathname}`,
      `${url.origin}/.well-known/oauth-authorization-server`,
    ];
    let tokenEndpoint: string | undefined;
    for (const candidate of origins) {
      const res = await fetch(candidate, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const meta = (await res.json()) as { token_endpoint?: string };
      if (meta.token_endpoint) {
        tokenEndpoint = meta.token_endpoint;
        break;
      }
    }
    if (!tokenEndpoint) return undefined;
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: entry?.clientInfo?.clientId ?? '',
    });
    const res = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return undefined;
    const payload = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!payload.access_token) return undefined;
    // El refresh puede ROTAR el refresh_token: persistir el nuevo par en el
    // store de OpenCode (misma estructura) para no invalidar su próxima sesión.
    try {
      const path = join(homedir(), '.local', 'share', 'opencode', 'mcp-auth.json');
      const store = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, OpenCodeAuthEntry>;
      const e = store[serverName];
      if (e?.tokens) {
        e.tokens.accessToken = payload.access_token;
        if (payload.refresh_token) e.tokens.refreshToken = payload.refresh_token;
        if (typeof payload.expires_in === 'number')
          e.tokens.expiresAt = Date.now() / 1000 + payload.expires_in;
        writeFileSync(path, JSON.stringify(store, null, 2), 'utf-8');
      }
    } catch {
      /* best-effort: el inventario ya tiene su token para esta corrida */
    }
    return payload.access_token;
  } catch {
    return undefined;
  }
}

async function listToolsFor(spec: ServerSpec): Promise<InventoryServer> {
  const base: InventoryServer = {
    name: spec.name,
    source: spec.source,
    command: `${spec.command} ${spec.args.join(' ')}`.trim(),
    tools: [],
  };
  // Remote: con headers declarados (bearer) o con token OAuth de OpenCode se
  // inventaría vía HTTP streamable; sin credencial queda diferido (no es fallo).
  if (spec.url && !spec.headers) {
    const oauthToken = await resolveRemoteOAuthToken(spec.name);
    if (!oauthToken)
      return { ...base, tools: [], error: 'remote-oauth (no inventoria automático)' };
    spec = { ...spec, headers: { Authorization: `Bearer ${oauthToken}` } };
  }
  if (spec.remoteOauth && !spec.url)
    return { ...base, tools: [], error: 'remote-oauth (no inventoria automático)' };
  try {
    if (spec.url) {
      // Remote MCP con auth vía headers (p.ej. mercadopago bearer): transporte
      // HTTP streamable del SDK, headers expandidos de {env:VAR}.
      const transport = new StreamableHTTPClientTransport(new URL(spec.url), {
        requestInit: spec.headers ? { headers: spec.headers } : undefined,
      });
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
    }
    const transport = new StdioClientTransport({
      command: spec.command,
      args: spec.args,
      stderr: 'ignore',
    });
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
      const inv: InventoryServer = {
        name: spec.name,
        source: spec.source,
        command: shared.command,
        tools: [...shared.tools],
      };
      servers.push(inv);
      console.error(
        `  ✔ ${inv.name} — ${inv.tools.length} tools (instancia compartida de ${primaryName})`,
      );
      continue;
    }
    const inv = await listToolsFor(spec);
    resolvedByName.set(spec.name, inv);
    servers.push(inv);
    // El estado lo define el RESULTADO, no la declaración: un remote-oauth con
    // credencial resuelta es un server verificado más.
    if (inv.error?.startsWith('remote-oauth'))
      console.error(`  ∼ ${inv.name} — requiere OAuth; inventario diferido`);
    else if (inv.error) console.error(`  ∅ ${inv.name} — error: ${inv.error}`);
    else console.error(`  ✔ ${inv.name} — ${inv.tools.length} tools${spec.url ? ' (remoto)' : ''}`);
  }

  const capturedAt = new Date().toISOString();
  const deferred = servers.filter((s) => s.error?.startsWith('remote-oauth')).length;
  const failed = servers.filter((s) => s.error && !s.error.startsWith('remote-oauth'));
  const coverage = {
    verified: servers.filter((s) => !s.error).length,
    deferred,
    failed: failed.length,
  };
  const payload = { capturedAt, servers, coverage };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(LATEST, JSON.stringify(payload, null, 2), 'utf-8');

  if (flags.has('emit-allowlist')) {
    const names = servers.flatMap((s) => (s.error ? [] : s.tools)).sort();
    console.log(names.join(', '));
  }

  let code = failed.length > 0 ? 1 : 0;
  if (failed.length > 0)
    console.error(
      `[mcp-inventory] captura incompleta: ${failed.length} servidor(es) no disponibles`,
    );
  if (deferred > 0)
    console.error(`[mcp-inventory] cobertura diferida: ${deferred} conexión(es) requieren OAuth`);
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
        console.error(
          `[mcp-inventory] DRIFT ${s.source}:${s.name} added=[${d.added.join(', ')}] removed=[${d.removed.join(', ')}]`,
        );
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

const invoked = ['mcp-inventory.ts', 'mcp-inventory.js'].includes(
  process.argv[1]?.split(/[\\/]/).pop() ?? '',
);
if (invoked) {
  main(process.argv.slice(2))
    .then((c) => {
      process.exitCode = c;
    })
    .catch((e: unknown) => {
      console.error(`[mcp-inventory] fatal: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    });
}
