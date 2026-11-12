#!/usr/bin/env node

/**
 * gitignore-source-guard.ts — Ningun codigo fuente referenciado puede quedar
 * fuera del repo por culpa de una regla de .gitignore.
 *
 * POR QUE EXISTE (2026-11-02)
 * El `.gitignore` del repo tiene una regla generica `build/`. Esa regla se
 * comio `docs/presentations/decks/build/` COMPLETO: los 22 scripts del
 * toolkit de presentaciones (compile.js, export-pdf.js, pptx-colors.py,
 * hero-assets.js...) quedaron sin versionar. El commit "parecio" llevar el
 * toolkit y el repo, en un clon limpio, no tenia el toolkit. El sintoma
 * aparecio semanas despues, cuando un build fallo en otra maquina.
 *
 * El fallo no fue la regla: fue que NADIE verifico la invariante
 *
 *     "todo archivo de codigo que el repo referencia esta versionado"
 *
 * Ese es este gate.
 *
 * QUE CHEQUEA
 *   1. REFERENCIADO-NO-VERSIONADO: un archivo de codigo al que apuntan los
 *      scripts de package.json, las skills o el AGENTS.md existe en disco pero
 *      `git ls-files` no lo lista -> el clon limpio lo pierde. (bloqueante)
 *   2. REFERENCIADO-QUE-NO-EXISTE: un script de package.json apunta a un
 *      archivo inexistente -> el comando falla en cualquier maquina. (bloqueante)
 *   3. DIRECTORIO PARCIALMENTE VERSIONADO: una regla ignora un directorio que
 *      ya tiene archivos versionados -> la regla se contradice sola. (aviso)
 *
 * USO
 *   node --import tsx src/tools/gitignore-source-guard.ts
 *   node --import tsx src/tools/gitignore-source-guard.ts --json
 *   node --import tsx src/tools/gitignore-source-guard.ts --root DIR
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type Severity = 'error' | 'warn';

export interface GuardFinding {
  rule: string;
  severity: Severity;
  path: string;
  message: string;
  fix: string;
  /** Referencia donde se detecto (archivo:lina aproximada). */
  source?: string;
}

export interface GuardReport {
  ok: boolean;
  errors: number;
  warnings: number;
  references: number;
  findings: GuardFinding[];
}

interface Reference {
  /** Ruta absoluta del archivo referenciado (puede no existir). */
  abs: string;
  /** Donde se menciona (para el mensaje). */
  source: string;
}

/** Extensiones que son codigo ejecutable, no artefactos. */
const CODE_EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs|py|sh|bash|ps1)$/i;

/** Tokens que no son rutas (flags, URLs, placeholders). */
const NOT_A_PATH = /^(https?:|node_modules|@|\$|\{|\[|<)/;

/**
 * Directorios de SALIDA CONVENCIONAL: lo que hay adentro es artefacto generado
 * (lo produce el propio repo) y no fuente que haya que versionar.
 *
 * `build/` NO esta en la lista a proposito: es el nombre ambiguo que causo el
 * incidente (el toolkit de decks). Un `build/` con codigo escrito a mano tiene
 * que viajar; un `build/` que sea salida real se declara en el .gitignore con
 * una excepcion explicita, y el gate lo marca como referencia-a-salida.
 */
const GENERATED_DIRS = new Set(['dist', 'out', 'coverage', '.next', 'target', 'lib', 'esm', 'cjs']);

/** Directorios que se recorren buscando package.json del workspace. */
const PKG_SCAN_DIRS = ['.', 'packages', 'apps', 'docs/presentations/decks', 'src'];

export function defaultRoot(): string {
  return join(import.meta.dirname ?? '.', '..', '..');
}

function git(root: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
  } catch {
    return '';
  }
}

/** Normaliza separadores y quita comillas. */
function cleanToken(token: string): string {
  return token.replace(/^["']|["']$/g, '').replace(/\\/g, '/');
}

/**
 * Extrae rutas con extension de codigo de un texto.
 *
 * Se limita a tokens que parecen rutas RELATIVAS con extension: un token sin
 * `/` y sin extension (por ejemplo `build`) no es una ruta, es una palabra.
 */
export function extractPaths(text: string): string[] {
  const out: string[] = [];
  // El token tiene que EMPEZAR por un caracter de nombre: asi `tests/*.test.ts`
  // no se lee como el archivo `.test.ts`, y `src/foo.ts` tampoco como `foo.ts`.
  const re = /(?<![\w/.*@$-])([A-Za-z~][\w./@-]*\.(?:ts|tsx|mts|cts|js|mjs|cjs|py|sh|bash|ps1))(?![\w*])/g;
  for (const match of text.matchAll(re)) {
    const raw = cleanToken(match[1]);
    if (!raw || NOT_A_PATH.test(raw)) continue;
    if (raw.includes('*')) continue;
    out.push(raw);
  }
  return out;
}

/**
 * Directorios BASE de un comando, en orden de prioridad.
 *
 * La mayoria de los scripts resuelven sus rutas contra el directorio del
 * package. Pero hay una excepcion real y frecuente: los runners con flag de
 * raiz (`vitest run --root scripts`, `jest --rootDir src`) resuelven los
 * argumentos de archivo contra ESA raiz, no contra el package.
 *
 * Sin esto, `vitest run --root scripts lifecycle-lock.test.ts` reportaba un
 * archivo inexistente: el gate buscaba `apps/<app>/lifecycle-lock.test.ts`
 * cuando el archivo vivia en `apps/<app>/scripts/lifecycle-lock.test.ts`.
 * Un gate que marca lo que esta bien se apaga: hay que probar AMBAS bases y
 * aceptar el archivo si aparece en alguna.
 */
export function baseDirsForCommand(pkgDir: string, command: string): string[] {
  const dirs = [pkgDir];
  const re = /(?<![\w-])--root(?:=|\s+)("[^"]+"|'[^']+'|[^\s]+)/g;
  for (const match of command.matchAll(re)) {
    const raw = cleanToken(match[1]);
    if (!raw || raw === '.' || raw === './') continue;
    if (raw.startsWith('-')) continue;
    const resolved = resolve(pkgDir, raw);
    if (!dirs.includes(resolved)) dirs.push(resolved);
  }
  return dirs;
}

/** package.json del repo y de sus miembros de workspace. */
export function findPackageFiles(root: string): string[] {
  const out: string[] = [];
  for (const dir of PKG_SCAN_DIRS) {
    const base = resolve(root, dir);
    if (!existsSync(base)) continue;
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(base, { withFileTypes: true }) as never;
    } catch {
      continue;
    }
    for (const entry of entries as unknown as Array<{ name: string; isDirectory(): boolean }>) {
      // Un subdirectorio puede contener un package.json propio; el directorio
      // de la base puede SER el package.json (raiz del repo o del paquete).
      if (entry.isDirectory()) {
        const pkgPath = join(base, entry.name, 'package.json');
        if (existsSync(pkgPath)) out.push(pkgPath);
        continue;
      }
      if (entry.name === 'package.json') out.push(join(base, entry.name));
    }
  }
  return out;
}

/** Scripts declarados en un package.json (valor -> nombre del script). */
export function scriptCommands(pkgPath: string): Array<{ name: string; command: string }> {
  let parsed: { scripts?: Record<string, string> };
  try {
    parsed = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch {
    return [];
  }
  return Object.entries(parsed.scripts ?? {}).map(([name, command]) => ({ name, command }));
}

/** Archivos markdown que declaran como se invocan las skills y el stack. */
function referenceDocs(root: string): string[] {
  const out: string[] = [];
  const candidates = [join(root, 'AGENTS.md')];
  const skillsDir = join(root, 'skills');
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true }) as unknown as Array<{
      name: string;
      isDirectory(): boolean;
    }>) {
      if (!entry.isDirectory()) continue;
      const skillFile = join(skillsDir, entry.name, 'SKILL.md');
      if (existsSync(skillFile)) out.push(skillFile);
    }
  }
  return candidates.filter((p) => existsSync(p));
}

/**
 * Corre el guard sobre una raiz.
 *
 * `tracked` y `ignoredBy` son inyectables para que el test negativo no
 * dependa del estado real del repo.
 */
export function checkIgnoredSource(
  root: string,
  options: { tracked?: Set<string>; ignoredBy?: Map<string, string> } = {},
): GuardReport {
  const findings: GuardFinding[] = [];
  const rel = (abs: string): string => relative(root, abs).replace(/\\/g, '/');

  const trackedSet =
    options.tracked ??
    new Set(
      git(root, ['ls-files'])
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean),
    );

  const ignoredMap = options.ignoredBy ?? buildIgnoredMap(root);

  const references: Reference[] = [];

  // 1) Scripts de package.json: la referencia mas fuerte del repo.
  for (const pkgPath of findPackageFiles(root)) {
    const pkgDir = resolve(pkgPath, '..');
    for (const { name, command } of scriptCommands(pkgPath)) {
      const bases = baseDirsForCommand(pkgDir, command);
      for (const token of extractPaths(command)) {
        // Un token puede existir en UNA de las bases validas (package dir o
        // la raiz del runner). Si existe en alguna, la referencia es valida.
        const candidates = bases.map((base) => resolve(base, token));
        const existing = candidates.find((abs) => existsSync(abs));
        references.push({
          abs: existing ?? candidates[0],
          source: `${rel(pkgPath)}#scripts.${name}`,
        });
      }
    }
  }

  // 2) Skills y AGENTS.md: como se invoca cada capacidad.
  for (const doc of referenceDocs(root)) {
    const text = readFileSync(doc, 'utf8');
    const docDir = resolve(doc, '..');
    for (const token of extractPaths(text)) {
      const abs = resolve(docDir, token);
      references.push({ abs, source: rel(doc) });
    }
  }

  const seen = new Set<string>();
  let count = 0;

  for (const ref of references) {
    if (!CODE_EXT.test(ref.abs)) continue;
    const relPath = rel(ref.abs);
    // node_modules: lo instala el package manager, no viaja en el clon.
    if (relPath.includes('node_modules/')) continue;

    const key = `${ref.abs}::${ref.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    count++;

    if (!existsSync(ref.abs)) {
      // Solo los scripts de package.json son evidencia dura: ahi el comando
      // se ejecuta de verdad y un archivo ausente rompe el comando.
      //
      // Pasa de AVISO a ERROR (2026-11-03) cuando la deuda esta pagada:
      // `apps/wpp-bot` tenia `smoke:twilio` y `db:migrate` apuntando a
      // archivos que NUNCA existieron. Un script que no se puede ejecutar es
      // una capacidad que el stack promete y no tiene. Con la deuda Zero,
      // dejarlo en aviso hacia que se acumulara otra vez sin que nadie lo
      // notara (un aviso que no rompe nada se lee como "todo bien").
      if (ref.source.includes('#scripts.')) {
        findings.push({
          rule: 'gitignore/missing-reference',
          severity: 'error',
          path: relPath,
          message: `el script ${ref.source} apunta a un archivo que no existe: ese comando no se puede ejecutar`,
          fix: 'crear/restaurar el archivo o corregir el script',
          source: ref.source,
        });
      }
      continue;
    }

    if (trackedSet.has(relPath)) continue;

    // Salida generada por el propio repo: no es fuente que haya que versionar.
    const segments = relPath.split('/');
    if (segments.some((seg) => GENERATED_DIRS.has(seg))) continue;

    const rule = ignoredMap.get(relPath);
    findings.push({
      rule: 'gitignore/untracked-source',
      severity: 'error',
      path: relPath,
      message: rule
        ? `codigo fuente referenciado por ${ref.source} pero ignorado por .gitignore (${rule}): no viaja en el clon`
        : `codigo fuente referenciado por ${ref.source} pero NO versionado: no viaja en el clon`,
      fix: 'versionarlo (git add -f) o corregir la regla de .gitignore',
      source: ref.source,
    });
  }

  // 3) Directorios parcialmente versionados: la regla se contradice.
  for (const [path, rule] of ignoredMap) {
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    if (!dir) continue;
    const siblings = trackedSet.has(path) || [...trackedSet].some((t) => t.startsWith(`${dir}/`));
    if (!siblings) continue;
    findings.push({
      rule: 'gitignore/partial-directory',
      severity: 'warn',
      path,
      message: `la regla "${rule}" ignora ${path} pero el directorio ${dir}/ ya tiene archivos versionados`,
      fix: 'aclarar la excepcion (negacion !ruta/) para que la regla no se contradiga',
    });
  }

  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warn').length;
  return { ok: errors === 0, errors, warnings, references: count, findings };
}

/**
 * Mapa ruta -> regla de .gitignore que la ignora, para CADA archivo de codigo
 * del repo (tracked o no).
 */
function buildIgnoredMap(root: string): Map<string, string> {
  const map = new Map<string, string>();
  const files = listCodeFiles(root);
  if (!files.length) return map;
  const input = files.join('\n');
  let out = '';
  try {
    out = execFileSync('git', ['check-ignore', '-v', '--stdin'], {
      cwd: root,
      input,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (err) {
    // check-ignore sale 1 cuando NINGUNO de los paths esta ignorado: eso es
    // un resultado valido, no un error.
    const e = err as { stdout?: Buffer | string };
    out = typeof e.stdout === 'string' ? e.stdout : e.stdout?.toString() ?? '';
  }
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue;
    // <fuente>:<lina>:<patron>\t<ruta>
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const meta = line.slice(0, tab);
    const path = line.slice(tab + 1).trim();
    const pattern = meta.split(':').slice(2).join(':');
    map.set(path, pattern);
  }
  return map;
}

/** Archivos de codigo del repo, incluidos los que git ignora (el caso que nos importa). */
function listCodeFiles(root: string): string[] {
  const SKIP = new Set([
    'node_modules',
    '.git',
    '.pnpm-store',
    '.next',
    'coverage',
    '.test-results',
    '__pycache__',
    '.atl',
    '.runtime',
    '.session',
    '.engram-data',
    '.codegraph',
    '.logs',
  ]);
  const out: string[] = [];
  const visit = (dir: string, depth: number): void => {
    if (depth > 8) return;
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as never;
    } catch {
      return;
    }
    for (const entry of entries as unknown as Array<{ name: string; isDirectory(): boolean }>) {
      if (SKIP.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full, depth + 1);
        continue;
      }
      if (!CODE_EXT.test(entry.name)) continue;
      try {
        if (statSync(full).size > 2 * 1024 * 1024) continue;
      } catch {
        continue;
      }
      out.push(relative(root, full).replace(/\\/g, '/'));
    }
  };
  visit(root, 0);
  return out;
}

function main(): void {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 && argv[rootIdx + 1] ? argv[rootIdx + 1] : defaultRoot();

  const report = checkIgnoredSource(root);

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `gitignore-source-guard -> ${report.references} referencias, ${report.errors} errores, ${report.warnings} avisos`,
    );
    for (const f of report.findings) {
      console.log(`  ${f.severity === 'error' ? 'ERR ' : 'WARN'} ${f.rule} ${f.path}: ${f.message}`);
      console.log(`       fix: ${f.fix}`);
    }
    if (report.ok) console.log('  OK: todo el codigo referenciado viaja en el clon');
  }

  if (!report.ok) {
    console.error(
      'gitignore-source-guard -> FAIL: hay codigo referenciado que no viaja en el clon. ' +
        'Versiona esos archivos o ajusta el .gitignore.',
    );
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
