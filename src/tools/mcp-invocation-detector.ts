#!/usr/bin/env node
/**
 * mcp-invocation-detector.ts — detector GENERICO de invocaciones de herramientas.
 *
 * POR QUE (2026-11-18)
 * -------------------------------------------------------------------------
 * La primera version del detector de uso de codegraph vivia dentro de la
 * herramienta y tenia dos defectos:
 *
 *   1. Buscaba `"name": "codegraph..."` y las tools reales se llaman
 *      `mcp__codegraph__codegraph_status` -> 0 usos falsos.
 *   2. No separaba INVOCACION de CATALOGO: un host puede declarar las 9 tools
 *      de codegraph en el request y no invocarlas nunca.
 *
 * Este modulo es la pieza reutilizable: el detector vive aca, la medicion por
 * host vive en la herramienta que lo usa. Cualquier MCP (o cualquier tool) se
 * mide con el mismo codigo y la misma calibracion.
 *
 * FORMATOS (medidos, no asumidos):
 *   - Anthropic  : {"type":"tool_use","id":...,"name":"..."}
 *   - MiniMax    : {"type":"toolCall","id":...,"name":...}
 *   - OpenAI/ZCode: {"tool_calls":[{"name":"...","function":{"name":"..."}}]}
 *
 * REGLA DE HONESTIDAD: un host sin transcripts legibles es "sin datos", nunca
 * "0 usos". Y un detector sin calibrar no puede concluir nada.
 */

export type InvocationFormat = 'anthropic' | 'mcode' | 'openai';

export interface InvocationHit {
  tool: string;
  format: InvocationFormat;
}

/** Marcadores de objeto de invocacion por formato. */
const OBJECT_MARKERS: Array<{ re: RegExp; format: InvocationFormat }> = [
  { re: /"type"\s*:\s*"tool_use"/g, format: 'anthropic' },
  { re: /"type"\s*:\s*"toolCall"/g, format: 'mcode' },
];

/** Claves cuyo valor es un array de invocaciones estilo OpenAI/ZCode. */
const CALL_ARRAY_KEYS = ['toolCalls', 'tool_calls'] as const;

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
 * Invocaciones REALES de una linea de transcript.
 *
 * Solo cuenta objetos de invocacion (tool_use / toolCall / tool_calls[]). El
 * catalogo de tools (definiciones con `input_schema`) NO aparece aca: no es
 * uso, es disponibilidad.
 */
export function extractInvocations(line: string): InvocationHit[] {
  const hits: InvocationHit[] = [];

  for (const marker of OBJECT_MARKERS) {
    marker.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = marker.re.exec(line)) !== null) {
      // El nombre viene justo despues del marcador (id, luego name).
      const window = line.slice(m.index, m.index + 600);
      const nameMatch = /"name"\s*:\s*"([^"]+)"/.exec(window);
      if (nameMatch) hits.push({ tool: nameMatch[1], format: marker.format });
    }
  }

  for (const key of CALL_ARRAY_KEYS) {
    const keyRe = new RegExp(`"${key}"\\s*:\\s*\\[`, 'g');
    let m: RegExpExecArray | null;
    while ((m = keyRe.exec(line)) !== null) {
      const arr = extractJsonArray(line, m.index + m[0].length - 1);
      for (const entry of arr ?? []) {
        const name = toolNameOf(entry);
        if (name) hits.push({ tool: name, format: 'openai' });
      }
    }
  }

  return hits;
}

/**
 * Cuenta invocaciones que satisfacen `matches`.
 * `resultSide` cuenta las menciones en resultados (`toolName`), que prueban
 * uso pero no son la invocacion en si.
 */
export function countInvocations(
  line: string,
  matches: (name: string) => boolean,
): { hits: number; resultSide: number; tools: string[] } {
  const tools: string[] = [];
  for (const hit of extractInvocations(line)) {
    if (matches(hit.tool)) tools.push(hit.tool);
  }
  const resultSide = (line.match(/"toolName"\s*:\s*"([^"]+)"/g) ?? []).filter((m) =>
    matches(/"toolName"\s*:\s*"([^"]+)"/.exec(m)?.[1] ?? ''),
  ).length;
  return { hits: tools.length, resultSide, tools };
}

/**
 * Controles positivos/negativos del detector: sin esto un "0" puede ser un
 * detector roto (ya paso) y no prueba nada.
 */
export function calibrateDetector(): {
  pass: boolean;
  checks: Array<{ name: string; expected: number; got: number; pass: boolean }>;
} {
  // El control usa un matcher REAL (un servidor MCP), no "cualquier tool": asi
  // el control negativo del `input` de otra tool discrimina de verdad.
  const isTarget = (name: string): boolean =>
    /^mcp__codegraph__/.test(name) || /^codegraph[_:-]/.test(name);
  const cases: Array<{ name: string; line: string; expected: number }> = [
    {
      name: 'anthropic tool_use',
      line: '{"type":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"mcp__codegraph__codegraph_status","input":{}}]}',
      expected: 1,
    },
    {
      name: 'mcode toolCall',
      line: '{"message":{"role":"assistant","content":[{"type":"toolCall","id":"call_1","name":"mcp__codegraph__codegraph_context","arguments":"{}"}]}}',
      expected: 1,
    },
    {
      name: 'zcode toolCalls[]',
      line: '{"response":{"toolCalls":[{"id":"call_2","name":"codegraph_files","input":{}}]}}',
      expected: 1,
    },
    {
      name: 'catalogo MCP (no es invocacion)',
      line: '{"request":{"tools":[{"name":"mcp__codegraph__codegraph_status","description":"Status","input_schema":{"type":"object"}}]}}',
      expected: 0,
    },
    {
      name: 'texto que menciona la tool',
      line: '{"message":{"role":"assistant","content":[{"type":"thinking","thinking":"el MCP codegraph no se usa"}]}}',
      expected: 0,
    },
    {
      name: 'input de otra tool (name de un simbolo)',
      line: '{"type":"assistant","content":[{"type":"tool_use","id":"toolu_3","name":"read","input":{"name":"codegraph_status"}}]}',
      expected: 0,
    },
  ];
  const checks = cases.map((c) => {
    const got = countInvocations(c.line, isTarget).hits;
    return { name: c.name, expected: c.expected, got, pass: got === c.expected };
  });
  return { pass: checks.every((c) => c.pass), checks };
}
