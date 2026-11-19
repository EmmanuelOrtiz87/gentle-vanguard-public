#!/usr/bin/env node
/**
 * mcp-usage-audit.ts — uso REAL de cada servidor MCP declarado, host por host.
 *
 * POR QUE (2026-11-18)
 * -------------------------------------------------------------------------
 * El stack declara MCPs en `.mcp.json`. Declarado NO es usado: un host puede
 * ofrecer las 9 tools de codegraph en su request y no invocarlas nunca (medido
 * en ZCode: las declara y no las usa).
 *
 * Con la medicion de codegraph se lleno la pregunta "este MCP vale lo que
 * cuesta?". Esta herramienta la responde para TODOS los MCPs del stack, con
 * el mismo detector calibrado (`mcp-invocation-detector.ts`):
 *
 *   - DECLARADO != USADO (el catalogo no cuenta)
 *   - 0 usos != sin datos (un host sin transcripts es "sin datos")
 *   - el detector se calibra antes de concluir
 *
 * USO
 *   node --import tsx src/tools/mcp-usage-audit.ts              # 7 dias
 *   node --import tsx src/tools/mcp-usage-audit.ts --days 365
 *   node --import tsx src/tools/mcp-usage-audit.ts --json
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  calibrateDetector,
  countInvocations,
  type InvocationFormat,
} from './mcp-invocation-detector.js';

const DAYS = (() => {
  const i = process.argv.indexOf('--days');
  const v = i >= 0 ? Number(process.argv[i + 1]) : 7;
  return Number.isFinite(v) && v > 0 ? v : 7;
})();

export interface McpServerUsage {
  server: string;
  hits: number;
  resultSideHits: number;
  lastHitAt: string | null;
  hostsUsing: string[];
  /**
   * Desglose por NOMBRE de tool (`mcp__codegraph__codegraph_callers` -> x).
   * Un total sin desglose no distingue "se usa el grafo entero" de "una tool
   * de estado se llamo sola": la re-medicion de codegraph (2026-12-18) decide
   * con este dato, no con el total.
   */
  tools: Record<string, number>;
}

export interface HostScan {
  host: string;
  source: string;
  scannedFiles: number;
  /** Herramientas invocadas por nombre (todas, no solo MCP). */
  toolCalls: Record<string, number>;
  /** Herramientas nombradas en resultados (`toolName`): evidencia de uso. */
  resultSideCalls: Record<string, number>;
  status: 'measured' | 'no-data';
  note?: string;
}

export interface McpUsageReport {
  days: number;
  servers: McpServerUsage[];
  /** Servidores OBSERVADOS en transcripciones, declarados o no. */
  observedServers: McpServerUsage[];
  hosts: HostScan[];
  calibration: {
    pass: boolean;
    checks: Array<{ name: string; expected: number; got: number; pass: boolean }>;
  };
  hostsWithoutData: string[];
  declaredButUnused: string[];
  used: string[];
  /**
   * Usados de verdad pero NO declarados en NINGUNA fuente: deriva invisible.
   *
   * "Declarado" son TRES fuentes, no una: el canon (`.mcp.json`, que solo
   * lleva lo precargado), el registro (`config/mcp-registry.json`, la fuente
   * de verdad de los comandos) y la politica (el ciclo de vida). Medido
   * 2026-11-18: la auditoria reportaba `rea`, `fetch-server`,
   * `chrome-devtools` y `gv-analytics-atlassian` como "usados sin declarar",
   * cuando los cuatro son a demanda POR DISENO y estan declarados en el
   * registro y en la politica: solo faltan en `.mcp.json`, que es la lista
   * de los precargados. Ese era un falso positivo que hacia ver deriva donde
   * hay diseno. Un uso que no esta en NINGUNA de las tres si es deriva.
   */
  usedButNotDeclared: string[];
  /** Usados y a demanda (fuera del canon por diseno, pero registrados). */
  usedOnDemand: string[];
}

interface HostSpec {
  host: string;
  source: string;
  /** La ruta puede depender del HOME del host y de la raiz del repo. */
  dir: (home: string, root?: string) => string;
  ext: string;
  limit: number;
}

export const HOSTS: HostSpec[] = [
  {
    host: 'Qoder',
    source: '~/.qoder/projects/**/*.jsonl',
    dir: (home) => join(home, '.qoder', 'projects'),
    ext: '.jsonl',
    limit: 600,
  },
  {
    host: 'Codex',
    source: '~/.codex/sessions/**/*.jsonl',
    dir: (home) => join(home, '.codex', 'sessions'),
    ext: '.jsonl',
    limit: 600,
  },
  {
    host: 'MiniMax Code',
    source: '~/.minimax/v2/sessions/**/messages.jsonl',
    dir: (home) => join(home, '.minimax', 'v2', 'sessions'),
    ext: '.jsonl',
    limit: 800,
  },
  {
    host: 'ZCode',
    source: '~/.zcode/cli/rollout/*.jsonl',
    dir: (home) => join(home, '.zcode', 'cli', 'rollout'),
    ext: '.jsonl',
    limit: 400,
  },
  {
    // Puente del stack (`npm run mcp:call`): invocaciones por MCP que NO
    // estan precargados en el host (rea, fetch-server, gv-design-system...).
    // Sin esta fuente, el uso desde el puente seria invisible y el censo
    // reportaria "0 invocaciones" para un servidor que se esta usando.
    host: 'MCP bridge (stack)',
    source: '.runtime/mcp-calls.jsonl',
    dir: (_home, root) => join(root ?? process.cwd(), '.runtime'),
    ext: 'mcp-calls.jsonl',
    limit: 50,
  },
];

function walkFiles(dir: string, ext: string, limit: number): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length && out.length < limit) {
    const current = stack.pop() as string;
    let entries: string[] = [];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) stack.push(full);
      else if (entry.endsWith(ext)) out.push(full);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** Los MCPs declarados por el repo (el canon: `.mcp.json`). */
export function readDeclaredMcpServers(root = process.cwd()): string[] {
  const path = join(root, '.mcp.json');
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as {
      mcpServers?: Record<string, unknown>;
    };
    return Object.keys(parsed.mcpServers ?? {}).sort();
  } catch {
    return [];
  }
}

/** Los MCPs del REGISTRO del stack: la fuente de verdad de los comandos. */
export function readRegisteredMcpServers(root = process.cwd()): string[] {
  const path = join(root, 'config', 'mcp-registry.json');
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as {
      servers?: Array<{ name?: string; enabled?: boolean }>;
    };
    return (parsed.servers ?? [])
      .filter((s) => s.enabled !== false && typeof s.name === 'string')
      .map((s) => s.name as string);
  } catch {
    return [];
  }
}

/** Los MCPs declarados en la POLITICA de ciclo de vida. */
export function readPolicyMcpServers(root = process.cwd()): string[] {
  const path = join(root, 'config', 'mcp-lifecycle-policy.json');
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as {
      servers?: Record<string, unknown>;
    };
    return Object.keys(parsed.servers ?? {}).sort();
  } catch {
    return [];
  }
}

/** Nombres de tool que pertenecen a un servidor MCP (`mcp__server__tool`). */
export function matchesServer(server: string): (name: string) => boolean {
  const mcpPrefixed = new RegExp(`^mcp__${server}__`, 'i');
  const bare = new RegExp(`^${server}[_:-]`, 'i');
  return (name: string) => mcpPrefixed.test(name) || bare.test(name);
}

export function scanHost(
  spec: HostSpec,
  home: string,
  since: number,
  root = process.cwd(),
): { scan: HostScan; hits: Map<string, { count: number; lastHit: number }> } {
  const scan: HostScan = {
    host: spec.host,
    source: spec.source,
    scannedFiles: 0,
    toolCalls: {},
    resultSideCalls: {},
    status: 'no-data',
  };
  const hits = new Map<string, { count: number; lastHit: number }>();
  const files = walkFiles(spec.dir(home, root), spec.ext, spec.limit);
  if (files.length === 0) {
    scan.note = 'sin transcripts legibles en la ruta declarada';
    return { scan, hits };
  }
  for (const file of files) {
    let mtime = 0;
    try {
      mtime = statSync(file).mtimeMs;
    } catch {
      continue;
    }
    if (mtime < since) continue;
    scan.scannedFiles++;
    let text: string;
    try {
      text = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line) continue;
      const counted = countInvocations(line, () => true);
      for (const tool of counted.tools) {
        scan.toolCalls[tool] = (scan.toolCalls[tool] ?? 0) + 1;
        const entry = hits.get(tool) ?? { count: 0, lastHit: 0 };
        entry.count++;
        if (mtime > entry.lastHit) entry.lastHit = mtime;
        hits.set(tool, entry);
      }
      // Lado resultado: el `toolName` del resultado nombra la tool llamada.
      for (const m of line.matchAll(/"toolName"\s*:\s*"([^"]+)"/g)) {
        scan.resultSideCalls[m[1]] = (scan.resultSideCalls[m[1]] ?? 0) + 1;
      }
    }
  }
  scan.status = 'measured';
  if (scan.scannedFiles === 0) scan.note = 'transcripts fuera de la ventana temporal';
  return { scan, hits };
}

export function auditMcpUsage(
  days = DAYS,
  home = homedir(),
  root = resolve(process.cwd()),
): McpUsageReport {
  const since = Date.now() - days * 86_400_000;
  const declared = readDeclaredMcpServers(root);
  // Las otras dos fuentes de "declarado": el REGISTRO (comandos) y la
  // POLITICA (ciclo de vida). El canon (`.mcp.json`) solo lleva lo
  // precargado, asi que comparar contra el solo produce falsos positivos
  // para toda capacidad a demanda.
  const registered = readRegisteredMcpServers(root);
  const policyServers = readPolicyMcpServers(root);
  const hosts: HostScan[] = [];
  const perTool = new Map<string, { count: number; lastHit: number; hosts: Set<string> }>();

  for (const spec of HOSTS) {
    const { scan, hits } = scanHost(spec, home, since, root);
    hosts.push(scan);
    for (const [tool, info] of hits) {
      const entry = perTool.get(tool) ?? { count: 0, lastHit: 0, hosts: new Set<string>() };
      entry.count += info.count;
      if (info.lastHit > entry.lastHit) entry.lastHit = info.lastHit;
      entry.hosts.add(spec.host);
      perTool.set(tool, entry);
    }
  }

  const servers: McpServerUsage[] = declared.map((server) => {
    const matcher = matchesServer(server);
    let hits = 0;
    let resultSideHits = 0;
    let lastHitAt: string | null = null;
    const hostsUsing: string[] = [];
    const tools: Record<string, number> = {};
    for (const [tool, info] of perTool) {
      if (!matcher(tool)) continue;
      hits += info.count;
      tools[tool] = (tools[tool] ?? 0) + info.count;
      for (const h of info.hosts) if (!hostsUsing.includes(h)) hostsUsing.push(h);
      if (info.lastHit > 0) {
        const iso = new Date(info.lastHit).toISOString();
        if (!lastHitAt || iso > lastHitAt) lastHitAt = iso;
      }
    }
    // Lado resultado (`toolName`): evidencia de uso, no invocacion.
    for (const scan of hosts) {
      for (const [tool, n] of Object.entries(scan.resultSideCalls)) {
        if (matcher(tool)) resultSideHits += n;
      }
    }
    return { server, hits, resultSideHits, lastHitAt, hostsUsing, tools };
  });

  const calibration = calibrateDetector();
  const hostsWithoutData = hosts.filter((h) => h.status === 'no-data').map((h) => h.host);
  const used = servers.filter((s) => s.hits > 0).map((s) => s.server);
  const declaredButUnused = servers.filter((s) => s.hits === 0).map((s) => s.server);

  // Servidores OBSERVADOS (declarados o no). Medir solo los declarados hace que
  // quitar un servidor del canon lo convierta en "0 usos" sin medirlo: el cero
  // falso. Aqui se ve el uso real de TODOS los MCPs que un host invoco.
  const observed = new Map<
    string,
    { count: number; lastHit: number; hosts: Set<string>; tools: Record<string, number> }
  >();
  for (const [tool, info] of perTool) {
    const match = /^mcp__(.+?)__/.exec(tool);
    if (!match) continue;
    const server = match[1];
    const entry = observed.get(server) ?? {
      count: 0,
      lastHit: 0,
      hosts: new Set<string>(),
      tools: {},
    };
    entry.count += info.count;
    entry.tools[tool] = (entry.tools[tool] ?? 0) + info.count;
    if (info.lastHit > entry.lastHit) entry.lastHit = info.lastHit;
    for (const host of info.hosts) entry.hosts.add(host);
    observed.set(server, entry);
  }
  const observedServers: McpServerUsage[] = [...observed.entries()]
    .map(([server, info]) => ({
      server,
      hits: info.count,
      resultSideHits: 0,
      lastHitAt: info.lastHit ? new Date(info.lastHit).toISOString() : null,
      hostsUsing: [...info.hosts].sort(),
      tools: info.tools,
    }))
    .sort((a, b) => b.hits - a.hits);
  const usedButNotDeclared: string[] = [];
  const usedOnDemand: string[] = [];
  for (const s of observedServers) {
    if (s.hits <= 0) continue;
    if (declared.includes(s.server)) continue;
    // Esta en el REGISTRO o en la POLITICA: es una capacidad declarada que
    // se usa a demanda (fuera del canon por diseno). No es deriva.
    if (registered.includes(s.server) || policyServers.includes(s.server)) {
      usedOnDemand.push(s.server);
      continue;
    }
    usedButNotDeclared.push(s.server);
  }

  return {
    days,
    servers,
    observedServers,
    hosts,
    calibration,
    hostsWithoutData,
    declaredButUnused,
    used,
    usedButNotDeclared,
    usedOnDemand,
  };
}

/** Desglose legible por tool: `codegraph_callers x3, codegraph_status x1`. */
export function toolBreakdown(tools: Record<string, number>, max = 8): string {
  const entries = Object.entries(tools)
    .map(([tool, n]) => [tool.replace(/^mcp__[^_]+__/i, ''), n] as const)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (entries.length === 0) return '';
  const shown = entries.slice(0, max).map(([tool, n]) => `${tool} x${n}`);
  const rest = entries.length - shown.length;
  return shown.join(', ') + (rest > 0 ? ` (+${rest} mas)` : '');
}

function main(): void {
  const json = process.argv.includes('--json');
  const report = auditMcpUsage();
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`Uso real de los MCP declarados — ultimos ${report.days} dias`);
  console.log('--------------------------------------------');
  for (const server of report.servers) {
    const when = server.lastHitAt ? ` · ultimo uso ${server.lastHitAt}` : '';
    const who = server.hostsUsing.length ? ` · ${server.hostsUsing.join(', ')}` : '';
    console.log(`  ${server.server.padEnd(24)} ${server.hits} invocacion(es)${when}${who}`);
  }
  console.log('\n  hosts leidos:');
  for (const host of report.hosts) {
    console.log(
      `    ${host.host.padEnd(14)} ${host.status === 'measured' ? `${host.scannedFiles} transcript(s)` : 'SIN DATOS'}` +
        (host.note ? ` — ${host.note}` : ''),
    );
  }
  console.log(`\n  calibracion: ${report.calibration.pass ? 'PASS' : 'FAIL'}`);
  console.log(`  declarados sin uso: ${report.declaredButUnused.join(', ') || 'ninguno'}`);
  console.log(`  declarados con uso: ${report.used.join(', ') || 'ninguno'}`);
  console.log('  observados (todos los MCP que un host invoco):');
  for (const server of report.observedServers) {
    const when = server.lastHitAt ? ` · ultimo ${server.lastHitAt.slice(0, 10)}` : '';
    console.log(`    ${server.server.padEnd(26)} ${server.hits}${when}`);
    const breakdown = toolBreakdown(server.tools);
    if (breakdown) console.log(`      ${breakdown}`);
  }
  if (report.usedOnDemand.length) {
    console.log(
      `  usados a demanda (fuera del canon por diseno, registrados): ${report.usedOnDemand.join(', ')}`,
    );
  }
  if (report.usedButNotDeclared.length) {
    console.log(
      `  USADOS SIN DECLARAR: ${report.usedButNotDeclared.join(', ')} (deriva real: se usan y no estan en el canon, el registro ni la politica)`,
    );
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main();
}

export type { InvocationFormat };
