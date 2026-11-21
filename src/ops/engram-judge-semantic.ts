#!/usr/bin/env node
/**
 * engram-judge-semantic.ts — cierra relaciones `pending` de Engram con un JUICIO
 * SEMANTICO de un modelo LOCAL, sin CLI de agente externo y sin cuota remota.
 *
 * POR QUE (2026-11-18)
 * -------------------------------------------------------------------------
 * `src/ops/engram-judge-deterministic.ts` cierra solo lo que se puede PROBAR
 * sin juicio (mismo titulo + contenido equivalente): 127 relaciones. Quedan 914
 * `pending` que necesitan criterio semantico.
 *
 * La capacidad oficial para eso era `engram conflicts scan --semantic`, pero
 * exige `ENGRAM_AGENT_CLI` (claude u opencode): manejo una CLI de agente
 * completa como juez, con su cuota, su latencia y su superficie de fallo. Con
 * la cuota remota agotada, esa via no era una via.
 *
 * La capacidad que faltaba era: **juzgar un par de observaciones con un modelo
 * local, y dejar el veredicto con su procedencia**. Eso es lo que hace este
 * script, en el mismo store y con las mismas convenciones que el juez
 * determinista.
 *
 * REGLAS (heredadas del principio "la UI afirma, el backend tiene que comprobar")
 * -------------------------------------------------------------------------
 * 1. El veredicto del modelo NO es un hecho: se guarda CON su confianza, su
 *    modelo y su razon. Si la confianza no llega al umbral, el par SIGUE
 *    pending (no se inventa un cierre).
 * 2. Una relacion que el modelo no puede clasificar (salida invalida, error de
 *    transporte, confianza baja) NO se cierra: se reporta como no juzgada.
 * 3. Todo apply deja recibo con el detalle par por par: es reversible.
 * 4. El juez NO decide sobre relaciones de memoria entre SI MISMAS
 *    (auto-relaciones): solo pares de observaciones distintas.
 *
 * USO
 *   node --import tsx src/ops/engram-judge-semantic.ts                      # dry-run
 *   node --import tsx src/ops/engram-judge-semantic.ts --apply --limit 100
 *   npm run engram:judge:semantic -- --apply --limit 200 --model qwen3-14b-32k
 *
 * OPCIONES
 *   --apply             escribe los veredictos (sin esto: dry-run)
 *   --limit N           maximo de pares a juzgar en esta corrida (default 50)
 *   --model M           modelo local de ollama (default qwen3-14b-32k)
 *   --concurrency N     llamadas simultaneas (default 2)
 *   --min-confidence F  confianza minima para cerrar (default 0.75)
 *   --timeout S         timeout por llamada, segundos (default 120)
 *   --max-content N     caracteres de contenido por observacion (default 900)
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DB_PATH = join(homedir(), '.engram', 'engram.db');
const OLLAMA_URL = process.env.GV_OLLAMA_URL ?? 'http://127.0.0.1:11434';

const RELATIONS = [
  'related',
  'compatible',
  'scoped',
  'supersedes',
  'conflicts_with',
  'not_conflict',
] as const;
type Relation = (typeof RELATIONS)[number];

interface PairRow {
  source_id: string;
  target_id: string;
  title_a: string;
  title_b: string;
  content_a: string;
  content_b: string;
  type_a: string;
  type_b: string;
}

export interface Verdict {
  relation: Relation;
  confidence: number;
  reason: string;
}

export interface JudgedPair {
  sourceId: string;
  targetId: string;
  titleA: string;
  titleB: string;
  verdict: Verdict | null;
  error?: string;
  elapsedMs: number;
}

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) {
    return process.argv[index + 1];
  }
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (inline) return inline.slice(`--${name}=`.length);
  return fallback;
}

const APPLY = process.argv.includes('--apply');
const LIMIT = Number(arg('limit', '50'));
const MODEL = arg('model', 'qwen3-14b-32k');
const CONCURRENCY = Math.max(1, Number(arg('concurrency', '2')));
const MIN_CONFIDENCE = Number(arg('min-confidence', '0.75'));
const TIMEOUT_MS = Number(arg('timeout', '120')) * 1000;
const MAX_CONTENT = Number(arg('max-content', '900'));

/** Recorta el contenido para que el juez vea lo que importa sin llenar el contexto. */
export function trimContent(text: string | null, max: number): string {
  const clean = (text ?? '').replace(/\r/g, '').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max)}\n[…truncado: ${clean.length - max} caracteres más]`;
}

/**
 * Parsea el veredicto del modelo. Anything que no sea un veredicto valido
 * devuelve null: un par no juzgado SIGUE pending.
 */
export function parseVerdict(raw: string): Verdict | null {
  const cleaned = raw
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as { relation?: unknown; confidence?: unknown; reason?: unknown };
  const relation = String(obj.relation ?? '')
    .trim()
    .toLowerCase() as Relation;
  if (!RELATIONS.includes(relation)) return null;
  // La confianza es parte del veredicto, no un default: sin ella no se sabe
  // cuanto pesar el juicio, y un cierre sin confianza seria inventar.
  if (typeof obj.confidence !== 'number' || !Number.isFinite(obj.confidence)) return null;
  const confidence = Math.max(0, Math.min(1, obj.confidence));
  const reason = typeof obj.reason === 'string' ? obj.reason.slice(0, 200) : '';
  if (!reason) return null;
  return { relation, confidence, reason };
}

export function buildPrompt(pair: PairRow): string {
  return [
    'Sos un juez de relaciones entre dos memorias de un proyecto de software.',
    'Decide COMO se relacionan las dos observaciones. No las resumas: clasificalas.',
    '',
    'Relaciones posibles (una sola):',
    '  not_conflict     = no se contradicen ni se solapan (mismo tema, distinto hecho/fecha)',
    '  related          = mismo tema, se complementan',
    '  compatible       = consistentes entre si, se refuerzan',
    '  scoped           = una es una version mas especifica o restringida de la otra',
    '  supersedes       = la segunda reemplaza a la primera (la primera quedo obsoleta)',
    '  conflicts_with   = se contradicen en un dato concreto',
    '',
    'Observacion A:',
    `[${pair.type_a}] ${pair.title_a}`,
    trimContent(pair.content_a, MAX_CONTENT),
    '',
    'Observacion B:',
    `[${pair.type_b}] ${pair.title_b}`,
    trimContent(pair.content_b, MAX_CONTENT),
    '',
    'Responde SOLO un JSON, sin texto alrededor:',
    '{"relation":"<una de las seis>","confidence":<0..1>,"reason":"<max 180 chars, en espanol, el dato concreto que decide>"}',
  ].join('\n');
}

/** Una llamada al modelo local. Devuelve el texto crudo (o un error). */
async function callModel(prompt: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        think: false,
        format: 'json',
        options: { temperature: 0, num_ctx: 8192, num_predict: 220 },
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return `__ERROR__ HTTP ${res.status}`;
    const body = (await res.json()) as { message?: { content?: string } };
    return body.message?.content ?? '__ERROR__ respuesta sin contenido';
  } catch (err) {
    return `__ERROR__ ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    clearTimeout(timer);
  }
}

async function judgePair(pair: PairRow): Promise<JudgedPair> {
  const started = Date.now();
  const raw = await callModel(buildPrompt(pair));
  const elapsedMs = Date.now() - started;
  const base = {
    sourceId: pair.source_id,
    targetId: pair.target_id,
    titleA: pair.title_a,
    titleB: pair.title_b,
    elapsedMs,
  };
  if (raw.startsWith('__ERROR__')) return { ...base, verdict: null, error: raw.slice(9) };
  const verdict = parseVerdict(raw);
  if (!verdict) return { ...base, verdict: null, error: 'veredicto no parseable' };
  return { ...base, verdict };
}

async function main(): Promise<void> {
  if (!existsSync(DB_PATH)) {
    console.error(`no encuentro el store de Engram: ${DB_PATH}`);
    process.exit(2);
  }

  const db = new DatabaseSync(DB_PATH);
  const pending = db
    .prepare(`SELECT COUNT(*) AS n FROM memory_relations WHERE judgment_status = 'pending'`)
    .get() as { n: number };

  const pairs = db
    .prepare(
      `SELECT r.source_id, r.target_id,
              a.title AS title_a, b.title AS title_b,
              a.content AS content_a, b.content AS content_b,
              a.type AS type_a, b.type AS type_b
       FROM memory_relations r
       JOIN observations a ON a.sync_id = r.source_id
       JOIN observations b ON b.sync_id = r.target_id
       WHERE r.judgment_status = 'pending'
       ORDER BY r.id
       LIMIT ?`,
    )
    .all(LIMIT) as unknown as PairRow[];

  console.log(
    `Engram — juez semantico local${APPLY ? ' (APLICANDO)' : ' (dry-run)'} · modelo ${MODEL}`,
  );
  console.log(`  relaciones pending totales: ${pending.n}`);
  console.log(`  pares en esta corrida: ${pairs.length} (limite ${LIMIT})`);
  if (pairs.length === 0) {
    db.close();
    return;
  }

  // Probe de disponibilidad: si el modelo no responde, NO se intenta 50 veces.
  const probe = await judgePair(pairs[0]);
  if (!probe.verdict) {
    console.error(`  el modelo local no responde: ${probe.error}`);
    console.error(`  verificar con: ollama list  /  npm run models:infer`);
    db.close();
    process.exit(2);
  }
  console.log(
    `  probe OK en ${probe.elapsedMs} ms · veredicto de ejemplo: ${probe.verdict.relation} (${probe.verdict.confidence})`,
  );

  const results: JudgedPair[] = [probe];
  const queue = pairs.slice(1);
  const worker = async (): Promise<void> => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      results.push(await judgePair(next));
      if (results.length % 10 === 0) {
        console.log(`  ... ${results.length}/${pairs.length}_pairs juzgados`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length || 1) }, worker));

  const closable = results.filter(
    (r): r is JudgedPair & { verdict: Verdict } =>
      !!r.verdict && r.verdict.confidence >= MIN_CONFIDENCE,
  );
  const lowConfidence = results.filter((r) => r.verdict && r.verdict.confidence < MIN_CONFIDENCE);
  const failed = results.filter((r) => !r.verdict);

  const breakdown: Record<string, number> = {};
  for (const r of closable) {
    breakdown[r.verdict.relation] = (breakdown[r.verdict.relation] ?? 0) + 1;
  }

  console.log(`  con veredicto utilizable (>= ${MIN_CONFIDENCE}): ${closable.length}`);
  console.log(`  confianza insuficiente (siguen pending): ${lowConfidence.length}`);
  console.log(`  no juzgados (error o salida invalida): ${failed.length}`);
  console.log(
    `  reparto: ${
      Object.entries(breakdown)
        .map(([k, v]) => `${k}=${v}`)
        .join(' · ') || '—'
    }`,
  );

  let receipt: string | null = null;
  if (APPLY && closable.length > 0) {
    const now = new Date().toISOString();
    const stamp = now.replace(/[:.]/g, '-');
    const dir = join(process.cwd(), '.session', 'snapshots', 'engram-judge-semantic', stamp);
    mkdirSync(dir, { recursive: true });

    const update = db.prepare(
      `UPDATE memory_relations
       SET relation = ?,
           judgment_status = ?,
           confidence = ?,
           reason = ?,
           marked_by_actor = ?,
           marked_by_kind = 'tool',
           marked_by_model = ?,
           updated_at = ?
       WHERE source_id = ? AND target_id = ? AND judgment_status = 'pending'`,
    );
    let closed = 0;
    db.exec('BEGIN');
    try {
      for (const pair of closable) {
        const verdict = pair.verdict;
        // Misma convencion que el store: `not_conflict` deja la relation en
        // 'pending' y se marca por `judgment_status` (asi lo escribio el juez
        // determinista y el store ya lo tiene asi).
        const relation = verdict.relation === 'not_conflict' ? 'pending' : verdict.relation;
        const status = verdict.relation === 'not_conflict' ? 'not_conflict' : 'judged';
        const reason = `${verdict.reason} [modelo:${MODEL} conf:${verdict.confidence}]`;
        const res = update.run(
          relation,
          status,
          verdict.confidence,
          reason,
          `local-model:${MODEL}`,
          MODEL,
          now,
          pair.sourceId,
          pair.targetId,
        );
        closed += Number(res.changes ?? 0);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      console.error(`  ERROR al escribir (rollback): ${String(error)}`);
      db.close();
      process.exit(1);
    }

    const receiptPath = join(dir, 'judged-semantic.json');
    writeFileSync(
      receiptPath,
      `${JSON.stringify(
        {
          at: now,
          model: MODEL,
          minConfidence: MIN_CONFIDENCE,
          closed,
          breakdown,
          notJudged: failed.map((r) => ({ pair: [r.sourceId, r.targetId], error: r.error })),
          lowConfidence: lowConfidence.map((r) => ({
            pair: [r.sourceId, r.targetId],
            confidence: r.verdict?.confidence,
            reason: r.verdict?.reason,
          })),
          pairs: results,
        },
        null,
        2,
      )}\n`,
      'utf-8',
    );
    receipt = receiptPath;
    console.log(`  cerradas: ${closed}`);
    console.log(`  recibo: ${receipt}`);
  } else if (!APPLY) {
    console.log('  aplicar con: --apply');
  }

  const after = db
    .prepare(`SELECT COUNT(*) AS n FROM memory_relations WHERE judgment_status = 'pending'`)
    .get() as { n: number };
  console.log(`  pending ahora: ${after.n}`);
  db.close();
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((err) => {
    console.error(String(err));
    process.exit(1);
  });
}
