#!/usr/bin/env node

/**
 * decks-facts-drift-gate.ts — Las cifras de los decks no pueden quedar viejas.
 *
 * POR QUE EXISTE (2026-11-03)
 * Un deck afirma numeros: quality gates, skills, tablas de Nexus, archivos
 * TypeScript y productos de Academy. Cada uno de
 * esos numeros estaba MEDIDO en algun momento y seguia pegado en la slide
 * mientras el repo seguia creciendo. La consecuencia es concreta: alguien
 * presenta "30 quality gates" en un evento y el stack tiene 35. No es un
 * error de redaccion: es una afirmacion falsa en la sala.
 *
 * QUE CHEQUEA
 *   1. Mide los hechos del repo (fuente unica: el repo, no el deck).
 *   2. Escanea decks y guiones, el copy HTML/i18n del sitio público de
 *      presentaciones y el deck manual fuente, buscando afirmaciones sobre
 *      esos hechos.
 *   3. Si el deck afirma un numero que NO coincide con la medicion, falla.
 *
 * REGLAS DE MEDICION (reproducibles)
 *   Los conteos usan los archivos VERSIONADOS (`git ls-files`): lo que se
 *   presenta es lo que esta commiteado. Si git no esta disponible, se cae al
 *   filesystem con las mismas reglas y se avisa.
 *   - archivos TS en src/   -> `git ls-files` con el patron src/ + .ts
 *   - archivos de test      -> versionados cuyo nombre termina en
 *                               .test. o .spec. seguido de una extension de codigo
 *   - scripts npm           -> claves de `scripts` en package.json
 *   - apps                  -> directorios de `apps/` (sin dotfiles)
 *   - quality gates         -> config/quality-gates.json
 *   - skills / nexus -> src/ops/stack-facts.ts (collectStackFacts)
 *   - agentes del roster -> config/agents.json
 *   - roles mapeados        -> config/subagent-mapping.json
 *   - bindings de modelo    -> config/model-router.json (agentBindings)
 *   - componentes watchtower-> literales de componente en src/core/watchtower
 *   - workflows de CI       -> .github/workflows/*
 *   - catalogo de Academy   -> apps/academy-landing/data/catalog-reco.js
 *
 * AFIRMACIONES PROHIBIDAS
 *   El total de checks del watchtower es DINAMICO (cambia con el estado de la
 *   maquina). Publicar "154 checks" en una slide es publicar un numero que
 *   envejece solo. El gate no lo permite: se dice "35 componentes vigilados".
 *
 * USO
 *   node --import tsx src/tools/decks-facts-drift-gate.ts
 *   node --import tsx src/tools/decks-facts-drift-gate.ts --json
 *   node --import tsx src/tools/decks-facts-drift-gate.ts --facts
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectStackFacts } from '../ops/stack-facts.js';

// ─── Hechos del repo ────────────────────────────────────────────────────────

export interface DeckFacts {
  qualityGates: { total: number; enforced: number; preCommit: number };
  skills: { indexed: number; critical: number };
  nexus: { tables: number; migrations: number };
  agents: { definitions: number; openCode: number; roles: number; bindings: number };
  scale: { tsFiles: number; testFiles: number; npmScripts: number; apps: number };
  watchtower: { components: number };
  academy: {
    products: number;
    courses: number;
    hours: number;
    ebooks: number;
    pages: number;
    premium: number;
    toolkits: number;
  };
  ci: { workflows: number };
}

const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|mts|cts|mjs|cjs|js)$/;

/** Archivos versionados del repo (o fallback al filesystem). */
function trackedFiles(root: string): { files: string[]; source: 'git' | 'filesystem' } {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
    const files = out.split('\0').filter(Boolean);
    if (files.length > 0) return { files, source: 'git' };
  } catch {
    // Sin git: se cae al filesystem.
  }
  return { files: walkFiles(root), source: 'filesystem' };
}

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.runtime']);

function walkFiles(dir: string, out: string[] = []): string[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (IGNORED_DIRS.has(name)) continue;
    const full = join(dir, name);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) walkFiles(full, out);
    else out.push(relative(rootDir, full).split('\\').join('/'));
  }
  return out;
}

let rootDir = '.';

/** Cuenta los componentes del watchtower leidos de su propio codigo. */
function countWatchtowerComponents(root: string): number {
  const dir = join(root, 'src', 'core', 'watchtower');
  const files: string[] = [];
  try {
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.ts')) files.push(join(dir, name));
    }
  } catch {
    return 0;
  }
  const orchestrator = join(root, 'src', 'core', 'maintenance-watchtower.ts');
  if (existsSync(orchestrator)) files.push(orchestrator);
  const components = new Set<string>();
  const re = /addResult\(\s*'([a-z0-9][a-z0-9-]*)'/g;
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      // `system` es el componente de emergencia que se usa cuando un check
      // tira excepcion: no es un componente vigilado, es un contenedor de error.
      if (match[1] === 'system') continue;
      components.add(match[1]);
    }
  }
  return components.size;
}

/** Catalogo publico de Academy: es lo que el cliente puede comprar. */
function readAcademyCatalog(root: string): DeckFacts['academy'] {
  const empty = {
    products: 0,
    courses: 0,
    hours: 0,
    ebooks: 0,
    pages: 0,
    premium: 0,
    toolkits: 0,
  };
  const catalogPath = join(root, 'apps', 'academy-landing', 'data', 'catalog-reco.js');
  if (!existsSync(catalogPath)) return empty;

  // El catalogo es un archivo de navegador: se evalua con un `window` falso
  // para leer la estructura real y no un conteo de texto.
  const sandbox: { GV_RECO?: { products?: Array<{ slug?: string; kind?: string; tier?: string }> } } = {};
  try {
    const source = readFileSync(catalogPath, 'utf8');
    new Function('window', source)(sandbox);
  } catch {
    return empty;
  }
  const products = sandbox.GV_RECO?.products ?? [];
  const slugs = (kind: string): string[] =>
    products.filter((p) => p.kind === kind).map((p) => p.slug ?? '');

  const dataRoot = join(root, 'apps', 'academy-web', 'data');
  let hours = 0;
  for (const slug of slugs('course')) {
    hours += readNumber(join(dataRoot, 'courses', slug, 'course.json'), 'estimatedHours');
  }
  let pages = 0;
  for (const slug of slugs('ebook')) {
    pages += readNumber(join(dataRoot, 'ebooks', slug, 'ebook.json'), 'pages');
  }

  return {
    products: products.length,
    courses: products.filter((p) => p.kind === 'course').length,
    hours,
    ebooks: products.filter((p) => p.kind === 'ebook').length,
    pages,
    premium: products.filter((p) => p.tier === 'ebook-premium').length,
    toolkits: products.filter((p) => p.kind === 'toolkit').length,
  };
}

function readNumber(file: string, key: string): number {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    const value = parsed[key];
    return typeof value === 'number' ? value : 0;
  } catch {
    return 0;
  }
}

/** Mide todos los hechos del repo. */
export function measureFacts(root: string): { facts: DeckFacts; source: 'git' | 'filesystem' } {
  rootDir = root;
  const { files, source } = trackedFiles(root);

  const tsFiles = files.filter((f) => f.startsWith('src/') && f.endsWith('.ts')).length;
  const testFiles = files.filter((f) => TEST_FILE_RE.test(f)).length;

  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const npmScripts = Object.keys(pkg.scripts ?? {}).length;

  let apps = 0;
  try {
    apps = readdirSync(join(root, 'apps')).filter((n) => !n.startsWith('.')).length;
  } catch {
    apps = 0;
  }

  const gatesConfig = JSON.parse(
    readFileSync(join(root, 'config', 'quality-gates.json'), 'utf8'),
  ) as { gates?: Array<{ enforced?: boolean; stage?: string }> };
  const gates = gatesConfig.gates ?? [];

  const subagentMapping = JSON.parse(
    readFileSync(join(root, 'config', 'subagent-mapping.json'), 'utf8'),
  ) as { mapping?: Record<string, unknown> };
  const roles = Object.keys(subagentMapping.mapping ?? {}).length;

  const modelRouter = JSON.parse(
    readFileSync(join(root, 'config', 'model-router.json'), 'utf8'),
  ) as { agentBindings?: Record<string, unknown> };
  const bindings = Object.keys(modelRouter.agentBindings ?? {}).length;

  const agentConfig = JSON.parse(
    readFileSync(join(root, 'config', 'agents.json'), 'utf8'),
  ) as { agents?: Record<string, unknown> };

  let workflows = 0;
  try {
    workflows = readdirSync(join(root, '.github', 'workflows')).filter((f) =>
      f.endsWith('.yml') || f.endsWith('.yaml'),
    ).length;
  } catch {
    workflows = 0;
  }

  const stack = collectStackFacts(root);

  const facts: DeckFacts = {
    qualityGates: {
      total: gates.length,
      enforced: gates.filter((g) => g.enforced).length,
      preCommit: gates.filter((g) => g.stage === 'pre-commit').length,
    },
    skills: { indexed: stack.skills.indexed, critical: stack.skills.critical },
    nexus: { tables: stack.nexus.tables, migrations: stack.nexus.migrations },
    agents: {
      definitions: Object.keys(agentConfig.agents ?? {}).length,
      openCode: stack.agents.opencode,
      roles,
      bindings,
    },
    scale: { tsFiles, testFiles, npmScripts, apps },
    watchtower: { components: countWatchtowerComponents(root) },
    academy: readAcademyCatalog(root),
    ci: { workflows },
  };

  return { facts, source };
}

// ─── Afirmaciones verificables ──────────────────────────────────────────────

export interface ClaimPattern {
  re: RegExp;
  /** Indices de los grupos capturados que llevan el valor, en orden. */
  groups: number[];
}

export interface ClaimSpec {
  id: string;
  label: string;
  /** Valores esperados, en el orden en que aparecen los grupos. */
  expected: number[];
  patterns: ClaimPattern[];
}

/**
 * Modo de comparacion de cada hecho.
 *
 * `exact`: el deck tiene que decir EXACTAMENTE el valor medido. Es el caso de
 * los hechos que se accountable (gates, skills, tablas, componentes,
 * catalogo). Si el numero no coincide, la afirmacion es falsa.
 *
 * `floor`: el deck afirma una CIFRA MINIMA ("mas de 800 archivos"). Estos
 * hechos crecen con cada commit (un archivo nuevo en src/ cambia el conteo),
 * asi que exigir exactitud seria exigir actualizar la slide en cada commit.
 * Lo que no se tolera es EXAGERAR: si el deck dice mas de lo que hay, falla.
 * Si el repo crecio por encima, sale un aviso para refrescar la cifra.
 */
export type FactMode = 'exact' | 'floor';

export const FACT_MODES: Readonly<Record<string, FactMode>> = {
  'ts-files': 'floor',
  'test-files': 'floor',
  'npm-scripts': 'floor',
};

/**
 * Normaliza un numero escrito en un deck: "2.634" y "2,634" son 2634.
 */
export function parseNumber(raw: string): number {
  const cleaned = raw.replace(/[.,]/g, '');
  const value = Number.parseInt(cleaned, 10);
  return Number.isFinite(value) ? value : Number.NaN;
}

/**
 * Definicion de las afirmaciones que el gate sabe verificar.
 *
 * Cada patron captura el numero que el deck AFIRMA; el gate lo compara con
 * la medicion. Si el deck no afirma nada del hecho, no hay nada que fallar.
 */
export const CLAIM_SPECS: readonly ClaimSpec[] = [
  {
    id: 'quality-gates',
    label: 'quality gates',
    expected: [0],
    patterns: [{ re: /(\d+)\s+quality\s+gates/gi, groups: [1] }],
  },
  {
    id: 'quality-gates-enforced',
    label: 'gates aplicados de forma estricta',
    expected: [0, 0],
    patterns: [
      { re: /(\d+)\s+de\s+(\d+)\s+aplicados/gi, groups: [1, 2] },
      { re: /(\d+)\s+of\s+(\d+)\s+enforced/gi, groups: [1, 2] },
    ],
  },
  {
    id: 'quality-gates-pre-commit',
    label: 'gates en pre-commit',
    expected: [0],
    patterns: [
      { re: /(\d+)\s+en\s+pre-commit/gi, groups: [1] },
      { re: /(\d+)\s+on\s+pre-commit/gi, groups: [1] },
    ],
  },
  {
    id: 'skills',
    label: 'skills indexadas',
    expected: [0],
    patterns: [
      // El total indexado. Las skills CRITICAS tienen su propia afirmacion:
      // "28 skills criticas" no es el total, es un subconjunto.
      {
        re: /(\d+)\s+skills(?!\s+cr[ií]t)(?!\s+de\s+ciberseguridad)/gi,
        groups: [1],
      },
      { re: /(\d+)\s+capacidades\b/gi, groups: [1] },
    ],
  },
  {
    id: 'skills-critical',
    label: 'skills criticas',
    expected: [0],
    patterns: [
      { re: /(\d+)\s+skills\s+cr[ií]ticas/gi, groups: [1] },
      { re: /(\d+)\s+critical\s+skills/gi, groups: [1] },
      { re: /(\d+)\s+cr[ií]ticas\b/gi, groups: [1] },
    ],
  },
  {
    id: 'nexus-tables',
    label: 'tablas de Nexus',
    expected: [0],
    patterns: [
      { re: /(\d+)\s+tablas/gi, groups: [1] },
      { re: /(\d+)\s+tables/gi, groups: [1] },
    ],
  },
  {
    id: 'nexus-migrations',
    label: 'migraciones de Nexus',
    expected: [0],
    patterns: [
      { re: /(\d+)\s+migraciones/gi, groups: [1] },
      { re: /(\d+)\s+migrations/gi, groups: [1] },
    ],
  },
  {
    id: 'open-code-agents',
    label: 'agentes OpenCode',
    expected: [0],
    patterns: [
      { re: /(\d+)\s+agentes\s+OpenCode/gi, groups: [1] },
      { re: /(\d+)\s+OpenCode\s+agents/gi, groups: [1] },
    ],
  },
  {
    id: 'agents',
    label: 'agentes del roster',
    expected: [0],
    patterns: [
      { re: /(\d+)\s+agentes(?!\s+OpenCode)/gi, groups: [1] },
      { re: /(\d+)\s+agents/gi, groups: [1] },
    ],
  },
  {
    id: 'roles-mapped',
    label: 'roles mapeados',
    expected: [0],
    patterns: [
      { re: /(\d+)\s+roles\s+mapeados/gi, groups: [1] },
      { re: /(\d+)\s+mapped\s+roles/gi, groups: [1] },
    ],
  },
  {
    id: 'model-bindings',
    label: 'bindings de modelo',
    expected: [0],
    patterns: [{ re: /(\d+)\s+bindings/gi, groups: [1] }],
  },
  {
    id: 'ts-files',
    label: 'archivos TypeScript en src/',
    expected: [0],
    patterns: [
      { re: /(\d+)\s+archivos\s+TypeScript/gi, groups: [1] },
      { re: /(\d+)\s+TypeScript/gi, groups: [1] },
      { re: /(\d+)\s+archivos\s+de\s+c[oó]digo/gi, groups: [1] },
      { re: /(\d+)\s+files\s+of\s+our\s+own\s+code/gi, groups: [1] },
    ],
  },
  {
    id: 'test-files',
    label: 'archivos de test',
    expected: [0],
    patterns: [
      { re: /(\d+)\s+archivos\s+de\s+test/gi, groups: [1] },
      { re: /(\d+)\s+test\s+files/gi, groups: [1] },
    ],
  },
  {
    id: 'npm-scripts',
    label: 'scripts npm',
    expected: [0],
    patterns: [
      { re: /(\d+)\s+scripts\s+npm/gi, groups: [1] },
      { re: /(\d+)\s+npm\s+scripts/gi, groups: [1] },
    ],
  },
  {
    id: 'apps',
    label: 'apps propias',
    expected: [0],
    patterns: [
      { re: /(\d+)\s+apps/gi, groups: [1] },
      { re: /(\d+)\s+aplicaciones/gi, groups: [1] },
      { re: /(\d+)\s+desarrollos\s+propios/gi, groups: [1] },
      { re: /(\d+)\s+of\s+our\s+own\s+applications/gi, groups: [1] },
    ],
  },
  {
    id: 'watchtower-components',
    label: 'componentes vigilados',
    expected: [0],
    patterns: [
      { re: /(\d+)\s+componentes\s+vigilados/gi, groups: [1] },
      { re: /(\d+)\s+components\s+watched/gi, groups: [1] },
    ],
  },
  {
    id: 'academy-products',
    label: 'productos de Academy',
    expected: [0],
    patterns: [
      { re: /(\d+)\s+productos/gi, groups: [1] },
      { re: /(\d+)\s+products/gi, groups: [1] },
    ],
  },
  {
    id: 'academy-courses',
    label: 'cursos de Academy',
    expected: [0],
    patterns: [
      { re: /(\d+)\s+cursos/gi, groups: [1] },
      { re: /(\d+)\s+courses/gi, groups: [1] },
    ],
  },
  {
    id: 'academy-hours',
    label: 'horas de video de Academy',
    expected: [0],
    patterns: [
      { re: /(\d+)\s+horas?\s+de\s+video/gi, groups: [1] },
      { re: /(\d+)\s+horas?\s+de\s+contenido\s+en\s+video/gi, groups: [1] },
      { re: /(\d+)\s+hours?\s+of\s+video/gi, groups: [1] },
    ],
  },
  {
    id: 'academy-ebooks',
    label: 'ebooks de Academy',
    expected: [0],
    patterns: [{ re: /(\d+)\s+ebooks/gi, groups: [1] }],
  },
  {
    id: 'academy-pages',
    label: 'paginas de los ebooks',
    expected: [0],
    patterns: [
      { re: /([\d][\d.,]*)\s+p[aá]ginas/gi, groups: [1] },
      { re: /([\d][\d.,]*)\s+pages/gi, groups: [1] },
    ],
  },
  {
    id: 'academy-premium',
    label: 'ebooks en edicion premium',
    expected: [0],
    patterns: [
      { re: /(\d+)\s+de\s+ellos/gi, groups: [1] },
      { re: /(\d+)\s+of\s+them/gi, groups: [1] },
    ],
  },
  {
    id: 'academy-toolkits',
    label: 'toolkits de Academy',
    expected: [0],
    patterns: [{ re: /(\d+)\s+toolkits/gi, groups: [1] }],
  },
  {
    id: 'ci-workflows',
    label: 'workflows de CI',
    expected: [0],
    patterns: [{ re: /(\d+)\s+workflows/gi, groups: [1] }],
  },
];

/**
 * Tiles `{ value: 'X', label: 'Y' }`: el valor se contrasta contra el hecho
 * que corresponde a la etiqueta.
 */
export const TILE_LABELS: Readonly<Record<string, string>> = {
  'Quality gates': 'quality-gates',
  'Test files': 'test-files',
  'Archivos de test': 'test-files',
  'TypeScript files in src/': 'ts-files',
  'Archivos TS en src/': 'ts-files',
  'npm scripts': 'npm-scripts',
  'Scripts npm': 'npm-scripts',
  Skills: 'skills',
  'Own apps': 'apps',
  'Apps propias': 'apps',
  'AI agents': 'agents',
  'Agentes de IA': 'agents',
  'Components watched': 'watchtower-components',
  'Componentes vigilados': 'watchtower-components',
  Courses: 'academy-courses',
  Cursos: 'academy-courses',
  Ebooks: 'academy-ebooks',
  Toolkits: 'academy-toolkits',
  Products: 'academy-products',
  Productos: 'academy-products',
};

const HTML_STAT_LABELS: Readonly<Record<string, string>> = {
  presence_skills: 'skills',
  presence_agents: 'open-code-agents',
  presence_migrations: 'nexus-migrations',
};

/** Afirmaciones prohibidas: numeros que envejecen solos. */
export const PROHIBITED_CLAIMS: ReadonlyArray<{ re: RegExp; message: string; fix: string }> = [
  {
    re: /(\d+)\s+health checks?\b/gi,
    message:
      'el total de checks del watchtower es dinamico (cambia con el estado de la maquina) ' +
      'y por eso no se publica como numero fijo',
    fix: 'decir "N componentes vigilados" en lugar del total de checks',
  },
  {
    re: /(\d+)\s+checks?\b/gi,
    message:
      'el total de checks del watchtower es dinamico (cambia con el estado de la maquina) ' +
      'y por eso no se publica como numero fijo',
    fix: 'decir "N componentes vigilados" en lugar del total de checks',
  },
  {
    re: /(\d+)\s+verificaciones de salud\b/gi,
    message:
      'el total de checks del watchtower es dinamico (cambia con el estado de la maquina) ' +
      'y por eso no se publica como numero fijo',
    fix: 'decir "N componentes vigilados" en lugar del total de checks',
  },
  {
    re: /(\d+)\s+verificações de saúde\b/gi,
    message:
      'el total de checks del watchtower es dinamico (cambia con el estado de la maquina) ' +
      'y por eso no se publica como numero fijo',
    fix: 'decir "N componentes vigilados" en lugar del total de checks',
  },
  {
    re: /(\d+)\s+checagens de sa[uú]de\b/gi,
    message:
      'el total de checks del watchtower es dinamico (cambia con el estado de la maquina) ' +
      'y por eso no se publica como numero fijo',
    fix: 'decir "N componentes vigilados" en lugar del total de checks',
  },
];

// ─── Reporte ────────────────────────────────────────────────────────────────

export interface FactsFinding {
  rule: string;
  severity: 'error' | 'warn';
  file: string;
  message: string;
  fix: string;
}

export interface FactsReport {
  ok: boolean;
  errors: number;
  warnings: number;
  files: number;
  claims: number;
  source: 'git' | 'filesystem';
  facts: DeckFacts;
  findings: FactsFinding[];
}

/** Valor esperado de cada hecho (para comparar con lo que afirma el deck). */
export function expectedValues(facts: DeckFacts): Record<string, number[]> {
  return {
    'quality-gates': [facts.qualityGates.total],
    'quality-gates-enforced': [facts.qualityGates.enforced, facts.qualityGates.total],
    'quality-gates-pre-commit': [facts.qualityGates.preCommit],
    skills: [facts.skills.indexed],
    'skills-critical': [facts.skills.critical],
    'nexus-tables': [facts.nexus.tables],
    'nexus-migrations': [facts.nexus.migrations],
    agents: [facts.agents.definitions],
    'open-code-agents': [facts.agents.openCode],
    'roles-mapped': [facts.agents.roles],
    'model-bindings': [facts.agents.bindings],
    'ts-files': [facts.scale.tsFiles],
    'test-files': [facts.scale.testFiles],
    'npm-scripts': [facts.scale.npmScripts],
    apps: [facts.scale.apps],
    'watchtower-components': [facts.watchtower.components],
    'academy-products': [facts.academy.products],
    'academy-courses': [facts.academy.courses],
    'academy-hours': [facts.academy.hours],
    'academy-ebooks': [facts.academy.ebooks],
    'academy-pages': [facts.academy.pages],
    'academy-premium': [facts.academy.premium],
    'academy-toolkits': [facts.academy.toolkits],
    'ci-workflows': [facts.ci.workflows],
  };
}

export interface DeckFile {
  path: string;
  text: string;
}

/** Verifica las afirmaciones de un conjunto de archivos contra los hechos. */
export function checkDeckFacts(files: DeckFile[], facts: DeckFacts): FactsReport {
  const findings: FactsFinding[] = [];
  const expected = expectedValues(facts);
  let claims = 0;

  /**
   * Compara lo que el deck afirma contra lo que el repo mide, segun el modo
   * del hecho. Devuelve el hallazgo si hay algo que reportar.
   */
  const compare = (
    factId: string,
    claimed: number,
    file: string,
    where: string,
  ): FactsFinding | null => {
    const expectedForSpec = expected[factId];
    if (!expectedForSpec) return null;
    const measured = expectedForSpec[0];
    const mode = FACT_MODES[factId] ?? 'exact';
    if (mode === 'floor') {
      if (claimed > measured) {
        return {
          rule: 'facts/drift',
          severity: 'error',
          file,
          message:
            `el deck afirma "${where}" pero el repo mide ${measured}: ` +
            `una cifra minima no puede superar lo que hay`,
          fix: `bajar la cifra a ${measured} o menos (o medir de nuevo si el conteo cambio)`,
        };
      }
      if (claimed < measured) {
        // Solo avisa cuando el repo crecio de forma relevante: un piso que
        // quedo 5 files abajo sigue siendo honesto.
        const drift = measured - claimed;
        if (drift > Math.max(10, claimed * 0.1)) {
          return {
            rule: 'facts/stale-floor',
            severity: 'warn',
            file,
            message:
              `el deck dice "${where}" y el repo ya mide ${measured}: ` +
              `la cifra minima quedo vieja (no es un error, es un aviso de refresco)`,
            fix: `actualizar la cifra a ${measured} si queres el dato al dia`,
          };
        }
        return null;
      }
      return null;
    }
    if (claimed !== measured) {
      return {
        rule: 'facts/drift',
        severity: 'error',
        file,
        message:
          `el deck afirma "${where}" pero el repo mide ` +
          `${measured} (${factId})`,
        fix: `actualizar la cifra a ${measured} (o regenerar el deck si el hecho cambio)`,
      };
    }
    return null;
  };

  for (const file of files) {
    const text = file.path.endsWith('.html')
      ? file.text.replace(/<!--[\s\S]*?-->/g, '')
      : file.text;
    for (const spec of CLAIM_SPECS) {
      const expectedForSpec = expected[spec.id];
      if (!expectedForSpec) continue;
      for (const pattern of spec.patterns) {
        const re = new RegExp(pattern.re.source, pattern.re.flags);
        let match: RegExpExecArray | null;
        while ((match = re.exec(text)) !== null) {
          if (spec.id === 'academy-pages') {
            const context = text
              .slice(Math.max(0, match.index - 100), Math.min(text.length, re.lastIndex + 100))
              .toLowerCase();
            if (!context.includes('ebook')) continue;
          }
          claims += 1;
          const claimed = pattern.groups.map((g) => parseNumber(match?.[g] ?? ''));
          const ok = claimed.every(
            (value, index) => value === expectedForSpec[index],
          );
          if (!ok) {
            // Modo floor: el primer grupo es la cifra minima; el resto tiene
            // que coincidir exacto.
            const mode = FACT_MODES[spec.id] ?? 'exact';
            if (mode === 'floor' && claimed.length === 1) {
              const finding = compare(spec.id, claimed[0], file.path, match[0].trim());
              if (finding) findings.push(finding);
            } else {
              findings.push({
                rule: 'facts/drift',
                severity: 'error',
                file: file.path,
                message:
                  `el deck afirma "${match[0].trim()}" pero el repo mide ` +
                  `${spec.label}: ${expectedForSpec.join(' / ')} (afirmado: ${claimed.join(' / ')})`,
                fix: `actualizar la cifra a ${expectedForSpec[0]} (o regenerar el deck si el hecho cambio)`,
              });
            }
          }
          if (match.index === re.lastIndex) re.lastIndex += 1;
        }
      }
    }

    // Tiles `{ value: 'X', label: 'Y' }`.
    const tileRe = /value:\s*'([^']*)'\s*,\s*label:\s*'([^']*)'/g;
    let tile: RegExpExecArray | null;
    while ((tile = tileRe.exec(text)) !== null) {
      const factId = TILE_LABELS[tile[2]];
      if (!factId) continue;
      claims += 1;
      const claimed = parseNumber(tile[1]);
      if (Number.isFinite(claimed)) {
        const finding = compare(factId, claimed, file.path, `el tile "${tile[2]}"`);
        if (finding) findings.push(finding);
      }
    }

    const statRe =
      /<div\b[^>]*class="[^"]*\bstat-n\b[^"]*"[^>]*>\s*([^<]+)\s*<\/div>\s*<div\b[^>]*class="[^"]*\bstat-l\b[^"]*"[^>]*data-i18n="([^"]+)"[^>]*>/g;
    let stat: RegExpExecArray | null;
    while ((stat = statRe.exec(text)) !== null) {
      const factId = HTML_STAT_LABELS[stat[2]];
      if (!factId) continue;
      claims += 1;
      const claimed = parseNumber(stat[1].trim());
      if (!Number.isFinite(claimed)) continue;
      const finding = compare(factId, claimed, file.path, `el indicador "${stat[2]}"`);
      if (finding) findings.push(finding);
    }

    // Afirmaciones prohibidas.
    for (const forbidden of PROHIBITED_CLAIMS) {
      const re = new RegExp(forbidden.re.source, forbidden.re.flags);
      const match = re.exec(text);
      if (match) {
        findings.push({
          rule: 'facts/volatile-claim',
          severity: 'error',
          file: file.path,
          message: `el deck afirma "${match[0].trim()}" y ${forbidden.message}`,
          fix: forbidden.fix,
        });
      }
    }
  }

  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warn').length;
  return {
    ok: errors === 0,
    errors,
    warnings,
    files: files.length,
    claims,
    source: 'git',
    facts,
    findings,
  };
}

/** Reúne decks, guiones y copy público que puede repetir afirmaciones del repo. */
export function collectDeckFiles(root: string): DeckFile[] {
  const files: DeckFile[] = [];
  const sources: Array<{ dir: string; accepts: (name: string) => boolean }> = [
    {
      dir: join(root, 'docs', 'presentations', 'decks', 'content'),
      accepts: (name) => name.endsWith('.js'),
    },
    {
      dir: join(root, 'docs', 'presentations', 'decks', 'speech'),
      accepts: (name) => name.endsWith('.md'),
    },
    {
      dir: join(root, 'docs', 'presentations'),
      accepts: (name) => name.endsWith('.html') || name.endsWith('.md'),
    },
    {
      dir: join(root, 'docs', 'presentations', 'assets', 'js'),
      accepts: (name) => /^i18n.*\.js$/i.test(name),
    },
  ];
  for (const { dir, accepts } of sources) {
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names.sort()) {
      if (!accepts(name)) continue;
      const full = join(dir, name);
      files.push({ path: relative(root, full).split('\\').join('/'), text: readFileSync(full, 'utf8') });
    }
  }
  const manualDeck = join(root, 'docs', 'presentations', 'decks', 'build', 'manual.js');
  if (existsSync(manualDeck)) {
    files.push({
      path: relative(root, manualDeck).split('\\').join('/'),
      text: readFileSync(manualDeck, 'utf8'),
    });
  }
  return files;
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

  const { facts, source } = measureFacts(root);
  const report = checkDeckFacts(collectDeckFiles(root), facts);
  report.source = source;

  if (showFacts) {
    console.log(JSON.stringify({ source, facts }, null, 2));
    return;
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `decks-facts-drift-gate -> ${report.files} archivos, ${report.claims} afirmaciones verificadas, ` +
        `${report.errors} errores (medicion: ${source})`,
    );
    for (const f of report.findings) {
      console.log(`  ${f.severity === 'error' ? 'ERR ' : 'WARN'} ${f.rule} ${f.file}: ${f.message}`);
      console.log(`       fix: ${f.fix}`);
    }
    if (report.ok) console.log('  OK: las cifras de los decks coinciden con el repo');
  }

  if (!report.ok) {
    console.error(
      'decks-facts-drift-gate -> FAIL: hay cifras viejas en los decks. ' +
        'Un numero que el repo ya no respalda es una afirmacion falsa en la sala.',
    );
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
