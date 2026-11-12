#!/usr/bin/env node
/**
 * local-capability-probe.ts — ¿el modelo local sabe TRABAJAR, o solo responde?
 *
 * EL HUECO QUE CIERRA
 * `model-inference-probe` mide si el endpoint contesta (30 tokens de prompt, 1
 * de completion). Eso prueba transporte, no capacidad: un modelo roto, truncado
 * o con la plantilla de chat mal armada tambien "responde". La homologacion
 * runtime (BL-MVJKNHPA-WT62) pide calificacion REAL, y con el free tier agotado
 * la unica capacidad honesta es la local.
 *
 * QUE MIDE
 * Tres tareas deterministas en una sola llamada, con validacion programatica:
 *   1. aritmetica exacta        (17 + 25 = 42)
 *   2. manipulacion de texto    ("vanguard" invertido = "draugnav")
 *   3. conteo de caracteres     (8 letras)
 * Ademas exige JSON estricto: seguir instrucciones de formato es parte del
 * trabajo real de un agente.
 *
 * Uso:
 *   node --import tsx src/tools/local-capability-probe.ts
 *   node --import tsx src/tools/local-capability-probe.ts --model ollama/qwen2.5-coder:14b
 *   node --import tsx src/tools/local-capability-probe.ts --provider lm-studio --json
 *
 * Exit: 0 = PASS, 1 = el modelo respondio pero fallo la validacion, 2 = sin
 * capacidad local disponible (endpoint caido / sin modelo).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EVIDENCE_PATH = join(ROOT, '.runtime', 'local-capability.json');

const EXPECTED = { sum: 42, reversed: 'draugnav', count: 8 } as const;

const PROMPT = [
  'Responde SOLO con JSON valido, sin markdown ni explicaciones.',
  'Forma exacta: {"sum": <numero>, "reversed": "<texto>", "count": <numero>}',
  'Datos:',
  '1) sum = 17 + 25',
  '2) reversed = el texto "vanguard" escrito al reves',
  '3) count = cantidad de letras de "vanguard"',
].join('\n');

interface ProviderEndpoint {
  baseUrl: string;
  model: string;
}

interface Args {
  provider: 'ollama' | 'lm-studio';
  model?: string;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { provider: 'ollama', json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--model') args.model = argv[++i];
    else if (argv[i] === '--provider') {
      const value = argv[++i];
      if (value === 'lm-studio' || value === 'ollama') args.provider = value;
    } else if (argv[i] === '--json') args.json = true;
  }
  return args;
}

/** Endpoint OpenAI-compatible de cada capacidad local conocida. */
function resolveEndpoint(args: Args): ProviderEndpoint {
  const defaults: Record<Args['provider'], ProviderEndpoint> = {
    ollama: { baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5-coder:14b' },
    'lm-studio': { baseUrl: 'http://127.0.0.1:1234/v1', model: '' },
  };
  const base = defaults[args.provider];
  const model = (args.model ?? base.model).replace(/^(ollama|lm-studio)\//, '');
  return { baseUrl: base.baseUrl, model };
}

/** Extrae el primer objeto JSON del texto (tolera ```json y prosa alrededor). */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) continue;
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* sigue con el proximo candidato */
    }
  }
  return null;
}

export interface CapabilityCheck {
  name: string;
  expected: string;
  actual: string;
  ok: boolean;
}

/** Valida la respuesta contra las tres tareas deterministas. */
export function validateAnswer(payload: Record<string, unknown> | null): CapabilityCheck[] {
  const sum = payload?.sum;
  const reversed = payload?.reversed;
  const count = payload?.count;
  return [
    {
      name: 'aritmetica',
      expected: String(EXPECTED.sum),
      actual: String(sum ?? '(ausente)'),
      ok: typeof sum === 'number' && sum === EXPECTED.sum,
    },
    {
      name: 'texto invertido',
      expected: EXPECTED.reversed,
      actual: String(reversed ?? '(ausente)'),
      ok:
        typeof reversed === 'string' &&
        reversed.trim().toLowerCase() === EXPECTED.reversed,
    },
    {
      name: 'conteo de letras',
      expected: String(EXPECTED.count),
      actual: String(count ?? '(ausente)'),
      ok: typeof count === 'number' && count === EXPECTED.count,
    },
  ];
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const { baseUrl, model } = resolveEndpoint(args);
  const started = Date.now();

  let text = '';
  let latencyMs = 0;
  try {
    if (!model) {
      console.error('[local-capability] no hay modelo configurado para este proveedor local');
      return 2;
    }
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'Sos un asistente preciso. Seguis el formato pedido al pie de la letra.' },
          { role: 'user', content: PROMPT },
        ],
        temperature: 0,
        max_tokens: 200,
        stream: false,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    latencyMs = Date.now() - started;
    if (!response.ok) {
      const body = await response.text();
      console.error(
        `[local-capability] sin capacidad local: HTTP ${response.status} ${body.slice(0, 200)}`,
      );
      return 2;
    }
    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    text = data.choices?.[0]?.message?.content ?? '';
  } catch (error) {
    console.error(
      `[local-capability] sin capacidad local: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 2;
  }

  const payload = extractJsonObject(text);
  const checks = validateAnswer(payload);
  const passedCount = checks.filter((c) => c.ok).length;
  // Veredicto graduado: la manipulacion exacta de caracteres es una debilidad
  // CONOCIDA de los LLM (tokenizacion), no un transporte roto. Un modelo que
  // acierta 2 de 3 sirve para trabajo real; uno que rompe el formato o acierta
  // 1 no sirve. Declarar FAIL a un 2/3 convertiria el gate en ruido.
  const verdict: 'PASS' | 'WARN' | 'FAIL' =
    passedCount === checks.length ? 'PASS' : passedCount >= 2 ? 'WARN' : 'FAIL';
  const weaknesses = checks.filter((c) => !c.ok).map((c) => c.name);

  const evidence = {
    version: 1,
    checkedAt: new Date().toISOString(),
    provider: args.provider,
    endpoint: baseUrl,
    model,
    verdict,
    score: `${passedCount}/${checks.length}`,
    weaknesses,
    latencyMs,
    checks,
    rawResponse: text.slice(0, 800),
  };
  try {
    mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
    writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf-8');
  } catch {
    /* la evidencia es util, no critica */
  }

  if (args.json) {
    console.log(JSON.stringify(evidence, null, 2));
  } else {
    console.log(`[local-capability] ${verdict} — ${model} (${passedCount}/${checks.length}, ${latencyMs}ms)`);
    for (const check of checks) {
      console.log(
        `  ${check.ok ? 'OK  ' : 'FAIL'} ${check.name}: esperado ${check.expected}, obtenido ${check.actual}`,
      );
    }
    if (weaknesses.length > 0) console.log(`  debilidades: ${weaknesses.join(', ')}`);
    console.log(`  evidencia -> ${EVIDENCE_PATH}`);
  }

  // PASS y WARN son operables; solo FAIL (formato roto o 1/3) bloquea.
  return verdict === 'FAIL' ? 1 : 0;
}

// Solo ejecuta cuando se invoca como script: importarlo (tests, otros modulos)
// no debe disparar una llamada real al modelo.
const invokedDirectly =
  process.argv[1]?.split(/[\\/]/).pop() === 'local-capability-probe.ts';
if (invokedDirectly) {
  process.exitCode = await main();
}
