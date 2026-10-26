/**
 * harness-proposer.ts — El proponente automatico del harness.
 *
 * En Harness^2 el proposer EDITA el harness in situ y luego la candidata se
 * ejecuta con ese harness. En el puerto de GV, las propuestas venian del
 * exterior (un directorio), con lo que el paso PROPOSE quedaba manual: el
 * bucle media el efecto de una edicion que escribia un humano.
 *
 * Este modulo cierra el ciclo: el mismo substrate que ejecuta las variantes
 * propone la edicion, la edicion se aplica al arbol del harness y se mide su
 * efecto con el mismo protocolo.
 *
 * Dos restricciones que el proposer hereda del metodo:
 *
 *  1. **La propuesta describe el TRABAJO, nunca su medicion.** El prompt no
 *     nombra scores, benchmarks ni judges: el proposer no puede optimizar
 *     contra una metrica que no ve (y no hay ninguna).
 *  2. **La propuesta tiene que ser OPERATIVA.** Una regla que dice "declara
 *     el estado del gate" no es medible; una que dice "escribi la linea
 *     `npm run harness:doctor:strict`" si. El prompt lo pide explicitamente,
 *     porque se midio que sin eso la edicion no mueve el comportamiento.
 */

import type { Substrate } from '../core/harness-loop.js';

/** Tipo de edicion propuesta. */
export type ProposalKind = 'invariant' | 'domain';

/** Una edicion propuesta del harness. */
export interface ProposedEdit {
  /** Path relativo dentro de la superficie (ej. `rules/HARNESS-EVOLUTION.md`). */
  path: string;
  /** Contenido COMPLETO del archivo propuesto. */
  content: string;
  /** Por que se propone (la rationale del proposer). */
  rationale: string;
  /** Que el proposer cambio respecto de la base, para el diff. */
  edits: Record<string, string>;
}

export interface ProposerOptions {
  /** Substrate que hace la propuesta (mismo que ejecuta las variantes). */
  substrate: Substrate;
  /** Dominio de trabajo. */
  domain: string;
  /** Tipo de edicion: transversal o del dominio. */
  kind: ProposalKind;
  /** Paths de la superficie donde la propuesta puede escribir. */
  allowedPaths?: readonly string[];
  /** Archivos de la superficie que el proposer puede leer como contexto. */
  context?: Record<string, string>;
}

/**
 * Reduce la tarea a su INTENCION, sin sus datos.
 *
 * Medido: si el proposer ve los datos de la tarea, los COPIA y propone el
 * informe en vez de la regla (con el 7b y con el 14b). Una regla que lleva
 * los datos metidos es una respuesta, no una instruccion: no generaliza y no
 * sobrevive a otra tarea.
 *
 * Por eso al proposer se le da el encabezado de la tarea (que dice que hay
 * que hacer) y nunca el bloque de datos (que dice que escribir).
 */
export function taskIntent(task: string): string {
  const marker = /\n\s*(DATOS|DATA|##\s*DATOS)/i.exec(task);
  const head = marker ? task.slice(0, marker.index) : task;
  const cleaned = head
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 12)
    .join('\n');
  return cleaned.length > 0 ? cleaned : task.slice(0, 400);
}

/**
 * Prompt del proposer.
 *
 * Describe el trabajo y la forma del artefacto; no menciona ninguna metrica
 * de evaluacion (marcadores prohibidos por el tripwire).
 */
export function proposerPrompt(options: {
  domain: string;
  kind: ProposalKind;
  task: string;
  context: Record<string, string>;
}): string {
  const kindLine =
    options.kind === 'invariant'
      ? 'Es una regla TRANSVERSAL: aplica a cualquier tarea del stack.'
      : 'Es una regla del DOMINIO: aplica a las tareas de este dominio.';
  const context = Object.entries(options.context)
    .map(([rel, content]) => `### ${rel}\n\n${content.slice(0, 4000)}`)
    .join('\n\n');

  return [
    `Propones una edicion del harness de un stack de agentes (dominio: ${options.domain}).`,
    '',
    kindLine,
    '',
    '## Que clase de tarea va a ejecutar el agente',
    '',
    taskIntent(options.task),
    '',
    '## Contexto del harness (extracto)',
    '',
    context || '(sin contexto)',
    '',
    '## Que tenes que devolver',
    '',
    'Un archivo de regla para el harness, en JSON:',
    '',
    '```json',
    '{',
    '  "path": "rules/<TU-REGLA>.md",',
    '  "rationale": "por que esta regla cambia el comportamiento en esta clase de tarea",',
    '  "content": "el contenido completo del archivo markdown"',
    '}',
    '```',
    '',
    'Reglas para la regla:',
    '',
    '- **Una regla es una INSTRUCCION para el agente, no la respuesta.** La regla',
    '  NO puede contener datos concretos de la tarea: describe la FORMA de',
    '  trabajar, no el resultado. Si copiaste un dato, no es una regla.',
    '- **Operativa**: tiene que decir el token LITERAL que el agente va a escribir.',
    '  "Declara el estado del gate" no sirve; "escribi la linea `npm run harness:doctor:strict`" si.',
    '- **Una sola regla**: no empaquetes varias. Si el agente tiene que decidir entre dos, no cumple ninguna.',
    '- **Autocontenida**: no puede depender de que otra regla la explique. Si para',
    '  entender tu regla hay que saber que dice otra, no va a funcionar: repeti',
    '  aunque parezca redundante. Medido: cuando la regla general ("citar el',
    '  nombre de la herramienta no alcanza") estaba en otro archivo, la regla',
    '  especifica que dependia de ella no se cumplia.',
    '- **Sin metrica**: la regla describe el trabajo, no como se califica. No menciones',
    '  ninguna herramienta de evaluacion ni el nombre de sus salidas.',
    '- **Markdown plano**, sin frontmatter.',
    '',
    'Ejemplo INVALIDO (contiene datos: es la respuesta):',
    '',
    '```markdown',
    '# Informe de estado',
    '- Verificaciones: harness-doctor 0 errores, 35 tests 20/20',
    '```',
    '',
    'Ejemplo VALIDO (es la instruccion, sin datos):',
    '',
    '```markdown',
    '# Informes de estado',
    '- Todo informe incluye la linea de comando `npm run harness:doctor:strict`.',
    '- Si un dato no viene de un comando, no lo declares verificado.',
    '```',
  ].join('\n');
}

/**
 * Extrae el JSON de la respuesta del proposer.
 *
 * Tolera que el modelo lo envuelva en texto o en un bloque cercado: un
 * proposer que devuelve algo casi-JSON es un proposer que no propondria nada.
 */
export function parseProposal(raw: string): ProposedEdit | null {
  const fenced = /```json\s*([\s\S]*?)```/i.exec(raw);
  const candidate = fenced?.[1] ?? raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as {
      path?: string;
      content?: string;
      rationale?: string;
    };
    const path = (parsed.path ?? '').trim();
    const content = (parsed.content ?? '').trim();
    if (!path || !content) return null;
    return {
      path: path.replace(/\\/g, '/').replace(/^\/+/, ''),
      content,
      rationale: (parsed.rationale ?? '').trim(),
      edits: { [path.replace(/\\/g, '/').replace(/^\/+/, '')]: content },
    };
  } catch {
    return null;
  }
}

/**
 * Valida que la edicion propuesta caiga dentro de la superficie editable.
 *
 * Una propuesta fuera de la superficie (por ejemplo `src/otro.ts`) no se
 * aplica: el bucle edita el harness, no el codigo.
 */
export function isAllowedProposal(
  proposal: ProposedEdit,
  allowedPaths: readonly string[]
): boolean {
  return allowedPaths.some((allowed) => proposal.path.startsWith(allowed));
}

/**
 * Propone una edicion del harness.
 *
 * Devuelve null si el proposer no devolvio algo utilizable: el bucle sigue
 * con la propuesta externa en ese caso. Un proposer que falla no puede
 * abortar el bucle entero.
 */
export async function proposeHarnessEdit(
  options: ProposerOptions,
  task: string
): Promise<ProposedEdit | null> {
  const allowed = options.allowedPaths ?? ['rules/', 'skills/', 'AGENTS.md'];
  const result = await options.substrate.run({
    variantName: `proposer-${options.kind}-${options.domain}`,
    systemPrompt: proposerPrompt({
      domain: options.domain,
      kind: options.kind,
      task,
      context: options.context ?? {},
    }),
    task: 'Devolve el JSON del archivo de regla propuesto.',
    workDir: process.cwd(),
    timeoutMs: 180_000,
    attributedSessionId: `sess-proposer-${options.kind}-${options.domain}`,
  });

  const proposal = parseProposal(result.render);
  if (!proposal) return null;
  if (!isAllowedProposal(proposal, allowed)) return null;
  return proposal;
}
