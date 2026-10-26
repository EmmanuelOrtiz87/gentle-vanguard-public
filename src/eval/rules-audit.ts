/**
 * rules-audit.ts — Audita que reglas del stack sean MEDIBLES.
 *
 * El bucle puede medir si una regla se cumple cuando la regla dice que token
 * literal escribir. Si no lo dice, el bucle no puede distinguir "el agente
 * ignoro la regla" de "la regla no es cumplible".
 *
 * Antes de gastar una corrida en medir una edicion del harness, conviene
 * saber si la regla que se quiere medir es siquiera medible. Esta auditoria
 * es ESTATICA (no llama a ningun modelo): cuenta cuantas reglas del stack
 * tienen un token literal y cuales son puro discurso.
 *
 * No es un gate: la mayoria de las reglas del stack no son ("nunca borres X")
 * y no tienen por que ser medibles. El valor de la auditoria es el INVENTARIO:
 * dice que parte de la superficie es medible hoy y que parte no.
 */

import type { HarnessTree } from '../core/harness-surface.js';

/** Una regla auditada. */
export interface RuleAuditEntry {
  /** Path relativo del archivo. */
  path: string;
  /** Tiene al menos un token literal (comando o ruta). */
  operative: boolean;
  /** Tokens literales encontrados. */
  tokens: string[];
  /** Cantidad de obligaciones expresadas ("debe", "nunca", "tiene que"...). */
  obligations: number;
  /** La regla declara que no es medible (prohibicion o principio). */
  declaredNotMeasurable: boolean;
  /** Razon de esa declaracion. */
  reason: string;
}

/** Marcadores de obligacion: sin ellos, un archivo ni siquiera es una regla. */
const OBLIGATION_MARKERS = [
  'debe',
  'deben',
  'tiene que',
  'tienen que',
  'hay que',
  'nunca',
  'siempre',
  'jamás',
  'no se permite',
  'prohibido',
  'obligatorio',
  'requerido',
  'incluye',
  'incluir',
  'contiene',
  'va en',
];

/**
 * Extrae los spans de codigo inline (`...`) de un texto markdown.
 *
 * Son los unicos lugares donde una regla puede declarar el token literal que
 * el agente tiene que escribir.
 */
export function extractInlineTokens(text: string): string[] {
  const tokens: string[] = [];
  const pattern = /`([^`\n]+)`/g;
  let match = pattern.exec(text);
  while (match) {
    const value = (match[1] ?? '').trim();
    if (value) tokens.push(value);
    match = pattern.exec(text);
  }
  return tokens;
}

/**
 * Un token cuenta como "literal de comando" si parece ejecutable, un path,
 * un ajuste o el nombre de una herramienta.
 *
 * "npm run x", "npx tsx src/y.ts", "./script.sh", "rules/Z.md", "src/a/b.ts",
 * "lazy: true", "blocking", "codegraph_node".
 */
export function isCommandLike(token: string): boolean {
  if (/^(npm|npx|pnpm|yarn|node|python3?|python|bash|sh|deno|tsx|git|docker)\b/.test(token)) {
    return true;
  }
  if (/^[./]/.test(token) && token.length > 2) return true;
  // Path: sin espacios, con al menos una barra.
  if (!/\s/.test(token) && /^[\w.*{}-]+\/[\w.*{}/-]+$/.test(token)) return true;
  // Ajuste tipo `clave: valor` o `clave=valor`.
  if (/[:=]/.test(token) && !/^https?:/.test(token)) return true;
  // Nombre de herramienta: snake_case o kebab-case.
  // (Sin cuantificadores anidados: el linter de regex inseguras los marca.)
  if (token.includes('_') && /^[a-z][a-z0-9_]*$/.test(token)) return true;
  if (token.includes('-') && /^[a-z][a-z0-9-]*$/.test(token)) return true;
  // Valor literal de una sola palabra (`blocking`, `status`, `warning`): la
  // regla exige que se escriba EXACTAMENTE esa palabra, asi que tambien es
  // medible. Se excluyen las palabras de menos de 3 letras para no contar
  // ruido (`si`, `no`).
  if (/^[a-z][a-z0-9]{2,}$/.test(token)) return true;
  return false;
}

/**
 * Agrupa el markdown en BLOQUES LOGICOS (bullets, items numerados, filas de
 * tabla) con sus lineas de continuacion.
 *
 * Hace falta porque en markdown un bullet se envuelve: la obligacion puede
 * estar en la primera linea del bullet y el token literal en la siguiente. Con
 * lineas fisicas, una regla operative seeria reportada como no medible
 * (falso positivo que infla el backlog con reglas que SI se pueden medir).
 */
export function logicalBlocks(content: string): string[] {
  const blocks: string[] = [];
  let current = '';
  for (const line of content.split('\n')) {
    const startsBlock = /^\s*([-*+]\s+|\d+[.)]\s+|\|)/.test(line);
    if (startsBlock) {
      if (current.trim()) blocks.push(current.trim());
      current = line;
    } else {
      current += `\n${line}`;
    }
  }
  if (current.trim()) blocks.push(current.trim());
  return blocks;
}

/**
 * Marcador con el que una regla declara que NO es medible por token.
 *
 * No toda regla tiene que ser medible: una prohibicion ("nunca borres X") o un
 * principio ("prefiere lo local") se verifican por observacion, no por un token
 * que el agente escribe. Declararlo evita que la auditoria lo reporte como
 * deuda de forma permanente, y deja el backlog real: las reglas que SI
 * deberian ser operativas y no lo son.
 *
 * Formato: `<!-- harness: not-measurable -->` seguido de `<!-- harness: razon: ... -->`
 */
const NOT_MEASURABLE_MARKER = /<!--\s*harness:\s*not-measurable\s*-->/i;

/**
 * Si la regla declara que no es medible (y por que).
 *
 * Tres vias: el marcador explicito, la razon que lo acompaña, y la
 * declaracion implicita de los archivos que escribe una maquina (el
 * auto-norm-learner los regenera: un marcador puesto a mano en ellos se
 * pierde en la siguiente corrida).
 */
export function declaredNotMeasurable(content: string): { declared: boolean; reason: string } {
  const machine =
    /auto-?maintained by|auto-?mantenido por/i.test(content) ||
    /generado por auto-norm-learner/i.test(content);
  const declared = NOT_MEASURABLE_MARKER.test(content) || machine;
  const reason = /<!--\s*harness:\s*razon:\s*([\s\S]*?)-->/i.exec(content)?.[1]?.trim() ?? '';
  return {
    declared,
    reason: reason || (machine ? 'archivo generado por maquina' : ''),
  };
}

/**
 * Tokens que una regla EXIGE (obligacion + token en el mismo bloque).
 *
 * Sirve para detectar duplicados: si dos reglas exigen el mismo token, la
 * segunda es la misma regla con otro nombre.
 */
export function obligationTokens(content: string): string[] {
  const tokens: string[] = [];
  for (const block of logicalBlocks(content)) {
    const lower = block.toLowerCase();
    const hasObligation = OBLIGATION_MARKERS.some((marker) => lower.includes(marker));
    if (!hasObligation) continue;
    for (const token of extractInlineTokens(block)) {
      if (isCommandLike(token)) tokens.push(token);
    }
  }
  return [...new Set(tokens)];
}

/** Audita un archivo de reglas. */
export function auditRuleFile(path: string, content: string): RuleAuditEntry {
  // Operativa = hay una OBLIGACION y un TOKEN LITERAL en el MISMO bloque
  // logico. Mencionar un path no alcanza: "leer rules/X.md" no dice que
  // escribir. Si la obligacion y el token estan en bloques distintos, la
  // regla no dice QUE escribir: no es medible.
  const operativeTokens: string[] = [];
  let obligations = 0;
  for (const block of logicalBlocks(content)) {
    const lower = block.toLowerCase();
    const blockObligations = OBLIGATION_MARKERS.reduce(
      (acc, marker) => acc + (lower.split(marker).length - 1),
      0
    );
    obligations += blockObligations;
    if (blockObligations === 0) continue;
    for (const token of extractInlineTokens(block)) {
      if (isCommandLike(token)) operativeTokens.push(token);
    }
  }

  return {
    path,
    operative: operativeTokens.length > 0,
    tokens: [...new Set(operativeTokens)],
    obligations,
    declaredNotMeasurable: declaredNotMeasurable(content).declared,
    reason: declaredNotMeasurable(content).reason,
  };
}

/** Resultado de la auditoria. */
export interface RulesAudit {
  /** Total de archivos de reglas auditados. */
  total: number;
  /** Cuantos tienen un token literal (medibles). */
  measurable: number;
  /** Cuantos expresan alguna obligacion. */
  withObligations: number;
  /** Declarados no medibles por naturaleza (prohibiciones y principios). */
  declared: number;
  /** Archivos que expresan obligaciones pero NO tienen token literal. */
  unmeasurable: RuleAuditEntry[];
  /** Todos los archivos auditados. */
  entries: RuleAuditEntry[];
}

/** Audita el arbol de reglas (los archivos `.md` dentro de `rules/`). */
export function auditRules(tree: HarnessTree, rulesPrefix = 'rules/'): RulesAudit {
  const entries: RuleAuditEntry[] = [];
  for (const path of Object.keys(tree).sort()) {
    if (!path.startsWith(rulesPrefix) || !path.endsWith('.md')) continue;
    entries.push(auditRuleFile(path, tree[path] ?? ''));
  }
  const unmeasurable = entries.filter(
    (entry) =>
      entry.obligations > 0 && !entry.operative && !entry.declaredNotMeasurable
  );
  return {
    total: entries.length,
    measurable: entries.filter((entry) => entry.operative).length,
    withObligations: entries.filter((entry) => entry.obligations > 0).length,
    declared: entries.filter((entry) => entry.declaredNotMeasurable).length,
    unmeasurable,
    entries,
  };
}

/** Renderiza la auditoria como texto para el CLI. */
export function renderRulesAudit(audit: RulesAudit): string {
  const lines: string[] = [];
  lines.push(`harness-rules-audit — ${audit.total} reglas`);
  lines.push(
    `  medibles (con token literal): ${audit.measurable} | con obligacion: ${audit.withObligations} | declaradas no medibles: ${audit.declared} | no medibles: ${audit.unmeasurable.length}`
  );
  lines.push('');
  if (audit.unmeasurable.length === 0) {
    lines.push('  Toda regla con obligacion es medible o esta declarada como no medible.');
    return lines.join('\n');
  }
  lines.push('  Candidatas a medible (obligacion sin token literal):');
  for (const entry of audit.unmeasurable.slice(0, 40)) {
    lines.push(`    ${entry.path} (${entry.obligations} obligacion/es)`);
  }
  if (audit.unmeasurable.length > 40) {
    lines.push(`    ... y ${audit.unmeasurable.length - 40} mas`);
  }
  return lines.join('\n');
}
