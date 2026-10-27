/**
 * harness-semantic-judge.ts — Cumplimiento semantico de una regla.
 *
 * El juez por frases (`harness-judge.ts`) mide si el artefacto contiene el
 * token literal que la regla pedia. Es exacto y reproducible, pero es
 * binario: no ve el cumplimiento parcial ("declaro el estado del gate" sin
 * declarar el gate) ni el cumplimiento equivocado (la forma pedida pero con
 * el dato inventado).
 *
 * Este juez lo evalua un MODELO, mirando el artefacto y la regla que recibio
 * esa variante. La disciplina del metodo se mantiene entera:
 *
 *  - Corre DESPUES de que la seleccion se cierra. Su veredicto no vuelve al
 *    pool, no cambia la adopcion y no se guarda como evidencia de otra tarea.
 *  - El prompt del juez describe el TRABAJO y la regla; no nombra metricas.
 *  - Cada variante se evalua por separado (una llamada por variante): si el
 *    juez viera todas juntas, compararia en vez de verificar, y volveria a
 *    ser una preferencia.
 *
 * Es un juez MAS, no un sustituto: el de frases sigue siendo el que se puede
 * reproducir sin modelo (checks deterministas) y el semantico cubre lo que el
 * de frases no ve.
 *
 * **El rol de juez exige un modelo mas capaz que el rol de ejecutor.** Medido
 * con el mismo artefacto y la misma regla: el 14b respondio CUMPLE (correcto) y
 * el 7b NO CUMPLE (falso negativo). Un juez que se equivoca en la direccion
 * de "no cumple" bloquea reglas que funcionan: por eso el juez de frases (que
 * decide que se promueve) NO es el semantico, y el semantico es ADVISORIO.
 */

import type { Substrate } from '../core/harness-loop.js';

/** Una variante evaluada por el juez semantico. */
export interface SemanticInput {
  /** Etiqueta de la variante (`inv-1`, `dom-2`, `agg-1`...). */
  label: string;
  /** Tipo de variante. */
  kind: string;
  /** La regla que recibio (el texto inyectado). */
  rule: string;
  /** Lo que respondio. */
  artifact: string;
}

/** Veredicto del juez semantico sobre una variante. */
export interface SemanticVerdict {
  label: string;
  kind: string;
  /** true si el modelo considera que la variante cumple la regla. */
  complies: boolean;
  /** Por que (una frase). */
  why: string;
  /** Si el juez no pudo responder, el motivo. */
  error?: string;
}

export interface SemanticJudgeOptions {
  /** Substrate que hace las consultas (el mismo del bucle). */
  substrate: Substrate;
  /** Modelo (el substrate lo decide). */
  variantNamePrefix?: string;
  /** Timeout por consulta. */
  timeoutMs?: number;
}

/**
 * Prompt del juez semantico.
 *
 * Le da la REGLA y el ARTEFACTO, y le pide un veredicto. No menciona scores,
 * benchmarks ni como se califica el trabajo: verifica el cumplimiento de la
 * regla que se le dio a esa variante.
 */
export function semanticJudgePrompt(input: SemanticInput): string {
  return [
    'Verificas si un entregable CUMPLE una regla que el agente recibio.',
    '',
    '## La regla que recibio',
    '',
    input.rule,
    '',
    '## Lo que respondio',
    '',
    input.artifact,
    '',
    '## Que contestas',
    '',
    'Responde EXACTAMENTE con este formato y nada mas:',
    '',
    '```veredicto',
    'CUMPLE',
    '```',
    '<why>una frase: que pide la regla y si el entregable lo hace</why>',
    '',
    'Escribí CUMPLE solo si el entregable hace lo que la regla pide de verdad.',
    'Si lo hace a medias, o lo hace con datos que no estan, contestá NO CUMPLE.',
  ].join('\n');
}

/**
 * Parsea la respuesta del juez semantico.
 *
 * Acepta las formas que un modelo produce: el bloque cercado, la linea suelta
 * o la forma con "NO CUMPLE" / "NO CUMPLE" escrito.
 */
export function parseSemanticVerdict(raw: string): { complies: boolean; why: string } {
  const text = raw.toUpperCase();
  const cumple = /CUMPLE/.test(text) && !/NO\s+CUMPLE/.test(text);
  const whyMatch = /<why>([\s\S]*?)<\/why>/i.exec(raw);
  const why = whyMatch ? (whyMatch[1] as string).trim() : raw.trim().slice(0, 200);
  return { complies: cumple, why };
}

/**
 * Crea el juez semantico.
 *
 * Una consulta por variante: cada una se verifica sola, sin ver a las demas.
 */
export function createSemanticJudge(
  options: SemanticJudgeOptions
): (inputs: readonly SemanticInput[]) => Promise<SemanticVerdict[]> {
  const prefix = options.variantNamePrefix ?? 'semantic-judge';
  return async (inputs) => {
    const verdicts: SemanticVerdict[] = [];
    for (const input of inputs) {
      const result = await options.substrate.run({
        variantName: `${prefix}-${input.label}`,
        systemPrompt: semanticJudgePrompt(input),
        task: 'Devolve el veredicto en el formato pedido.',
        workDir: process.cwd(),
        timeoutMs: options.timeoutMs ?? 120_000,
        attributedSessionId: `sess-${prefix}-${input.label}`,
      });
      if (!result.render.trim()) {
        verdicts.push({
          label: input.label,
          kind: input.kind,
          complies: false,
          why: 'el juez no devolvio veredicto',
          error: result.error ?? 'respuesta vacia',
        });
        continue;
      }
      const parsed = parseSemanticVerdict(result.render);
      verdicts.push({
        label: input.label,
        kind: input.kind,
        complies: parsed.complies,
        why: parsed.why,
      });
    }
    return verdicts;
  };
}
