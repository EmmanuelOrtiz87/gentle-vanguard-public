#!/usr/bin/env node

/**
 * skills-accessibility-gate.ts — Ninguna skill cargable puede ser inaccesible.
 *
 * POR QUE EXISTE (2026-11-02)
 * El doctor (`src/tools/harness-doctor.ts`) ya reportaba `skill/unindexed` como
 * AVISO, no como fallo. Un aviso que no rompe nada se lee como "todo bien" y el
 * indice semantico se vafosando en silencio: una skill que no esta en
 * `.atl/skill-embeddings.json` NO tiene trigger, el router nunca la devuelve y
 * el agente la carga jamas. Eso es peso muerto: 250 skills en disco que el
 * agente no puede encontrar.
 *
 * Ademas hay una regla de carga que NO falla: una skill sin `description:` en
 * el frontmatter se descarta SILENCIOSAMENTE (regla de harness2/core/tree.py).
 * Un archivo que existe, pasa el lint, y nunca se carga.
 *
 * ESTE GATE ES LA VERSION BLOQUEANTE DE ESA VERDAD:
 *   - toda skill cargable (directorio con SKILL.md en una raiz del runtime)
 *     tiene frontmatter con `name` y `description` con contenido;
 *   - toda skill cargable es alcanzable por el router (esta en el indice
 *     semantico, por su nombre de directorio o por el `name:` declarado);
 *   - toda entrada del indice semantico apunta a una skill que existe.
 *
 * NO es un duplicado del doctor: el doctor audita la SUPERFICIE (scripts
 * referenciados, marcadores, budgets) y reporta; este gate responde una sola
 * pregunta y responde con exit code: "¿el agente puede encontrar TODAS las
 * skills?".
 *
 * USO
 *   node --import tsx src/tools/skills-accessibility-gate.ts           # reporte + exit 1
 *   node --import tsx src/tools/skills-accessibility-gate.ts --json    # machine-readable
 *   node --import tsx src/tools/skills-accessibility-gate.ts --root DIR # otra raiz (tests)
 *
 * FIX
 *   npm run skills:index        # regenera .atl/skill-embeddings.json
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { skillRoots } from '../skills/skill-embedder.js';

export type Severity = 'error' | 'warn';

export interface AccessibilityFinding {
  rule: string;
  severity: Severity;
  path: string;
  message: string;
  fix: string;
}

export interface AccessibilityReport {
  ok: boolean;
  errors: number;
  warnings: number;
  /** Skills cargables detectadas en disco. */
  scanned: number;
  /** Skills que el router puede devolver (indice semantico). */
  indexed: number;
  findings: AccessibilityFinding[];
}

interface Frontmatter {
  name: string | null;
  description: string | null;
}

/** Raiz del repo por defecto: este archivo vive en src/tools/. */
export function defaultRoot(): string {
  return join(import.meta.dirname ?? '.', '..', '..');
}

/**
 * Parsea el frontmatter YAML de un SKILL.md.
 *
 * No se usa un parser YAML: el loader real (`parseSkillDocument` del embedder)
 * tambien es textual, y una dependencia mas para leer dos lineas seria una
 * razon para no correr el gate.
 */
export function parseFrontmatter(body: string): Frontmatter | null {
  if (!body.startsWith('---')) return null;
  const end = body.indexOf('\n---', 3);
  if (end === -1) return null;
  const fm = body.slice(3, end);

  const scalar = (key: string): string | null => {
    const m = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(fm);
    if (!m) return null;
    const value = m[1].trim();
    if (!value || value === '>' || value === '|' || value === '"' || value === "'") {
      // Bloque folded/literal: el contenido son las lineas indentadas de abajo.
      const rest = fm.slice(m.index + m[0].length);
      const block = rest
        .split(/\r?\n/)
        .slice(1)
        .filter((l) => /^\s+\S/.test(l))
        .map((l) => l.trim())
        .join(' ')
        .trim();
      return block.length > 0 ? block : null;
    }
    return value.replace(/^["']|["']$/g, '');
  };

  return { name: scalar('name'), description: scalar('description') };
}

/** Nombres que el router puede devolver: `.atl/skill-embeddings.json`. */
export function readIndexedNames(root: string): Set<string> {
  const names = new Set<string>();
  const file = join(root, '.atl', 'skill-embeddings.json');
  if (!existsSync(file)) return names;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { skills?: Array<{ name?: string }> };
    for (const s of parsed.skills ?? []) if (s.name) names.add(s.name);
  } catch {
    // Indice ilegible: se reporta abajo como indice ausente, no se inventa.
  }
  return names;
}

/** Directorios de skill (con SKILL.md) por raiz del runtime. */
export function listSkillDirs(root: string): Array<{ dir: string; skillFile: string }> {
  const out: Array<{ dir: string; skillFile: string }> = [];
  for (const base of skillRoots(root)) {
    if (!existsSync(base)) continue;
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(base, { withFileTypes: true }) as never;
    } catch {
      continue;
    }
    for (const entry of entries as unknown as Array<{ name: string; isDirectory(): boolean }>) {
      if (!entry.isDirectory()) continue;
      const skillFile = join(base, entry.name, 'SKILL.md');
      if (!existsSync(skillFile)) continue;
      out.push({ dir: entry.name, skillFile });
    }
  }
  return out;
}

/**
 * Corre el gate sobre una raiz.
 *
 * `indexedNames` y `skillDirs` son inyectables para que el test negativo
 * pueda simular un indice desactualizado sin tocar el indice real.
 */
export function checkSkillAccessibility(
  root: string,
  options: { indexedNames?: Set<string>; skillDirs?: Array<{ dir: string; skillFile: string }> } = {},
): AccessibilityReport {
  const findings: AccessibilityFinding[] = [];
  const indexPath = join(root, '.atl', 'skill-embeddings.json');
  const indexExists = existsSync(indexPath);
  const indexed = options.indexedNames ?? readIndexedNames(root);
  const dirs = options.skillDirs ?? listSkillDirs(root);

  const rel = (abs: string): string => relative(root, abs).replace(/\\/g, '/');

  /**
   * El indice semantico (.atl/) es un artefacto LOCAL: `.atl/` esta en el
   * .gitignore, asi que en un clon recien hecho no existe todavia.
   *
   * Sin indice NO se puede afirmar nada sobre alcanzabilidad, y afirmar lo
   * contrario (marcar 282 skills como inaccesibles) seria un falso positivo
   * enorme. El gate degrada con un AVISO explicito y sigue validando lo que
   * si puede validar: que cada SKILL.md sea cargable (frontmatter + descripcion).
   */
  const indexMissing = !indexExists && !options.indexedNames;
  if (indexMissing) {
    findings.push({
      rule: 'skill/index-missing',
      severity: 'warn',
      path: '.atl/skill-embeddings.json',
      message:
        'el indice semantico no existe: no se puede verificar la alcanzabilidad por el router ' +
        '(el indice es local, .atl/ esta en el .gitignore)',
      fix: 'npm run skills:index',
    });
  }

  // 1) Superficie cargable: cada SKILL.md tiene que poder cargarse.
  const knownNames = new Set<string>();
  for (const { dir, skillFile } of dirs) {
    knownNames.add(dir);
    const body = readFileSync(skillFile, 'utf8');
    const fm = parseFrontmatter(body);

    if (!fm) {
      findings.push({
        rule: 'skill/no-frontmatter',
        severity: 'error',
        path: rel(skillFile),
        message: 'sin frontmatter YAML: el cargador no puede derivar name ni description',
        fix: 'agregar bloque --- con name y description',
      });
      continue;
    }
    if (fm.name) knownNames.add(fm.name);

    if (!fm.description) {
      findings.push({
        rule: 'skill/no-description',
        severity: 'error',
        path: rel(skillFile),
        message: 'frontmatter sin `description:` con contenido: el cargador la descarta SILENCIOSAMENTE',
        fix: 'describir en una linea que hace la skill y cuando invocarla',
      });
    }
    if (!fm.name) {
      findings.push({
        rule: 'skill/no-name',
        severity: 'error',
        path: rel(skillFile),
        message: 'frontmatter sin `name:`: la skill no se puede invocar por nombre',
        fix: `declarar name: ${dir}`,
      });
    }

    // 2) Alcanzabilidad: sin indice no hay trigger.
    if (!indexMissing) {
      const reachable = indexed.has(dir) || (fm.name !== null && indexed.has(fm.name));
      if (!reachable) {
        findings.push({
          rule: 'skill/unindexed',
          severity: 'error',
          path: rel(skillFile),
          message: `"${dir}" no esta en el indice semantico: el router nunca la devuelve (peso muerto)`,
          fix: 'npm run skills:index',
        });
      }
    }
  }

  // 3) El indice no puede apuntar a skills que ya no existen.
  for (const name of indexMissing ? [] : indexed) {
    if (knownNames.has(name)) continue;
    findings.push({
      rule: 'skill/dead-index-entry',
      severity: 'error',
      path: '.atl/skill-embeddings.json',
      message: `el indice anuncia "${name}" pero no existe ninguna skill con ese nombre`,
      fix: 'npm run skills:index (el indice se regenera desde el disco)',
    });
  }

  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warn').length;
  return {
    ok: errors === 0,
    errors,
    warnings,
    scanned: dirs.length,
    indexed: indexed.size,
    findings,
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 && argv[rootIdx + 1] ? argv[rootIdx + 1] : defaultRoot();

  const report = checkSkillAccessibility(root);

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `skills-accessibility-gate -> ${report.scanned} skills cargables, ${report.indexed} indexadas, ` +
        `${report.errors} errores, ${report.warnings} avisos`,
    );
    for (const f of report.findings) {
      console.log(`  ${f.severity === 'error' ? 'ERR ' : 'WARN'} ${f.rule} ${f.path}: ${f.message}`);
      console.log(`       fix: ${f.fix}`);
    }
    if (report.ok) console.log('  OK: toda skill cargable es alcanzable por el router');
  }

  if (!report.ok) {
    console.error(
      'skills-accessibility-gate -> FAIL: hay skills que el agente no puede encontrar. ' +
        'Corre `npm run skills:index` y agrega el `description:` que falte.',
    );
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
