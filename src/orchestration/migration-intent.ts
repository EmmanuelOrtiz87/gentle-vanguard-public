/**
 * migration-intent.ts — mecánica de migración documental en lenguaje natural.
 *
 * POR QUÉ EXISTE
 * ---------------------------------------------------------------------------
 * El stack ya reconocía intenciones editoriales (synthesis/translation/summary/
 * transcription/rewrite/extract/conversion/draft) pero NO la migración
 * documental: "migrá la documentación de Buyflow a Confluence" caía al routing
 * genérico, perdía el cliente y publicaba sin prefijo de raíz.
 *
 * Este módulo aporta la MECÁNICA (no la ejecución):
 *   · reconoce la activación en es/en/pt exigiendo el objetivo documental;
 *   · deduce lo que el pedido ya dice (área, cliente, sistema);
 *   · pregunta, en orden fijo área → cliente → sistema, lo que falta.
 *
 * El DESTINO es un dato versionado (`config/confluence-destination.json`), no
 * código: espacios, prefijos de raíz y textos de las preguntas viven en config.
 *
 * QUÉ NO HACE (frontera explícita)
 * ---------------------------------------------------------------------------
 * No escribe en Confluence, no resuelve la página raíz y no publica. La
 * resolución del nodo raíz por nombre es de `apps/censor/lib/confluence.mjs`
 * (`resolveRoot`); la clasificación de contenido y el estándar A/B, de
 * `apps/censor/public/migrate.js`. Este módulo solo decide QUÉ se pregunta y
 * CUÁNDO, y produce el destino ya resuelto para que la ruta editorial lo use.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Operación editorial disparada por la activación. */
export type MigrationOperation = 'migrate' | 'document';
/** Áreas del catálogo (cada una mapea a un espacio Confluence). */
export type MigrationArea = 'digital' | 'it';
/** Clientes del laboratorio de migración (DTV / SKY / OTT). */
export type MigrationClient = 'OTT' | 'SKY' | 'DTV';
/** Orden fijo de las tres preguntas. */
export type MigrationQuestionKey = 'area' | 'client' | 'system';
/** Idioma del pedido: define el idioma de las preguntas. */
export type MigrationLanguage = 'es' | 'en' | 'pt';

export interface MigrationQuestion {
  key: MigrationQuestionKey;
  prompt: string;
  options?: string[];
}

export interface MigrationIntent {
  operation: MigrationOperation;
  area?: MigrationArea;
  client?: MigrationClient;
  system?: string;
  missing: MigrationQuestionKey[];
  nextQuestion?: MigrationQuestion;
  /** Idioma detectado en el pedido: define el idioma de los prompts. */
  language?: MigrationLanguage;
}

/** Destino ya resuelto (espacio + prefijo + nombre del sistema). */
export interface MigrationDestination {
  site: string;
  baseUrl?: string;
  space: string;
  spaceName?: string;
  parentPage?: string | null;
  prefix: string;
  rootTitle: string;
  standard: string;
  client?: MigrationClient;
  area?: MigrationArea;
  system?: string;
}

/* ── Config versionado ────────────────────────────────────────────────────── */

interface AliasSpec {
  value: string;
  caseSensitive: boolean;
}

interface AreaSpec {
  label: Record<MigrationLanguage, string>;
  space: string;
  spaceName?: string;
  parentPage?: string | null;
  aliases: AliasSpec[];
}

interface ClientSpec {
  label: Record<MigrationLanguage, string>;
  description?: Record<MigrationLanguage, string>;
  prefix: string;
  aliases: AliasSpec[];
}

interface QuestionSpec {
  es: string;
  en: string;
  pt: string;
}

export interface MigrationDestinationConfig {
  version: string;
  site: { key: string; host: string; baseUrl?: string; source?: string };
  areas: Record<string, AreaSpec>;
  clients: Record<string, ClientSpec>;
  prefixTemplate: string;
  defaultStandard: string;
  standards?: string[];
  questions: Record<MigrationQuestionKey, QuestionSpec>;
}

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIG_CANDIDATES = [
  resolve(MODULE_DIR, '..', '..', 'config', 'confluence-destination.json'),
  resolve(process.cwd(), 'config', 'confluence-destination.json'),
];

let cachedConfig: MigrationDestinationConfig | undefined;
let configLookupFailed = false;

/** Carga (y cachea) el destino versionado. `undefined` si el config no existe. */
export function migrationConfig(): MigrationDestinationConfig | undefined {
  if (cachedConfig) return cachedConfig;
  if (configLookupFailed) return undefined;
  for (const path of CONFIG_CANDIDATES) {
    try {
      if (!existsSync(path)) continue;
      cachedConfig = JSON.parse(readFileSync(path, 'utf-8')) as MigrationDestinationConfig;
      return cachedConfig;
    } catch {
      // config ilegible: se prueba el siguiente candidato
    }
  }
  configLookupFailed = true;
  return undefined;
}

/* ── Normalización y utilidades ──────────────────────────────────────────── */

function normalize(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Límite de palabra tolerante: a diferencia de `\b`, no exige que el carácter
 * vecino sea alfanumérico. Necesario para alias con signo (`SKY+`).
 */
function boundaryPattern(source: string): string {
  return `(?<![\\p{L}\\p{N}])${source}(?![\\p{L}\\p{N}])`;
}

function aliasRegex(alias: AliasSpec, loose = false): RegExp {
  const caseSensitive = alias.caseSensitive && !loose;
  const source = caseSensitive ? alias.value : normalize(alias.value);
  return new RegExp(boundaryPattern(escapeRegExp(source)), caseSensitive ? 'u' : 'iu');
}

/* ── Vocabulario de activación ───────────────────────────────────────────── */

/**
 * Verbo de migración (es/en/pt). Se evalúa sobre el texto normalizado
 * (minúsculas y sin acentos), por eso `migrá` y `migra` colapsan en `migra`.
 */
const MIGRATE_VERB =
  /(?<![\p{L}\p{N}])(?:migra|migrar|migracion|migracoes|migracao|migrate|migrating|migration)(?![\p{L}\p{N}])/u;

/**
 * Verbo de documentación. Los sustantivos (`documentación`, `documentation`)
 * NO activan: "migrá la documentación de X" es una migración, no un pedido de
 * redactar algo nuevo.
 */
const DOCUMENT_VERB =
  /(?<![\p{L}\p{N}])(?:documenta|documentar|documentando|documente|document|documenting)(?![\p{L}\p{N}])/u;

/** `armá/creá la ficha`: activar exige el objeto "ficha". */
const FICHA_VERBS = '(?:arma|armar|crea|crear|cria|criar)';
const FICHA_VERB = new RegExp(
  `(?<![\\p{L}\\p{N}])${FICHA_VERBS}(?![\\p{L}\\p{N}])\\s+ficha(?![\\p{L}\\p{N}])`,
  'u',
);
/** Igual, con artículo delante: "armá la ficha". */
const FICHA_VERB_WITH_ARTICLE = new RegExp(
  `(?<![\\p{L}\\p{N}])${FICHA_VERBS}(?![\\p{L}\\p{N}])\\s+(?:la|el|una|un)\\s+ficha(?![\\p{L}\\p{N}])`,
  'u',
);

/** Objetivo documental: sin esto no hay migración documental. */
const DOC_TARGET =
  /(?<![\p{L}\p{N}])(?:documentacion|documentacoes|documentacao|documentation|documentos|documento|docs|doc|wiki|confluence|fichas|ficha)(?![\p{L}\p{N}])/u;

/** Destino de formato: si aparece sin Confluence/wiki, es conversión, no migración. */
const FORMAT_TARGET =
  /(?<![\p{L}\p{N}])(?:markdown|docx|word|pdf|html|odt|rtf|txt)(?![\p{L}\p{N}])/u;

/** Destino documental explícito (marca que el encargo no es una conversión). */
const DOC_DESTINATION = /(?<![\p{L}\p{N}])(?:confluence|wiki)(?![\p{L}\p{N}])/u;

/* ── Stopwords para el nombre del sistema ────────────────────────────────── */

const SYSTEM_STOPWORDS = new Set([
  // es
  'la',
  'el',
  'los',
  'las',
  'un',
  'una',
  'unos',
  'unas',
  'este',
  'esta',
  'estos',
  'estas',
  'ese',
  'esa',
  'cliente',
  'clientes',
  'sistema',
  'sistemas',
  'producto',
  'productos',
  'proyecto',
  'proyectos',
  'area',
  'areas',
  'equipo',
  'nombre',
  'documentacion',
  'documentos',
  'documento',
  'docs',
  'doc',
  'wiki',
  'confluence',
  'ficha',
  'fichas',
  'contenido',
  'informacion',
  'todo',
  'toda',
  'todos',
  'todas',
  'nuestro',
  'nuestra',
  'otro',
  'otra',
  'nuevo',
  'nueva',
  // en
  'the',
  'a',
  'an',
  'of',
  'to',
  'and',
  'for',
  'client',
  'clients',
  'system',
  'systems',
  'product',
  'products',
  'project',
  'area',
  'team',
  'documentation',
  'documents',
  'document',
  'docs',
  'name',
  'all',
  'content',
  'information',
  // pt
  'o',
  'os',
  'as',
  'um',
  'uma',
  'do',
  'da',
  'no',
  'na',
  'em',
  'para',
  'com',
  'sistema',
  'sistemas',
  'produto',
  'produtos',
  'projeto',
  'equipe',
  'documentacao',
  'informacao',
  'nome',
  'todo',
  'todos',
]);

/* ── Detección de idioma ──────────────────────────────────────────────────── */

const LANGUAGE_MARKERS: Record<MigrationLanguage, string[]> = {
  es: [
    'migrá',
    'documentá',
    'documentación',
    'necesito',
    'necesitás',
    'cuál',
    'hacé',
    'armá',
    'creá',
    'pasame',
    'acá',
    'sistema de',
  ],
  en: [
    'migrate',
    'migration',
    'documenting',
    'documentation',
    'please',
    'which',
    'need to',
    'create the',
    'client of',
  ],
  pt: [
    'migração',
    'documentação',
    'documentar',
    'preciso',
    'precisa',
    'necessito',
    'faça',
    'crie',
    'qual',
    'você',
    'de qual',
  ],
};

/** Idioma del pedido: define el idioma de las tres preguntas. */
function detectLanguage(raw: string): MigrationLanguage {
  const haystack = raw.toLowerCase();
  let best: MigrationLanguage = 'es';
  let bestScore = 0;
  for (const [language, markers] of Object.entries(LANGUAGE_MARKERS) as [
    MigrationLanguage,
    string[],
  ][]) {
    const score = markers.filter((marker) => haystack.includes(marker)).length;
    if (score > bestScore) {
      bestScore = score;
      best = language;
    }
  }
  return best;
}

/* ── Detección de área, cliente y sistema ────────────────────────────────── */

function detectArea(raw: string, normalized: string, loose = false): MigrationArea | undefined {
  const config = migrationConfig();
  if (!config) return undefined;
  for (const [key, spec] of Object.entries(config.areas)) {
    for (const alias of spec.aliases) {
      const haystack = alias.caseSensitive && !loose ? raw : normalized;
      if (aliasRegex(alias, loose).test(haystack)) return key as MigrationArea;
    }
  }
  // Deducción por espacio explícito: solo si la clave NO colisiona con un
  // cliente (OTT es a la vez espacio del área Digital y clave de cliente).
  const clientKeys = new Set(Object.keys(config.clients));
  for (const [key, spec] of Object.entries(config.areas)) {
    if (clientKeys.has(spec.space)) continue;
    const re = new RegExp(boundaryPattern(escapeRegExp(spec.space)), 'u');
    if (re.test(raw)) return key as MigrationArea;
  }
  return undefined;
}

function detectClient(raw: string, normalized: string, loose = false): MigrationClient | undefined {
  const config = migrationConfig();
  if (!config) return undefined;
  let best: { client: MigrationClient; index: number; length: number } | undefined;
  for (const [key, spec] of Object.entries(config.clients)) {
    for (const alias of spec.aliases) {
      const haystack = alias.caseSensitive && !loose ? raw : normalized;
      const match = aliasRegex(alias, loose).exec(haystack);
      if (!match) continue;
      const length = match[0].length;
      if (!best || match.index < best.index || (match.index === best.index && length > best.length))
        best = { client: key as MigrationClient, index: match.index, length };
    }
  }
  return best?.client;
}

/** Tokens que pertenecen al catálogo y NUNCA son el nombre del sistema. */
function catalogTokens(): Set<string> {
  const config = migrationConfig();
  const tokens = new Set<string>();
  if (!config) return tokens;
  for (const spec of Object.values(config.areas)) {
    tokens.add(normalize(spec.space));
    for (const alias of spec.aliases) tokens.add(normalize(alias.value));
  }
  for (const [key, spec] of Object.entries(config.clients)) {
    tokens.add(normalize(key));
    tokens.add(normalize(spec.prefix));
    for (const alias of spec.aliases) tokens.add(normalize(alias.value));
  }
  tokens.add(normalize(config.site.host));
  return tokens;
}

/**
 * ¿El token es descartable como nombre de sistema? (stopword, objetivo
 * documental, alias de área/cliente, clave de espacio o de cliente).
 */
function isReservedToken(token: string, catalog: Set<string>): boolean {
  const normalized = normalize(token);
  if (!normalized) return true;
  if (SYSTEM_STOPWORDS.has(normalized)) return true;
  if (catalog.has(normalized)) return true;
  if (DOC_TARGET.test(normalized)) return true;
  return false;
}

/** Tokens capitalized del texto (nombre propio o sigla). */
function capitalizedTokens(text: string): Array<{ value: string; index: number }> {
  const tokens: Array<{ value: string; index: number }> = [];
  const re = /(?<![\p{L}\p{N}])[\p{Lu}][\p{L}\p{N}]*/gu;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    tokens.push({ value: match[0], index: match.index });
  }
  return tokens;
}

/**
 * Nombre del sistema, en orden de confianza:
 *   1. entre comillas (permite nombres de varias palabras);
 *   2. token capitalizado (cubre "de Buyflow" y las siglas en MAYÚSCULAS);
 *   3. respaldo: el token que sigue a "de", aunque esté en minúscula.
 */
/**
 * Sufijo de versión pegado al nombre: "Buyflow v2", "Buyflow 2.0", "Buyflow 20".
 *
 * Sin esto, "migrá la documentación de Buyflow v2" se recortaba a "Buyflow" y
 * resolvía una página homónima equivocada: el nombre del sistema es lo que
 * identifica la raíz, y la versión suele ser parte de ese nombre.
 */
function versionSuffix(raw: string, end: number): string {
  const tail = raw.slice(end);
  const match = /^\s+(v?\d+)/i.exec(tail);
  if (!match) return '';
  let suffix = match[1];
  // La parte decimal se lee SIN regex anidada: un cuantificador dentro de un
  // grupo cuantificado es una expresión insegura (ReDoS) y el gate de lint
  // (`security/detect-unsafe-regex`) la rechaza.
  const decimal = /^\.(\d+)/.exec(tail.slice(match[0].length));
  if (decimal) suffix += `.${decimal[1]}`;
  return ` ${suffix}`;
}

function detectSystem(raw: string, catalog: Set<string>): string | undefined {
  const quoted = /["'«»“”]([^"'«»“”]{2,60})["'«»“”]/.exec(raw);
  if (quoted && !isReservedToken(quoted[1], catalog)) return quoted[1].trim();

  const tokens = capitalizedTokens(raw);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.index === 0) continue; // primera palabra de la frase
    if (isReservedToken(token.value, catalog)) continue;
    const parts = [token.value];
    let end = token.index + token.value.length;
    let j = i + 1;
    while (j < tokens.length) {
      const next = tokens[j];
      if (isReservedToken(next.value, catalog)) break;
      const between = raw.slice(end, next.index);
      if (!/^[\s.-]*$/.test(between)) break;
      parts.push(next.value);
      end = next.index + next.value.length;
      j++;
    }
    return parts.join(' ') + versionSuffix(raw, end);
  }

  const dePattern = /(?<![\p{L}\p{N}])de[l]?\s+([\p{L}\p{N}][\p{L}\p{N}._-]*)/giu;
  let match: RegExpExecArray | null;
  while ((match = dePattern.exec(raw)) !== null) {
    const candidate = match[1].replace(/[.,;:!?]+$/, '');
    if (!isReservedToken(candidate, catalog))
      return candidate + versionSuffix(raw, match.index + match[0].length);
  }
  return undefined;
}

/* ── API pública ──────────────────────────────────────────────────────────── */

/**
 * Reconoce una intención de migración documental.
 *
 * Devuelve `undefined` cuando el encargo NO es una migración documental:
 * falta el verbo de activación o falta el objetivo documental
 * ("Migra el código de JavaScript a TypeScript", "convierte markdown a docx").
 */
export function migrationIntent(task: string): MigrationIntent | undefined {
  const config = migrationConfig();
  if (!config) return undefined;
  const raw = String(task ?? '').trim();
  if (!raw) return undefined;
  const normalized = normalize(raw);

  const operation = detectOperation(normalized);
  if (!operation) return undefined;
  // Sin objetivo documental no hay migración documental.
  if (!DOC_TARGET.test(normalized)) return undefined;
  // Un destino de formato sin Confluence/wiki es conversión editorial.
  if (FORMAT_TARGET.test(normalized) && !DOC_DESTINATION.test(normalized)) return undefined;

  const language = detectLanguage(raw);
  const catalog = catalogTokens();
  const area = detectArea(raw, normalized);
  const client = detectClient(raw, normalized);
  const system = detectSystem(raw, catalog);

  const intent: MigrationIntent = {
    operation,
    missing: [],
    language,
  };
  if (area) intent.area = area;
  if (client) intent.client = client;
  if (system) intent.system = system;
  return finalize(intent);
}

/** Verbo de activación → operación. */
function detectOperation(normalized: string): MigrationOperation | undefined {
  if (MIGRATE_VERB.test(normalized)) return 'migrate';
  if (DOCUMENT_VERB.test(normalized)) return 'document';
  if (FICHA_VERB.test(normalized) || FICHA_VERB_WITH_ARTICLE.test(normalized)) return 'document';
  return undefined;
}

/** Recalcula `missing` y `nextQuestion` sobre el estado actual de la intent. */
function finalize(intent: MigrationIntent): MigrationIntent {
  const missing: MigrationQuestionKey[] = [];
  if (!intent.area) missing.push('area');
  if (!intent.client) missing.push('client');
  if (!intent.system) missing.push('system');
  const next: MigrationIntent = { ...intent, missing };
  const question = nextMigrationQuestion(next);
  if (question) next.nextQuestion = question;
  else delete next.nextQuestion;
  return next;
}

/**
 * Primera pregunta pendiente en el orden fijo área → cliente → sistema.
 * `undefined` cuando no falta nada.
 */
export function nextMigrationQuestion(intent: MigrationIntent): MigrationQuestion | undefined {
  const config = migrationConfig();
  if (!config) return undefined;
  const key = firstMissing(intent);
  if (!key) return undefined;
  const spec = config.questions[key];
  if (!spec) return undefined;
  const language = intent.language ?? 'es';
  const prompt = spec[language] ?? spec.es;
  const options = optionsFor(key, language);
  return options ? { key, prompt, options } : { key, prompt };
}

function firstMissing(intent: MigrationIntent): MigrationQuestionKey | undefined {
  if (!intent.area) return 'area';
  if (!intent.client) return 'client';
  if (!intent.system) return 'system';
  return undefined;
}

function optionsFor(key: MigrationQuestionKey, language: MigrationLanguage): string[] | undefined {
  const config = migrationConfig();
  if (!config) return undefined;
  if (key === 'area') {
    return Object.values(config.areas).map((spec) => spec.label[language] ?? spec.label.es);
  }
  if (key === 'client') {
    return Object.values(config.clients).map((spec) => spec.label[language] ?? spec.label.es);
  }
  return undefined;
}

/** Limpia la respuesta cruda del usuario (comillas, puntuación, muletillas). */
function cleanAnswer(answer: string): string {
  return String(answer ?? '')
    .replace(/["'«»“”]/g, '')
    .replace(/^\s*(?:es|son|é|e|eh|is|o|são|sao)\s+/i, '')
    .replace(/[.,;:!?]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Respuestas que no aportan dato: no llenan ningún slot. */
const NON_ANSWERS = new Set([
  'no',
  'nose',
  'no se',
  'no sé',
  'nada',
  'ninguno',
  'ninguna',
  'nenhum',
  'nenhuma',
  'desconozco',
  'unknown',
  'n a',
  'na',
  '-',
]);

function isNonAnswer(answer: string): boolean {
  const normalized = normalize(answer).trim();
  return NON_ANSWERS.has(normalized) || normalized.length < 2;
}

/**
 * Aplica la respuesta del usuario a la intent para que el orquestador itere
 * sin volver a preguntar lo ya dicho.
 */
export function applyMigrationAnswer(intent: MigrationIntent, answer: string): MigrationIntent {
  const cleaned = cleanAnswer(answer);
  if (!cleaned || isNonAnswer(cleaned)) return finalize(intent);
  const config = migrationConfig();
  if (!config) return finalize(intent);

  const key = intent.nextQuestion?.key ?? intent.missing[0];
  const next: MigrationIntent = { ...intent };
  // En la respuesta explícita a un slot, el alias se acepta sin distinguir
  // mayúsculas: quien contesta "it" a la pregunta de área quiere decir IT.
  const area = detectArea(cleaned, normalize(cleaned), key === 'area');
  const client = detectClient(cleaned, normalize(cleaned), key === 'client');

  if (key === 'area' && area) next.area = area;
  else if (key === 'client' && client) next.client = client;
  else if (key === 'system' && !area && !client) next.system = cleaned;
  else if (area && !next.area) next.area = area;
  else if (client && !next.client) next.client = client;
  else if (key === 'system') next.system = cleaned;
  else if (!next.system) next.system = cleaned;

  return finalize(next);
}

/**
 * Destino ya resuelto: espacio (por área) + prefijo de raíz (por cliente) +
 * nombre del sistema. `undefined` si falta alguna de las tres piezas.
 */
export function migrationDestination(intent: MigrationIntent): MigrationDestination | undefined {
  const config = migrationConfig();
  if (!config) return undefined;
  const area = intent.area ? config.areas[intent.area] : undefined;
  const client = intent.client ? config.clients[intent.client] : undefined;
  if (!area || !client || !intent.system) return undefined;
  const prefix = config.prefixTemplate.replace('{prefix}', client.prefix);
  return {
    site: config.site.host,
    baseUrl: config.site.baseUrl,
    space: area.space,
    spaceName: area.spaceName,
    parentPage: area.parentPage ?? null,
    prefix,
    rootTitle: `${prefix}${intent.system}`,
    standard: config.defaultStandard,
    client: intent.client,
    area: intent.area,
    system: intent.system,
  };
}
