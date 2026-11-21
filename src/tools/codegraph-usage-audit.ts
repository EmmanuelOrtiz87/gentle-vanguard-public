#!/usr/bin/env node
/**
 * codegraph-usage-audit.ts — mide el uso REAL del MCP codegraph por host.
 *
 * POR QUE (2026-11-18)
 * -------------------------------------------------------------------------
 * La decision del owner fue: "mantener el sync y medir hits reales una semana".
 * El indice .codegraph pesa 956 MB y el MCP esta ON: la pregunta que importa no
 * es "esta encendido?" sino "alguien lo usa?". Instrumentar el servidor MCP
 * obligaria a tocar la config de cada host; los hosts YA registran sus tool
 * calls en sus propios transcripts, asi que la medicion honesta sale de ahi.
 *
 * REGLA DE HONESTIDAD (3 capas, todas verificadas):
 *   1. Un host sin transcripts legibles se reporta como "sin datos", NUNCA
 *      como "0 usos". Cero y desconocido son cosas distintas.
 *   2. Solo cuentan las INVOCACIONES, no el CATALOGO. Un host puede tener el
 *      MCP codegraph declarado en sus tools (catalogo) sin haberlo invocado
 *      nunca: contarlo seria un falso positivo (medido: ZCode declara las 9
 *      tools de codegraph en el request y no las invoco nunca).
 *   3. El detector se CALIBRA antes de decir "0": si no detecta una invocacion
 *      sintetica conocida, el "0" no prueba nada y el reporte dice
 *      "detector no calibrado" en vez de "no se usa".
 *
 * FORMATOS DE TRANSCRIPT (medidos, no asumidos):
 *   - Qoder / Codex : {"type":"tool_use","id":...,"name":"..."}
 *   - MiniMax Code  : {"type":"toolCall","id":...,"name":"..."}
 *   - ZCode         : {"toolCalls":[{"id":...,"name":"...","input":{...}}]}
 *   - catalogo MCP  : {"name":"mcp__codegraph__codegraph_x","description":...}
 *
 * USO
 *   node --import tsx src/tools/codegraph-usage-audit.ts            # 7 dias
 *   node --import tsx src/tools/codegraph-usage-audit.ts --days 30
 *   node --import tsx src/tools/codegraph-usage-audit.ts --json
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DAYS = (() => {
  const i = process.argv.indexOf('--days');
  const v = i >= 0 ? Number(process.argv[i + 1]) : 7;
  return Number.isFinite(v) && v > 0 ? v : 7;
})();

export interface HostUsage {
  host: string;
  source: string;
  scannedFiles: number;
  totalHits: number;
  resultSideHits: number;
  hitsByTool: Record<string, number>;
  lastHitAt: string | null;
  status: 'measured' | 'no-data';
  note?: string;
}

export interface CalibrationCheck {
  name: string;
  expected: number;
  got: number;
  pass: boolean;
}

/** Nombres de herramienta que cuentan como uso del MCP codegraph. */
const CODEGRAPH_TOOL = /^(?:mcp__)?codegraph(?:__|[_:-]|$)/i;

/** Marcadores de invocacion por formato de transcript. */
const INVOCATION_MARKERS = [
  { re: /"type"\s*:\s*"tool_use"/g, label: 'anthropic tool_use' },
  { re: /"type"\s*:\s*"toolCall"/g, label: 'mcode toolCall' },
] as const;

/** Claves cuyo valor es un array de invocaciones estilo OpenAI/ZCode. */
const CALL_ARRAY_KEYS = ['toolCalls', 'tool_calls'] as const;

function walkFiles(dir: string, ext: string, limit = 400): string[] {
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

/** Extrae el array JSON que empieza en `start` (indice de '['). */
function extractJsonArray(text: string, start: number): unknown[] | null {
  if (text[start] !== '[') return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, i + 1));
          return Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Nombre de herramienta de una entrada de invocacion, sea cual sea el formato. */
function toolNameOf(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') return null;
  const obj = entry as Record<string, unknown>;
  if (typeof obj.name === 'string') return obj.name;
  const fn = obj.function;
  if (fn && typeof fn === 'object' && typeof (fn as Record<string, unknown>).name === 'string') {
    return (fn as Record<string, string>).name;
  }
  return null;
}

/**
 * Cuenta invocaciones de herramientas codegraph* en una linea de transcript.
 * `resultSide` cuenta las menciones en resultados (toolName), que prueban uso
 * pero no son la invocacion en si.
 */
export function countHitsInLine(line: string): {
  hits: number;
  resultSide: number;
  tools: string[];
} {
  const tools: string[] = [];

  // 1) Marcadores de objeto de invocacion: el nombre viene justo despues.
  for (const marker of INVOCATION_MARKERS) {
    marker.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = marker.re.exec(line)) !== null) {
      const window = line.slice(m.index, m.index + 600);
      const nameMatch = /"name"\s*:\s*"([^"]+)"/.exec(window);
      if (nameMatch && CODEGRAPH_TOOL.test(nameMatch[1])) tools.push(nameMatch[1]);
    }
  }

  // 2) Arrays de invocaciones estilo ZCode/OpenAI.
  for (const key of CALL_ARRAY_KEYS) {
    const keyRe = new RegExp(`"${key}"\\s*:\\s*\\[`, 'g');
    let m: RegExpExecArray | null;
    while ((m = keyRe.exec(line)) !== null) {
      const arr = extractJsonArray(line, m.index + m[0].length - 1);
      for (const entry of arr ?? []) {
        const name = toolNameOf(entry);
        if (name && CODEGRAPH_TOOL.test(name)) tools.push(name);
      }
    }
  }

  // 3) Lado resultado: prueba uso, no invocacion.
  const resultSide = (line.match(/"toolName"\s*:\s*"([^"]+)"/g) ?? []).filter((m) =>
    CODEGRAPH_TOOL.test(m),
  ).length;

  return { hits: tools.length, resultSide, tools };
}

/** Cuenta invocaciones de herramientas codegraph* en un JSONL de transcript. */
export function countJsonlHits(file: string): {
  hits: number;
  resultSide: number;
  tools: Record<string, number>;
} {
  const tools: Record<string, number> = {};
  let hits = 0;
  let resultSide = 0;
  let text: string;
  try {
    text = readFileSync(file, 'utf-8');
  } catch {
    return { hits, resultSide, tools };
  }
  for (const line of text.split('\n')) {
    if (!line || !/codegraph/i.test(line)) continue;
    const counted = countHitsInLine(line);
    hits += counted.hits;
    resultSide += counted.resultSide;
    for (const name of counted.tools) tools[name] = (tools[name] ?? 0) + 1;
  }
  return { hits, resultSide, tools };
}

/**
 * ControlesPositive/negativos del detector. Sin esto, un "0" podria ser un
 * detector roto (ya paso: la primera version no contaba mcp__codegraph__*).
 */
export function calibrateDetector(): { pass: boolean; checks: CalibrationCheck[] } {
  const cases: Array<{ name: string; line: string; expected: number }> = [
    {
      name: 'anthropic tool_use con nombre codegraph',
      line: '{"type":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"codegraph_search","input":{}}]}',
      expected: 1,
    },
    {
      name: 'anthropic tool_use con nombre mcp__codegraph__*',
      line: '{"type":"assistant","content":[{"type":"tool_use","id":"toolu_2","name":"mcp__codegraph__codegraph_status","input":{}}]}',
      expected: 1,
    },
    {
      name: 'mcode toolCall con nombre mcp__codegraph__*',
      line: '{"message":{"role":"assistant","content":[{"type":"toolCall","id":"call_1","name":"mcp__codegraph__codegraph_context","arguments":"{}"}]}}',
      expected: 1,
    },
    {
      name: 'zcode toolCalls con nombre mcp__codegraph__*',
      line: '{"response":{"toolCalls":[{"id":"call_2","name":"mcp__codegraph__codegraph_context","input":{}}]}}',
      expected: 1,
    },
    {
      name: 'catalogo MCP (no es invocacion)',
      line: '{"request":{"tools":[{"name":"mcp__codegraph__codegraph_status","description":"Status del indice","input_schema":{"type":"object"}}]}}',
      expected: 0,
    },
    {
      name: 'texto que menciona codegraph (no es invocacion)',
      line: '{"message":{"role":"assistant","content":[{"type":"thinking","thinking":"el MCP codegraph no se usa"}]}}',
      expected: 0,
    },
  ];
  const checks = cases.map((c) => {
    const got = countHitsInLine(c.line).hits;
    return { name: c.name, expected: c.expected, got, pass: got === c.expected };
  });
  return { pass: checks.every((c) => c.pass), checks };
}

function measureHost(host: string, source: string, files: string[], since: number): HostUsage {
  const base: HostUsage = {
    host,
    source,
    scannedFiles: 0,
    totalHits: 0,
    resultSideHits: 0,
    hitsByTool: {},
    lastHitAt: null,
    status: 'no-data',
  };
  if (files.length === 0) {
    base.note = 'sin transcripts legibles en la ruta declarada';
    return base;
  }
  let lastHit = 0;
  for (const file of files) {
    let mtime = 0;
    try {
      mtime = statSync(file).mtimeMs;
    } catch {
      continue;
    }
    if (mtime < since) continue;
    base.scannedFiles++;
    const { hits, resultSide, tools } = countJsonlHits(file);
    base.totalHits += hits;
    base.resultSideHits += resultSide;
    for (const [tool, n] of Object.entries(tools)) {
      base.hitsByTool[tool] = (base.hitsByTool[tool] ?? 0) + n;
    }
    if (hits > 0 && mtime > lastHit) lastHit = mtime;
  }
  base.status = 'measured';
  base.lastHitAt = lastHit ? new Date(lastHit).toISOString() : null;
  if (base.totalHits === 0) {
    base.note =
      base.resultSideHits > 0
        ? 'sin invocaciones directas, pero con resultados que nombran codegraph'
        : 'transcripts leidos sin ninguna invocacion a codegraph';
  }
  return base;
}

export function auditCodegraphUsage(
  days = DAYS,
  home = homedir(),
): {
  days: number;
  hosts: HostUsage[];
  totalHits: number;
  calibration: { pass: boolean; checks: CalibrationCheck[] };
  hostsWithoutData: string[];
  verdict: 'in-use' | 'unused' | 'detector-uncalibrated' | 'no-data';
} {
  const since = Date.now() - days * 86_400_000;
  const hosts = [
    measureHost(
      'Qoder',
      '~/.qoder/projects/**/*.jsonl',
      walkFiles(join(home, '.qoder', 'projects'), '.jsonl', 600),
      since,
    ),
    measureHost(
      'Codex',
      '~/.codex/sessions/**/*.jsonl',
      walkFiles(join(home, '.codex', 'sessions'), '.jsonl', 600),
      since,
    ),
    measureHost(
      'MiniMax Code',
      '~/.minimax/v2/sessions/**/messages.jsonl',
      walkFiles(join(home, '.minimax', 'v2', 'sessions'), '.jsonl', 800),
      since,
    ),
    measureHost(
      'ZCode',
      '~/.zcode/cli/rollout/*.jsonl',
      walkFiles(join(home, '.zcode', 'cli', 'rollout'), '.jsonl', 400),
      since,
    ),
  ];
  const totalHits = hosts.reduce((acc, h) => acc + h.totalHits, 0);
  const calibration = calibrateDetector();
  const hostsWithoutData = hosts.filter((h) => h.status === 'no-data').map((h) => h.host);
  let verdict: 'in-use' | 'unused' | 'detector-uncalibrated' | 'no-data';
  if (!calibration.pass) verdict = 'detector-uncalibrated';
  else if (hostsWithoutData.length === hosts.length) verdict = 'no-data';
  else if (totalHits > 0) verdict = 'in-use';
  else verdict = 'unused';
  return { days, hosts, totalHits, calibration, hostsWithoutData, verdict };
}

function main(): void {
  const json = process.argv.includes('--json');
  const result = auditCodegraphUsage();
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Uso real del MCP codegraph — ultimos ${result.days} dias`);
  console.log('--------------------------------------------');
  for (const host of result.hosts) {
    console.log(
      `  ${host.host.padEnd(14)} ${host.status === 'measured' ? `${host.totalHits} hit(s)` : 'SIN DATOS'} ` +
        `· ${host.scannedFiles} transcript(s) leidos`,
    );
    if (host.lastHitAt) console.log(`                 ultimo uso: ${host.lastHitAt}`);
    if (host.note) console.log(`                 nota: ${host.note}`);
    for (const [tool, n] of Object.entries(host.hitsByTool))
      console.log(`                 ${tool}: ${n}`);
  }
  console.log(`\n  total: ${result.totalHits} invocacion(es)`);
  console.log(
    `  calibracion del detector: ${result.calibration.pass ? 'PASS' : 'FAIL'} ` +
      `(${result.calibration.checks.filter((c) => c.pass).length}/${result.calibration.checks.length} controles)`,
  );
  if (result.hostsWithoutData.length) {
    console.log(`  hosts sin datos (no son cero): ${result.hostsWithoutData.join(', ')}`);
  }
  const lecturas: Record<string, string> = {
    'in-use': '  LECTURA: hay uso real -> el sync se justifica.',
    unused:
      '  LECTURA: el MCP codegraph no registra uso en los hosts medidos -> candidato a retirar.',
    'detector-uncalibrated':
      '  LECTURA: el detector NO esta calibrado -> el "0" no prueba nada. No concluyas.',
    'no-data':
      '  LECTURA: ningun host tiene transcripts legibles -> no hay evidencia, no hay veredicto.',
  };
  console.log(lecturas[result.verdict]);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main();
}
