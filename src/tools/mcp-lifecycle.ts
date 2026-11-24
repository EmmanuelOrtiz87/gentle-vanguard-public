#!/usr/bin/env node
/**
 * mcp-lifecycle.ts — censo y alineacion de servidores MCP en TODAS las superficies.
 *
 * POR QUE (2026-11-18)
 * -------------------------------------------------------------------------
 * El stack tenia CUATRO fuentes de verdad sobre los servidores MCP y ninguna
 * coincidia con las demas:
 *
 *   1. `config/mcp-lifecycle-policy.json`  -> 14 servidores, con `activation`.
 *   2. `config/mcp-registry.json`          -> 10 servidores, con `autoStart`.
 *   3. `.mcp.json` (repo)                  ->  4 servidores, todos "siempre".
 *   4. configs de host (opencode, codex, kimi, claude, qoder, zcode).
 *
 * Consecuencias medidas:
 *   - La politica declara `rea: on-demand`, pero rea estaba ENABLED en codex,
 *     kimi y claude: el derive-check solo miraba OpenCode, asi que la deriva
 *     era invisible.
 *   - `engram` es `always-on` y esta AUSENTE en las configs de host de Kimi y
 *     Claude: esas superficies no capturaban memoria entre sesiones.
 *   - La politica declara `harness` y `gv-analytics-atlassian` como `on-demand`,
 *     pero el `.mcp.json` canonico los declara siempre.
 *
 * Este modulo deja UNA regla: la POLITICA manda; cada superficie se alinea con
 * ella; y la deriva se reporta en todas las superficies, no solo en una.
 *
 * USO
 *   node --import tsx src/tools/mcp-lifecycle.ts             # censo + deriva (texto)
 *   node --import tsx src/tools/mcp-lifecycle.ts --json      # idem, JSON
 *   node --import tsx src/tools/mcp-lifecycle.ts --markdown  # idem, markdown
 *   node --import tsx src/tools/mcp-lifecycle.ts --check     # exit 1 si hay deriva
 *   node --import tsx src/tools/mcp-lifecycle.ts --apply     # alinea (backup + recibo)
 *   node --import tsx src/tools/mcp-lifecycle.ts --apply --only=rea
 *
 * SEGURIDAD
 *   - Los archivos de host se respaldan antes de escribir (`.bak-<ts>`).
 *   - Cada escritura deja recibo en `.session/snapshots/mcp-lifecycle/<ts>/`.
 *   - La superficie `codex` se modifica con la CLI del cliente
 *     (`codex mcp add/remove`), no editando TOML a mano.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { runSync } from '../core/run-command.js';
import { auditMcpUsage, matchesServer } from './mcp-usage-audit.js';
import {
  activationFor,
  loadPolicy as loadPolicyShared,
  loadRegistry as loadRegistryShared,
  type Activation,
  type Policy,
  type PolicyEntry,
  type RegistryEntry,
} from '../mcp/mcp-policy.js';
import { checkDemandMap } from './mcp-suggest.js';

// ─── Politica ───────────────────────────────────────────────────────────────

/** Una superficie = un archivo de config con un formato concreto. */
export interface Surface {
  id: string;
  label: string;
  path: string;
  owner: 'stack' | 'host';
  format: 'mcpServers' | 'opencode-mcp' | 'codex-cli' | 'servers';
  /** El cliente soporta `enabled: false` sin quitar la entrada. */
  supportsEnabledFlag: boolean;
  writable: boolean;
}

// Los tipos de la politica viven en UN solo modulo (`src/mcp/mcp-policy.ts`),
// que es el que importan todos los consumidores. Aqui se re-exportan para no
// romper a quien los importaba desde el censo.
export type { Activation, Policy, PolicyEntry, RegistryEntry };

/**
 * ¿Esta superficie es la config REAL de Codex?
 *
 * La CLI de codex (`codex mcp add/remove/list`) SIEMPRE lee y escribe
 * `~/.codex/config.toml` del host: ignora el `home` que le pase el stack. Por
 * eso una operacion sobre una superficie codex-cli con un home de fixture
 * (tests, sandboxes) tocia la config del owner.
 *
 * Medido 2026-11-18: el test de `mcp-lifecycle` ejecuto `codex mcp add harness`
 * contra la config REAL, dejo el server `harness` levantado en cada sesion de
 * codex (contra la politica, que lo declara a demanda) y el gate `mcp:policy`
 * paso a rojo por una entrada que el propio test habia creado.
 *
 * Regla: la CLI de codex solo se usa sobre la config real del host.
 */
export function isRealCodexSurface(surface: Surface): boolean {
  if (surface.format !== 'codex-cli') return false;
  const realPath = join(homedir(), '.codex', 'config.toml');
  return resolve(surface.path) === resolve(realPath);
}

// ─── Lectura de superficies ────────────────────────────────────────────────

export interface SurfaceEntry {
  name: string;
  present: boolean;
  enabled: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface SurfaceState {
  surface: Surface;
  exists: boolean;
  entries: SurfaceEntry[];
  error?: string;
}

function readJsonFile(path: string): Record<string, unknown> | null {
  try {
    const raw = readFileSync(path, 'utf-8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function entriesFromRecord(
  record: Record<string, unknown> | undefined,
): Array<[string, Record<string, unknown>]> {
  if (!record) return [];
  return Object.entries(record).filter(
    (entry): entry is [string, Record<string, unknown>] =>
      !!entry[1] && typeof entry[1] === 'object' && !Array.isArray(entry[1]),
  );
}

function toSurfaceEntry(name: string, raw: Record<string, unknown>): SurfaceEntry {
  // OpenCode usa `command: [exe, ...args]`; los demas hosts usan
  // `command: "exe"` + `args: [...]`. Las dos formas son el mismo servidor:
  // si no se normalizan, la firma parte uno en dos y el uso se cuenta mal.
  const commandArray = Array.isArray(raw.command) ? (raw.command as unknown[]) : undefined;
  const commandIsArray = commandArray !== undefined;
  const command = commandIsArray
    ? typeof commandArray?.[0] === 'string'
      ? (commandArray[0] as string)
      : undefined
    : typeof raw.command === 'string'
      ? raw.command
      : undefined;
  const args = commandIsArray
    ? (commandArray ?? []).slice(1).filter((a): a is string => typeof a === 'string')
    : Array.isArray(raw.args)
      ? (raw.args as string[])
      : undefined;
  const env =
    raw.env && typeof raw.env === 'object' && !Array.isArray(raw.env)
      ? (raw.env as Record<string, string>)
      : undefined;
  return {
    name,
    present: true,
    enabled: raw.enabled !== false,
    command,
    args,
    env,
  };
}

export function readSurface(surface: Surface): SurfaceState {
  if (!existsSync(surface.path)) {
    return { surface, exists: false, entries: [], error: 'archivo inexistente' };
  }
  if (surface.format === 'codex-cli') {
    if (!isRealCodexSurface(surface)) {
      return {
        surface,
        exists: existsSync(surface.path),
        entries: [],
        error: 'codex CLI: no se consulta fuera de la config real del host',
      };
    }
    const result = runSync('codex', ['mcp', 'list', '--json'], { timeout: 30_000 });
    if (result.status !== 0) {
      return {
        surface,
        exists: true,
        entries: [],
        error: `codex mcp list --json fallo (exit ${result.status})`,
      };
    }
    try {
      const parsed = JSON.parse(result.stdout.replace(/^\uFEFF/, '')) as Array<{
        name: string;
        enabled?: boolean;
        transport?: {
          type?: string;
          command?: string;
          args?: string[];
          env?: Record<string, string>;
        };
      }>;
      return {
        surface,
        exists: true,
        entries: parsed.map((item) => ({
          name: item.name,
          present: true,
          enabled: item.enabled !== false,
          command: item.transport?.command,
          args: item.transport?.args,
          env: item.transport?.env,
        })),
      };
    } catch (err) {
      return {
        surface,
        exists: true,
        entries: [],
        error: `no se pudo parsear codex mcp list --json: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const json = readJsonFile(surface.path);
  if (!json) {
    return { surface, exists: true, entries: [], error: 'JSON ilegible o no es un objeto' };
  }
  const bucket =
    surface.format === 'opencode-mcp'
      ? ((json.mcp as Record<string, unknown> | undefined)?.servers as Record<string, unknown>)
      : surface.format === 'servers'
        ? (json.servers as Record<string, unknown>)
        : (json.mcpServers as Record<string, unknown>);
  return {
    surface,
    exists: true,
    entries: entriesFromRecord(bucket).map(([name, raw]) => toSurfaceEntry(name, raw)),
  };
}

// ─── Superficies ───────────────────────────────────────────────────────────

export function listSurfaces(root = resolve(process.cwd()), home = homedir()): Surface[] {
  const at = (p: string) => (p.startsWith('~') ? join(home, p.slice(2)) : resolve(root, p));
  return [
    {
      id: 'repo',
      label: 'Repo (canonico)',
      path: at('.mcp.json'),
      owner: 'stack',
      format: 'mcpServers',
      supportsEnabledFlag: false,
      writable: true,
    },
    {
      id: 'kimi-repo',
      label: 'Repo · Kimi',
      path: at('.kimi-code/mcp.json'),
      owner: 'stack',
      format: 'mcpServers',
      supportsEnabledFlag: false,
      writable: true,
    },
    {
      id: 'cursor',
      label: 'Repo · Cursor',
      path: at('.cursor/config.json'),
      owner: 'stack',
      format: 'mcpServers',
      supportsEnabledFlag: false,
      writable: true,
    },
    {
      id: 'cline',
      label: 'Repo · Cline',
      path: at('.cline/config.json'),
      owner: 'stack',
      format: 'mcpServers',
      supportsEnabledFlag: false,
      writable: true,
    },
    {
      id: 'opencode-repo',
      label: 'Repo · opencode.json',
      path: at('opencode.json'),
      owner: 'stack',
      format: 'opencode-mcp',
      supportsEnabledFlag: true,
      writable: true,
    },
    {
      // Superficie que el censo NO cubria (medido 2026-11-18): declaraba
      // `codegraph` habilitado mientras la politica lo daba por apagado.
      id: 'opencode-dir',
      label: 'Repo · .opencode/mcp.json',
      path: at('.opencode/mcp.json'),
      owner: 'stack',
      format: 'servers',
      supportsEnabledFlag: false,
      writable: true,
    },
    {
      // Mismo gap que `.opencode/mcp.json`: superficie de workspace de ZCode.
      id: 'zcode-repo',
      label: 'Repo · .zcode/config.json',
      path: at('.zcode/config.json'),
      owner: 'stack',
      format: 'opencode-mcp',
      supportsEnabledFlag: false,
      writable: true,
    },
    {
      id: 'continue-repo',
      label: 'Repo · .continue/config.json',
      path: at('.continue/config.json'),
      owner: 'stack',
      format: 'mcpServers',
      supportsEnabledFlag: false,
      writable: true,
    },
    {
      id: 'vscode',
      label: 'Repo · .vscode/mcp.json',
      path: at('.vscode/mcp.json'),
      owner: 'stack',
      format: 'servers',
      supportsEnabledFlag: false,
      writable: true,
    },
    {
      id: 'opencode',
      label: 'Host · OpenCode',
      path: at('~/.config/opencode/opencode.json'),
      owner: 'host',
      format: 'opencode-mcp',
      supportsEnabledFlag: true,
      writable: true,
    },
    {
      id: 'codex',
      label: 'Host · Codex',
      path: at('~/.codex/config.toml'),
      owner: 'host',
      format: 'codex-cli',
      supportsEnabledFlag: true,
      writable: true,
    },
    {
      id: 'kimi',
      label: 'Host · Kimi',
      path: at('~/.kimi-code/mcp.json'),
      owner: 'host',
      format: 'mcpServers',
      supportsEnabledFlag: false,
      writable: true,
    },
    {
      id: 'claude',
      label: 'Host · Claude Code',
      path: at('~/.claude.json'),
      owner: 'host',
      format: 'mcpServers',
      supportsEnabledFlag: false,
      writable: true,
    },
    {
      id: 'qoder',
      label: 'Host · Qoder',
      path: at('~/.qoder/settings.json'),
      owner: 'host',
      format: 'mcpServers',
      supportsEnabledFlag: false,
      writable: true,
    },
    {
      id: 'zcode',
      label: 'Host · ZCode',
      path: at('~/.zcode/cli/config.json'),
      owner: 'host',
      format: 'opencode-mcp',
      supportsEnabledFlag: true,
      writable: true,
    },
  ];
}

// ─── Politica + registro ───────────────────────────────────────────────────

export function loadPolicy(root = resolve(process.cwd())): Policy {
  return loadPolicyShared(root) as Policy;
}

export function loadRegistry(root = resolve(process.cwd())): RegistryEntry[] {
  return loadRegistryShared(root) as RegistryEntry[];
}

/**
 * La identidad de un servidor MCP es su FIRMA (command + args), no su nombre.
 * El mismo server aparece con nombres distintos en el stack (`skill-server` en
 * el registro, `gentle-vanguard-skills` en `.mcp.json`, `engram`/`engram-mcp`).
 * Sin esta normalizacion, la medicion de uso cuenta un alias y se pierde otro.
 *
 * La firma normaliza el comando a su nombre de archivo sin extension: el
 * registro dice `engram` y el host ejecuta `C:\\...\\engram.exe`; son el mismo
 * servidor.
 */
export function signatureOf(entry: { command?: string; args?: string[] }): string {
  const command = (entry.command ?? '').split(/[\\/]/).pop() ?? '';
  const bin = command.replace(/\.(exe|cmd|bat)$/i, '');
  return [bin, ...(entry.args ?? [])].join(' ').trim();
}

export interface ServerIdentity {
  canonical: string;
  aliases: string[];
  signature?: string;
}

export function buildIdentities(
  policy: Policy,
  registry: RegistryEntry[],
  surfaces: SurfaceState[],
  observed: string[] = [],
): ServerIdentity[] {
  const bySignature = new Map<string, Set<string>>();
  const signatureOfName = new Map<string, string>();
  const add = (name: string, signature?: string) => {
    if (!signature) return;
    signatureOfName.set(name, signature);
    const set = bySignature.get(signature) ?? new Set<string>();
    set.add(name);
    bySignature.set(signature, set);
  };

  for (const entry of registry) add(entry.name, signatureOf(entry));
  for (const state of surfaces) {
    for (const entry of state.entries) {
      add(entry.name, signatureOf({ command: entry.command, args: entry.args }));
    }
  }
  for (const name of observed) {
    if (!signatureOfName.has(name)) add(name, undefined);
  }

  // Clusters por NOMBRE: un mismo server puede aparecer con firmas distintas
  // (el registro dice `rea` y el host ejecuta `node rea.mjs mcp`). El nombre es
  // el ancla; las firmas unen alias. Sin esto, un server sale duplicado.
  const parent = new Map<string, string>();
  const find = (name: string): string => {
    let current = name;
    while (parent.get(current) && parent.get(current) !== current) current = parent.get(current)!;
    return current;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const allNames = new Set<string>([
    ...Object.keys(policy.servers),
    ...registry.map((r) => r.name),
    ...observed,
  ]);
  for (const state of surfaces) for (const entry of state.entries) allNames.add(entry.name);
  for (const name of allNames) parent.set(name, name);
  for (const [signature, names] of bySignature) {
    const list = [...names];
    for (const other of list.slice(1)) union(list[0], other);
    void signature;
  }
  // Enlace por nombre normalizado cuando no hay firma comun: la politica dice
  // `engram` y el registro dice `engram-mcp`; sin esto son dos servidores y el
  // conteo de uso se parte.
  const normalized = (name: string) => name.toLowerCase().replace(/[-_]?mcp$/, '');
  const byNormalized = new Map<string, string[]>();
  for (const name of allNames) {
    const key = normalized(name);
    byNormalized.set(key, [...(byNormalized.get(key) ?? []), name]);
  }
  for (const group of byNormalized.values()) {
    for (const other of group.slice(1)) union(group[0], other);
  }

  const clusters = new Map<string, Set<string>>();
  for (const name of allNames) {
    const root = find(name);
    const set = clusters.get(root) ?? new Set<string>();
    set.add(name);
    clusters.set(root, set);
  }

  const policyNames = new Set(Object.keys(policy.servers));
  const registryNames = new Set(registry.map((r) => r.name));
  const identities: ServerIdentity[] = [];
  for (const [root, names] of clusters) {
    const list = [...names].sort();
    const canonical =
      list.find((n) => policyNames.has(n)) ?? list.find((n) => registryNames.has(n)) ?? list[0];
    const signature = signatureOfName.get(root) ?? signatureOfName.get(list[0]);
    identities.push({ canonical, aliases: list, signature });
  }
  return identities.sort((a, b) => a.canonical.localeCompare(b.canonical));
}

// ─── Deriva ────────────────────────────────────────────────────────────────

/**
 * Candidatos a superficie MCP dentro del repo.
 *
 * Un archivo que declara servidores MCP y NO esta en el censo es un PUNTO
 * CIEGO: nadie mide esa superficie, su deriva es invisible. Medido 2026-11-18:
 * `.opencode/mcp.json`, `.zcode/config.json` y `.continue/config.json`
 * declaraban `codegraph` habilitado mientras la politica lo daba por apagado.
 */
const REPO_MCP_CANDIDATES = [
  '.mcp.json',
  '.opencode/mcp.json',
  'opencode.json',
  '.cursor/config.json',
  '.cline/config.json',
  '.continue/config.json',
  '.kimi-code/mcp.json',
  '.zcode/config.json',
  '.zcode/mcp.json',
  '.qoder/mcp.json',
  '.vscode/mcp.json',
  '.windsurf/config.json',
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.codex/config.json',
  '.gemini/settings.json',
];

/** Extrae el bucket de servidores MCP de un JSON de config, sea cual sea su forma. */
export function mcpBucketOf(json: Record<string, unknown>): Record<string, unknown> | undefined {
  const candidates: unknown[] = [json.mcpServers, json.servers];
  const mcp = json.mcp;
  if (mcp && typeof mcp === 'object' && !Array.isArray(mcp)) {
    const obj = mcp as Record<string, unknown>;
    if (obj.servers && typeof obj.servers === 'object') candidates.unshift(obj.servers);
    else candidates.unshift(obj);
  }
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const entries = Object.entries(candidate as Record<string, unknown>).filter(
      ([, value]) => !!value && typeof value === 'object' && !Array.isArray(value),
    );
    if (entries.length > 0) return candidate as Record<string, unknown>;
  }
  return undefined;
}

export interface UninventoriedSurface {
  path: string;
  servers: string[];
}

/** Superficies MCP del repo que el censo NO mira. */
export function findUninventoriedSurfaces(
  root = resolve(process.cwd()),
  surfaces: Surface[] = listSurfaces(root),
): UninventoriedSurface[] {
  const known = new Set(surfaces.map((surface) => resolve(surface.path)));
  const found: UninventoriedSurface[] = [];
  for (const relative of REPO_MCP_CANDIDATES) {
    const absolute = resolve(root, relative);
    if (known.has(absolute)) continue;
    if (!existsSync(absolute)) continue;
    const json = readJsonFile(absolute);
    if (!json) continue;
    const bucket = mcpBucketOf(json);
    if (!bucket) continue;
    found.push({ path: relative, servers: Object.keys(bucket) });
  }
  return found;
}

/**
 * Deriva entre el REGISTRO del stack y la POLITICA.
 *
 * El registro dice que servidores auto-arranca el gateway; la politica dice
 * cuales se pueden levantar solos. Con `enabled: true` en los 11 servidores y
 * sin consultar la politica, un "start all" del dashboard levantaba `rea`
 * (node + Java + Ghidra) en cada sesion.
 */
export function buildRegistryDrift(policy: Policy, registry: RegistryEntry[]): DriftItem[] {
  const drift: DriftItem[] = [];
  for (const entry of registry) {
    const activation = activationFor(policy, entry.name, 'repo');
    if (!activation) continue; // sin invariante declarada: decide el registro
    const allowed = activation === 'always-on' || activation.startsWith('warm-when');
    const autoStart = entry.autoStart === true;
    if (allowed && !autoStart) {
      drift.push({
        surface: 'registry',
        server: entry.name,
        expected: activation,
        actual: 'auto-start-disabled',
        kind: 'registry',
        problem: `la politica dice ${activation} y el registro lo tiene con autoStart=false`,
      });
    }
    if (!allowed && autoStart) {
      drift.push({
        surface: 'registry',
        server: entry.name,
        expected: activation,
        actual: 'auto-start-enabled',
        kind: 'registry',
        problem: `la politica dice ${activation} y el registro lo auto-arranca en cada sesion`,
      });
    }
  }
  return drift;
}

export interface DriftItem {
  surface: string;
  server: string;
  expected: Activation;
  actual:
    | 'present-enabled'
    | 'present-disabled'
    | 'absent'
    | 'auto-start-enabled'
    | 'auto-start-disabled'
    | 'uninventoried';
  problem: string;
  /** De donde sale la deriva: una superficie, el registro o el inventario del repo. */
  kind?: 'surface' | 'registry' | 'inventory' | 'command';
  /** Comando declarado en la superficie (deriva de comando). */
  actualCommand?: string;
  /** Comando canonico del registro (deriva de comando). */
  expectedCommand?: string;
}

export interface CensusServer {
  server: string;
  aliases: string[];
  policy: {
    activation?: Activation;
    criticality?: string;
    role?: string;
    management?: string;
    perSurface: Record<string, Activation>;
  };
  surfaces: Array<{ surface: string; state: string }>;
  usage: { invocations: number; lastHitAt: string | null; hosts: string[] };
  verdict: string;
}

export interface Census {
  generatedAt: string;
  surfaces: Array<{
    id: string;
    label: string;
    path: string;
    owner: string;
    exists: boolean;
    servers: string[];
  }>;
  servers: CensusServer[];
  drift: DriftItem[];
  usage: { days: number; calibration: string; hostsWithoutData: string[] };
  policySources: { policy: number; registry: number; repoCanonical: number };
}

/** La activacion esperada de un server en una superficie concreta. */
export function expectedActivation(
  entry: PolicyEntry | undefined,
  surfaceId: string,
  fallback: Activation = 'on-demand',
): Activation {
  const perSurface = entry?.surfaces?.[surfaceId];
  if (perSurface) return perSurface;
  return entry?.activation ?? fallback;
}

function actualState(entry: SurfaceEntry | undefined): DriftItem['actual'] {
  if (!entry) return 'absent';
  return entry.enabled ? 'present-enabled' : 'present-disabled';
}

export function buildCensus(
  root = resolve(process.cwd()),
  home = homedir(),
  days = 365,
  options: { surfaces?: Surface[]; includeUsage?: boolean } = {},
): Census {
  const policy = loadPolicy(root);
  const registry = loadRegistry(root);
  const surfaces = (options.surfaces ?? listSurfaces(root, home)).map((surface) =>
    readSurface(surface),
  );
  // La deriva depende de configuración actual, no de leer todos los transcripts.
  // El censo completo sigue midiendo uso por defecto; --policy opta por no medirlo.
  const usage = options.includeUsage === false ? null : auditMcpUsage(days, home, root);
  const observedServers = usage?.observedServers ?? [];
  const identities = buildIdentities(
    policy,
    registry,
    surfaces,
    observedServers.map((s) => s.server),
  );

  // Uso por servidor OBSERVADO (declarado o no): medir solo lo declarado
  // convierte en "0" a todo server que sale del canon, sin medirlo.
  const usageByServer = new Map<
    string,
    { invocations: number; lastHitAt: string | null; hosts: string[] }
  >();
  for (const server of observedServers) {
    usageByServer.set(server.server, {
      invocations: server.hits,
      lastHitAt: server.lastHitAt,
      hosts: server.hostsUsing,
    });
  }

  const servers: CensusServer[] = [];
  const drift: DriftItem[] = [];
  const demandState = readDemandState(root);
  const demandActive = new Map(demandState.map((d) => [d.server, d]));

  for (const identity of identities) {
    const policyEntry = policy.servers[identity.canonical];
    const perSurface: Record<string, Activation> = {};
    for (const state of surfaces) {
      perSurface[state.surface.id] = expectedActivation(policyEntry, state.surface.id);
    }

    const surfaceRows: CensusServer['surfaces'] = [];
    for (const state of surfaces) {
      const entry = state.entries.find((e) => e.name === identity.canonical);
      const aliasEntry = entry ?? state.entries.find((e) => identity.aliases.includes(e.name));
      const current = actualState(aliasEntry);
      surfaceRows.push({ surface: state.surface.id, state: current });

      const expected = perSurface[state.surface.id];
      const isDeclared = identity.aliases.some((alias) =>
        state.entries.some((e) => e.name === alias),
      );
      // Sin entrada en la politica no hay invariante: un server del host que el
      // stack no declara no es drift (lo declara el owner, no el stack).
      if (!policyEntry) continue;

      // ─── Deriva de COMANDO ────────────────────────────────────────────────
      // Estar declarado y habilitado NO alcanza: el server puede apuntar a un
      // comando que no arranca. Medido 2026-11-18: `dist/scripts/mcp/
      // skill-server.js` estaba declarado y habilitado en .cursor, .cline y
      // .mcp.json, y el server moria al arrancar (ERR_MODULE_NOT_FOUND). El
      // censo comparaba solo presencia y activacion, asi que todo daba verde.
      const spec = canonicalEntry(identity.canonical, registry, identity.aliases);
      // Solo se compara el comando donde el STACK es el dueno de como se lanza
      // el server (`management: stack-managed`) y la superficie es del stack.
      // Un server `host-managed` lo lanza el host como quiere (rea usa el shim
      // del stack en el repo y la ruta absoluta en los hosts): compararlo con
      // el registro daria deriva falsa.
      if (
        spec &&
        aliasEntry &&
        policyEntry.management === 'stack-managed' &&
        state.surface.owner === 'stack'
      ) {
        const declared = aliasEntry.command ?? '';
        const accepted = new Set([
          spec.command,
          resolveCommand(spec.command),
          basename(spec.command),
        ]);
        const expectedArgs = spec.args ?? [];
        const declaredArgs = aliasEntry.args ?? [];
        const argsOk =
          declaredArgs.length >= expectedArgs.length &&
          expectedArgs.every((arg, index) => declaredArgs[index] === arg);
        if (!accepted.has(declared) || !argsOk) {
          drift.push({
            surface: state.surface.id,
            server: identity.canonical,
            expected,
            actual: current,
            kind: 'command',
            actualCommand: [declared, ...declaredArgs].join(' ').trim(),
            expectedCommand: [spec.command, ...expectedArgs].join(' ').trim(),
            problem: `la superficie lo declara con otro comando: "${[declared, ...declaredArgs].join(' ').trim()}" (registro: "${[spec.command, ...expectedArgs].join(' ').trim()}")`,
          });
        }
      }

      if (expected === 'always-on' && current !== 'present-enabled') {
        drift.push({
          surface: state.surface.id,
          server: identity.canonical,
          expected,
          actual: current,
          problem: isDeclared
            ? `la politica dice always-on y la superficie lo tiene ${current === 'present-disabled' ? 'deshabilitado' : 'ausente'}`
            : 'la politica dice always-on y no esta declarado en la superficie',
        });
      }
      if (
        (expected === 'on-demand' || expected === 'disabled-by-policy') &&
        current === 'present-enabled'
      ) {
        // Una activacion a demanda DECLARADA no es deriva: es el estado
        // pedido a proposito (`.session/mcp-on-demand.json`).
        const demand = demandActive.get(identity.canonical);
        if (!demand || !demand.surfaces.includes(state.surface.id)) {
          drift.push({
            surface: state.surface.id,
            server: identity.canonical,
            expected,
            actual: current,
            problem: `la politica dice ${expected} y la superficie lo levanta en cada sesion`,
          });
        }
      }
    }

    // Uso: se cuenta por alias (un server con dos nombres es un solo server).
    let invocations = 0;
    let lastHitAt: string | null = null;
    const hosts: string[] = [];
    for (const alias of identity.aliases) {
      const hit = usageByServer.get(alias);
      if (!hit) continue;
      invocations += hit.invocations;
      hosts.push(...hit.hosts);
      if (hit.lastHitAt && (!lastHitAt || hit.lastHitAt > lastHitAt)) lastHitAt = hit.lastHitAt;
    }

    const declaredAnywhere = surfaceRows.some((row) => row.state !== 'absent');
    const verdict = !usage
      ? 'uso no medido (censo de configuración)'
      : !declaredAnywhere
        ? 'no declarado en ninguna superficie'
        : invocations > 0
          ? `en uso (${invocations} invocaciones en ${days} dias)`
          : 'declarado pero sin invocaciones medidas';

    servers.push({
      server: identity.canonical,
      aliases: identity.aliases,
      policy: {
        activation: policyEntry?.activation,
        criticality: policyEntry?.criticality,
        role: policyEntry?.role,
        management: policyEntry?.management,
        perSurface,
      },
      surfaces: surfaceRows,
      usage: {
        invocations,
        lastHitAt,
        hosts: [...new Set(hosts)].sort(),
      },
      verdict,
    });
  }

  // Deriva registro vs politica (el gateway arranca lo que el registro dice,
  // no lo que la politica permite).
  drift.push(...buildRegistryDrift(policy, registry));

  // Superficies MCP del repo que el censo no mira: su deriva es invisible.
  for (const orphan of findUninventoriedSurfaces(
    root,
    surfaces.map((state) => state.surface),
  )) {
    drift.push({
      surface: 'repo-inventory',
      server: orphan.servers.join(', '),
      expected: 'always-on',
      actual: 'uninventoried',
      kind: 'inventory',
      problem: `superficie MCP del repo no inventariada: ${orphan.path} declara ${orphan.servers.join(', ')}`,
    });
  }

  const repoSurface = surfaces.find((s) => s.surface.id === 'repo');
  return {
    generatedAt: new Date().toISOString(),
    surfaces: surfaces.map((state) => ({
      id: state.surface.id,
      label: state.surface.label,
      path: state.surface.path,
      owner: state.surface.owner,
      exists: state.exists,
      servers: state.entries.map((e) => e.name),
    })),
    servers,
    drift,
    usage: {
      days: usage ? days : 0,
      calibration: usage ? (usage.calibration.pass ? 'PASS' : 'FAIL') : 'NOT-MEASURED',
      hostsWithoutData: usage?.hostsWithoutData ?? [],
    },
    policySources: {
      policy: Object.keys(policy.servers).length,
      registry: registry.length,
      repoCanonical: repoSurface?.entries.length ?? 0,
    },
  };
}

// ─── Aplicacion ────────────────────────────────────────────────────────────

export interface ApplyAction {
  surface: string;
  server: string;
  action: 'enable' | 'disable' | 'install' | 'remove';
  detail: string;
}

export interface ApplyResult {
  applied: ApplyAction[];
  skipped: ApplyAction[];
  backups: string[];
  receiptDir: string | null;
  errors: string[];
}

/** La entrada canonica de instalacion de un server (del registro del stack). */
export function canonicalEntry(
  server: string,
  registry: RegistryEntry[],
  aliases: string[],
): { command: string; args: string[]; env?: Record<string, string>; type?: string } | null {
  const names = new Set([server, ...aliases]);
  for (const entry of registry) {
    if (!names.has(entry.name)) continue;
    if (!entry.command) continue;
    return {
      command: entry.command,
      args: entry.args ?? [],
      env: entry.env,
      type: entry.type === 'builtin' ? 'stdio' : entry.type,
    };
  }
  return null;
}

/**
 * Resuelve un comando a su ruta absoluta si esta en el PATH. Los clientes que
 * spawnean el proceso SIN shell (codex, zcode) no siempre resuelven el PATH:
 * con el nombre bare, el server queda declarado y no arranca.
 */
export function resolveCommand(command: string): string {
  if (!command || /[\\/]/.test(command)) return command;
  const path = process.env.PATH ?? '';
  const dirs = path.split(';').filter(Boolean);
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, `${command}${ext}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return command;
}

function backupFile(path: string, stamp: string): string | null {
  if (!existsSync(path)) return null;
  const backup = `${path}.bak-${stamp}`;
  try {
    copyFileSync(path, backup);
    return backup;
  } catch {
    return null;
  }
}

/**
 * El bucket de servidores MCP de una superficie, normalizado por formato.
 * Cada formato de cliente lo guarda en un lugar distinto; sin esta tabla, la
 * escritura busca en la clave equivocada y la alineacion no ocurre.
 */
function bucketOf(
  json: Record<string, unknown>,
  format: Surface['format'],
): Record<string, unknown> {
  if (format === 'opencode-mcp') {
    const mcp = (json.mcp ??= {}) as Record<string, unknown>;
    return (mcp.servers ??= {}) as Record<string, unknown>;
  }
  if (format === 'servers') {
    return (json.servers ??= {}) as Record<string, unknown>;
  }
  return (json.mcpServers ??= {}) as Record<string, unknown>;
}

function writeJsonSurface(
  surface: Surface,
  mutate: (json: Record<string, unknown>) => boolean,
): boolean {
  const json = readJsonFile(surface.path);
  if (!json) return false;
  const changed = mutate(json);
  if (!changed) return false;
  writeFileSync(surface.path, `${JSON.stringify(json, null, 2)}\n`, 'utf-8');
  // Los archivos del REPO pasan por el format-check del hook: JSON.stringify
  // expande los arrays y Prettier los colapsa si entran en el print width.
  // Sin este paso, la propia herramienta rompe el gate de formato.
  if (surface.owner === 'stack') {
    const result = runSync('npx', ['prettier', '--write', surface.path], { timeout: 120_000 });
    if (result.status !== 0) {
      console.warn(
        `[mcp-lifecycle] no se pudo formatear ${surface.path}: ${result.stderr || result.stdout}`,
      );
    }
  }
  return true;
}

export function applyPolicy(
  root = resolve(process.cwd()),
  home = homedir(),
  days = 365,
  only?: string[],
): ApplyResult {
  const census = buildCensus(root, home, days);
  const registry = loadRegistry(root);
  const surfaces = listSurfaces(root, home);
  const applied: ApplyAction[] = [];
  const skipped: ApplyAction[] = [];
  const backups: string[] = [];
  const errors: string[] = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  for (const drift of census.drift) {
    if (only && only.length && !only.includes(drift.server)) {
      skipped.push({
        surface: drift.surface,
        server: drift.server,
        action: 'enable',
        detail: 'filtrado por --only',
      });
      continue;
    }
    const surface = surfaces.find((s) => s.id === drift.surface);
    if (!surface) {
      // Deriva del REGISTRO: el `autoStart` del stack tiene que coincidir con
      // la politica. Es el unico consumidor que decide que se levanta solo.
      if (drift.kind === 'registry') {
        const registryPath = join(root, 'config', 'mcp-registry.json');
        const registrySurface: Surface = {
          id: 'registry',
          label: 'Registro del stack',
          path: registryPath,
          owner: 'stack',
          format: 'mcpServers',
          supportsEnabledFlag: true,
          writable: true,
        };
        const backup = backupFile(registryPath, stamp);
        if (backup) backups.push(backup);
        const shouldAutoStart =
          drift.expected === 'always-on' || drift.expected.startsWith('warm-when');
        const changed = writeJsonSurface(registrySurface, (json) => {
          const servers = Array.isArray(json.servers) ? (json.servers as RegistryEntry[]) : [];
          const target = servers.find((entry) => entry.name === drift.server);
          if (!target) return false;
          target.autoStart = shouldAutoStart;
          json.servers = servers;
          return true;
        });
        if (!changed) {
          errors.push(`registry/${drift.server}: no se pudo alinear autoStart`);
          continue;
        }
        applied.push({
          surface: 'registry',
          server: drift.server,
          action: shouldAutoStart ? 'enable' : 'disable',
          detail: `autoStart=${shouldAutoStart} (politica: ${drift.expected})`,
        });
      }
      continue;
    }
    const aliases = census.servers.find((s) => s.server === drift.server)?.aliases ?? [];
    const spec = canonicalEntry(drift.server, registry, aliases);

    // ─── Deriva de COMANDO: la superficie declara el server con otro comando ──
    // Se alinea ANTES que la activacion: el comando es lo que decide si el
    // server arranca. Un server declarado y habilitado con un comando roto es
    // un FAIL aunque la politica este satisfecha.
    if (drift.kind === 'command') {
      if (!spec) {
        errors.push(
          `${drift.surface}/${drift.server}: hay deriva de comando pero no hay entrada canonica en config/mcp-registry.json`,
        );
        continue;
      }
      if (surface.format === 'codex-cli') {
        if (!isRealCodexSurface(surface)) {
          errors.push(
            `${drift.surface}/${drift.server}: codex CLI no se usa fuera de la config real del host (no se toca la del owner)`,
          );
          continue;
        }
        const cmdArgs = [spec.command, ...spec.args];
        const envArgs = Object.entries(spec.env ?? {}).flatMap(([k, v]) => ['--env', `${k}=${v}`]);
        const result = runSync(
          'codex',
          ['mcp', 'add', drift.server, ...envArgs, '--', ...cmdArgs],
          {
            timeout: 60_000,
          },
        );
        if (result.status !== 0) {
          errors.push(
            `${drift.surface}/${drift.server}: codex mcp add fallo: ${result.stderr || result.stdout}`,
          );
          continue;
        }
        applied.push({
          surface: drift.surface,
          server: drift.server,
          action: 'install',
          detail: `comando alineado al registro: ${[spec.command, ...spec.args].join(' ')}`,
        });
        continue;
      }
      const backup = backupFile(surface.path, stamp);
      if (backup) backups.push(backup);
      const changed = writeJsonSurface(surface, (json) => {
        const bucket = bucketOf(json, surface.format);
        // Se reescribe la clave YA DECLARADA (p.ej. `gentle-vanguard-skills`):
        // crear la canonica al lado del alias declaraba el server dos veces.
        const key =
          [drift.server, ...aliases].find((name) => bucket[name] !== undefined) ?? drift.server;
        const existing = (bucket[key] as Record<string, unknown>) ?? {};
        bucket[key] = {
          ...existing,
          command: surface.owner === 'host' ? resolveCommand(spec.command) : spec.command,
          args: spec.args,
          ...(spec.env ? { env: spec.env } : {}),
          ...(surface.format === 'opencode-mcp' ? { type: 'local' } : {}),
          enabled: true,
        };
        return true;
      });
      if (!changed) {
        errors.push(`${drift.surface}/${drift.server}: no se pudo escribir ${surface.path}`);
        continue;
      }
      applied.push({
        surface: drift.surface,
        server: drift.server,
        action: 'install',
        detail: `comando alineado al registro: ${[spec.command, ...spec.args].join(' ')}`,
      });
      continue;
    }

    if (drift.expected === 'always-on') {
      if (!spec) {
        errors.push(
          `${drift.surface}/${drift.server}: la politica dice always-on pero no hay entrada canonica en config/mcp-registry.json`,
        );
        continue;
      }
      if (surface.format === 'codex-cli') {
        if (!isRealCodexSurface(surface)) {
          errors.push(
            `${drift.surface}/${drift.server}: codex CLI no se usa fuera de la config real del host (no se toca la del owner)`,
          );
          continue;
        }
        const args = [spec.command, ...spec.args];
        const envArgs = Object.entries(spec.env ?? {}).flatMap(([k, v]) => ['--env', `${k}=${v}`]);
        const result = runSync('codex', ['mcp', 'add', drift.server, ...envArgs, '--', ...args], {
          timeout: 60_000,
        });
        if (result.status !== 0) {
          errors.push(
            `${drift.surface}/${drift.server}: codex mcp add fallo: ${result.stderr || result.stdout}`,
          );
          continue;
        }
        applied.push({
          surface: drift.surface,
          server: drift.server,
          action: 'install',
          detail: 'codex mcp add',
        });
        continue;
      }
      const backup = backupFile(surface.path, stamp);
      if (backup) backups.push(backup);
      const changed = writeJsonSurface(surface, (json) => {
        const bucket = bucketOf(json, surface.format);
        // La identidad de un componente es su FIRMA, no su nombre: si la
        // superficie ya declara uno de los alias (p.ej. `gentle-vanguard-skills`
        // frente al canonico `skill-server`), se reescribe ESA clave. Escribir
        // la canonica al lado del alias declaraba el mismo servidor dos veces
        // en la misma config.
        const key =
          [drift.server, ...aliases].find((name) => bucket[name] !== undefined) ?? drift.server;
        const existing = (bucket[key] as Record<string, unknown>) ?? {};
        bucket[key] = {
          ...existing,
          command: surface.owner === 'host' ? resolveCommand(spec.command) : spec.command,
          args: spec.args,
          ...(spec.env ? { env: spec.env } : {}),
          ...(surface.format === 'opencode-mcp' ? { type: 'local' } : {}),
          enabled: true,
        };
        return true;
      });
      if (!changed) {
        errors.push(`${drift.surface}/${drift.server}: no se pudo escribir ${surface.path}`);
        continue;
      }
      applied.push({
        surface: drift.surface,
        server: drift.server,
        action: 'install',
        detail: 'entrada creada y habilitada',
      });
      continue;
    }

    // on-demand / disabled-by-policy: no debe levantarse al iniciar sesion.
    if (surface.format === 'codex-cli') {
      if (!isRealCodexSurface(surface)) {
        errors.push(
          `${drift.surface}/${drift.server}: codex CLI no se usa fuera de la config real del host (no se toca la del owner)`,
        );
        continue;
      }
      const result = runSync('codex', ['mcp', 'remove', drift.server], { timeout: 60_000 });
      if (result.status !== 0) {
        errors.push(
          `${drift.surface}/${drift.server}: codex mcp remove fallo: ${result.stderr || result.stdout}`,
        );
        continue;
      }
      applied.push({
        surface: drift.surface,
        server: drift.server,
        action: 'remove',
        detail: 'codex mcp remove (se reactiva a demanda con npm run mcp:on-demand)',
      });
      continue;
    }
    if (surface.supportsEnabledFlag) {
      const backup = backupFile(surface.path, stamp);
      if (backup) backups.push(backup);
      const changed = writeJsonSurface(surface, (json) => {
        const bucket = bucketOf(json, surface.format);
        // La clave real puede ser un alias (el repo declara 'gentle-vanguard-skills'
        // y la politica lo llama 'skill-server'): se busca por cualquiera de los dos.
        const key = [drift.server, ...aliases].find((name) => name in bucket);
        if (!key) return false;
        const existing = bucket[key] as Record<string, unknown>;
        existing.enabled = false;
        bucket[key] = existing;
        return true;
      });
      if (!changed) {
        errors.push(`${drift.surface}/${drift.server}: no se pudo deshabilitar en ${surface.path}`);
        continue;
      }
      applied.push({
        surface: drift.surface,
        server: drift.server,
        action: 'disable',
        detail: 'enabled=false (sigue declarado, no se levanta)',
      });
      continue;
    }
    const backup = backupFile(surface.path, stamp);
    if (backup) backups.push(backup);
    const changed = writeJsonSurface(surface, (json) => {
      const bucket = bucketOf(json, surface.format);
      const key = [drift.server, ...aliases].find((name) => name in bucket);
      if (!key) return false;
      delete bucket[key];
      return true;
    });
    if (!changed) {
      errors.push(`${drift.surface}/${drift.server}: no se pudo quitar de ${surface.path}`);
      continue;
    }
    applied.push({
      surface: drift.surface,
      server: drift.server,
      action: 'remove',
      detail: 'entrada retirada (se reactiva a demanda con npm run mcp:on-demand)',
    });
  }

  let receiptDir: string | null = null;
  if (applied.length) {
    receiptDir = join(root, '.session', 'snapshots', 'mcp-lifecycle', stamp);
    try {
      mkdirSync(receiptDir, { recursive: true });
      writeFileSync(
        join(receiptDir, 'apply.json'),
        `${JSON.stringify({ stamp, applied, skipped, backups, errors, census: census.drift }, null, 2)}\n`,
        'utf-8',
      );
    } catch (err) {
      errors.push(
        `no se pudo escribir el recibo: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { applied, skipped, backups, receiptDir, errors };
}

// ─── Activacion a demanda ──────────────────────────────────────────────────

/**
 * Instala la entrada canonica de un server en una superficie.
 * Devuelve true si la superficie cambio.
 */
export function installEntry(
  surface: Surface,
  server: string,
  spec: { command: string; args: string[]; env?: Record<string, string> },
  stamp: string,
): boolean {
  if (surface.format === 'codex-cli') {
    if (!isRealCodexSurface(surface)) return false;
    const envArgs = Object.entries(spec.env ?? {}).flatMap(([k, v]) => ['--env', `${k}=${v}`]);
    const result = runSync(
      'codex',
      ['mcp', 'add', server, ...envArgs, '--', resolveCommand(spec.command), ...spec.args],
      { timeout: 60_000 },
    );
    return result.status === 0;
  }
  backupFile(surface.path, stamp);
  return writeJsonSurface(surface, (json) => {
    const bucket =
      surface.format === 'opencode-mcp'
        ? ((((json.mcp ??= {}) as Record<string, unknown>).servers ??= {}) as Record<
            string,
            unknown
          >)
        : ((json.mcpServers ??= {}) as Record<string, unknown>);
    const existing = (bucket[server] as Record<string, unknown>) ?? {};
    bucket[server] = {
      ...existing,
      command: surface.owner === 'host' ? resolveCommand(spec.command) : spec.command,
      args: spec.args,
      ...(spec.env ? { env: spec.env } : {}),
      ...(surface.format === 'opencode-mcp' ? { type: 'local' } : {}),
      enabled: true,
    };
    return true;
  });
}

/**
 * Quita (o deshabilita) la entrada de un server en una superficie.
 * `onDemand` = true deshabilita si el cliente lo soporta; si no, la quita.
 */
export function removeEntry(
  surface: Surface,
  server: string,
  aliases: string[],
  stamp: string,
  onDemand = true,
): boolean {
  if (surface.format === 'codex-cli') {
    if (!isRealCodexSurface(surface)) return false;
    const result = runSync('codex', ['mcp', 'remove', server], { timeout: 60_000 });
    return result.status === 0;
  }
  backupFile(surface.path, stamp);
  const key = [server, ...aliases].find((name) => {
    const json = readJsonFile(surface.path);
    if (!json) return false;
    const bucket =
      surface.format === 'opencode-mcp'
        ? (((json.mcp as Record<string, unknown> | undefined)?.servers ?? {}) as Record<
            string,
            unknown
          >)
        : ((json.mcpServers as Record<string, unknown> | undefined) ?? {});
    return name in bucket;
  });
  if (!key) return false;
  return writeJsonSurface(surface, (json) => {
    const bucket =
      surface.format === 'opencode-mcp'
        ? ((((json.mcp ??= {}) as Record<string, unknown>).servers ??= {}) as Record<
            string,
            unknown
          >)
        : ((json.mcpServers ??= {}) as Record<string, unknown>);
    if (onDemand && surface.supportsEnabledFlag) {
      const existing = bucket[key] as Record<string, unknown>;
      existing.enabled = false;
      bucket[key] = existing;
      return true;
    }
    delete bucket[key];
    return true;
  });
}

export interface DemandAction {
  server: string;
  surfaces: string[];
  action: 'activate' | 'deactivate';
  detail: string;
}

/** Estado declarado de activaciones a demanda (efimero, en `.session/`). */
export interface DemandState {
  server: string;
  activatedAt: string;
  surfaces: string[];
}

export function readDemandState(root = resolve(process.cwd())): DemandState[] {
  const raw = readJsonFile(join(root, '.session', 'mcp-on-demand.json'));
  const list = Array.isArray(raw?.activations) ? (raw?.activations as DemandState[]) : [];
  return list.filter((a) => a && typeof a.server === 'string');
}

function writeDemandState(states: DemandState[], root = resolve(process.cwd())): void {
  const dir = join(root, '.session');
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'mcp-on-demand.json'),
      `${JSON.stringify({ updatedAt: new Date().toISOString(), activations: states }, null, 2)}\n`,
      'utf-8',
    );
  } catch (err) {
    console.warn(
      `[mcp-lifecycle] no se pudo escribir el estado de activacion: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Activa (o desactiva) un servidor "a demanda" en las superficies del stack.
 * La entrada canonica sale del registro (`config/mcp-registry.json`): el stack
 * no inventa comandos.
 */
export function toggleDemand(
  server: string,
  activate: boolean,
  root = resolve(process.cwd()),
  home = homedir(),
): DemandAction {
  const policy = loadPolicy(root);
  const registry = loadRegistry(root);
  const surfaces = listSurfaces(root, home);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const spec = canonicalEntry(server, registry, [server]);
  if (!spec) {
    return {
      server,
      surfaces: [],
      action: activate ? 'activate' : 'deactivate',
      detail: `no hay entrada canonica de "${server}" en config/mcp-registry.json`,
    };
  }
  const entry = policy.servers[server];
  const aliases = buildIdentities(policy, registry, [], []).find((i) =>
    [server, ...i.aliases].includes(server),
  )?.aliases ?? [server];
  const touched: string[] = [];
  const skipped: string[] = [];
  const alreadyActive: string[] = [];
  for (const surface of surfaces) {
    const expected = expectedActivation(entry, surface.id);
    // Una superficie "always-on" no se apaga por demanda: no es de este servidor.
    if (!activate && expected === 'always-on') {
      skipped.push(surface.id);
      continue;
    }
    const declared = readSurface(surface).entries.filter((e) =>
      [server, ...aliases].includes(e.name),
    );
    const enabledNow = declared.some((e) => e.enabled);
    if (activate) {
      // "Declarada pero deshabilitada" NO es estar activa: hay que volver a
      // habilitarla, no darla por activa.
      if (enabledNow) {
        alreadyActive.push(surface.id);
        continue;
      }
      if (installEntry(surface, server, spec, stamp)) touched.push(surface.id);
      continue;
    }
    // Desactivar: se retira de las superficies donde la politica lo deja a
    // demanda. En una superficie "always-on" NO se toca (no es de este server).
    if (declared.length === 0) continue;
    if (expected === 'always-on') {
      skipped.push(surface.id);
      continue;
    }
    if (removeEntry(surface, server, aliases, stamp, true)) touched.push(surface.id);
  }

  // La activacion a demanda queda DECLARADA: sin esto, un servidor
  // activated a proposito seria reportado como deriva por el gate.
  const states = readDemandState(root).filter((s) => s.server !== server);
  const activeSurfaces = [...new Set([...touched, ...alreadyActive])].sort();
  if (activate && activeSurfaces.length) {
    states.push({ server, activatedAt: new Date().toISOString(), surfaces: activeSurfaces });
  }
  writeDemandState(states, root);

  return {
    server,
    surfaces: touched,
    action: activate ? 'activate' : 'deactivate',
    detail: touched.length
      ? `superficies actualizadas: ${touched.join(', ')}`
      : 'sin cambios (ya estaba en el estado pedido)',
  };
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

function renderText(census: Census): string {
  const lines: string[] = [];
  lines.push(
    `\nMCP lifecycle — ${census.policySources.policy} en la politica · ${census.policySources.registry} en el registro · ${census.policySources.repoCanonical} en el .mcp.json del repo`,
  );
  lines.push(`uso medido: ${census.usage.days} dias · calibracion ${census.usage.calibration}\n`);
  for (const server of census.servers) {
    const alias = server.aliases.length > 1 ? ` (alias: ${server.aliases.join(', ')})` : '';
    lines.push(`  ${server.server}${alias}`);
    lines.push(
      `    politica: ${server.policy.activation ?? 'sin politica'} · ${server.policy.criticality ?? '-'} · ${server.policy.role ?? '-'}`,
    );
    lines.push(
      `    superficies: ${server.surfaces.map((s) => `${s.surface}=${s.state}`).join(' · ')}`,
    );
    lines.push(
      `    uso: ${server.usage.invocations} invocacion(es)${server.usage.lastHitAt ? ` · ultimo ${server.usage.lastHitAt.slice(0, 10)}` : ''} · ${server.verdict}`,
    );
  }
  lines.push('\n  superficies:');
  for (const surface of census.surfaces) {
    lines.push(
      `    ${surface.id.padEnd(12)} ${surface.exists ? surface.servers.join(', ') || '(vacia)' : 'NO EXISTE'}`,
    );
  }
  if (census.drift.length) {
    lines.push(`\n  DERIVA (${census.drift.length}):`);
    for (const item of census.drift) {
      lines.push(`    [${item.surface}] ${item.server}: ${item.problem}`);
    }
  } else {
    lines.push('\n  OK — ninguna superficie contradice la politica');
  }
  return lines.join('\n');
}

function renderMarkdown(census: Census): string {
  const lines: string[] = [];
  lines.push('# Censo de servidores MCP');
  lines.push('');
  lines.push(
    `Generado ${census.generatedAt} · uso medido sobre ${census.usage.days} dias (calibracion ${census.usage.calibration}).`,
  );
  lines.push('');
  lines.push('| Servidor | Alias | Politica | Superficies | Uso | Veredicto |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const server of census.servers) {
    const surfaces = server.surfaces.map((s) => `${s.surface}: ${s.state}`).join('<br>');
    lines.push(
      `| \`${server.server}\` | ${server.aliases.filter((a) => a !== server.server).join(', ') || '-'} | ${server.policy.activation ?? '-'} | ${surfaces} | ${server.usage.invocations} | ${server.verdict} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function main(): void {
  const days = Number(arg('days') ?? 365);
  const root = resolve(process.cwd());
  const home = homedir();

  const activate = arg('activate');
  if (activate) {
    const result = toggleDemand(activate, true, root, home);
    console.log(`\nActivacion a demanda — ${result.action} ${result.server}: ${result.detail}`);
    return;
  }
  const deactivate = arg('deactivate');
  if (deactivate) {
    const result = toggleDemand(deactivate, false, root, home);
    console.log(`\nActivacion a demanda — ${result.action} ${result.server}: ${result.detail}`);
    return;
  }

  const census = buildCensus(root, home, days);

  if (flag('apply')) {
    const only = arg('only');
    const result = applyPolicy(root, home, days, only?.split(','));
    console.log(
      `\nAlineacion MCP — ${result.applied.length} accion(es), ${result.errors.length} error(es)`,
    );
    for (const action of result.applied) {
      console.log(`  ✓ ${action.surface}/${action.server}: ${action.action} — ${action.detail}`);
    }
    for (const error of result.errors) console.log(`  ✗ ${error}`);
    if (result.backups.length) console.log(`  backups: ${result.backups.length}`);
    if (result.receiptDir) console.log(`  recibo: ${result.receiptDir}`);
    if (result.errors.length) process.exitCode = 1;
    return;
  }

  const demand = checkDemandMap(root);
  if (flag('json')) {
    // Un SOLO documento JSON: dos `console.log` de objetos sueltos seria
    // JSON invalido para cualquier consumidor.
    console.log(JSON.stringify({ ...census, demandMap: demand }, null, 2));
  } else if (flag('markdown')) {
    console.log(renderMarkdown(census));
  } else {
    console.log(renderText(census));
    if (!demand.ok) {
      console.log(`\n  MAPA DE DEMANDA — ${demand.problems.length} problema(s):`);
      for (const problem of demand.problems) console.log(`    - ${problem}`);
    } else {
      console.log(`\n  mapa de demanda: ${demand.intents} intenciones, todas lanzables`);
    }
  }

  if (flag('check') && (census.drift.length || !demand.ok)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main();
}

export { matchesServer };
