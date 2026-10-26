/**
 * harness-surface.ts — La superficie editable del harness de gentle-vanguard.
 *
 * Adaptacion del patron "SurfaceSpec" de Harness^2 (google-research/harness2,
 * Apache-2.0) al stack GV. Harness^2 separa tres cosas que GV mezclaba:
 *
 *   1. METODO  — como se improve un harness (Propose-Probe-Compose + biblioteca)
 *   2. SUPERFICIE — que archivos son editables y como se validan
 *   3. BENC — el benchmark que mide
 *
 * Este modulo es (2). Define que parte del repo GV puede tocar un bucle de
 * evolucion automatica, y con que reglas se valida cada edicion antes de que
 * llegue a un agente.
 *
 * Por que importa: GV ya tiene 242 skills, 70+ reglas y 22 scripts. Sin una
 * superficie declarada, un bucle de auto-mejora editaria a ciegas. El contrato
 * "omitido-es-heredado" (una propuesta emite solo lo que cambia) y los
 * validadores de superficie son lo que hace que una edicion automatica sea
 * auditable en vez de una caja negra.
 *
 * Portado de harness2/core/tree.py (Google LLC, Apache-2.0).
 */

import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import { join } from 'node:path';

/** Un archivo del harness: ruta relativa a la raiz del repo -> contenido. */
export type HarnessTree = Record<string, string>;

/** Radio de una edicion sobre la superficie. */
export type HarnessTier = 'prose' | 'code';

/**
 * Declaracion de la superficie editable de un stack.
 *
 * `alwaysOn` son los paths que se cargan en CADA sesion sin que nada los pida.
 * El tope de caracteres importa: un prompt base que crece sin freno es la
 * forma mas comun de degradar un stack sin que nadie lo note.
 */
export interface HarnessSurface {
  /** Nombre del stack, para reports. */
  name: string;
  /** Paths cargados incondicionalmente en cada sesion. */
  alwaysOn: readonly string[];
  /** Tope de caracteres del bloque always-on. */
  alwaysOnMax: number;
  /** Por que existe el tope (se muestra en el finding para que sea accionable). */
  alwaysOnCapReason: string;
  /** Directorio de skills (relativo a la raiz). */
  skillDir: string;
  /** Directorio de reglas/normativas (relativo a la raiz). */
  ruleDir: string;
  /** Indice maestro de reglas (relativo a la raiz). */
  ruleIndex: string;
  /** Directorio de subagents (relativo a la raiz) o null si no aplica. */
  subagentDir: string | null;
  /** Directorio de scripts raiz (relativo a la raiz). */
  scriptsDir: string;
  /** Directorio de plugins (relativo a la raiz) o null si no aplica. */
  pluginDir: string | null;
  /** Extensiones de script admitidas por politica TS-first (NORM-TS-001). */
  scriptExts: readonly string[];
  /** Extension prohibida por politica TS-first. */
  bannedScriptExts: readonly string[];
}

/**
 * Superficie de gentle-vanguard.
 *
 * Mapeo contra los ocho componentes editables de Harness^2:
 *
 *   c1 system_prompt   -> AGENTS.md
 *   c2 context_policy  -> src/core, src/tokens (ensamblado de contexto)
 *   c3 long_term_mem   -> Engram (.engram/), memoria de agente
 *   c4 tool_guidance   -> skills/<nombre>/SKILL.md (frontmatter description)
 *   c5 subagents       -> src/agents/
 *   c6 guardrails      -> rules/ (+ skills)
 *   c7 scripts         -> scripts/, skills/<nombre>/scripts/
 *   c8 plugins         -> plugins/, src/plugins/, MCP servers
 */export const GV_SURFACE: HarnessSurface = {
  name: 'gentle-vanguard',
  alwaysOn: ['AGENTS.md'],
  alwaysOnMax: 60_000,
  alwaysOnCapReason:
    'AGENTS.md se inyecta en cada sesion; un prompt base que crece sin freno degrada todo el stack',
  skillDir: 'skills',
  ruleDir: 'rules',
  ruleIndex: 'rules/NORMATIVES.md',
  subagentDir: 'src/agents',
  scriptsDir: 'scripts',
  pluginDir: 'plugins',
  scriptExts: ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.py', '.sh'],
  bannedScriptExts: ['.ps1'],
};

/**
 * Marcas de veredicto de un evaluador.
 *
 * Portado de harness2/core/context.py. Un archivo que contiene estas cadenas
 * NO puede servirse como evidencia a una tarea posterior: si el veredicto entra
 * en el contexto, el agente aprende a optimizar la metrica en vez del trabajo.
 *
 * El tripwire no es la defensa: si dispara, hay que encontrar el camino de
 * lectura que lo produjo, no ampliar la lista de marcadores.
 */
export const GRADER_VERDICT_MARKERS: readonly string[] = [
  'deterministic_eval_summary',
  'deterministic_eval_result',
  'judge_scope_and_deterministic_status',
  'Judge findings on the rendered result',
  '"passed_count"',
  '"pass_rate"',
  '"test_pass_rate"',
];

/**
 * Marcas de veredicto en forma NO entrecomillada.
 *
 * Los literales de arriba solo ven JSON entrecomillado (`"pass_rate": 0.9`).
 * Una candidata que responde en markdown escribe `pass_rate: 0.9`, y esa forma
 * llega igual al selector. Se expresan con regex porque la forma libre
 * ("pass rate") no es un marcador fiable y produce falsos positivos.
 */
export const GRADER_VERDICT_PATTERNS: readonly { label: string; re: RegExp }[] = [
  { label: 'pass_rate', re: /\bpass_rate\b\s*[:=]\s*[0-9]/i },
  { label: 'passed_count', re: /\bpassed_count\b\s*[:=]\s*[0-9]/i },
  { label: 'test_pass_rate', re: /\btest_pass_rate\b\s*[:=]\s*[0-9]/i },
  { label: 'judge_score', re: /\bjudge[_-]?score\b\s*[:=]\s*[0-9]/i },
];

/**
 * Palabras que un PROMPT (o el artefacto de una candidata) no debe usar.
 *
 * Regla de Harness^2: el prompt describe el TRABAJO, nunca su MEDICION. Un
 * prompt que habla de benchmark, rubric o grader convierte al agente en un
 * optimizador de metrica en vez de un ejecutor de tarea.
 *
 * A diferencia de los marcadores de veredicto, estas palabras no son prueba
 * de contaminacion por si solas: "judge" puede ser una metafora legitima. Por
 * eso se reportan como AVISO, no como bloqueo.
 */
export const PROMPT_BANNED_TERMS: readonly string[] = [
  'benchmark',
  'grader',
  'rubric',
  'judge',
  'scoring',
];

/** Extensiones cuyo contenido se escanea en busca de marcas de veredicto. */
const MARKER_SCAN_SUFFIXES = new Set([
  '.md',
  '.txt',
  '.json',
  '.csv',
  '.tsv',
  '.yaml',
  '.yml',
  '.html',
  '.htm',
  '.log',
  '.ts',
  '.js',
  '.mjs',
  '.sh',
  '.xml',
  '.ini',
  '.toml',
  '.patch',
  '.diff',
  '',
]);

/** Normaliza una ruta relativa y rechaza escapes del harness. */
export function normalizeRel(rel: string): string {
  const r = String(rel).trim().replace(/\\/g, '/');
  if (r.startsWith('/') || '..'.split('/').includes(r) || r.includes('..')) {
    throw new Error(`path escapes the harness: ${rel}`);
  }
  let out = r;
  while (out.startsWith('./')) out = out.slice(2);
  return out.replace(/^\/+|\/+$/g, '');
}

/** Extension en minusculas, con punto. */
function extOf(rel: string): string {
  const i = rel.lastIndexOf('.');
  const slash = rel.lastIndexOf('/');
  return i > slash && i >= 0 ? rel.slice(i).toLowerCase() : '';
}

/**
 * Si una ruta pertenece a la superficie editable, y con que radio.
 *
 * Precedencia (de mas a menos radio): scripts de skill (code) > agentes
 * (code) > scripts raiz (code) > skills (prose) > reglas (prose) > AGENTS.md
 * (prose). Devolver null significa "no editable por el bucle".
 */
export function editableTier(surface: HarnessSurface, rel: string): HarnessTier | null {
  let r: string;
  try {
    r = normalizeRel(rel);
  } catch {
    return null;
  }
  if (r === 'AGENTS.md') return 'prose';
  if (r.startsWith(`${surface.skillDir}/`)) {
    if (r.includes('/scripts/')) return 'code';
    return 'prose';
  }
  if (r.startsWith(`${surface.ruleDir}/`) && r.endsWith('.md')) return 'prose';
  if (surface.subagentDir && r.startsWith(`${surface.subagentDir}/`)) return 'code';
  if (r.startsWith(`${surface.scriptsDir}/`)) return 'code';
  return null;
}

/** Si una ruta es editable (cualquier radio). */
export function isEditable(surface: HarnessSurface, rel: string): boolean {
  return editableTier(surface, rel) !== null;
}

/** Lee el contenido always-on concatenado de un arbol de harness. */
export function alwaysOnText(surface: HarnessSurface, tree: HarnessTree): string {
  return surface.alwaysOn
    .map((a) => tree[a] ?? '')
    .filter((t) => t.length > 0)
    .join('\n\n');
}

/**
 * Resume el cambio entre dos arboles de harness.
 *
 * `always_on_char_delta` es la metrica que mas duele cuando se edita sin
 * control: cada caracter added al prompt base se paga en cada sesion.
 */
export function diffSurface(
  surface: HarnessSurface,
  before: HarnessTree,
  after: HarnessTree
): {
  added: string[];
  removed: string[];
  modified: string[];
  alwaysOnCharDelta: number;
} {
  const added = Object.keys(after)
    .filter((k) => !(k in before))
    .sort();
  const removed = Object.keys(before)
    .filter((k) => !(k in after))
    .sort();
  const modified = Object.keys(before)
    .filter((k) => k in after && before[k] !== after[k])
    .sort();
  return {
    added,
    removed,
    modified,
    alwaysOnCharDelta:
      alwaysOnText(surface, after).length - alwaysOnText(surface, before).length,
  };
}

/**
 * Diversidad entre arboles candidatos: Jaccard de lineas, par a par.
 *
 * Sirve para que el colapso sea visible. Si todos los candidatos candidatos
 * convergen al mismo cuerpo, el bucle esta decorando, no explorando, y la
 * "mejora" es ruido con buena prosa.
 */
export function surfaceDiversity(trees: Record<string, HarnessTree>): {
  n: number;
  nDistinct: number;
  meanLineJaccard: number;
} {
  const names = Object.keys(trees).sort();
  if (names.length < 2) {
    return { n: names.length, nDistinct: names.length, meanLineJaccard: 1 };
  }
  const linesOf = (t: HarnessTree): Set<string> => {
    const s = new Set<string>();
    for (const [rel, content] of Object.entries(t)) {
      for (const line of content.split('\n')) {
        if (line.trim()) s.add(`${rel}:${line}`);
      }
    }
    return s;
  };
  const sets = new Map(names.map((n) => [n, linesOf(trees[n])]));
  const sims: number[] = [];
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      const a = sets.get(names[i]) as Set<string>;
      const b = sets.get(names[j]) as Set<string>;
      const union = new Set([...a, ...b]);
      sims.push(union.size === 0 ? 1 : [...a].filter((x) => b.has(x)).length / union.size);
    }
  }
  const distinct = new Set(names.map((n) => JSON.stringify(trees[n]))).size;
  const mean = sims.reduce((acc, s) => acc + s, 0) / sims.length;
  return { n: names.length, nDistinct: distinct, meanLineJaccard: Number(mean.toFixed(4)) };
}

/**
 * Diff por lineas entre dos versiones de un archivo.
 *
 * Se usa para INYECTAR EL CAMBIO y no el archivo entero. Hallazgo medido en
 * el bucle: cuando la edicion del harness llega como el archivo completo, el
 * modelo sigue lo que es saliente. Una regla al final de un archivo largo y
 * mayormente irrelevante se ignora; la misma regla en un archivo corto y
 * focalizado se cumple. El diff es corto por construccion, asi que lo que
 * cambio es justo lo que el modelo ve.
 *
 * Algoritmo: recorte del prefijo y del sufijo comunes (sin LCS): para
 * archivos de harness es exacto en la practica y es O(n).
 */
export function diffLines(before: string, after: string): string {
  if (before === after) return '';
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');

  let start = 0;
  while (
    start < beforeLines.length &&
    start < afterLines.length &&
    beforeLines[start] === afterLines[start]
  ) {
    start += 1;
  }

  let endBefore = beforeLines.length;
  let endAfter = afterLines.length;
  while (
    endBefore > start &&
    endAfter > start &&
    beforeLines[endBefore - 1] === afterLines[endAfter - 1]
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }

  const removed = beforeLines.slice(start, endBefore);
  const added = afterLines.slice(start, endAfter);
  return [
    ...removed.map((l) => `- ${l}`),
    ...added.map((l) => `+ ${l}`),
  ].join('\n');
}

/**
 * Diversidad entre ARTEFACTOS (lo que cada variante respondio).
 *
 * Es el otro mitad de la pregunta: `surfaceDiversity` mide si los ARBOLES
 * candidatos colapsaron al mismo cuerpo; esta mide si los ARTEFACTOS
 * colapsaron a la misma respuesta. Un bucle puede tener arboles distintos y
 * respuestas identicas: eso es decoracion con buena prosa.
 */
export function textDiversity(texts: Record<string, string>): {
  n: number;
  nDistinct: number;
  meanLineJaccard: number;
} {
  const names = Object.keys(texts).sort();
  if (names.length < 2) {
    return { n: names.length, nDistinct: names.length, meanLineJaccard: 1 };
  }
  const linesOf = (text: string): Set<string> => {
    const s = new Set<string>();
    for (const line of text.split('\n')) {
      if (line.trim()) s.add(line.trim());
    }
    return s;
  };
  const sets = new Map(names.map((n) => [n, linesOf(texts[n])]));
  const sims: number[] = [];
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      const a = sets.get(names[i]) as Set<string>;
      const b = sets.get(names[j]) as Set<string>;
      const union = new Set([...a, ...b]);
      sims.push(union.size === 0 ? 1 : [...a].filter((x) => b.has(x)).length / union.size);
    }
  }
  const distinct = new Set(names.map((n) => texts[n].trim())).size;
  const mean = sims.reduce((acc, s) => acc + s, 0) / sims.length;
  return { n: names.length, nDistinct: distinct, meanLineJaccard: Number(mean.toFixed(4)) };
}

/**
 * Busca marcas de veredicto de evaluador dentro de un texto libre.
 *
 * Se separa de `assertNoGraderVerdicts` (que trabaja sobre un arbol) porque
 * el tripwire tiene que cubrir TAMBIEN los artefactos que lee el selector: un
 * veredicto dentro del texto de una candidata es tan filtrable como uno
 * dentro de un archivo de harness.
 */
export function findVerdictMarkers(text: string, label = 'contenido'): string[] {
  const hits: string[] = [];
  for (const marker of GRADER_VERDICT_MARKERS) {
    if (text.includes(marker)) hits.push(`${label}: marker ${marker}`);
  }
  for (const pattern of GRADER_VERDICT_PATTERNS) {
    if (pattern.re.test(text)) hits.push(`${label}: patron ${pattern.label}`);
  }
  return hits;
}

/**
 * Palabras de medicion dentro de un prompt o de un artefacto de candidata.
 *
 * Se reporta por separado de los marcadores de veredicto: son un AVISO, no
 * una prueba. Sirven para que el operador vea que el prompt esta describiendo
 * la medicion en vez del trabajo, sin abortar el bucle por una metafora.
 */
export function findPromptBannedTerms(text: string, label = 'prompt'): string[] {
  const hits: string[] = [];
  const lower = text.toLowerCase();
  for (const term of PROMPT_BANNED_TERMS) {
    if (lower.includes(term)) hits.push(`${label}: termino ${term}`);
  }
  return hits;
}

/** Un veredicto encontrado en la superficie, con su archivo y su marcador. */
export interface VerdictHit {
  /** Archivo donde aparece. */
  path: string;
  /** Marcador concreto que apareció. */
  marker: string;
  /** Dónde apareció. */
  where: 'nombre' | 'contenido';
}

/**
 * Busca marcas de veredicto en un árbol de harness.
 *
 * Devuelve hits ESTRUCTURADOS (archivo + marcador) para que quien aplique la
 * regla pueda consultar la allowlist por (archivo, marcador) sin parsear
 * strings.
 */
export function findVerdictHits(tree: HarnessTree): VerdictHit[] {
  const hits: VerdictHit[] = [];
  for (const rel of Object.keys(tree).sort()) {
    for (const marker of GRADER_VERDICT_MARKERS) {
      if (rel.includes(marker)) {
        hits.push({ path: rel, marker, where: 'nombre' });
      }
    }
    if (!MARKER_SCAN_SUFFIXES.has(extOf(rel))) continue;
    const body = String(tree[rel]);
    for (const marker of GRADER_VERDICT_MARKERS) {
      if (body.includes(marker)) {
        hits.push({ path: rel, marker, where: 'contenido' });
      }
    }
  }
  return hits;
}

/**
 * Verifica que un arbol de harness no contenga veredictos de evaluador.
 *
 * Se corre ANTES de que el arbol se materialice en disco o se sirva como
 * evidencia. Un arbol contaminado no puede volver a usarse nunca.
 */
export function assertNoGraderVerdicts(tree: HarnessTree): string[] {
  return findVerdictHits(tree).map(
    (hit) => `${hit.path}: marker ${hit.marker} en el ${hit.where.toUpperCase()}`
  );
}

/**
 * Lee la superficie editable desde disco.
 *
 * Fuente unica de verdad: el doctor, el bucle y la CLI leen el harness por
 * acá, para que no haya dos definiciones de "que es la superficie" que
 * puedan divergir.
 */
export function readSurfaceTree(surface: HarnessSurface, root: string): HarnessTree {
  const tree: HarnessTree = {};
  const roots = [
    ...surface.alwaysOn,
    surface.skillDir,
    surface.ruleDir,
    surface.scriptsDir,
    surface.subagentDir,
  ].filter((p): p is string => Boolean(p));

  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const rel = full.replace(/\\/g, '/').replace(`${root.replace(/\\/g, '/')}/`, '');
        if (isEditable(surface, rel)) tree[rel] = readFileSync(full, 'utf-8');
      }
    }
  };

  for (const entry of roots) {
    const abs = join(root, entry);
    if (!existsSync(abs)) continue;
    if (!statSync(abs).isDirectory()) {
      tree[entry] = readFileSync(abs, 'utf-8');
      continue;
    }
    walk(abs);
  }
  return tree;
}
