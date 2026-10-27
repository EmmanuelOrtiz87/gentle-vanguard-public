/**
 * harness-judge.ts — Medicion OBJETIVA del efecto de una edicion del harness.
 *
 * Por que existe: la comparacion ciega dice "el selector prefiero esta
 * candidata", que es una opinion. Lo que el metodo de Harness^2 quiere saber
 * es si la EDICION del harness produjo una diferencia de COMPORTAMIENTO
 * medible. Para eso hace falta una verdad de referencia: la regla que se le
 * dio a cada variante.
 *
 * La disciplina es la misma del metodo: **el juez corre DESPUES de que la
 * seleccion se cierra**. El veredicto del juez no vuelve a entrar al pool, no
 * cambia la eleccion y no se guarda como evidencia para otra tarea. Si el
 * juez participara de la seleccion, el bucle optimizaria contra el juez.
 *
 * Los checks son declarativos (frases que el artefacto debe o no debe
 * contener) para que el juez no dependa de un modelo: es una medicion
 * reproducible, no otra opinion.
 */

/** Checks aplicables a un tipo de variante. */
export interface JudgeChecks {
  /** El artefacto DEBE contener estas frases (case-insensitive). */
  mustContain?: string[];
  /** El artefacto NO debe contener estas frases (case-insensitive). */
  mustNotContain?: string[];
  /**
   * Al menos uno de estos patrones (regex) debe aparecer en el artefacto.
   *
   * Se usa cuando la forma exacta importa poco: un modelo escribe "R = 4k"
   * o "R=4k" segun el dia, y un check de substring loose haria fallar la
   * medicion por formato en vez de por comportamiento.
   */
  mustMatchAny?: string[];
}

/** Checks por tipo de variante. */
export interface JudgeSpec {
  /** Variante invariante (etiqueta `inv-*`). */
  invariante?: JudgeChecks;
  /** Variante de dominio (etiqueta `dom-*`). */
  dominio?: JudgeChecks;
  /** Variante base (etiqueta `base-*`): la referencia sin reglas nuevas. */
  base?: JudgeChecks;
  /**
   * Composiciones (etiqueta `agg-*`).
   *
   * Por defecto se evaluan con la union de invariante y dominio: una
   * composicion deberia cumplir las dos reglas.
   */
  composicion?: JudgeChecks;
}

/** Veredicto por variante. */
export interface JudgeVerdict {
  /** Etiqueta de la variante evaluada. */
  label: string;
  /** Tipo de variante. */
  kind: VariantKind;
  /** Checks que se satisfied. */
  passed: string[];
  /** Checks que fallaron, con el detalle. */
  failed: string[];
  /** true si no fallo ningun check. */
  ok: boolean;
}

/** Tipo de variante, deducido de la etiqueta. */
export type VariantKind = 'base' | 'invariante' | 'dominio' | 'composicion';

/** De que tipo de variante es una etiqueta (`inv-2` -> invariante). */
export function variantKind(label: string): VariantKind {
  if (label.startsWith('base-')) return 'base';
  if (label.startsWith('inv-')) return 'invariante';
  if (label.startsWith('dom-')) return 'dominio';
  if (label.startsWith('agg-')) return 'composicion';
  return 'base';
}

/** Checks que aplican a un tipo de variante. */
export function checksFor(spec: JudgeSpec, kind: VariantKind): JudgeChecks {
  if (kind === 'composicion' && spec.composicion) return spec.composicion;
  if (kind === 'invariante') return spec.invariante ?? {};
  if (kind === 'dominio') return spec.dominio ?? {};
  if (kind === 'base') return spec.base ?? {};
  // La composicion hereda la union de invariante y dominio.
  return {
    mustContain: [...(spec.invariante?.mustContain ?? []), ...(spec.dominio?.mustContain ?? [])],
    mustNotContain: [
      ...(spec.invariante?.mustNotContain ?? []),
      ...(spec.dominio?.mustNotContain ?? []),
    ],
    mustMatchAny: [
      ...(spec.invariante?.mustMatchAny ?? []),
      ...(spec.dominio?.mustMatchAny ?? []),
    ],
  };
}

/** Lo que el juez necesita de una corrida: la etiqueta y el artefacto. */
export interface JudgeInput {
  label: string;
  render: string;
}

/**
 * Evalua cada variante contra los checks de su tipo.
 *
 * No lanza: una variante sin entrega falla sus checks (no cumple nada) y se
 * reporta con el motivo. Un juez que tira la corrida entera es un juez que
 * hace perder la evidencia.
 *
 * `taskText` (opcional) es el texto de la tarea. Para la BASE, un token de
 * `mustNotContain` que la tarea YA menciona es un DATO que la base tiene que
 * reportar con fidelidad, no una fuga de regla: medido con un modelo capaz
 * (bitacora §4.18), la base declara `R=4k`/`P=3k` porque los datos embebidos
 * de la tarea los traen, y fallar ese check confunde fidelidad con fuga.
 */
export function judgeCompliance(
  inputs: readonly JudgeInput[],
  spec: JudgeSpec,
  taskText?: string
): JudgeVerdict[] {
  const task = taskText?.toLowerCase();
  return inputs.map((input) => {
    const kind = variantKind(input.label);
    const checks = checksFor(spec, kind);
    const text = input.render.toLowerCase();
    const passed: string[] = [];
    const failed: string[] = [];

    for (const phrase of checks.mustContain ?? []) {
      const found = text.includes(phrase.toLowerCase());
      if (found) passed.push(`contiene "${phrase}"`);
      else failed.push(`falta "${phrase}"`);
    }
    for (const phrase of checks.mustNotContain ?? []) {
      // Dato de la tarea, no fuga: la base no puede "no contener" lo que la
      // propia tarea le pide informar.
      if (kind === 'base' && task?.includes(phrase.toLowerCase())) {
        passed.push(`no aplica: "${phrase}" es dato de la tarea`);
        continue;
      }
      const found = text.includes(phrase.toLowerCase());
      if (found) failed.push(`no deberia contener "${phrase}"`);
      else passed.push(`no contiene "${phrase}"`);
    }
    {
      // `mustMatchAny` es un grupo: basta con que UNO de los patrones
      // aparezca. Exigir todos convierte "cualquiera de estos" en "todos
      // estos" y reporta como incumplimiento lo que es un acierto.
      const group = checks.mustMatchAny ?? [];
      if (group.length > 0) {
        const matched = group.filter((p) => new RegExp(p, 'i').test(input.render));
        if (matched.length > 0) {
          passed.push(`matchea ${matched.map((p) => `/${p}/`).join(' o ')}`);
        } else {
          failed.push(`no matchea ninguno de [${group.join(', ')}]`);
        }
      }
    }

    return { label: input.label, kind, passed, failed, ok: failed.length === 0 };
  });
}

/** Resumen del juez: cuantas variantes cumplen y cuantas no, por tipo. */
export function summarizeJudge(verdicts: readonly JudgeVerdict[]): {
  total: number;
  ok: number;
  porTipo: Record<string, { ok: number; total: number }>;
} {
  const porTipo: Record<string, { ok: number; total: number }> = {};
  let ok = 0;
  for (const verdict of verdicts) {
    const bucket = porTipo[verdict.kind] ?? { ok: 0, total: 0 };
    bucket.total += 1;
    if (verdict.ok) {
      bucket.ok += 1;
      ok += 1;
    }
    porTipo[verdict.kind] = bucket;
  }
  return { total: verdicts.length, ok, porTipo };
}
