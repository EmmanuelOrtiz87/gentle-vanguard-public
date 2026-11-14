#!/usr/bin/env node
/**
 * mcp-doctor.ts — Verifica los MCP configurados con un handshake JSON-RPC REAL.
 *
 * Por que existe: `opencode mcp list` miente en los dos sentidos (medido 2026-11-13):
 *   1. Da `failed` por timeout de 30 s en servers con cold start lento (npx, tsx).
 *      El server esta sano y conecta 5 segundos despues.
 *   2. Da `connected` a servers remotos que responden 401 a cada tool.
 *
 * La prueba honesta es protocolo: se lanza el server con stdio real, se manda
 * `initialize`, luego `notifications/initialized` y `tools/list`. Un server que
 * responde eso esta operativo; uno que no, no lo esta, diga lo que diga el cliente.
 *
 * Corolario que ya costo un diagnostico falso: un server con StdioServerTransport
 * TERMINA EN SILENCIO cuando se le cierra stdin (exit limpio, sin stderr). Lanzarlo
 * desde un gestor que no conecta pipes lo hace parecer roto. Este doctor siempre
 * conecta stdin, que es la unica forma de saber.
 *
 * Los servers remotos no se pueden probar sin el token OAuth que guarda el cliente:
 * se reportan `skip` con el comando exacto para diagnosticarlos.
 *
 * Uso:
 *   node --import tsx src/tools/mcp-doctor.ts
 *   node --import tsx src/tools/mcp-doctor.ts --json
 *   node --import tsx src/tools/mcp-doctor.ts --strict      # exit 1 si algun server falla
 *   node --import tsx src/tools/mcp-doctor.ts --server=gv-analytics-atlassian
 *   node --import tsx src/tools/mcp-doctor.ts --timeout-ms=90000
 *   node --import tsx src/tools/mcp-doctor.ts --max-tools=150
 *   node --import tsx src/tools/mcp-doctor.ts --policy      # deriva politica<->config (no lanza procesos)
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { run } from '../core/run-command.js';

type Status = 'ok' | 'fail' | 'skip';

interface ServerConfig {
  type?: string;
  command?: string[] | string;
  args?: string[];
  url?: string;
  enabled?: boolean;
  environment?: Record<string, string>;
}

interface ServerReport {
  name: string;
  type: string;
  status: Status;
  tools: number;
  toolNames: string[];
  elapsedMs: number;
  serverInfo?: string;
  detail: string;
}

interface Report {
  ok: boolean;
  totalTools: number;
  servers: ServerReport[];
}

export interface McpDoctorOptions {
  cwd?: string;
  /** Timeout por server: el cold start de npx/tsx puede pasar de 30 s. */
  timeoutMs?: number;
  /** Solo este server. */
  only?: string;
  /** Umbral de aviso por presupuesto de prompt (los schemas son contexto). */
  maxTools?: number;
}

const PROTOCOL_VERSION = '2024-11-05';

function readJson(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** Config del proyecto sobre config global, con el shape V2 (`mcp.servers`). */
export function loadServers(cwd: string): Record<string, ServerConfig> {
  const global = readJson(join(homedir(), '.config', 'opencode', 'opencode.json'));
  const project = readJson(join(cwd, 'opencode.json'));
  const pick = (cfg: Record<string, unknown> | undefined): Record<string, ServerConfig> => {
    const mcp = (cfg?.mcp ?? {}) as Record<string, unknown>;
    const servers = (mcp.servers ?? {}) as Record<string, ServerConfig>;
    // El shape V1 (`mcp.<nombre>` sin `servers`) es lo que OpenCode descarta en silencio:
    // se ignora a proposito para que el doctor no reporte como operativo lo que el cliente no carga.
    return servers;
  };
  return { ...pick(global), ...pick(project) };
}

/** Handshake real por stdio: initialize -> initialized -> tools/list. */
function handshake(name: string, config: ServerConfig, timeoutMs: number): Promise<ServerReport> {
  const started = Date.now();
  const argv = Array.isArray(config.command) ? config.command : [String(config.command ?? '')];
  const [exe, ...rest] = argv;
  const args = [...rest, ...(config.args ?? [])];
  if (!exe) {
    return Promise.resolve({
      name,
      type: config.type ?? 'local',
      status: 'fail',
      tools: 0,
      toolNames: [],
      elapsedMs: 0,
      detail: 'sin command (shape V1 o entrada vacia: OpenCode la descarta)',
    });
  }
  return new Promise<ServerReport>((resolvePromise) => {
    const child = run(exe, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, ...(config.environment ?? {}) } as NodeJS.ProcessEnv,
    });
    let buffer = '';
    let stderr = '';
    let done = false;
    let serverInfo: string | undefined;

    const finish = (status: Status, detail: string, tools: string[] = []): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        // el proceso ya murio
      }
      resolvePromise({
        name,
        type: config.type ?? 'local',
        status,
        tools: tools.length,
        toolNames: tools,
        elapsedMs: Date.now() - started,
        serverInfo,
        detail,
      });
    };

    const timer = setTimeout(() => {
      finish('fail', `timeout ${timeoutMs} ms sin tools/list`);
    }, timeoutMs);

    // `run()` devuelve ChildProcess con stdio opcional segun el tipo: sin los tres
    // pipes no hay protocolo posible, y hay que decirlo en vez de romper.
    const stdin = child.stdin;
    const stdout = child.stdout;
    const stderrStream = child.stderr;
    if (!stdin || !stdout || !stderrStream) {
      resolvePromise({
        name,
        type: config.type ?? 'local',
        status: 'fail',
        tools: 0,
        toolNames: [],
        elapsedMs: Date.now() - started,
        detail: 'sin pipes stdio (no se puede hablar el protocolo)',
      });
      return;
    }

    child.on('error', (err) => finish('fail', `no se pudo lanzar: ${String(err)}`));
    child.on('exit', (code) => {
      // Salir antes de responder es exactamente el sintoma de stdin cerrado.
      if (!done) finish('fail', `termino antes del handshake (code=${String(code)})`);
    });
    stderrStream.on('data', (chunk) => {
      stderr += String(chunk);
    });
    stdout.on('data', (chunk) => {
      buffer += String(chunk);
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let msg: { id?: number; result?: Record<string, unknown>; error?: { message?: string } };
        try {
          msg = JSON.parse(line) as typeof msg;
        } catch {
          continue;
        }
        if (msg.id === 1) {
          const info = msg.result?.serverInfo as { name?: string; version?: string } | undefined;
          serverInfo = info ? `${info.name ?? '?'} ${info.version ?? ''}`.trim() : undefined;
          stdin.write(
            `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
          );
          stdin.write(
            `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`,
          );
        } else if (msg.id === 2) {
          if (msg.error) {
            finish('fail', `tools/list fallo: ${msg.error.message ?? 'sin mensaje'}`);
            return;
          }
          const tools = ((msg.result?.tools ?? []) as Array<{ name?: string }>).map(
            (t) => t.name ?? '?',
          );
          finish('ok', `${tools.length} tools`, tools);
        }
      }
    });

    stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'gv-mcp-doctor', version: '1.0.0' },
        },
      })}\n`,
    );
    // Si el server no lee nunca, un EPIPE en stdin no debe tumbar el doctor.
    stdin.on('error', () => {
      if (!done && stderr.trim()) finish('fail', `stdin cerrado: ${stderr.trim().slice(-200)}`);
    });
  });
}

export async function diagnoseMcp(options: McpDoctorOptions = {}): Promise<Report> {
  const cwd = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? 45_000;
  const servers = loadServers(cwd);
  const entries = Object.entries(servers).filter(
    ([name, cfg]) => cfg.enabled !== false && (!options.only || name === options.only),
  );

  const remote: ServerReport[] = [];
  const local: Array<[string, ServerConfig]> = [];
  for (const [name, cfg] of entries) {
    if (cfg.type === 'remote' || (cfg.url && !cfg.command)) {
      remote.push({
        name,
        type: 'remote',
        status: 'skip',
        tools: 0,
        toolNames: [],
        elapsedMs: 0,
        detail: `remoto: verificar con \`opencode mcp debug ${name}\` (el token OAuth vive en el cliente)`,
      });
    } else {
      local.push([name, cfg]);
    }
  }

  const settled = await Promise.allSettled(
    local.map(([name, cfg]) => handshake(name, cfg, timeoutMs)),
  );
  const reports: ServerReport[] = settled.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : {
          name: local[i]?.[0] ?? '?',
          type: 'local',
          status: 'fail',
          tools: 0,
          toolNames: [],
          elapsedMs: 0,
          detail: `excepcion: ${String(r.reason)}`,
        },
  );

  const all = [...reports, ...remote].sort((a, b) => a.name.localeCompare(b.name));
  return {
    ok: all.every((s) => s.status !== 'fail'),
    totalTools: all.reduce((sum, s) => sum + s.tools, 0),
    servers: all,
  };
}

// ─── Politica ────────────────────────────────────────────────────────────────

export interface PolicyDrift {
  ok: boolean;
  problems: string[];
  policyServers: number;
  configServers: string[];
}

interface PolicyEntry {
  role?: string;
  criticality?: string;
  activation?: string;
  management?: string;
  verification?: string;
  notes?: string;
  [key: string]: unknown;
}

/**
 * Deriva entre `config/mcp-lifecycle-policy.json` y la config real de OpenCode.
 *
 * El handshake prueba que un server responde AHORA. Esto prueba algo distinto y
 * complementario: que la politica declarada y la config no se contradigan. Ya
 * paso — `memory` figuraba `disabled-by-policy` con el server `enabled`, y nadie
 * se enteraba porque nada comparaba las dos fuentes.
 *
 * Invariantes:
 *   1. schema: cada entry cumple required + enums + tipos.
 *   2. toda capacidad configurada esta declarada en la politica (nada opera sin politica).
 *   3. `disabled-by-policy` no puede estar enabled; `always-on` no puede estar ausente ni disabled.
 */
export function checkPolicy(cwd: string): PolicyDrift {
  const policyPath = join(cwd, 'config', 'mcp-lifecycle-policy.json');
  const schemaPath = join(cwd, 'config', 'mcp-lifecycle-policy.schema.json');
  const policy = readJson(policyPath);
  const schema = readJson(schemaPath);
  if (!policy) {
    return {
      ok: false,
      problems: [`no se pudo leer ${policyPath}`],
      policyServers: 0,
      configServers: [],
    };
  }

  const problems: string[] = [];
  const servers = (policy.servers ?? {}) as Record<string, PolicyEntry>;

  // 1. schema
  const schemaServers = ((schema?.properties as Record<string, unknown> | undefined)?.servers ??
    {}) as {
    required?: string[];
    additionalProperties?: { properties?: Record<string, { enum?: unknown[]; type?: string }> };
  };
  const required = schemaServers.required ?? [];
  const fields = schemaServers.additionalProperties?.properties ?? {};
  for (const [name, entry] of Object.entries(servers)) {
    for (const key of required) {
      if (!(key in entry)) problems.push(`[schema] ${name}: falta "${key}"`);
    }
    for (const [key, value] of Object.entries(entry)) {
      const spec = fields[key];
      if (!spec) {
        problems.push(`[schema] ${name}.${key}: propiedad no declarada en el schema`);
        continue;
      }
      if (spec.enum && !spec.enum.includes(value)) {
        problems.push(`[schema] ${name}.${key}=${JSON.stringify(value)} no esta en el enum`);
      }
      if (spec.type && typeof value !== spec.type) {
        problems.push(`[schema] ${name}.${key}: tipo ${typeof value} != ${spec.type}`);
      }
    }
  }

  // 2 y 3. config real
  const configured = loadServers(cwd);
  for (const [name, cfg] of Object.entries(configured)) {
    const entry = servers[name];
    if (!entry) {
      problems.push(`[politica] ${name} esta en la config y no en la politica`);
      continue;
    }
    const enabled = cfg.enabled !== false;
    if (entry.activation === 'disabled-by-policy' && enabled) {
      problems.push(
        `[deriva] ${name}: politica dice disabled-by-policy y la config lo tiene enabled`,
      );
    }
    if (entry.activation === 'always-on' && !enabled) {
      problems.push(`[deriva] ${name}: politica dice always-on y la config lo tiene disabled`);
    }
  }
  for (const [name, entry] of Object.entries(servers)) {
    if (entry.activation === 'always-on' && !(name in configured)) {
      problems.push(`[deriva] ${name}: politica dice always-on y no esta en la config`);
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    policyServers: Object.keys(servers).length,
    configServers: Object.keys(configured).sort(),
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  const maxTools = Number(arg('max-tools') ?? 150);

  // Modo politica: no lanza procesos, compara las dos fuentes de verdad del stack.
  if (flag('policy')) {
    const drift = checkPolicy(process.cwd());
    if (flag('json')) {
      process.stdout.write(`${JSON.stringify(drift, null, 2)}\n`);
    } else {
      console.log(
        `\nMCP policy — ${drift.policyServers} servers en la politica · ${drift.configServers.length} en la config\n`,
      );
      for (const p of drift.problems) console.log(`  ${p}`);
      console.log(
        `\n${drift.ok ? 'OK — politica y config sin deriva' : 'ATENCION: hay deriva o schema invalido'}\n`,
      );
    }
    if (!drift.ok) process.exit(1);
    return;
  }

  const report = await diagnoseMcp({
    timeoutMs: Number(arg('timeout-ms') ?? 45_000),
    only: arg('server'),
    maxTools,
  });

  if (flag('json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const icon: Record<Status, string> = { ok: 'OK  ', fail: 'FAIL', skip: 'SKIP' };
    console.log(`\nMCP doctor — handshake real por stdio (${report.servers.length} servers)\n`);
    for (const s of report.servers) {
      console.log(`[${icon[s.status]}] ${s.name} · ${s.type} · ${s.elapsedMs} ms · ${s.detail}`);
      if (s.serverInfo) console.log(`         serverInfo: ${s.serverInfo}`);
    }
    console.log(`\n${report.totalTools} tools en total`);
    if (report.totalTools > maxTools) {
      console.log(
        `AVISO: ${report.totalTools} tools superan el umbral ${maxTools}: los schemas son contexto y el prompt puede pasar de 32k. Desactivar por prefijo en el agente.`,
      );
    }
    console.log(`\n${report.ok ? 'OK' : 'ATENCION: hay servers que no responden el handshake'}\n`);
  }

  if (flag('strict') && !report.ok) process.exit(1);
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('mcp-doctor.ts') ?? false;
if (invokedDirectly) {
  void main().catch((err) => {
    console.error(`mcp-doctor: ${String(err)}`);
    process.exit(1);
  });
}
