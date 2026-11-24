#!/usr/bin/env node
/**
 * mcp-call.ts — invocar un MCP "a demanda" SIN precargarlo en el host.
 *
 * POR QUE (2026-11-18)
 * -------------------------------------------------------------------------
 * Los MCP del stack tienen tres estados, y el tercero estaba roto:
 *
 *   - always-on  → el host lo carga al iniciar y paga su esquema en CADA turno.
 *   - on-demand  → declarado, pero sin camino para usarlo en la sesion.
 *   - disabled   → apagado por decision.
 *
 * Medido: el conjunto precargado son 37 tools y ~8.9k tokens de esquema por
 * turno. En cambio `rea` son 170 tools y ~109k tokens de esquema: activarlo
 * "a demanda" precargandolo multiplicaba por 12 el costo de cada turno. El
 * unico camino que habia era `npm run mcp:on-demand` (escribe la config del
 * host) + reiniciar la sesion: el server no se puede usar hasta el proximo
 * arranque, y mientras tanto carga el esquema entero.
 *
 * ESTE PUENTE lo resuelve: levanta el server por stdio, habla MCP con el
 * (initialize -> tools/list -> tools/call) y devuelve el resultado. El host
 * no lo declara, el contexto no crece, y funciona igual en cualquier host y
 * desde cualquier subagente o script.
 *
 * REGLAS
 *   - El comando sale SIEMPRE del registro canonico (`config/mcp-registry.json`)
 *     o de la superficie donde esta declarado. El stack no inventa comandos.
 *   - Si la politica dice `disabled-by-policy`, el puente se niega y explica.
 *   - Toda invocacion queda registrada en `.runtime/mcp-calls.jsonl`, con el
 *     nombre de tool en formato `mcp__<server>__<tool>`: asi la auditoria de
 *     uso (que mira los transcripts de los hosts) cuenta tambien las llamadas
 *     por el puente. Sin esto, el uso desde el puente seria invisible y
 *     "0 invocaciones" seria un cero falso.
 *
 * USO
 *   npm run mcp:call -- --server rea --list
 *   npm run mcp:call -- --server fetch-server --tool fetch --args '{"url":"https://example.com"}'
 *   npm run mcp:call -- --server harness --tool harness_loop_run --args '{}' --json
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runSync } from '../core/run-command.js';
import { activationFor, loadPolicy } from '../mcp/mcp-policy.js';
import { resolveRemoteOAuthToken } from '../mcp/mcp-inventory.js';

const ROOT = resolve(process.cwd());
const CALL_LOG = join(ROOT, '.runtime', 'mcp-calls.jsonl');

export interface ServerSpec {
  name: string;
  command: string;
  args: string[];
  source: 'registro' | 'canon';
  /** `http` = MCP remoto por HTTP (no se lanza por stdio). */
  transport?: 'stdio' | 'http';
  /** Endpoint del MCP remoto. Solo con transport=http. */
  url?: string;
  /** Variables de entorno que el servidor necesita. */
  env?: Record<string, string>;
  /**
   * Dependencia EXTERNA que el server necesita para servir.
   *
   * POR QUE (2026-11-18): `browse` responde 18 tools pero su modo MCP
   * (`browse mcp`) NO auto-arranca el relay local, al contrario que los
   * comandos CLI relay-backed (medido: `browse execute` lo arranca). Sin
   * relay, toda tool responde "relay is not reachable at 127.0.0.1:19988" y
   * se lee como "el server esta roto". El preflight lo verifica y ejecuta
   * el remedio declarado (el ciclo de vida sancionado del propio browse).
   */
  preflight?: PreflightSpec;
}

/** Verificacion de una dependencia externa + su remedio. */
export interface PreflightSpec {
  /** Comando que consulta si la dependencia esta lista. */
  check: { command: string; args?: string[]; readyExitCode?: number };
  /** Comando que deja la dependencia lista (idempotente). */
  remedy?: { command: string; args?: string[] };
  /** Que significa "no listo", en palabras del stack. */
  notReadyHint?: string;
  timeoutMs?: number;
}

/** Servidores que el host declara (host-managed): el stack no los administra. */
export function readCanonServers(root = ROOT): ServerSpec[] {
  const path = join(root, '.mcp.json');
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as {
      mcpServers?: Record<string, { command?: string; args?: string[]; enabled?: boolean }>;
    };
    return Object.entries(parsed.mcpServers ?? {})
      .filter(([, v]) => v.enabled !== false)
      .map(([name, v]) => ({
        name,
        command: String(v.command ?? ''),
        args: v.args ?? [],
        source: 'canon' as const,
      }));
  } catch {
    return [];
  }
}

/** Registro canonico del stack: la fuente de verdad de los comandos. */
export function readRegistryServers(root = ROOT): ServerSpec[] {
  const path = join(root, 'config', 'mcp-registry.json');
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as {
      servers?: Array<{
        name: string;
        command?: string;
        args?: string[];
        enabled?: boolean;
        transport?: string;
        url?: string;
        env?: Record<string, string>;
        preflight?: PreflightSpec;
      }>;
    };
    return (parsed.servers ?? [])
      .filter((s) => s.enabled !== false)
      .map((s): ServerSpec | null => {
        // Un MCP remoto se declara por `url`, no por comando: se llama igual,
        // pero por HTTP y sin levantar proceso.
        if (s.transport === 'remote' || s.transport === 'http') {
          return {
            name: s.name,
            command: '',
            args: [],
            source: 'registro',
            transport: 'http',
            url: s.url ?? '',
            env: s.env,
            preflight: s.preflight,
          };
        }
        if (typeof s.command !== 'string' || s.command.length === 0) return null;
        return {
          name: s.name,
          command: s.command,
          args: s.args ?? [],
          source: 'registro',
          env: s.env,
          preflight: s.preflight,
        };
      })
      .filter((s): s is ServerSpec => s !== null);
  } catch {
    return [];
  }
}

/** Resuelve un servidor por nombre (registro primero, canon despues). */
export function resolveServer(name: string, root = ROOT): ServerSpec | undefined {
  const all = [...readRegistryServers(root), ...readCanonServers(root)];
  const target = name.toLowerCase();
  return (
    all.find((s) => s.name.toLowerCase() === target) ??
    all.find((s) => s.name.toLowerCase().replace(/-/g, '') === target.replace(/-/g, '')) ??
    all.find((s) => s.name.toLowerCase().includes(target) || target.includes(s.name.toLowerCase()))
  );
}

/** El puente se niega si la politica apago la capacidad. */
export function policyRefusal(server: string, root = ROOT): string | undefined {
  const activation = activationFor(loadPolicy(root), server, 'repo');
  if (activation === 'disabled-by-policy') {
    return `${server} esta apagado por politica declarada (config/mcp-lifecycle-policy.json)`;
  }
  return undefined;
}

export interface PreflightResult {
  /** La dependencia esta lista (o no hace falta). */
  ok: boolean;
  /** El server declaraba un preflight. */
  declared: boolean;
  /** Se ejecuto el remedio. */
  remedyRan: boolean;
  /** Que paso, en palabras. */
  detail: string;
}

/**
 * Verifica (y repara) la dependencia externa de un server.
 *
 * REGLAS
 *   - El preflight es DECLARATIVO (viene del registro): el stack no inventa
 *     comandos de terceros.
 *   - El remedio se ejecuta solo si la dependencia NO esta lista, y solo si
 *     es idempotente: un remedio que rompe algo no se ejecuta a ciegas.
 *   - Si el remedio no la deja lista, se dice QUE FALTA y como se arregla:
 *     un fallo honesto vale mas que un error generico.
 */
export function runPreflight(spec: ServerSpec, root = ROOT): PreflightResult {
  const preflight = spec.preflight;
  if (!preflight) return { ok: true, declared: false, remedyRan: false, detail: 'sin preflight' };

  const timeout = preflight.timeoutMs ?? 30_000;
  const readyExit = preflight.check.readyExitCode ?? 0;

  const check = () =>
    runSync(preflight.check.command, preflight.check.args ?? [], { cwd: root, timeout });

  const first = check();
  if (first.status === readyExit) {
    return {
      ok: true,
      declared: true,
      remedyRan: false,
      detail: `dependencia lista (${preflight.check.command})`,
    };
  }

  if (!preflight.remedy) {
    return {
      ok: false,
      declared: true,
      remedyRan: false,
      detail:
        preflight.notReadyHint ??
        `la dependencia de ${spec.name} no esta lista (${preflight.check.command} salio ${first.status})`,
    };
  }

  const remedy = runSync(preflight.remedy.command, preflight.remedy.args ?? [], {
    cwd: root,
    timeout,
  });
  const second = check();
  if (second.status === readyExit) {
    return {
      ok: true,
      declared: true,
      remedyRan: true,
      detail: `dependencia reparada con ${preflight.remedy.command}`,
    };
  }
  return {
    ok: false,
    declared: true,
    remedyRan: true,
    detail:
      `la dependencia de ${spec.name} sigue sin estar lista: ` +
      `${preflight.check.command} salio ${second.status} (remedio: ${preflight.remedy.command} salio ${remedy.status})`,
  };
}

export interface CallOutcome {
  server: string;
  tool?: string;
  tools?: number;
  toolNames?: string[];
  ok: boolean;
  isError?: boolean;
  ms: number;
  content?: unknown;
  error?: string;
}

/** Registra la invocacion en el log que lee la auditoria de uso. */
export function recordCall(entry: Record<string, unknown>, logPath = CALL_LOG): void {
  try {
    mkdirSync(join(logPath, '..'), { recursive: true });
    // El sobre es COMPATIBLE con el detector de invocaciones (`tool_use` +
    // `name`), el mismo que lee los transcripts de los hosts: asi la llamada
    // por el puente cuenta en la auditoria de uso sin un segundo detector que
    // pueda contar distinto. Sin esto, "0 invocaciones" seria un cero falso.
    const envelope = {
      at: entry.at,
      via: 'bridge',
      type: 'assistant',
      content: [{ type: 'tool_use', id: `bridge-${entry.server}`, name: entry.tool, input: {} }],
      server: entry.server,
      ms: entry.ms,
      isError: entry.isError,
      ok: entry.ok,
    };
    appendFileSync(logPath, `${JSON.stringify(envelope)}\n`, 'utf-8');
  } catch {
    /* perder un registro de uso no puede romper la llamada */
  }
}

/** Conecta al server y ejecuta tools/list (y opcionalmente tools/call). */
export async function callServer(
  spec: ServerSpec,
  options: {
    tool?: string;
    args?: Record<string, unknown>;
    timeoutMs?: number;
    oauthHome?: string;
  },
): Promise<CallOutcome> {
  const started = Date.now();
  const oauthToken =
    spec.transport === 'http'
      ? await resolveRemoteOAuthToken(spec.name, { serverUrl: spec.url, home: options.oauthHome })
      : undefined;
  // Un MCP remoto (transport=http) se habla por HTTP: no se levanta proceso.
  // El SDK exige el mismo handshake (initialize -> tools/list -> tools/call).
  const transport =
    spec.transport === 'http'
      ? new StreamableHTTPClientTransport(new URL(spec.url ?? ''), {
          requestInit: oauthToken
            ? { headers: { Authorization: `Bearer ${oauthToken}` } }
            : undefined,
        })
      : new StdioClientTransport({
          command: spec.command,
          args: spec.args,
          cwd: ROOT,
          stderr: 'ignore',
          env: spec.env ? { ...(process.env as Record<string, string>), ...spec.env } : undefined,
        });
  const client = new Client({ name: 'gv-mcp-call', version: '1.0.0' }, { capabilities: {} });
  try {
    await client.connect(transport);
    const list = (await client.listTools()) as {
      tools?: Array<{ name?: string; description?: string }>;
    };
    const tools = list.tools ?? [];
    if (!options.tool) {
      return {
        server: spec.name,
        tools: tools.length,
        toolNames: tools.map((t) => t.name ?? '').filter(Boolean),
        ok: true,
        ms: Date.now() - started,
      };
    }
    const result = (await client.callTool({
      name: options.tool,
      arguments: options.args ?? {},
    })) as { isError?: boolean; content?: unknown };
    return {
      server: spec.name,
      tool: options.tool,
      ok: !result.isError,
      isError: result.isError,
      content: result.content,
      ms: Date.now() - started,
    };
  } catch (err) {
    return {
      server: spec.name,
      tool: options.tool,
      ok: false,
      ms: Date.now() - started,
      error: String(err).slice(0, 400),
    };
  } finally {
    try {
      await client.close();
    } catch {
      /* cierre best-effort */
    }
  }
}

function argOf(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')) {
    return process.argv[idx + 1];
  }
  return undefined;
}

async function main(): Promise<void> {
  const server = argOf('server');
  const tool = argOf('tool');
  const rawArgs = argOf('args');
  const asJson = process.argv.includes('--json');
  const listOnly = process.argv.includes('--list') || !tool;

  if (!server) {
    console.error(
      'uso: npm run mcp:call -- --server <nombre> [--tool <tool> --args <json>] [--list] [--json]',
    );
    process.exit(2);
  }

  const spec = resolveServer(server);
  if (!spec) {
    console.error(
      `no hay entrada canonica para "${server}" (config/mcp-registry.json ni .mcp.json). El stack no inventa comandos.`,
    );
    process.exit(2);
  }
  if (spec.transport === 'http' && !spec.url) {
    console.error(`[mcp-call] ${spec.name} es remoto pero no declara url`);
    process.exit(2);
  }

  const refusal = policyRefusal(spec.name);
  if (refusal) {
    console.error(`[mcp-call] ${refusal}`);
    process.exit(1);
  }

  let args: Record<string, unknown> = {};
  if (rawArgs) {
    try {
      args = JSON.parse(rawArgs) as Record<string, unknown>;
    } catch (err) {
      console.error(`--args no es JSON valido: ${String(err)}`);
      process.exit(2);
    }
  }

  // Preflight: la dependencia externa del server, verificada (y reparada si
  // el remedio es idempotente) ANTES de levantar el server. Sin esto, una
  // dependencia caida se lee como "el server esta roto".
  const preflight = runPreflight(spec);
  if (preflight.declared && !preflight.ok) {
    console.error(`[mcp-call] ${spec.name}: ${preflight.detail}`);
    process.exit(1);
  }

  const outcome = await callServer(spec, { tool: listOnly ? undefined : tool, args });

  // El log usa el prefijo `mcp__<server>__<tool>`: la auditoria de uso lo
  // reconoce como invocacion de ese servidor. Solo se registran llamadas a
  // tools: un `tools/list` es una sonda de capacidad, no uso de negocio, y
  // contarlo infla la medida.
  if (!listOnly) {
    recordCall({
      at: new Date().toISOString(),
      tool: `mcp__${spec.name}__${tool}`,
      server: spec.name,
      via: 'bridge',
      ms: outcome.ms,
      isError: outcome.isError ?? false,
      ok: outcome.ok,
    });
  }

  if (asJson) {
    console.log(JSON.stringify(outcome, null, 2));
  } else if (!outcome.ok) {
    console.error(`[mcp-call] ${spec.name}: ${outcome.error ?? 'la tool fallo'}`);
    // Un MCP remoto con OAuth responde 401 sin credencial: eso NO es un fallo
    // del stack, es lo esperado (la politica lo declara). Decirlo evita que
    // un 401 se lea como "el servidor esta roto".
    if (spec.transport === 'http' && /401|Authentication failed/i.test(outcome.error ?? '')) {
      console.error(
        `[mcp-call] ${spec.name} es remoto y exige credencial OAuth: el token vive en el cliente, no en el stack.`,
      );
    }
    const content = outcome.content as Array<{ type?: string; text?: string }> | undefined;
    if (Array.isArray(content)) {
      for (const item of content) {
        if (item.type === 'text' && item.text) console.error(item.text);
      }
    }
  } else if (listOnly) {
    console.log(`[mcp-call] ${spec.name} expone ${outcome.tools} tools (sin precargar en el host)`);
    for (const name of outcome.toolNames ?? []) console.log(`  - ${name}`);
  } else {
    console.log(`[mcp-call] ${spec.name}.${outcome.tool} → ${outcome.ms}ms`);
    const content = outcome.content as Array<{ type?: string; text?: string }> | undefined;
    if (Array.isArray(content)) {
      for (const item of content) {
        if (item.type === 'text' && item.text) console.log(item.text);
      }
    } else if (outcome.content !== undefined) {
      console.log(JSON.stringify(outcome.content, null, 2));
    }
  }
  // `process.exit()` con el pool HTTP de undici abierto rompe libuv
  // (Assertion failed: UV_HANDLE_CLOSING, exit 3221226505) en Windows. Para un
  // servidor remoto hay que dejar que el event loop termine solo: se fija
  // `exitCode` y se sale de forma natural.
  if (spec.transport === 'http') {
    process.exitCode = outcome.ok ? 0 : 1;
    return;
  }
  process.exit(outcome.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  void main();
}
