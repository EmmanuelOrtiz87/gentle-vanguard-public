/**
 * blind-selection.ts — Seleccion ciega, anonimizada y SIN score.
 *
 * Portado de harness2/core/selection.py (google-research/harness2, Apache-2.0).
 *
 * Este es el corazon del metodo de Harness^2. Resuelve la objecion circular de
 * todo sistema de auto-mejora de agentes: "¿como sabes que tu cambio es
 * mejor?". La respuesta no es comparar scores: es COMPARAR COMPORTAMIENTO,
 * a ciegas, y que el judge corra DESPUES de que la seleccion cierre.
 *
 * Reglas que este modulo hace cumplir:
 *
 *  1. El pool son EXACTAMENTE las k finales. Las corridas base quedan fuera,
 *     asi que no hay abstención por construccion.
 *  2. Las no-respuestas se descartan, REGISTRANDO LA CAUSA de cada descarte.
 *     Un descarte silencioso es un sesgo silencioso.
 *  3. Los identificadores son ESTABLES y SEMILLAADOS por
 *     `sha1(task_id|k|mode)`: la misma corrida produce la misma permutacion
 *     en cualquier maquina, y la comparacion es reproducible.
 *  4. Se escribe UN archivo por candidata, sin recortar, con un header que lo
 *     declara. Sin recortar porque el recorte introduce sesgo.
 *  5. El selector elige EXACTAMENTE una. Si falla, hay fallback: una base
 *     entregada, o la primera final. Nunca lanza.
 *  6. Antes de que el selector vea nada, se verifica que ningun veredicto de
 *     evaluador se filtre en el contexto. Si un veredicto entra, el selector
 *     deja de comparar comportamientos y pasa a optimizar la metrica.
 *     El chequeo corre sobre DOS caminos: los arboles de harness y los
 *     ARTEFACTOS que la candidata entrega (render + trayectoria). Una
 *     candidata que escribe `pass_rate: 0.97` contamina por el texto.
 *  7. Lo que se escribe va redactado: secretos y rutas de usuario no se
 *     persisten en el pool (rules/AI-NORMATIVES.md §6).
 *
 * La anonimizacion no es decorativa: sin IDs estables, el modelo prefiere por
 * posicion o por orden de presentacion, y la "comparacion" mide el sesgo del
 * modelo, no la calidad de las candidatas.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  findPromptBannedTerms,
  findVerdictHits,
  findVerdictMarkers,
  type HarnessTree,
} from '../core/harness-surface.js';
import { isExempt, type VerdictExemptions } from '../core/harness-allowlist.js';
import { scrubArtifact } from './artifact-scrubber.js';

/** Modo del bucle: entra en la semilla de la permutacion. */
export type SelectionMode = 'agg' | 'seq';

/** Una candidata del pool de seleccion. */
export interface SelectionCandidate {
  /** Identificador de la corrida (ej. `agg-1`). */
  label: string;
  /** La corrida termino sin error. */
  ok: boolean;
  /** La corrida entrego un artefacto. */
  delivered: boolean;
  /** Texto del artefacto entregable. */
  render: string;
  /** Trayectoria completa de la corrida. */
  rollout: string;
}

/** Causa por la que una candidata fue descartada. */
export type DropCause = 'not-ok' | 'not-delivered' | 'empty-render' | 'verdict-marker';

export interface DroppedCandidate {
  label: string;
  cause: DropCause;
}

/** Una candidata anonima, lista para que el selector la lea. */
export interface AnonymizedCandidate {
  /** Identificador anonimo (`A`, `B`, `C`...). */
  id: string;
  /** Etiqueta original (NO se expone al selector). */
  label: string;
  /** Ruta del archivo escrito para el selector. */
  path: string;
  /** Contenido completo, sin recortar. */
  content: string;
  /**
   * Solo el ARTEFACTO entregado (sin la trayectoria).
   *
   * Es lo que se compara: la trayectoria es ruido de transporte y, ademas,
   * infla el contexto del selector. El archivo del pool sigue.teniendo todo
   * para la auditoria.
   */
  render: string;
}

export interface SelectionPool {
  /** Candidatas que pasan el filtro, anonimizadas. */
  candidates: AnonymizedCandidate[];
  /** Candidatas descartadas, con la causa de cada descarte. */
  dropped: DroppedCandidate[];
  /** Etiqueta original -> identificador anonimo. */
  idByLabel: Map<string, string>;
  /** Semilla usada para la permutacion. */
  seed: string;
  /**
   * Fugas de veredicto detectadas en los artefactos que iba a leer el selector.
   *
   * No es cosmetico: si hay una fuga, hay un camino de lectura que hay que
   * encontrar. Se reportan SIEMPRE, aunque la candidata contaminada se haya
   * descartado.
   */
  violations: string[];
  /** Palabras de medicion encontradas en los artefactos (aviso, no bloqueo). */
  warnings: string[];
}

export interface SelectionOptions {
  taskId: string;
  k: number;
  mode: SelectionMode;
  /** Directorio donde se escriben los archivos de la comparacion. */
  outDir: string;
  /** Arboles de harness a proteger del tripwire (opcional). */
  harnessTrees?: Record<string, HarnessTree>;
}

export interface SelectionResult {
  /** Etiqueta original de la elegida. */
  selectedLabel: string | null;
  /** Identificador anonimo de la elegida. */
  selectedId: string | null;
  /** Razon declarada por el selector. */
  why: string | null;
  /** Como se resolvio: 'selector' | 'fallback-base' | 'fallback-first'. */
  via: 'selector' | 'fallback-base' | 'fallback-first';
  /** Respuesta CRUDA del selector (para auditar por que no se pudo parsear). */
  raw: string | null;
  /** Pool completo, para auditoria. */
  pool: SelectionPool;
}

/* ── Semilla estable ── */

/**
 * Semilla determinista: `sha1(task_id|k|mode)`.
 *
 * La misma tarea, el mismo k y el mismo modo producen SIEMPRE la misma
 * permutacion. Eso hace que la comparacion sea reproducible y que dos
 * corridas del bucle puedan contrastarse entre si.
 */
export function selectionSeed(taskId: string, k: number, mode: SelectionMode): string {
  return createHash('sha1').update(`${taskId}|${k}|${mode}`).digest('hex');
}

/**
 * PRNG determinista a partir de la semilla (xorshift de 32 bits).
 *
 * No se usa Math.random: la permutacion tiene que ser reproducible.
 */
function seededRandom(seedHex: string): () => number {
  let state = parseInt(seedHex.slice(0, 8), 16) || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

/**
 * Asigna identificadores anonimos a las candidatas.
 *
 * Orden canonico + barajado sembrado: la asignacion no depende del orden de
 * llegada, y dos corridas del mismo bucle coinciden.
 */
export function assignAnonymizedIds(
  labels: readonly string[],
  seed: string
): Map<string, string> {
  const sorted = [...labels].sort();
  const random = seededRandom(seed);
  // Fisher-Yates con PRNG sembrado.
  for (let i = sorted.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = sorted[i] as string;
    sorted[i] = sorted[j] as string;
    sorted[j] = tmp;
  }
  const map = new Map<string, string>();
  sorted.forEach((label, index) => {
    map.set(label, String.fromCharCode(65 + index));
  });
  return map;
}

/* ── Filtro de no-respuestas ── */

/**
 * Descarta las candidatas que no son respuestas, con la causa del descarte.
 *
 * Descartar sin registrar la causa convierte un sesgo en un misterio.
 */
export function partitionCandidates(candidates: readonly SelectionCandidate[]): {
  kept: SelectionCandidate[];
  dropped: DroppedCandidate[];
} {
  const kept: SelectionCandidate[] = [];
  const dropped: DroppedCandidate[] = [];
  for (const candidate of candidates) {
    if (!candidate.ok) {
      dropped.push({ label: candidate.label, cause: 'not-ok' });
    } else if (!candidate.delivered) {
      dropped.push({ label: candidate.label, cause: 'not-delivered' });
    } else if (!candidate.render.trim()) {
      dropped.push({ label: candidate.label, cause: 'empty-render' });
    } else {
      kept.push(candidate);
    }
  }
  return { kept, dropped };
}

/* ── Tripwire ── */

/**
 * Verifica que ningun veredicto de evaluador se filtre en el contexto de la
 * seleccion.
 *
 * Se corre ANTES de que el selector vea nada. Un veredicto filtrado no es un
 * falso positivo: significa que existe un camino de lectura que hay que
 * encontrar y cerrar.
 *
 * Aplica las MISMAS exenciones que el doctor (`config/harness-doctor-allowlist.json`),
 * por archivo y por marcador concreto. Dos oraculos para la misma regla
 * divergen: el doctor daba limpio y el bucle abortaba por los mismos tres
 * archivos de documentacion de `skill-creator`.
 */
export function assertSelectionClean(
  trees: Record<string, HarnessTree>,
  exemptions?: VerdictExemptions
): { exempted: string[] } {
  const hits: string[] = [];
  const exempted: string[] = [];
  for (const [name, tree] of Object.entries(trees)) {
    for (const hit of findVerdictHits(tree)) {
      const label = `${name}: ${hit.path}: marker ${hit.marker} en el ${hit.where.toUpperCase()}`;
      const exemption = isExempt(exemptions, hit.path, hit.marker);
      if (exemption) {
        exempted.push(`${label} — exencion: ${exemption.reason}`);
      } else {
        hits.push(label);
      }
    }
  }
  if (hits.length > 0) {
    throw new Error(
      `Fuga de veredicto de evaluador en el contexto de seleccion:\n  ${hits.join('\n  ')}\n` +
        'No es un falso positivo a ampliar: hay que encontrar el camino de lectura que lo produjo.'
    );
  }
  return { exempted };
}

/* ── Pool ── */

/**
 * Construye el pool de seleccion y escribe un archivo por candidata.
 *
 * El contenido NO se recorta: el recorte introduce sesgo. El header declara
 * que el archivo esta completo para que el selector no asuma lo contrario.
 *
 * Antes de escribir, cada candidata pasa por el TRIPWIRE DE ARTEFACTOS: si su
 * render o su trayectoria contienen un veredicto de evaluador, la candidata se
 * DESCARTA (con causa registrada) y la fuga se reporta. El tripwire sobre
 * arboles de harness no alcanza: una candidata que escribe `pass_rate: 0.97`
 * llega al selector por el camino del texto, no por el del archivo.
 *
 * Lo que se escribe va REDACTADO (secretos y rutas de usuario), porque el pool
 * se versiona en el artefacto de corrida y la trayectoria cruda del CLI puede
 * contener el token del proveedor o la ruta home de la maquina.
 */
export function buildSelectionPool(
  candidates: readonly SelectionCandidate[],
  options: SelectionOptions
): SelectionPool {
  const { kept, dropped } = partitionCandidates(candidates);
  const seed = selectionSeed(options.taskId, options.k, options.mode);
  const idByLabel = assignAnonymizedIds(
    kept.map((c) => c.label),
    seed
  );

  mkdirSync(options.outDir, { recursive: true });
  const pool: AnonymizedCandidate[] = [];
  const violations: string[] = [];
  const warnings: string[] = [];

  for (const candidate of kept) {
    const hits = [
      ...findVerdictMarkers(candidate.render, `${candidate.label}.render`),
      ...findVerdictMarkers(candidate.rollout, `${candidate.label}.rollout`),
    ];
    if (hits.length > 0) {
      dropped.push({ label: candidate.label, cause: 'verdict-marker' });
      violations.push(...hits);
      continue;
    }

    warnings.push(
      ...findPromptBannedTerms(candidate.render, `${candidate.label}.render`),
      ...findPromptBannedTerms(candidate.rollout, `${candidate.label}.rollout`)
    );

    const id = idByLabel.get(candidate.label) as string;
    const path = join(options.outDir, `${id}.md`);
    const render = scrubArtifact(candidate.render.trim());
    const rollout = scrubArtifact(candidate.rollout.trim());
    const content = [
      '<!-- CANDIDATA ANONIMA — ARCHIVO COMPLETO, NADA RECORTADO -->',
      `<!-- id: ${id} -->`,
      '',
      '## Artefacto entregado',
      '',
      render.text,
      '',
      '## Trayectoria',
      '',
      rollout.text,
      '',
    ].join('\n');
    writeFileSync(path, content, 'utf-8');
    pool.push({ id, label: candidate.label, path, content, render: render.text });
  }

  return { candidates: pool, dropped, idByLabel, seed, violations, warnings };
}

/* ── Lectura de la decision ── */

export interface ParsedSelection {
  choice: string;
  why: string;
}

/**
 * Parsea la respuesta del selector.
 *
 * Acepta el bloque ```` ```choice ```` con el identificador y un bloque
 * `<why>`. Devuelve null si la respuesta no es una eleccion valida: el
 * llamador aplica el fallback en vez de lanzar.
 *
 * Tolera las formas que un modelo produce de verdad: el bloque cercado, la
 * etiqueta `<choice>`, `choice: A`, y una linea con la sola letra. Ser
 * estricto aqui no protege el metodo: solo convierte una eleccion valida en
 * un fallback determinista, que es la eleccion sesgada por construccion.
 */
export function parseSelection(raw: string): ParsedSelection | null {
  const fenced = /```choice\s*([A-Za-z]+)\s*```/i.exec(raw);
  const tagged = /<choice>\s*([A-Za-z]+)\s*<\/choice>/i.exec(raw);
  const inline = /\bchoice\s*[:=]\s*([A-Za-z]+)\b/i.exec(raw);
  const solo = /^\s*([A-Z])\s*$/m.exec(raw);

  const choice = (fenced?.[1] ?? tagged?.[1] ?? inline?.[1] ?? solo?.[1] ?? '').trim();
  if (!choice || !/^[A-Za-z]+$/.test(choice)) return null;

  const whyMatch = /<why>([\s\S]*?)<\/why>/i.exec(raw);
  const whyFallback = /\bwhy\b\s*[:=]\s*([^\n]+)/i.exec(raw);
  const why = whyMatch
    ? (whyMatch[1] as string).trim()
    : whyFallback
      ? (whyFallback[1] as string).trim()
      : '';
  return { choice, why };
}

/* ── Seleccion ── */

/**
 * Ejecuta la seleccion ciega.
 *
 * `selector` recibe el pool y devuelve el texto crudo de su decision. Si
 * devuelve algo no parseable, se aplica el fallback: una base entregada, o la
 * primera final. NUNCA lanza: una seleccion fallida no puede abortar el
 * bucle entero.
 *
 * `fallbackBaseLabel` solo tiene efecto si esa base esta EN el pool. El pool
 * del bucle son las finales (regla 1: las base quedan fuera, no hay
 * abstension por construccion), asi que en la practica el fallback usable es
 * `fallback-first`. El parametro queda para los llamadores que si incluyen una
 * base en el pool.
 */
export function selectBlind(
  pool: SelectionPool,
  selector: (pool: SelectionPool) => string | Promise<string>,
  fallbackBaseLabel?: string
): Promise<SelectionResult> {
  return (async () => {
    if (pool.candidates.length === 0) {
      return {
        selectedLabel: null,
        selectedId: null,
        why: null,
        via: 'fallback-first',
        raw: null,
        pool,
      };
    }

    let parsed: ParsedSelection | null = null;
    let raw = '';
    try {
      raw = await selector(pool);
      parsed = parseSelection(raw);
    } catch {
      parsed = null;
    }

    if (parsed) {
      const found = pool.candidates.find((c) => c.id === parsed.choice);
      if (found) {
        return {
          selectedLabel: found.label,
          selectedId: found.id,
          why: parsed.why,
          via: 'selector',
          raw,
          pool,
        };
      }
    }

    // Fallback 1: una base entregada, si se indico y esta en el pool.
    if (fallbackBaseLabel) {
      const base = pool.candidates.find((c) => c.label === fallbackBaseLabel);
      if (base) {
        return {
          selectedLabel: base.label,
          selectedId: base.id,
          why: 'El selector no produjo una eleccion valida; se conserva la base entregada.',
          via: 'fallback-base',
          raw,
          pool,
        };
      }
    }

    // Fallback 2: la primera final, en orden canonico de etiqueta.
    const first = [...pool.candidates].sort((a, b) => a.label.localeCompare(b.label))[0];
    return {
      selectedLabel: first?.label ?? null,
      selectedId: first?.id ?? null,
      why: 'El selector no produjo una eleccion valida; se toma la primera final.',
      via: 'fallback-first',
      raw,
      pool,
    };
  })();
}
