#!/usr/bin/env node

/**
 * docs-facts-drift-gate.ts — Las cifras de la documentacion no pueden quedar viejas.
 *
 * POR QUE EXISTE (2026-11-23)
 * `decks-facts-drift-gate.ts` vigila lo que se DECLARA en una presentacion. Queda
 * un hermano mas grande: lo que se AFIRMA en la documentacion (READMEs del repo
 * publico y privado, docs/, READMEs de apps, HTML de la landing). El modo de
 * falla es el mismo y es concreto: el repo publico de GentleVanguard anuncia
 * "263 skills" mientras el canon mide 265 indexadas, o dice "30 quality gates"
 * cuando el registro tiene 70. Nadie lo detecta porque la documentacion no
 * tiene gate: los gates que existen miran los decks, no los README.
 *
 * QUE CHEQUEA
 *   1. Mide los hechos del repo (fuente unica: el repo).
 *   2. Escanea las superficies de documentacion y extrae afirmaciones
 *      cuantitativas sobre el inventario del stack.
 *   3. Compara cada afirmacion contra el hecho medido. Si no coincide, falla.
 *
 * DECISIONES DE DISENO (evitan los dos falsos clasicos)
 *   - AMBIGUIDAD -> NO SE EVALUA. Un "4 agentes" que habla de un pipeline
 *     concreto no es una afirmacion sobre el inventario del stack. Cada claim
 *     tiene un QUALIFIER: si el contexto no califica la afirmacion, el claim
 *     se cuenta como "ambiguo" y no se evalua. Un gate que falla por falso
 *     positivo entrena al owner a ignorar la salida (ver bitacora 2026-11-23).
 *   - CONTEXTO HISTORICO -> EXENTO, con marcadores explicitos. "En 4.0 habia
 *     154 checks" es un registro, no una mentira: corregirlo falsifica la
 *     historia. El gate distingue "estado actual" de "release pasada".
 *   - NUMERO FIJO EN EL CODIGO -> NUNCA. Todos los valores esperados salen de
 *     medir el repo en el momento; no hay literales de version ni de conteo
 *     escritos a mano en este archivo.
 *
 * USO
 *   node --import tsx src/tools/docs-facts-drift-gate.ts
 *   node --import tsx src/tools/docs-facts-drift-gate.ts --json
 *   node --import tsx src/tools/docs-facts-drift-gate.ts --facts
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, type Dirent } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectStackFacts } from '../ops/stack-facts.js';
import { measureFacts as measureDeckFacts } from './decks-facts-drift-gate.js';

/* eslint-disable security/detect-unsafe-regex --
   Los patrones de afirmacion son LITERALES y ACOTADOS: se aplican sobre
   archivos del repo (documentacion propia), nunca sobre input de usuario. El
   `(?<![\w.])` + `(\d+)` es lineal: no hay cuantificador anidado ni
   alternancia ambigua, solo un lookbehind de ancho fijo. */

// ─── Hechos del repo ────────────────────────────────────────────────────────

export interface DocsFacts {
  version: string;
  skills: { canonical: number; indexed: number; critical: number };
  agents: number;
  checks: number;
  ruleFiles: number;
  npmScripts: number;
  tsFiles: number;
  testFiles: number;
  nexus: { tables: number; migrations: number };
  apps: { total: number; native: number; client: number };
  mcpServers: number;
  watchtowerComponents: number;
  academy: { courses: number; ebooks: number; toolkits: number; products: number };
}

/** Cuentos del registro de apps (fuente unica: config/apps.registry.json). */
function measureApps(root: string): DocsFacts['apps'] {
  const empty = { total: 0, native: 0, client: 0 };
  const file = join(root, 'config', 'apps.registry.json');
  if (!existsSync(file)) return empty;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
      apps?: Array<{ scope?: string }>;
    };
    const apps = parsed.apps ?? [];
    const native = apps.filter((a) => (a.scope ?? '').toLowerCase() === 'native').length;
    const client = apps.filter((a) => (a.scope ?? '').toLowerCase() === 'client').length;
    return { total: apps.length, native, client };
  } catch {
    return empty;
  }
}

/** Mide todos los hechos del repo. */
export function measureDocsFacts(root: string): DocsFacts {
  const stack = collectStackFacts(root);
  const deck = measureDeckFacts(root).facts;
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    version?: string;
    scripts?: Record<string, string>;
  };
  const mcpRegistry = join(root, 'config', 'mcp-registry.json');
  let mcpServers = 0;
  if (existsSync(mcpRegistry)) {
    try {
      const parsed = JSON.parse(readFileSync(mcpRegistry, 'utf8')) as {
        servers?: unknown[];
      };
      mcpServers = (parsed.servers ?? []).length;
    } catch {
      mcpServers = 0;
    }
  }
  return {
    version: pkg.version ?? '0.0.0',
    skills: {
      canonical: stack.skills.canonical,
      indexed: stack.skills.indexed,
      critical: stack.skills.critical,
    },
    agents: stack.agents.opencode,
    checks: stack.watchtower.checks,
    ruleFiles: stack.governance.ruleFiles,
    npmScripts: Object.keys(pkg.scripts ?? {}).length,
    tsFiles: stack.tooling.typescriptFiles,
    testFiles: stack.tooling.testFiles,
    nexus: { tables: stack.nexus.tables, migrations: stack.nexus.migrations },
    apps: measureApps(root),
    mcpServers,
    watchtowerComponents: deck.watchtower.components,
    academy: {
      courses: deck.academy.courses,
      ebooks: deck.academy.ebooks,
      toolkits: deck.academy.toolkits,
      products: deck.academy.products,
    },
  };
}

// ─── Superficie escaneada ───────────────────────────────────────────────────

/**
 * Superficies de documentacion que declaran el inventario del stack.
 *
 * La superficie es DELIBERADAMENTE CHICA. `docs/` tiene 50+ subdirectorios y
 * cientos de auditorias con fecha: son registros point-in-time, no estado
 * actual, y auditarlos como si lo fueran produce cientos de falsos positivos
 * (medido: 346 errores, de los cuales la mayoria eran informes de auditoria
 * de octubre congelados en su momento).
 *
 * Se escanea lo que un lector lee HOY para conocer el stack:
 *   - los README (publico, privado, getting started)
 *   - la documentacion de raiz de docs/ (26 archivos)
 *   - la documentacion pedagogica (docs/educacion) y la de referencia
 *   - los README de apps/ y packages/
 *   - el HTML de la landing publica (lo que ve el cliente)
 *
 * Se excluyen a proposito:
 *   - docs/adr/, docs/plans/, docs/analysis/, docs/releases/, ... : registro
 *     historico por definicion.
 *   - docs/generated/ : es la FUENTE de los hechos; no puede contradecirse.
 *   - docs/presentations/decks/ : lo cubre decks-facts-drift-gate.
 *   - CHANGELOG*      : registro de release por release.
 *   - todo archivo con fecha en el nombre (auditorias point-in-time).
 */
/**
 * Superficie de la auditoria. El tipo es EXPLICITO porque un literal de array
 * con formas distintas se inferia como un solo objeto con propiedades
 * opcionales: `scope.path` quedaba en `string | undefined` y el typecheck del
 * repo (que corre en pre-push) fallaba.
 */
type DocScope =
  | { kind: 'file'; path: string }
  | { kind: 'dir'; dir: string; ext?: string; name?: string; depth?: number };

const SCOPE_FILES: DocScope[] = [
  { kind: 'file', path: 'README.md' },
  { kind: 'file', path: 'README-PUBLIC.md' },
  { kind: 'file', path: 'GETTING-STARTED.md' },
  { kind: 'dir', dir: 'docs', ext: '.md', depth: 1 },
  { kind: 'dir', dir: 'docs/educacion', ext: '.md' },
  { kind: 'dir', dir: 'docs/reference', ext: '.md' },
  { kind: 'dir', dir: 'apps', name: 'README.md' },
  { kind: 'dir', dir: 'packages', name: 'README.md' },
  { kind: 'dir', dir: 'apps/academy-landing', ext: '.html' },
];

/** Nombre con fecha: informe point-in-time, no estado actual. */
const DATED_NAME = /20\d\d-\d\d(-\d\d)?/;

/** Marcadores de contexto historico: la afirmacion describe el pasado. */
const HISTORICAL_MARKERS =
  /\b(hist[oó]ric|hist[oó]rica|historia|bit[áa]cora|lanzamiento|lanz[oó]|pasado|pas[oó]|anterior|antigu|legacy|obsolet|deprecad|informe|reporte|auditor[íi]a|benchmark|comparativa|cierre|activaci[óo]n|absorpci[óo]n|release\s+v?\d+\.\d+|@\d{4}-\d{2}-\d{2}|20\d\d-\d{2}-\d{2})/i;

/**
 * Documentos point-in-time: registran el estado del stack en un momento dado.
 * Sus cifras no son "afirmaciones actuales": corregirlas falsifica el registro.
 * Se detectan por nombre/ruta, no por contenido (el nombre es la señal de que
 * el documento es un registro, no una referencia vigente).
 */
const HISTORICAL_DOC_RE =
  /(?:^|[/_.-])(BITACORA|BENCHMARK|COMPARATIV\w*|ACTIVACION|ABSORPTION|AUDITOR\w*|RDD|INFORME\w*|REPORTE\w*|POSTMORTEM|RETROSPECT\w*|ANALYSIS|LEGACY|legacy|cloud)(?:[/_.-]|$)/;

/**
 * Palabras que preceden al numero y delatan una MENCION DE SUBCONJUNTO
 * ("incluye 2 skills que solo existen en mirrors"): no es una afirmacion
 * sobre el total del stack, es una enumeracion parcial.
 */
const SUBSET_MARKER =
  /(?:incluye|incluyendo|solo |solamente|un subconjunto|los mirrors|mirrors)\s*$/i;

export interface DocFile {
  path: string;
  text: string;
}

/**
 * Archivos del repo que hay que auditar: los versionados **y los nuevos sin
 * commitear** (excluyendo lo que .gitignore marca).
 *
 * POR QUE los sin commitear (2026-11-23)
 * Con `git ls-files` pelado, un documento recien creado no lo audita NINGUN
 * gate hasta que se commitea: el gate daba verde sobre un doc nuevo con
 * cifras viejas. `--others --exclude-standard` mete lo no trackeado (menos lo
 * ignorado) sin meter ruido de `.runtime/` ni `node_modules/`.
 */
function trackedFiles(root: string): string[] {
  try {
    const out = execFileSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      },
    );
    const files = out.split('\0').filter(Boolean);
    if (files.length > 0) return files;
  } catch {
    // Sin git: se cae al filesystem.
  }
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: Dirent[] = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(relative(root, full).split('\\').join('/'));
    }
  };
  walk(root);
  return out;
}

/** Reune los archivos de la superficie de documentacion. */
export function collectDocFiles(root: string): DocFile[] {
  const tracked = new Set(trackedFiles(root));
  const all = trackedFiles(root);
  const files: DocFile[] = [];
  const seen = new Set<string>();

  const push = (relPath: string): void => {
    if (seen.has(relPath)) return;
    const full = join(root, relPath);
    if (!existsSync(full)) return;
    seen.add(relPath);
    files.push({ path: relPath, text: readFileSync(full, 'utf8') });
  };

  for (const scope of SCOPE_FILES) {
    if (scope.kind === 'file') {
      if (tracked.has(scope.path)) push(scope.path);
      continue;
    }
    const dir = scope.dir;
    const ext = scope.ext;
    const name = scope.name;
    const depth = scope.depth;
    for (const relPath of all) {
      if (!relPath.startsWith(`${dir}/`)) continue;
      if (depth !== undefined) {
        const rest = relPath.slice(dir.length + 1);
        if (rest.includes('/')) continue;
      }
      if (DATED_NAME.test(relPath.split('/').pop() ?? '')) continue;
      if (name) {
        if (!relPath.endsWith(`/${name}`)) continue;
      } else if (ext) {
        if (!relPath.endsWith(ext)) continue;
      } else {
        continue;
      }
      push(relPath);
    }
  }
  return files;
}

// ─── Afirmaciones ──────────────────────────────────────────────────────────

export interface ClaimSpec {
  /** Id del hecho que la afirmacion deberia respectar. */
  fact: string;
  /** Etiqueta legible para el reporte. */
  label: string;
  /** Regex de la afirmacion: el grupo 1 es el numero afirmado. */
  re: RegExp;
  /**
   * Calificador OBLIGATORIO: sin una coincidencia en el contexto, la
   * afirmacion es ambigua y NO se evalua.
   */
  qualifier: RegExp;
  /**
   * Valores aceptables para este hecho (se derivan de la medicion).
   *
   * `string` entra acá porque un hecho puede ser un valor y no un conteo: la
   * version del stack ("4.5.0") no es un numero, y forzarla a number la
   * convertia en NaN (afirmacion que nunca se evaluaba).
   */
  acceptable: (facts: DocsFacts) => (number | string)[];
  /**
   * Evaluar el calificador sobre la LINEA en vez de la ventana de contexto.
   * Mas preciso, menos cobertura: se usa donde la ventana de ±120 chars
   * arrastra la palabra de otra frase y produce falsos positivos.
   */
  lineQualifier?: boolean;
  /**
   * Palabras que, inmediatamente despues del numero, indican que hay otra
   * especificidad (la captura un spec mas preciso): "29 skills CRITICAS".
   */
  refinedBy?: RegExp;
}

export const CLAIM_SPECS: ClaimSpec[] = [
  {
    fact: 'skills',
    label: 'skills canonicas',
    re: /(?<![\w.])(\d+)\s+skills?\b/gi,
    qualifier:
      /can[oó]nic|indexad|cr[íi]tic|critical|en total|del stack|globales|disponibles|repositorio/i,
    acceptable: (f) => [f.skills.canonical, f.skills.indexed],
    refinedBy: /cr[íi]tic|can[óo]nic|indexad|reutilizab|especializad/i,
  },
  {
    fact: 'skills-canonical',
    label: 'skills canonicas',
    re: /(?<![\w.])(\d+)\s+skills?\s+(?:can[oó]nic\w*|canonic\w*)/gi,
    qualifier: /can[oó]nic/i,
    acceptable: (f) => [f.skills.canonical],
  },
  {
    fact: 'skills-critical',
    label: 'skills criticas',
    re: /(?<![\w.])(\d+)\s+skills?\s+(?:cr[íi]tic\w*|critical\w*)/gi,
    qualifier: /cr[íi]tic|critical/i,
    acceptable: (f) => [f.skills.critical],
  },
  {
    fact: 'agents',
    label: 'agentes OpenCode',
    re: /(?<![\w.])(\d+)\s+agentes?\b/gi,
    qualifier: /OpenCode|roster|especializad|en total|registrad|flota|disponibles/i,
    acceptable: (f) => [f.agents],
  },
  {
    fact: 'checks',
    label: 'checks del watchtower',
    re: /(?<![\w.])(\d+)\s+(?:checks|controladores)\b/gi,
    qualifier: /watchtower|monitor|salud|health|registrad|autom[áa]tic|componentes/i,
    acceptable: (f) => [f.checks],
    lineQualifier: true,
  },
  {
    fact: 'rule-files',
    label: 'archivos de reglas',
    re: /(?<![\w.])(\d+)\s+(?:reglas|normas|normativas)\s+(?:de\s+)?(?:archivo|archivos|t[ée]cnica|t[ée]cnicas|stack|repositorio|repo)/gi,
    qualifier: /archivo|stack|repo|t[ée]cnica/i,
    acceptable: (f) => [f.ruleFiles],
  },
  {
    fact: 'npm-scripts',
    label: 'scripts npm',
    re: /(?<![\w.])(\d+)\s+scripts\s+(?:de\s+)?npm\b/gi,
    qualifier: /npm/i,
    acceptable: (f) => [f.npmScripts],
  },
  {
    fact: 'ts-files',
    label: 'archivos TypeScript',
    re: /(?<![\w.])(\d+)\s+archivos\s+(?:de\s+)?TypeScript\b/gi,
    qualifier: /TypeScript|\.ts/i,
    acceptable: (f) => [f.tsFiles],
  },
  {
    fact: 'test-files',
    label: 'archivos de test',
    re: /(?<![\w.])(\d+)\s+(?:archivos\s+de\s+(?:test|prueba)|tests?\s+(?:unitarios|de\s+prueba))/gi,
    qualifier: /repositorio|repo|del stack|en total|globales/i,
    acceptable: (f) => [f.testFiles],
  },
  {
    fact: 'watchtower-components',
    label: 'componentes del watchtower',
    re: /(?<![\w.])(\d+)\s+componentes\b/gi,
    qualifier: /watchtower|checks|controladores/i,
    acceptable: (f) => [f.watchtowerComponents],
    lineQualifier: true,
  },
  {
    fact: 'nexus-tables',
    label: 'tablas de Nexus',
    re: /(?<![\w.])(\d+)\s+tablas\b/gi,
    qualifier: /Nexus|SQLite|base\s+de\s+datos|\bdb\b/i,
    acceptable: (f) => [f.nexus.tables],
  },
  {
    fact: 'nexus-migrations',
    label: 'migraciones de Nexus',
    re: /(?<![\w.])(\d+)\s+migraciones\b/gi,
    qualifier: /Nexus|SQLite|base\s+de\s+datos|\bdb\b/i,
    acceptable: (f) => [f.nexus.migrations],
  },
  {
    fact: 'mcp-servers',
    label: 'servidores MCP',
    re: /(?<![\w.])(\d+)\s+servidores?\s+MCP\b/gi,
    qualifier: /MCP/i,
    acceptable: (f) => [f.mcpServers],
  },
  {
    fact: 'apps',
    label: 'apps registradas',
    re: /(?<![\w.])(\d+)\s+apps?\b/gi,
    qualifier: /registrad|en total|del stack|nativas|client/i,
    acceptable: (f) => [f.apps.total, f.apps.native, f.apps.client],
  },
  {
    fact: 'academy-courses',
    label: 'cursos publicados',
    re: /(?<![\w.])(\d+)\s+cursos\b/gi,
    qualifier: /Academy|cat[áa]log|publicad|disponibl|en total/i,
    acceptable: (f) => [f.academy.courses],
  },
  {
    fact: 'academy-ebooks',
    label: 'ebooks publicados',
    re: /(?<![\w.])(\d+)\s+ebooks?\b/gi,
    qualifier: /Academy|cat[áa]log|publicad|disponibl|en total/i,
    acceptable: (f) => [f.academy.ebooks],
  },
  {
    fact: 'academy-toolkits',
    label: 'toolkits publicados',
    re: /(?<![\w.])(\d+)\s+toolkits?\b/gi,
    qualifier: /Academy|cat[áa]log|publicad|disponibl|en total/i,
    acceptable: (f) => [f.academy.toolkits],
  },
  {
    fact: 'version',
    label: 'version del stack',
    re: /(?:versi[oó]n\s+(?:actual|release|v?)|release\s+(?:actual|v)|(?:stack|build)\s+v)(?:=|:)?\s*v?(\d+\.\d+\.\d+)/gi,
    qualifier: /actual|current|release|stack|build/i,
    acceptable: (f) => [f.version],
  },
];

// ─── Baseline (exenciones explicitas, con motivo) ──────────────────────────

export interface BaselineEntry {
  file: string;
  claim: string;
  fact: string;
  reason: string;
}

export interface Baseline {
  entries: BaselineEntry[];
}

export function loadBaseline(root: string): Baseline {
  const file = join(root, 'config', 'baselines', 'docs-facts-drift.json');
  if (!existsSync(file)) return { entries: [] };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Baseline>;
    return { entries: parsed.entries ?? [] };
  } catch {
    return { entries: [] };
  }
}

// ─── Reporte ────────────────────────────────────────────────────────────────

export interface DocsFinding {
  rule: string;
  severity: 'error' | 'warn';
  file: string;
  line: number;
  claim: string;
  message: string;
  fix: string;
  fact: string;
}

export interface DocsReport {
  ok: boolean;
  errors: number;
  warnings: number;
  files: number;
  claims: number;
  evaluated: number;
  ambiguous: number;
  historical: number;
  historicalFiles: number;
  baselined: number;
  findings: DocsFinding[];
  facts: DocsFacts;
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

/** Linea completa que contiene la afirmacion. */
function lineText(text: string, index: number): string {
  const start = text.lastIndexOf('\n', index) + 1;
  const end = text.indexOf('\n', index);
  return text.slice(start, end === -1 ? text.length : end);
}

/**
 * Verifica las afirmaciones de un conjunto de documentos contra los hechos.
 * `baseline` son exenciones explicitas (con motivo) para casos que el gate no
 * puede distinguir por si solo.
 */
export function checkDocsFacts(
  files: DocFile[],
  facts: DocsFacts,
  baseline: Baseline = { entries: [] },
): DocsReport {
  const findings: DocsFinding[] = [];
  const baselineUsed = new Set<string>();
  let claims = 0;
  let evaluated = 0;
  let ambiguous = 0;
  let historical = 0;
  let baselined = 0;
  let historicalFiles = 0;

  const baselineKey = (file: string, fact: string, claim: string): string =>
    `${file}|${fact}|${claim}`;

  for (const file of files) {
    // Documento point-in-time: sus cifras son registro, no estado actual.
    if (HISTORICAL_DOC_RE.test(file.path)) {
      historicalFiles += 1;
      continue;
    }
    // El HTML puede traer el numero en un atributo o en el texto visible.
    const text = file.path.endsWith('.html')
      ? file.text.replace(/<!--[\s\S]*?-->/g, '')
      : file.text;

    for (const spec of CLAIM_SPECS) {
      const acceptable = spec.acceptable(facts).map((n) => String(n));
      const re = new RegExp(spec.re.source, spec.re.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(text)) !== null) {
        claims += 1;
        const raw = match[1] ?? '';
        const claimed = Number(raw);
        const context = text.slice(
          Math.max(0, match.index - 120),
          match.index + match[0].length + 120,
        );
        const claimText = match[0].trim();

        if (!Number.isFinite(claimed)) {
          if (match.index === re.lastIndex) re.lastIndex += 1;
          continue;
        }

        // 1. Contexto historico: la afirmacion describe una release pasada.
        const line = lineText(text, match.index);
        if (HISTORICAL_MARKERS.test(line)) {
          historical += 1;
          if (match.index === re.lastIndex) re.lastIndex += 1;
          continue;
        }

        // 2. Menciones de subconjunto: no son afirmaciones sobre el total.
        const before = text.slice(Math.max(0, match.index - 24), match.index);
        if (SUBSET_MARKER.test(before)) {
          ambiguous += 1;
          if (match.index === re.lastIndex) re.lastIndex += 1;
          continue;
        }

        // 2b. Another more specific spec owns this claim ("29 skills CRITICAS").
        if (spec.refinedBy) {
          const after = text.slice(
            match.index + match[0].length,
            match.index + match[0].length + 24,
          );
          if (spec.refinedBy.test(after)) {
            ambiguous += 1;
            if (match.index === re.lastIndex) re.lastIndex += 1;
            continue;
          }
        }

        // 3. Ambiguidad: sin calificador, no se evalua.
        const qualifierText = spec.lineQualifier ? line : context;
        if (!spec.qualifier.test(qualifierText)) {
          ambiguous += 1;
          if (match.index === re.lastIndex) re.lastIndex += 1;
          continue;
        }

        // 3. Baseline explicito.
        const key = baselineKey(file.path, spec.fact, claimText);
        const entry = baseline.entries.find((e) => baselineKey(e.file, e.fact, e.claim) === key);
        if (entry) {
          baselineUsed.add(key);
          baselined += 1;
          if (match.index === re.lastIndex) re.lastIndex += 1;
          continue;
        }

        evaluated += 1;
        if (!acceptable.includes(String(claimed))) {
          findings.push({
            rule: 'facts/drift',
            severity: 'error',
            file: file.path,
            line: lineOf(text, match.index),
            claim: claimText,
            fact: spec.fact,
            message:
              `la documentacion afirma "${claimText}" pero el repo mide ` +
              `${spec.label}: ${acceptable.join(' / ')}`,
            fix:
              `actualizar la cifra a ${acceptable[0]}` +
              ` (o regenerar los hechos: npm run stack:facts)`,
          });
        }
        if (match.index === re.lastIndex) re.lastIndex += 1;
      }
    }
  }

  // Entradas de baseline que ya no aplican: la excepcion se puede retirar.
  for (const entry of baseline.entries) {
    const key = baselineKey(entry.file, entry.fact, entry.claim);
    if (baselineUsed.has(key)) continue;
    findings.push({
      rule: 'facts/stale-baseline',
      severity: 'warn',
      file: entry.file,
      line: 0,
      claim: entry.claim,
      fact: entry.fact,
      message: `la excepcion "${entry.claim}" ya no aplica: el drift desaparecio`,
      fix: `borrar la entrada del baseline config/baselines/docs-facts-drift.json`,
    });
  }

  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warn').length;
  return {
    ok: errors === 0,
    errors,
    warnings,
    files: files.length,
    claims,
    evaluated,
    ambiguous,
    historical,
    historicalFiles,
    baselined,
    findings,
    facts,
  };
}

export function defaultRoot(): string {
  return join(import.meta.dirname ?? '.', '..', '..');
}

function main(): void {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const showFacts = argv.includes('--facts');
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 && argv[rootIdx + 1] ? argv[rootIdx + 1] : defaultRoot();

  const facts = measureDocsFacts(root);
  if (showFacts) {
    console.log(JSON.stringify({ facts }, null, 2));
    return;
  }

  const report = checkDocsFacts(collectDocFiles(root), facts, loadBaseline(root));

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `docs-facts-drift-gate -> ${report.files} archivos, ${report.claims} cifras, ` +
        `${report.evaluated} evaluadas (${report.ambiguous} ambiguas, ` +
        `${report.historical} historicas, ${report.historicalFiles} docs point-in-time, ` +
        `${report.baselined} exentadas), ` +
        `${report.errors} errores`,
    );
    for (const f of report.findings) {
      console.log(
        `  ${f.severity === 'error' ? 'ERR ' : 'WARN'} ${f.rule} ${f.file}:${f.line}: ${f.message}`,
      );
      console.log(`       fix: ${f.fix}`);
    }
    if (report.ok) console.log('  OK: las cifras de la documentacion coinciden con el repo');
  }

  if (!report.ok) {
    console.error(
      'docs-facts-drift-gate -> FAIL: hay cifras viejas en la documentacion. ' +
        'Una cifra que el repo ya no respalda es una afirmacion falsa publicada.',
    );
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
