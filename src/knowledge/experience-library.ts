/**
 * experience-library.ts — Biblioteca de experiencia del harness.
 *
 * Portado del patron de Harness^2 (google-research/harness2, Apache-2.0) al
 * stack GV. Harness^2 guarda, por cada adopcion de un harness, la RAZON por la
 * que se adopto y la leccion que se transfiere. El contrato es simple y severo:
 *
 *   cue       la senal que dispara la leccion   ("cuando...")
 *   lesson    la regla transferible              ("entonces...")
 *   evidence  la evidencia que la sostiene      ("porque en el rollout X...")
 *
 * Si falta cualquiera de los tres, NO SE GUARDA NADA. Ese filtro barato es
 * lo que separa una biblioteca de lecciones de un vertedero de notas: una
 * entrada sin evidencia no es una leccion, es una opinion.
 *
 * Donde vive:
 *   - Nexus (.runtime/gentle-vanguard.db) -> tabla `harness_experiences`.
 *     Campos consultables, contrato verificado en la frontera de escritura.
 *   - docs/harness-experience/<dominio>/   -> proyeccion legible y versionable
 *     (INDEX.md por dominio, EXPERIENCE.md por adopcion).
 *   - .runtime/harness-experience/<dominio>/harnesses/<tarea>/harness/<rel>
 *     -> el ARBOL completo del harness adoptado. Es un artefacto de corrida
 *     (NORMATIVA: los artefactos de pipeline no se versionan), pero se
 *     transporta ENTERO, nunca resumido: un resumen no es auditable.
 *
 * Schema note: las migraciones canonicas de Nexus viven en
 * apps/web-dashboard/server/database/repositories/MigrationRunner.ts, que
 * pertenece a otro workstream. Este modulo gestiona su propia tabla de forma
 * perezosa con CREATE TABLE IF NOT EXISTS (mismo criterio que
 * src/eval/continuous-eval.ts).
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import type Database from 'better-sqlite3';
import type { HarnessTree } from '../core/harness-surface.js';

/* ── Tipos ── */

export type Confidence = 'low' | 'medium' | 'high';

/** Campos que el contrato exige. Faltar uno invalida la entrada. */
export const EXPERIENCE_CONTRACT_FIELDS = ['cue', 'lesson', 'evidence'] as const;

export interface ExperienceEntry {
  /** Clave tematica `<area>/<subject>` segun rules/TOPIC-KEY-CONVENTION.md. */
  topicKey: string;
  /** Dominio de trabajo (kebab-case) donde la leccion aplica. */
  domain: string;
  /** Cuando aplica. */
  cue: string;
  /** Que hacer. */
  lesson: string;
  /** Por que se sostiene. */
  evidence: string;
  /** Confianza de la leccion. */
  confidence: Confidence;
  /** Rutas del harness que la leccion modifica. */
  edits?: string[];
  /**
   * Rutas cuya REGLA quedo VERIFICADA por el juez.
   *
   * No es lo mismo que `edits`: `edits` es lo que toco la variante ganadora,
   * `verifiedEdits` es lo que se comprobó que el agente CUMPLE. Una regla que
   * se midio y no se cumplio no se promueve: quedaria en el repo como norma
   * que el propio stack no obeye.
   */
  verifiedEdits?: string[];
  /** Corrida o tarea que la produjo. */
  taskId?: string;
  /** Ruta (relativa a la raiz del repo) del arbol de harness adoptado. */
  harnessSnapshot?: string;
}

export interface ExperienceRecord extends ExperienceEntry {
  id: number;
  adoptedAt: string;
}

/* ── Contrato ── */

/**
 * Longitud minima de cada campo del contrato.
 *
 * El contrato tiene que distinguir una leccion TRANSFERIBLE de un relleno.
 * Con solo exigir texto no vacio, un `cue` generico ("cuando se propone
 * editar el harness") cumple el contrato sin aportar nada: la biblioteca se
 * llena de entradas que no transferen a otra corrida.
 */
export const EXPERIENCE_MIN_FIELD_LENGTH = 40;

/** Error de contrato: la entrada no cumple cue+lesson+evidence. */
export class IncompleteExperienceError extends Error {
  constructor(
    readonly missing: readonly string[],
    readonly topicKey: string
  ) {
    super(
      `Experiencia incompleta en "${topicKey}": ${missing.join(', ')}. ` +
        'El contrato exige cue, lesson y evidence con contenido util: ' +
        'una entrada vacia, demasiado corta o repetida no se guarda.'
    );
    this.name = 'IncompleteExperienceError';
  }
}

/** Areas tematicas aprobadas por rules/TOPIC-KEY-CONVENTION.md. */
export const APPROVED_TOPIC_AREAS: readonly string[] = [
  'architecture',
  'bugfix',
  'config',
  'security',
  'ops',
  'testing',
  'migration',
  'decision',
  'discovery',
  'pattern',
  'learning',
];

const TOPIC_KEY_RE = /^[a-z][a-z0-9-]+\/[a-z][a-z0-9-]+$/;

/** Valida una clave tematica contra la convencion del repo. */
export function assertTopicKey(topicKey: string): void {
  if (!TOPIC_KEY_RE.test(topicKey)) {
    throw new Error(
      `Clave tematica invalida "${topicKey}": se espera <area>/<subject> en kebab-case (regla TOPIC-KEY-CONVENTION).`
    );
  }
  if (topicKey.length > 60) {
    throw new Error(`Clave tematica "${topicKey}" excede 60 caracteres.`);
  }
  const area = topicKey.split('/')[0] as string;
  if (!APPROVED_TOPIC_AREAS.includes(area)) {
    throw new Error(
      `Area tematica "${area}" no aprobada. Areas validas: ${APPROVED_TOPIC_AREAS.join(', ')}.`
    );
  }
}

/**
 * Verifica el contrato de la entrada.
 *
 * @throws IncompleteExperienceError si falta cue, lesson o evidence.
 */
export function assertCompleteEntry(entry: ExperienceEntry): void {
  const missing = EXPERIENCE_CONTRACT_FIELDS.filter((field) => {
    const value = entry[field];
    return typeof value !== 'string' || value.trim().length === 0;
  });
  if (missing.length > 0) throw new IncompleteExperienceError(missing, entry.topicKey);
  assertTopicKey(entry.topicKey);
  if (!entry.domain.trim()) {
    throw new IncompleteExperienceError(['domain'], entry.topicKey);
  }

  // Anti-boilerplate: un campo de relleno cumple "no vacio" y no aporta nada.
  const weak = EXPERIENCE_CONTRACT_FIELDS.filter(
    (field) => entry[field].trim().length < EXPERIENCE_MIN_FIELD_LENGTH
  );
  if (weak.length > 0) {
    throw new IncompleteExperienceError(weak, entry.topicKey);
  }

  // cue y lesson no pueden ser el mismo texto: son dos preguntas distintas.
  if (entry.cue.trim() === entry.lesson.trim()) {
    throw new IncompleteExperienceError(['cue', 'lesson'], entry.topicKey);
  }
}

/* ── Tabla (lazy, idempotente) ── */

export const HARNESS_EXPERIENCES_DDL = `
CREATE TABLE IF NOT EXISTS harness_experiences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_key TEXT NOT NULL,
  domain TEXT NOT NULL,
  cue TEXT NOT NULL,
  lesson TEXT NOT NULL,
  evidence TEXT NOT NULL,
  confidence TEXT NOT NULL,
  edits_json TEXT NOT NULL,
  verified_edits_json TEXT,
  task_id TEXT,
  harness_snapshot TEXT,
  adopted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_harness_experiences_domain ON harness_experiences (domain);
CREATE INDEX IF NOT EXISTS idx_harness_experiences_topic ON harness_experiences (topic_key);
CREATE INDEX IF NOT EXISTS idx_harness_experiences_adopted ON harness_experiences (adopted_at);
`;

export function ensureExperiencesTable(db: Database.Database): void {
  db.exec(HARNESS_EXPERIENCES_DDL);
  // La tabla puede venir de una version anterior (sin la columna de
  // ediciones verificadas). El ALTER es idempotente: si la columna ya esta,
  // SQLite avisa y se sigue.
  const columns = db.prepare('PRAGMA table_info(harness_experiences)').all() as Array<{
    name: string;
  }>;
  if (!columns.some((c) => c.name === 'verified_edits_json')) {
    db.exec('ALTER TABLE harness_experiences ADD COLUMN verified_edits_json TEXT');
  }
}

/* ── Escritura ── */

/**
 * Guarda una experiencia.
 *
 * El contrato se verifica ANTES de tocar la base: una entrada incompleta no
 * deja ni una fila, ni una projection, ni un archivo.
 *
 * La clave natural es `(topic_key, task_id)`: reejecutar la MISMA tarea
 * actualiza la leccion en vez de duplicarla. Una biblioteca de experiencia que
 * se llena de copias de la misma leccion deja de servir para aprender.
 */
export function addExperience(
  db: Database.Database,
  entry: ExperienceEntry,
  now: string = new Date().toISOString()
): ExperienceRecord {
  assertCompleteEntry(entry);
  ensureExperiencesTable(db);

  const existing = db
    .prepare(
      `SELECT id FROM harness_experiences
        WHERE topic_key = ? AND IFNULL(task_id, '') = IFNULL(?, '')
        ORDER BY id DESC`
    )
    .all(entry.topicKey, entry.taskId ?? null) as Array<{ id: number }>;

  if (existing.length > 0) {
    const keep = (existing[0] as { id: number }).id;
    for (const dup of existing.slice(1)) {
      db.prepare('DELETE FROM harness_experiences WHERE id = ?').run(dup.id);
    }
    db.prepare(
      `UPDATE harness_experiences
          SET domain = ?, cue = ?, lesson = ?, evidence = ?, confidence = ?,
              edits_json = ?, verified_edits_json = ?, harness_snapshot = ?, adopted_at = ?
        WHERE id = ?`
    ).run(
      entry.domain,
      entry.cue,
      entry.lesson,
      entry.evidence,
      entry.confidence,
      JSON.stringify(entry.edits ?? []),
      entry.verifiedEdits ? JSON.stringify(entry.verifiedEdits) : null,
      entry.harnessSnapshot ?? null,
      now,
      keep
    );
    return {
      ...entry,
      edits: entry.edits ?? [],
      id: keep,
      adoptedAt: now,
    };
  }

  const info = db
    .prepare(
      `INSERT INTO harness_experiences
         (topic_key, domain, cue, lesson, evidence, confidence, edits_json, verified_edits_json, task_id, harness_snapshot, adopted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      entry.topicKey,
      entry.domain,
      entry.cue,
      entry.lesson,
      entry.evidence,
      entry.confidence,
      JSON.stringify(entry.edits ?? []),
      entry.verifiedEdits ? JSON.stringify(entry.verifiedEdits) : null,
      entry.taskId ?? null,
      entry.harnessSnapshot ?? null,
      now
    );
  return { ...entry, edits: entry.edits ?? [], id: Number(info.lastInsertRowid), adoptedAt: now };
}

/* ── Lectura ── */

interface ExperienceRow {
  id: number;
  topic_key: string;
  domain: string;
  cue: string;
  lesson: string;
  evidence: string;
  confidence: string;
  edits_json: string;
  verified_edits_json: string | null;
  task_id: string | null;
  harness_snapshot: string | null;
  adopted_at: string;
}

function toRecord(row: ExperienceRow): ExperienceRecord {
  let edits: string[] = [];
  try {
    const parsed = JSON.parse(row.edits_json) as unknown;
    if (Array.isArray(parsed)) edits = parsed.filter((e): e is string => typeof e === 'string');
  } catch {
    edits = [];
  }
  let verifiedEdits: string[] | undefined;
  if (row.verified_edits_json) {
    try {
      const parsed = JSON.parse(row.verified_edits_json) as unknown;
      if (Array.isArray(parsed)) {
        verifiedEdits = parsed.filter((e): e is string => typeof e === 'string');
      }
    } catch {
      verifiedEdits = undefined;
    }
  }
  return {
    id: row.id,
    topicKey: row.topic_key,
    domain: row.domain,
    cue: row.cue,
    lesson: row.lesson,
    evidence: row.evidence,
    confidence: row.confidence as Confidence,
    edits,
    verifiedEdits,
    taskId: row.task_id ?? undefined,
    harnessSnapshot: row.harness_snapshot ?? undefined,
    adoptedAt: row.adopted_at,
  };
}

export interface ExperienceQuery {
  domain?: string;
  topicKey?: string;
  limit?: number;
}

/** Lista experiencias, opcionalmente filtradas por dominio o clave tematica. */
export function listExperiences(
  db: Database.Database,
  query: ExperienceQuery = {}
): ExperienceRecord[] {
  if (!tableExists(db)) return [];
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (query.domain) {
    clauses.push('domain = ?');
    params.push(query.domain);
  }
  if (query.topicKey) {
    clauses.push('topic_key = ?');
    params.push(query.topicKey);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = query.limit && query.limit > 0 ? `LIMIT ${Number(query.limit)}` : '';
  const rows = db
    .prepare(`SELECT * FROM harness_experiences ${where} ORDER BY adopted_at DESC, id DESC ${limit}`)
    .all(...params) as ExperienceRow[];
  return rows.map(toRecord);
}

/** Devuelve los dominios que tienen al menos una experiencia. */
export function listDomains(db: Database.Database): string[] {
  if (!tableExists(db)) return [];
  const rows = db
    .prepare('SELECT DISTINCT domain FROM harness_experiences ORDER BY domain')
    .all() as Array<{ domain: string }>;
  return rows.map((r) => r.domain);
}

export function countExperiences(db: Database.Database): number {
  if (!tableExists(db)) return 0;
  const row = db.prepare('SELECT COUNT(*) AS n FROM harness_experiences').get() as { n: number };
  return row.n;
}

function tableExists(db: Database.Database): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='harness_experiences'")
    .get() as { name?: string } | undefined;
  return Boolean(row?.name);
}

/* ── Proyeccion en disco ── */

/** Raiz de la proyeccion legible y versionable. */
export function projectionRoot(repoRoot: string = process.cwd()): string {
  return join(repoRoot, 'docs', 'harness-experience');
}

/** Raiz de los artefactos de corrida (arboles de harness adoptados). */
export function artifactsRoot(repoRoot: string = process.cwd()): string {
  return join(repoRoot, '.runtime', 'harness-experience');
}

/** Directorio de un dominio dentro de la proyeccion. */
export function domainDir(domain: string, repoRoot: string = process.cwd()): string {
  return join(projectionRoot(repoRoot), domain);
}

/**
 * Escribe el arbol completo de un harness adoptado.
 *
 * Se transporta ENTERO, nunca resumido: un resumen no es auditable. Cada
 * archivo se escribe bajo `<rel>` para que la estructura del harness quede
 * reproducible.
 */
export function saveHarnessSnapshot(
  domain: string,
  taskId: string,
  tree: HarnessTree,
  repoRoot: string = process.cwd()
): string {
  const relBase = join('.runtime', 'harness-experience', domain, 'harnesses', taskId, 'harness');
  const base = join(repoRoot, relBase);
  // El snapshot se BORRA antes de escribir: el directorio se reutiliza para
  // la misma tarea, y sin esta limpieza acumularia los archivos de corridas
  // viejas. Con residuos, la promocion sube reglas que la leccion actual no
  // toco (medido: proponia REGLA-001.md de un run anterior).
  rmSync(base, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(tree)) {
    const target = join(base, rel);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, content, 'utf-8');
  }
  // Se devuelve la ruta RELATIVA al repo: la proyeccion es versionable y una
  // ruta absoluta de la maquina no puede viajar en un archivo versionado
  // (rules/AI-NORMATIVES.md 6.2: no path disclosure).
  return relBase.replace(/\\/g, '/');
}

/** Lee de vuelta el arbol de harness adoptado. */
export function loadHarnessSnapshot(
  domain: string,
  taskId: string,
  repoRoot: string = process.cwd()
): HarnessTree {
  const base = join(artifactsRoot(repoRoot), domain, 'harnesses', taskId, 'harness');
  const tree: HarnessTree = {};
  if (!existsSync(base)) return tree;
  for (const rel of walkFiles(base)) {
    const abs = join(base, rel);
    tree[rel] = readFileSync(abs, 'utf-8');
  }
  return tree;
}

/** Enumera archivos de un arbol en disco, con rutas relativas POSIX. */
function walkFiles(dir: string, prefix = '', out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(abs, rel, out);
    else if (statSync(abs).isFile()) out.push(rel);
  }
  return out;
}

/** Renderiza el INDEX.md de un dominio. */
export function renderDomainIndex(domain: string, records: ExperienceRecord[]): string {
  const lines: string[] = [];
  lines.push(`# Experiencia del harness — ${domain}`);
  lines.push('');
  lines.push('> Generado por `src/knowledge/experience-library.ts`. No editar a mano.');
  lines.push('> Cada entrada cumple el contrato `cue` + `lesson` + `evidence`.');
  lines.push('');
  if (records.length === 0) {
    lines.push('Sin experiencias adoptadas en este dominio todavia.');
    lines.push('');
    return lines.join('\n');
  }
  lines.push('| Fecha | Clave | Confianza | Cuando (cue) | Que hacer (lesson) |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const record of records) {
    const cue = record.cue.replace(/\|/g, '\\|');
    const lesson = record.lesson.replace(/\|/g, '\\|');
    lines.push(
      `| ${record.adoptedAt.slice(0, 10)} | \`${record.topicKey}\` | ${record.confidence} | ${cue} | ${lesson} |`
    );
  }
  lines.push('');
  return lines.join('\n');
}

/** Escribe el INDEX.md de un dominio. */
export function writeDomainIndex(
  domain: string,
  records: ExperienceRecord[],
  repoRoot: string = process.cwd()
): string {
  const dir = domainDir(domain, repoRoot);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'INDEX.md');
  writeFileSync(path, renderDomainIndex(domain, records), 'utf-8');
  return path;
}

/** Renderiza el EXPERIENCE.md de una adopcion. */
export function renderExperienceNote(record: ExperienceRecord): string {
  const lines: string[] = [];
  lines.push(`# Adopcion — ${record.topicKey}`);
  lines.push('');
  lines.push(`- **Dominio:** ${record.domain}`);
  lines.push(`- **Adoptada:** ${record.adoptedAt}`);
  lines.push(`- **Confianza:** ${record.confidence}`);
  if (record.taskId) lines.push(`- **Corrida:** ${record.taskId}`);
  if (record.harnessSnapshot) lines.push(`- **Arbol adoptado:** ${record.harnessSnapshot}`);
  lines.push('');
  lines.push('## Cuando');
  lines.push('');
  lines.push(record.cue);
  lines.push('');
  lines.push('## Que hacer');
  lines.push('');
  lines.push(record.lesson);
  lines.push('');
  lines.push('## Evidencia');
  lines.push('');
  lines.push(record.evidence);
  lines.push('');
  if (record.edits && record.edits.length > 0) {
    lines.push('## Rutas editadas');
    lines.push('');
    for (const edit of record.edits) lines.push(`- \`${edit}\``);
    lines.push('');
  }
  return lines.join('\n');
}

/** Escribe el EXPERIENCE.md de una adopcion. */
export function writeExperienceNote(
  domain: string,
  taskId: string,
  record: ExperienceRecord,
  repoRoot: string = process.cwd()
): string {
  const dir = join(domainDir(domain, repoRoot), 'harnesses', taskId);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'EXPERIENCE.md');
  writeFileSync(path, renderExperienceNote(record), 'utf-8');
  return path;
}

/**
 * Adopta una experiencia completa: verifica contrato, escribe en Nexus,
 * proyecta en disco y devuelve el registro.
 *
 * Si algo falla, no queda estado parcial: el contrato se verifica primero.
 */
export function adoptExperience(
  db: Database.Database,
  entry: ExperienceEntry,
  repoRoot: string = process.cwd()
): ExperienceRecord {
  assertCompleteEntry(entry);
  const record = addExperience(db, entry);
  if (entry.taskId) {
    writeExperienceNote(entry.domain, entry.taskId, record, repoRoot);
  }
  writeDomainIndex(entry.domain, listExperiences(db, { domain: entry.domain }), repoRoot);
  return record;
}

/** Ruta absoluta de la base Nexus por defecto del stack. */
export function nexusDbPath(repoRoot: string = process.cwd()): string {
  return join(resolve(repoRoot), '.runtime', 'gentle-vanguard.db');
}
