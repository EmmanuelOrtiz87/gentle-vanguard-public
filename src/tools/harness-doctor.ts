#!/usr/bin/env node
/**
 * harness-doctor.ts — Diagnostico de la superficie editable del harness de GV.
 *
 * Por que existe: Harness^2 (google-research/harness2) publico que un harness
 * solo mejora si sus componentes son un artefacto EDITABLE y VALIDABLE. GV ya
 * tiene 242 skills, 70+ reglas y 22 scripts, pero no tenia una declaracion de
 * "que se puede tocar" ni un validador que dijera "este cambio es seguro".
 *
 * Este doctor es la parte barata de esa idea: read-only, deterministico, sin
 * llamadas a modelo. Mide el estado de la superficie hoy, de modo que cualquier
 * bucle de auto-mejora futuro tenga contra que compararse (medir antes y
 * despues, KAIZEN). Si el doctor esta rojo, el bucle no arranca.
 *
 * Reglas portadas de harness2/core/tree.py (Google LLC, Apache-2.0):
 *   - una skill sin `description:` se descarta SILENCIOSAMENTE al cargar
 *   - un `name:` que no coincide con el directorio rompe las lineas de trigger
 *   - una skill que nunca se nombra es peso muerto
 *   - un script invocado pero no incluido rompe la skill
 *   - el presupuesto always-on tiene tope
 *
 * Regla propia del stack:
 *   - NORM-TS-001: nada de .ps1 en la superficie editable
 *   - tripwire anti-contaminacion: ninguna marca de veredicto de evaluador
 *
 * Uso:
 *   node --import tsx src/tools/harness-doctor.ts            # reporte
 *   node --import tsx src/tools/harness-doctor.ts --json     # machine-readable
 *   node --import tsx src/tools/harness-doctor.ts --strict   # exit 1 si hay errores
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  GV_SURFACE,
  alwaysOnText,
  assertNoGraderVerdicts,
  readSurfaceTree,
  type HarnessSurface,
  type HarnessTree,
} from '../core/harness-surface.js';
import { collectInvokableNames, skillRoots } from '../skills/skill-embedder.js';
import { loadVerdictExemptions, type VerdictExemption } from '../core/harness-allowlist.js';

/** Raiz del repo: este archivo vive en src/tools/. */
const ROOT = resolve(import.meta.dirname ?? '.', '..', '..');

type Severity = 'error' | 'warn';

interface Finding {
  rule: string;
  severity: Severity;
  path: string;
  message: string;
  fix: string;
}

interface DoctorReport {
  ok: boolean;
  errors: number;
  warnings: number;
  /**
   * Que se escanea y que NO.
   *
   * La cobertura parcial es una degradacion silenciosa: si el doctor dice
   * "0 errores" pero solo mira la mitad de las skills, el lector asume que
   * todo el stack esta verificado. Por eso el alcance se declara.
   */
  scope: {
    /** Raices donde se validan frontmatter, scripts y marcadores. */
    scanned: string[];
    /** Raices de skills cargables que el doctor NO valida en estructura. */
    gaps: string[];
  };
  census: {
    skills: number;
    rules: number;
    scripts: number;
    subagents: number;
    alwaysOnChars: number;
    alwaysOnMax: number;
    alwaysOnPct: number;
  };
  findings: Finding[];
  allowlisted: Array<{ path: string; marker: string; reason: string }>;
}

/** Lee el frontmatter YAML de un archivo, o null si no lo tiene. */
function frontmatter(body: string): string | null {
  if (!body.startsWith('---')) return null;
  const end = body.indexOf('\n---', 3);
  if (end === -1) return null;
  return body.slice(3, end);
}

/**
 * Un valor de frontmatter tiene contenido si es escalar no vacio, o si es un
 * bloque folded/literal (`>`, `|`) con lineas indentadas debajo.
 */
function hasContent(fm: string, key: string): boolean {
  const re = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm');
  const m = re.exec(fm);
  if (!m) return false;
  const value = m[1].trim();
  if (value && value !== '>' && value !== '|') return true;
  const rest = fm.slice(m.index + m[0].length);
  return rest
    .split('\n')
    .slice(1)
    .some((line) => /^\s+\S/.test(line));
}

/** Nombre declarado en el frontmatter, si hay. */
function declaredName(fm: string): string | null {
  const m = /^name:[ \t]*(\S+)[ \t]*$/m.exec(fm);
  return m ? m[1] : null;
}

/** Relativo al repo, con separadores POSIX. */
function rel(abs: string): string {
  return relative(ROOT, abs).replace(/\\/g, '/');
}

/**
 * Nombres de skills que el stack puede descubrir.
 *
 * La fuente real de descubrimiento es el indice semantico que consume el
 * router (`.atl/skill-embeddings.json`), NO el lockfile ni la tabla de
 * agentes: esos son subconjuntos curados (18 y 33 entradas respectivamente)
 * sobre 242 skills en disco. Medir contra la fuente equivocada produce
 * findings que son ruido.
 */
function indexedSkills(): { router: Set<string>; other: Set<string> } {
  const router = new Set<string>();
  const other = new Set<string>();
  const embeddings = join(ROOT, '.atl', 'skill-embeddings.json');
  if (existsSync(embeddings)) {
    try {
      const parsed = JSON.parse(readFileSync(embeddings, 'utf-8')) as {
        skills?: Array<{ name?: string }>;
      };
      for (const s of parsed.skills ?? []) if (s.name) router.add(s.name);
    } catch {
      /* indice ilegible: el finding queda sin cobertura, no se inventa */
    }
  }
  const lock = join(ROOT, 'skills-lock.json');
  if (existsSync(lock)) {
    try {
      const parsed = JSON.parse(readFileSync(lock, 'utf-8')) as {
        skills?: Record<string, unknown>;
      };
      for (const name of Object.keys(parsed.skills ?? {})) other.add(name);
    } catch {
      /* lockfile ilegible */
    }
  }
  const registry = join(ROOT, '.atl', 'skill-registry.md');
  if (existsSync(registry)) {
    for (const line of readFileSync(registry, 'utf-8').split(/\r?\n/)) {
      if (!line.startsWith('|')) continue;
      const name = line.split('|').map((c) => c.trim())[2] ?? '';
      if (/^[a-z][a-z0-9_-]+$/.test(name)) other.add(name);
    }
  }
  return { router, other };
}

/**
 * Nombres de skill que un agente puede REALMENTE cargar.
 *
 * Se reusa el oraculo del stack (`collectInvokableNames` del embedder) en vez
 * de reimplementarlo: el embedder ya define "invocable" como el nombre del
 * directorio MAS el `name:` del frontmatter, y conoce todas las raices
 * (skills/, public/skills/, .opencode/skills/, .agents/skills/).
 *
 * Reimplementar esa regla aca producia 15 falsos positivos: 12 skills con
 * frontmatter distinto del directorio (alias legitimos) y 3 skills que solo
 * viven en .opencode/skills/ (raiz que el scan manual no cubria).
 */
/**
 * Nombres de skill que un agente puede REALMENTE cargar.
 *
 * El oraculo es el CARGADOR (`skillRoots`): el runtime indexa y carga
 * `skills/`, `.opencode/skills/` y `.agents/skills/`. `public/skills/` es el
 * catalogo publicado para la web (versiones recortadas, no cargables): si
 * entra en el oraculo, el chequeo de entradas stale deja de ver rutas
 * muertas, porque una skill que solo existe alla parece valida.
 */
function invokableSkillNames(): Set<string> {
  return collectInvokableNames(skillRoots(ROOT));
}

/** Directorios que no aportan scripts al repo (ruido, generados o backups). */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.runtime',
  '.next',
  '.pnpm-store',
  '.codegraph',
  '.engram-data',
  '.recovery',
  '.backups',
  '.archive',
  '.logs',
  'dist',
  'build',
  'coverage',
  '.test-results',
  '.pytest_cache',
  '__pycache__',
]);

/**
 * Mapa basename -> rutas del repo para los archivos con extension de script.
 * Se construye una vez por corrida: sirve para distinguir "este script no
 * existe" de "existe pero la referencia no es resoluble desde la skill".
 */
function scriptIndex(): Map<string, string[]> {
  const index = new Map<string, string[]>();
  const visit = (dir: string, depth: number): void => {
    if (depth > 6) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) visit(full, depth + 1);
      else if (entry.isFile() && /\.(ts|mts|cts|js|mjs|cjs|py|sh)$/i.test(entry.name)) {
        const list = index.get(entry.name) ?? [];
        list.push(rel(full));
        index.set(entry.name, list);
      }
    }
  };
  visit(ROOT, 0);
  return index;
}

/**
 * Rutas de script INVOCADAS dentro de un cuerpo markdown.
 *
 * Solo cuenta una referencia precedida por un comando (`node scripts/x.cjs`,
 * `python3 scripts/y.py`, `npx tsx scripts/z.ts`). Una mencion suelta
 * (`File: scripts/deploy.sh:15` en la salida de ejemplo de un escaner)
 * describe un archivo, no depende de el: marcarla como dependencia rota
 * convierte el doctor en ruido.
 *
 * El patron captura el token completo que sigue al comando y el filtrado se
 * hace en codigo: un regex con cuantificadores anidados sobre rutas puede
 * entrar en backtracking catastrofico sobre un documento grande.
 */
function scriptRefs(body: string): string[] {
  const commandRe =
    /(?:^|[\s"'`(\[])(?:node|python3?|bash|sh|npx|tsx|deno)\s+([^\s"'`)]+)/g;
  const out = new Set<string>();
  for (const m of body.matchAll(commandRe)) {
    const token = m[1] as string;
    if (!token.includes('scripts/')) continue;
    // Se conserva el token COMPLETO: `apps/academy-web/scripts/x.mjs` y
    // `scripts/x.mjs` son rutas distintas y ambas existen en el stack.
    if (!SCRIPT_REF_RE.test(token)) continue;
    if (isPlaceholder(token)) continue;
    out.add(token);
  }
  return [...out];
}

/**
 * Un nombre de ejemplo no es una dependencia rota.
 *
 * El placeholder puede estar en la base (`xxx.sh`) o en cualquier parte de la
 * ruta (`<skill-dir>/scripts/self_check.py`): la segunda forma es documentacion
 * correcta de "el script que trae la skill", no una referencia rota.
 */
function isPlaceholder(ref: string): boolean {
  const base = ref.split('/').pop() ?? '';
  return (
    /^(xxx|example|placeholder|todo|your[-_])/i.test(base) ||
    /[<>]/.test(ref) ||
    /^[\[{]/.test(base)
  );
}

/** Extension de un script referenciado. */
const SCRIPT_REF_RE = /\.(ts|mts|cts|js|mjs|cjs|py|sh)$/;

/**
 * Rutas donde un script invocado podria existir.
 *
 * Cubre las convenciones que conviven en el stack: repo-root
 * (`scripts/x.mjs`), app (`apps/x/scripts/x.mjs`), skill
 * (`skills/<n>/scripts/x.mjs`) y relativa a la skill (`scripts/x.mjs` dentro
 * de `skills/<n>/`).
 */
function scriptCandidates(surface: HarnessSurface, skillDirName: string, ref: string): string[] {
  const base = ref.split('/').pop() ?? '';
  const out = new Set<string>();
  out.add(ref);
  if (ref.startsWith('scripts/')) {
    out.add(join(surface.skillDir, skillDirName, ref));
    out.add(join(surface.skillDir, skillDirName, 'scripts', base));
  }
  return [...out];
}

/**
 * Exenciones al tripwire anti-contaminacion.
 *
 * El tripwire sirve para que un veredicto de evaluador no entre al contexto de
 * otra tarea. Pero hay una diferencia real entre "un veredicto medido" y
 * "documentacion que explica como escribir un veredicto". La excepcion se
 * declara por archivo Y por marcador concreto: un marcador nuevo en el mismo
 * archivo vuelve a disparar, y un archivo sin excepcion nunca queda exento.
 *
 * La carga vive en `src/core/harness-allowlist.ts` porque el bucle tiene que
 * aplicar la MISMA regla: dos oraculos para la misma regla divergen.
 */
function verdictExemptions(): Map<string, VerdictExemption> {
  return loadVerdictExemptions(ROOT);
}

/**
 * Skills fuera de la raiz editable principal.
 *
 * El runtime carga `skills/`, `.opencode/skills/` y `.agents/skills/`.
 * `public/skills/` NO entra: es el catalogo publicado para la web (versiones
 * recortadas) y el runtime no lo carga, asi que sus skills no son disparables
 * por trigger y no son superficie del harness.
 *
 * Sin este escaneo, una skill sin `description:` en esas raices se descarta
 * en silencio y el doctor no lo veria: cobertura parcial es degradacion
 * silenciosa.
 */
function readExtraSkills(): Array<{ path: string; dirName: string; body: string }> {
  const out: Array<{ path: string; dirName: string; body: string }> = [];
  const mainRoot = join(ROOT, GV_SURFACE.skillDir);
  for (const root of skillRoots(ROOT)) {
    if (root === mainRoot) continue;
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      // Las copias internas (`_deprecated-...`) no las carga el runtime: no
      // son skills y no compiten por el nombre.
      if (entry.name.startsWith('_')) continue;
      const skillFile = join(root, entry.name, 'SKILL.md');
      if (!existsSync(skillFile)) continue;
      const rel = relative(ROOT, skillFile).replace(/\\/g, '/');
      out.push({ path: rel, dirName: entry.name, body: readFileSync(skillFile, 'utf-8') });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Ejecuta todos los validadores contra el arbol recolectado. */
export function diagnose(surface: HarnessSurface, tree: HarnessTree): DoctorReport {
  const findings: Finding[] = [];
  const allowlisted: DoctorReport['allowlisted'] = [];
  const scope: DoctorReport['scope'] = {
    scanned: [
      ...surface.alwaysOn,
      `${surface.skillDir}/ (estructura de SKILL.md)`,
      `${surface.ruleDir}/`,
      `${surface.scriptsDir}/`,
      surface.subagentDir ? `${surface.subagentDir}/` : '(sin subagentes)',
      ...skillRoots(ROOT)
        .map((root) => relative(ROOT, root).replace(/\\/g, '/'))
        .filter((root) => root !== surface.skillDir)
        .map((root) => `${root}/ (estructura de SKILL.md)`),
    ],
    gaps: [
      'public/skills/ (catalogo publicado para la web: el runtime NO lo carga, sus skills no son disparables por trigger y sus cuerpos son versiones recortadas, no la superficie del harness)',
    ],
  };
  const { router, other } = indexedSkills();
  const indexed = new Set<string>([...router, ...other]);
  const onDisk = invokableSkillNames();
  const scripts = scriptIndex();

  // --- V0: entradas stale en el indice del router -------------------------
  // El router puede devolver un nombre que no corresponde a ninguna skill.
  // Eso es una ruta muerta: el agente pide la skill y no hay que cargar.
  for (const name of [...router].sort()) {
    if (onDisk.has(name)) continue;
    findings.push({
      rule: 'index/stale-entry',
      severity: 'error',
      path: '.atl/skill-embeddings.json',
      message: `el indice del router contiene "${name}", pero no hay ninguna skill con ese nombre en disco`,
      fix: 'regenerar el indice con src/skills/skill-embedder.ts; mientras tanto el router puede devolver una ruta muerta',
    });
  }

  // --- V1: presupuesto always-on ------------------------------------------
  const alwaysChars = alwaysOnText(surface, tree).length;
  if (alwaysChars > surface.alwaysOnMax) {
    findings.push({
      rule: 'always-on/over-budget',
      severity: 'error',
      path: surface.alwaysOn.join(', '),
      message: `bloque always-on de ${alwaysChars.toLocaleString('es-AR')} caracteres, sobre el tope de ${surface.alwaysOnMax.toLocaleString('es-AR')}`,
      fix: surface.alwaysOnCapReason,
    });
  }

  // --- V2b: skills fuera de la raiz principal ------------------------------
  //
  // La superficie editable solo incluye `skills/`, pero el runtime carga
  // tambien `public/skills/`, `.opencode/skills/` y `.agents/skills/`. Una
  // skill sin `description:` en esas raices se descarta SILENCIOSAMENTE y el
  // doctor no lo veria: cobertura parcial es degradacion silenciosa.
  //
  // Se aplican los checks ESTRUCTURALES (frontmatter, description, nombre,
  // indexado). El check de referencias a scripts NO se aplica aca: esas
  // skills viven fuera del arbol de la superficie y sus rutas relativas no se
  // resuelven contra el mismo arbol.
  const extraSkills = readExtraSkills();
  for (const extra of extraSkills) {
    const dirName = extra.dirName;
    const fm = frontmatter(extra.body);

    if (!fm) {
      findings.push({
        rule: 'skill/no-frontmatter',
        severity: 'error',
        path: extra.path,
        message: 'sin frontmatter YAML: el cargador no puede derivar name ni description',
        fix: 'agregar bloque --- con name y description',
      });
      continue;
    }

    if (!hasContent(fm, 'description')) {
      findings.push({
        rule: 'skill/no-description',
        severity: 'error',
        path: extra.path,
        message: 'frontmatter sin `description:` con contenido',
        fix: 'la skill se descarta SILENCIOSAMENTE al cargar sin description',
      });
    }

    const name = declaredName(fm);
    if (name && name !== dirName) {
      const bothIndexed = indexed.has(dirName) && indexed.has(name);
      findings.push({
        rule: bothIndexed ? 'skill/duplicate-index' : 'skill/name-mismatch',
        severity: 'warn',
        path: extra.path,
        message: bothIndexed
          ? `el indice contiene "${dirName}" y "${name}": la misma skill responde bajo dos nombres`
          : `frontmatter declara name "${name}" pero el directorio es "${dirName}"`,
        fix: bothIndexed
          ? `dejar un solo nombre: el runtime expone "${name}" y el router responde "${dirName}", asi que un trigger por cualquiera de los dos resuelve distinto`
          : `usar name: ${dirName} o renombrar el directorio; el nombre declarado gana al cargar y rompe las lineas de trigger`,
      });
    }

    // Alcanzabilidad por el ORACULO, no por el nombre del directorio: una
    // skill cuyo frontmatter declara otro nombre sigue siendo alcanzable por
    // ese nombre (es lo que indexa el embedder). Preguntar solo por el
    // directorio daria falsos positivos en los mirrors de `public/skills/`.
    const reachable = indexed.has(dirName) || (name !== null && indexed.has(name));
    if (!reachable) {
      findings.push({
        rule: 'skill/unindexed',
        severity: 'warn',
        path: extra.path,
        message: `"${dirName}" no esta en el indice semantico (.atl/skill-embeddings.json)`,
        fix: 'sin index no hay trigger: el agente nunca la invoca (peso muerto). Regenerar el indice con src/skills/skill-embedder.ts',
      });
    }
  }

  // --- V2..V4: skills -------------------------------------------------------
  const skillFiles = Object.keys(tree)
    .filter((r) => r.startsWith(`${surface.skillDir}/`) && r.endsWith('/SKILL.md'))
    .sort();

  for (const skillFile of skillFiles) {
    const dirName = skillFile.split('/')[1];
    const body = tree[skillFile] ?? '';
    const fm = frontmatter(body);

    if (!fm) {
      findings.push({
        rule: 'skill/no-frontmatter',
        severity: 'error',
        path: skillFile,
        message: 'sin frontmatter YAML: el cargador no puede derivar name ni description',
        fix: 'agregar bloque --- con name y description',
      });
      continue;
    }

    if (!hasContent(fm, 'description')) {
      findings.push({
        rule: 'skill/no-description',
        severity: 'error',
        path: skillFile,
        message: 'frontmatter sin `description:` con contenido',
        fix: 'la skill se descarta SILENCIOSAMENTE al cargar sin description',
      });
    }

    const name = declaredName(fm);
    if (name && name !== dirName) {
      const bothIndexed = indexed.has(dirName) && indexed.has(name);
      findings.push({
        rule: bothIndexed ? 'skill/duplicate-index' : 'skill/name-mismatch',
        severity: 'warn',
        path: skillFile,
        message: bothIndexed
          ? `el indice contiene "${dirName}" y "${name}": la misma skill responde bajo dos nombres`
          : `frontmatter declara name "${name}" pero el directorio es "${dirName}"`,
        fix: bothIndexed
          ? `dejar un solo nombre: el runtime expone "${name}" y el router responde "${dirName}", asi que un trigger por cualquiera de los dos resuelve distinto`
          : `usar name: ${dirName} o renombrar el directorio; el nombre declarado gana al cargar y rompe las lineas de trigger`,
      });
    }

    if (!indexed.has(dirName)) {
      findings.push({
        rule: 'skill/unindexed',
        severity: 'warn',
        path: skillFile,
        message: `"${dirName}" no esta en el indice semantico (.atl/skill-embeddings.json)`,
        fix: 'sin index no hay trigger: el agente nunca la invoca (peso muerto). Regenerar el indice con src/skills/skill-embedder.ts',
      });
    }

    for (const ref of scriptRefs(body)) {
      const candidates = scriptCandidates(surface, dirName, ref);
      if (candidates.some((c) => existsSync(join(ROOT, c)))) continue;

      const base = ref.split('/').pop() ?? '';
      const elsewhere = scripts.get(base) ?? [];
      if (elsewhere.length > 0) {
        findings.push({
          rule: 'skill/script-ref-ambiguous',
          severity: 'warn',
          path: skillFile,
          message: `invoca \`${ref}\` pero el archivo vive en ${elsewhere[0]} y no es resoluble desde la skill`,
          fix: 'usar la ruta real o adjuntar el script a la skill; tal como esta escrita, la invocacion falla',
        });
      } else {
        findings.push({
          rule: 'skill/script-ref-unresolvable',
          severity: 'error',
          path: skillFile,
          message: `invoca \`${ref}\` y ese archivo no existe en ninguna parte del repo`,
          fix: 'adjuntar el script a la skill o quitar la invocacion',
        });
      }
    }
  }

  // --- V5: NORM-TS-001 (nada de .ps1) --------------------------------------
  for (const relPath of Object.keys(tree)) {
    const lower = relPath.toLowerCase();
    if (surface.bannedScriptExts.some((ext) => lower.endsWith(ext))) {
      findings.push({
        rule: 'script/ps1-not-allowed',
        severity: 'error',
        path: relPath,
        message: 'script PowerShell en la superficie editable',
        fix: 'NORM-TS-001: reescribir en TypeScript (rules/NORM-TS-001-no-powershell-only-typescript)',
      });
    }
  }

  // --- V6: tripwire anti-contaminacion ------------------------------------
  const exemptions = verdictExemptions();
  for (const hit of assertNoGraderVerdicts(tree)) {
    const path = hit.split(':')[0] ?? hit;
    const marker = hit.split('marker ')[1]?.split(' en ')[0]?.trim() ?? '';
    const exemption = exemptions.get(path);
    if (exemption && exemption.markers.includes(marker)) {
      allowlisted.push({ path, marker, reason: exemption.reason });
      continue;
    }
    findings.push({
      rule: 'surface/verdict-marker-present',
      severity: 'error',
      path,
      message: hit,
      fix: 'si este archivo alguna vez se sirve como evidencia a otra tarea, el agente lee un veredicto como si fuera un hecho; el bloqueo duro va en el borde de servicio de evidencia, no en el archivo',
    });
  }

  // --- V7: reglas huerfanas -------------------------------------------------
  const indexText = [surface.ruleIndex, 'rules/README.md', 'AGENTS.md']
    .map((p) => {
      const abs = join(ROOT, p);
      return existsSync(abs) ? readFileSync(abs, 'utf-8') : '';
    })
    .join('\n');

  const ruleFiles = Object.keys(tree)
    .filter((r) => r.startsWith(`${surface.ruleDir}/`) && r.endsWith('.md'))
    .filter((r) => r !== surface.ruleIndex && !r.endsWith('/README.md'))
    .filter((r) => !r.startsWith(`${surface.ruleDir}/adaptive/`) && !r.startsWith(`${surface.ruleDir}/custom/`))
    .sort();

  for (const ruleFile of ruleFiles) {
    const base = ruleFile.split('/').pop() as string;
    const stem = base.replace(/\.md$/, '');
    if (!indexText.includes(base) && !indexText.includes(stem)) {
      findings.push({
        rule: 'rule/orphan',
        severity: 'warn',
        path: ruleFile,
        message: 'ningun indice la referencia: no entra en contexto por la via normal',
        fix: `enlazar desde ${surface.ruleIndex} o moverla a rules/adaptive/`,
      });
    }
  }

  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.length - errors;

  return {
    ok: errors === 0,
    errors,
    warnings,
    scope,
    census: {
      skills: skillFiles.length + extraSkills.length,
      rules: ruleFiles.length,
      scripts: Object.keys(tree).filter((r) => r.includes('/scripts/') || r.startsWith('scripts/')).length,
      subagents: surface.subagentDir
        ? Object.keys(tree).filter((r) => r.startsWith(`${surface.subagentDir}/`)).length
        : 0,
      alwaysOnChars: alwaysChars,
      alwaysOnMax: surface.alwaysOnMax,
      alwaysOnPct: Number(((alwaysChars / surface.alwaysOnMax) * 100).toFixed(1)),
    },
    findings,
    allowlisted,
  };
}

/** Render humano del reporte. */
function render(report: DoctorReport): string {
  const lines: string[] = [];
  const { census } = report;
  lines.push(`harness-doctor — ${GV_SURFACE.name}`);
  lines.push(
    `  superficie: ${census.skills} skills, ${census.rules} reglas, ${census.scripts} scripts, ${census.subagents} subagents`
  );
  lines.push(
    `  always-on: ${census.alwaysOnChars.toLocaleString('es-AR')} / ${census.alwaysOnMax.toLocaleString('es-AR')} chars (${census.alwaysOnPct}%)`
  );
  lines.push(`  resultado: ${report.errors} errores, ${report.warnings} warnings`);
  lines.push(`  alcance escaneado: ${report.scope.scanned.join(', ')}`);
  if (report.scope.gaps.length > 0) {
    lines.push(
      `  SIN escanear en estructura (raices de skills cargables): ${report.scope.gaps.join(', ')}`
    );
  }
  if (report.allowlisted.length > 0) {
    lines.push(
      `  exenciones: ${report.allowlisted.length} (${report.allowlisted.map((a) => a.path).join(', ')})`
    );
  }
  lines.push('');

  if (report.findings.length === 0) {
    lines.push('  superficie limpia: sin findings.');
    return lines.join('\n');
  }

  const byRule = new Map<string, Finding[]>();
  for (const f of report.findings) {
    const bucket = byRule.get(f.rule) ?? [];
    bucket.push(f);
    byRule.set(f.rule, bucket);
  }

  for (const [rule, bucket] of [...byRule.entries()].sort()) {
    const sev = bucket.some((f) => f.severity === 'error') ? 'ERROR' : 'warn ';
    lines.push(`${sev} ${rule} (${bucket.length})`);
    for (const f of bucket.slice(0, 12)) {
      lines.push(`    ${f.path}`);
      lines.push(`      ${f.message}`);
      lines.push(`      fix: ${f.fix}`);
    }
    if (bucket.length > 12) lines.push(`    ... y ${bucket.length - 12} mas`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Punto de entrada CLI. */
function main(): number {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const strict = args.includes('--strict');

  const tree = readSurfaceTree(GV_SURFACE, ROOT);
  const report = diagnose(GV_SURFACE, tree);

  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${render(report)}\n`);
  }

  if (strict && report.errors > 0) return 1;
  return 0;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  process.exit(main());
}
