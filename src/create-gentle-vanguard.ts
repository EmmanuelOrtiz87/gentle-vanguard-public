#!/usr/bin/env node
/**
 * create-gentle-vanguard.ts — Bootstrap scaffold for the Gentle-Vanguard stack.
 *
 * Creates a new project with the stack structure in one command:
 *   1. Resolves the project name (from argv or an interactive prompt)
 *   2. Copies the base stack structure (config/, src/, adapters/, scripts/, ...)
 *      applying an ignore list (node_modules, .git, .runtime, .session, ...)
 *   3. Generates a base package.json + README.md for the new project
 *   4. Optionally runs `npm install` and prints the next steps
 *
 * Usage:
 *   npx tsx src/create-gentle-vanguard.ts --name <proyecto> [--target <dir>]
 *                                          [--no-install] [--dry-run] [--yes]
 *
 * Pure helpers (isIgnored / filterCopyable / sanitizeProjectName /
 * buildBasePackageJson / buildReadme) are exported so they can be unit-tested
 * without touching disk.
 */

import { createInterface } from 'node:readline/promises';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runSync } from './core/run-command.js';

// ─── Template scope ───────────────────────────────────────────────────

/**
 * Top-level entries copied into the new project. Everything else (apps,
 * node_modules, runtime dirs, editor configs, ...) stays out of the template.
 */
export const COPY_ENTRIES: readonly string[] = [
  'config',
  'src',
  'adapters',
  'scripts',
  'rules',
  'tests',
  'docs',
  '.opencode',
  'tsconfig.json',
  'eslint.config.js',
  'opencode.json',
  'AGENTS.md',
  '.secretlintrc.json',
  '.lefthook.yml',
  '.gitignore',
  '.npmrc',
  '.env.example',
  '.editorconfig',
  '.node-version',
  '.nvmrc',
  '.dockerignore',
  '.prettierrc',
  '.prettierignore',
  '.markdownlint.json',
  '.graphifyignore',
  '.gitattributes',
  '.gitleaks.toml',
  '.trivyignore',
  '.trufflehogignore',
  '.secretlintignore',
];

/**
 * Directory/file segments that are always ignored at any depth.
 * These are runtime/generated artifacts that must never be scaffolded.
 */
const IGNORED_SEGMENTS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  '.git-rewrite',
  '.runtime',
  '.session',
  '.telemetry',
  '.codegraph',
  '.engram',
  '.engram-data',
  '.pytest_cache',
  '.tmp',
  '.local',
  '.workspace',
  '.pnpm-store',
  '.wwebjs_cache',
  '.test',
  '.eval',
  '.ft',
  '.sdd',
  '.recovery',
  '.archive',
  '.event-bus',
  'dist',
  'coverage',
  'build',
]);

/**
 * Top-level-only entries (first path segment) that are ignored.
 * These exist at the repo root but never inside copied source dirs.
 */
const IGNORED_TOP_LEVEL: ReadonlySet<string> = new Set([
  'logs',
  '.logs',
  'backups',
  '.backups',
  'keys',
  'protected',
  'graphify-out',
  '.vscode',
  '.devcontainer',
  '.github',
]);

/** Exact filenames ignored at any depth. */
const IGNORED_FILENAMES: ReadonlySet<string> = new Set([
  '.env',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  '.DS_Store',
  'Thumbs.db',
]);

/** Local config overrides may hold real values — never scaffolded. */
const LOCAL_CONFIG_RE = /\.local\.(?:json|ya?ml)$/i;

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

// ─── Ignore list (pure, disk-free) ────────────────────────────────────

/**
 * Returns true when a relative path must NOT be scaffolded.
 * Pure — takes only the relative path, no I/O. Exported for unit tests.
 */
export function isIgnored(relPath: string): boolean {
  const p = toPosix(relPath);
  if (p === '') return false;
  const segments = p.split('/');
  const first = segments[0] ?? '';
  if (IGNORED_TOP_LEVEL.has(first)) return true;
  for (const seg of segments) {
    if (IGNORED_SEGMENTS.has(seg)) return true;
  }
  const name = segments[segments.length - 1] ?? '';
  if (IGNORED_FILENAMES.has(name)) return true;
  if (LOCAL_CONFIG_RE.test(name)) return true;
  return false;
}

/**
 * Filters a list of relative paths keeping only the copyable ones.
 * Pure — Exported for unit tests.
 */
export function filterCopyable(paths: readonly string[]): string[] {
  return paths.filter((p) => !isIgnored(p));
}

// ─── Helpers (pure) ───────────────────────────────────────────────────

/**
 * Normalizes a project name into a safe npm package slug.
 * Pure — Exported for unit tests.
 */
export function sanitizeProjectName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'gentle-vanguard-app';
}

/**
 * Base package.json for the new project: minimal, functional, zero cloud deps.
 * Pure — Exported for unit tests.
 */
export function buildBasePackageJson(projectName: string): Record<string, unknown> {
  return {
    name: projectName,
    version: '0.1.0',
    private: true,
    type: 'module',
    engines: { node: '>=20.0.0' },
    scripts: {
      start: 'npx tsx src/quick-start.ts',
      gv: 'npx tsx src/cli/gv.ts',
      'stack:setup': 'npx tsx src/stack-setup.ts',
      'stack:setup:yes': 'npx tsx src/stack-setup.ts --yes',
      'stack:setup:dry': 'npx tsx src/stack-setup.ts --dry-run',
      'setup:complete': 'npx tsx src/setup-complete.ts',
      'db:init': 'npx tsx src/database/db-init.ts',
      'db:health': 'npx tsx scripts/database/db-health.ts',
      'health:check': 'npx tsx src/core/health-check.ts',
      watchtower: 'npx tsx src/core/maintenance-watchtower.ts',
      'watchtower:health': 'npx tsx src/core/maintenance-watchtower.ts --action health',
      'session:autostart:detached': 'npx tsx src/session-autostart-detached.ts',
      graphify: 'npx tsx src/cli/graphify.ts',
      'token:status': 'npx tsx src/token-status.ts',
      test: 'npx tsx src/test-runner-optimized.ts',
      'test:quick': 'npx tsx src/test-runner-optimized.ts --quick',
      typecheck: 'tsc --noEmit',
      lint: 'eslint "scripts/**/*.ts" "src/**/*.ts" --max-warnings 0',
      'lint:json': 'npx tsx src/json-lint.ts',
      'format:check': 'npx prettier --check "**/*.{md,json,yml,yaml,ts}"',
      'format:fix': 'npx prettier --write "**/*.{md,json,yml,yaml,ts}"',
    },
    devDependencies: {
      '@types/node': '^25.9.1',
      '@typescript-eslint/eslint-plugin': '^8.64.0',
      '@typescript-eslint/parser': '^8.64.0',
      eslint: '^10.7.0',
      'eslint-plugin-security': '^4.0.1',
      lefthook: '^2.1.8',
      prettier: '^3.0.0',
      tsx: '^4.23.1',
      typescript: '^5.9.3',
    },
    dependencies: {
      glob: '^13.0.6',
      zod: '^4.4.3',
    },
  };
}

/**
 * README for the new project with quick-start instructions.
 * Pure — Exported for unit tests.
 */
export function buildReadme(projectName: string): string {
  return `# ${projectName}

Proyecto generado con \`create-gentle-vanguard\` — scaffold del stack Gentle-Vanguard
(SSD + agentes, Nexus operacional, dashboard de observabilidad, watchtower, local-first).

## Inicio rápido

\`\`\`bash
npm install
npm run stack:setup -- --yes
npm start
\`\`\`

## Comandos principales

| Comando                    | Descripción                                  |
| -------------------------- | ------------------------------------------- |
| npm run stack:setup        | Setup completo (deps, Nexus DB, hooks)       |
| npm run stack:setup:dry    | Preview del setup (sin cambios)              |
| npm run health:check       | Verificación de salud del stack              |
| npm run watchtower         | Monitoreo continuo + auto-heal               |
| npm run db:init            | Inicializar base operacional Nexus           |
| npm run graphify           | Knowledge graph del código                   |
| npm run typecheck          | TypeScript sin errores                       |
| npm run lint               | ESLint sin warnings                          |
| npm test                   | Suite de tests unitarios                     |
| npm start                  | Dashboard / quick-start                      |

## Documentación

Ver \`docs/product/\` para MANIFESTO, ROADMAP y guías del stack.
`;
}

// ─── CLI ──────────────────────────────────────────────────────────────

interface CliArgs {
  name?: string;
  target?: string;
  noInstall: boolean;
  dryRun: boolean;
  yes: boolean;
}

function printHelp(): void {
  console.log(`
create-gentle-vanguard — scaffold del stack Gentle-Vanguard

Uso:
  npx tsx src/create-gentle-vanguard.ts --name <proyecto> [opciones]

Opciones:
  -n, --name <proyecto>   Nombre del proyecto (si no se pasa, se pregunta)
  -t, --target <dir>      Directorio de destino (default: ./<nombre>)
  -d, --dry-run           Muestra qué copiaría, sin escribir nada
      --no-install        No ejecutar npm install al final
  -y, --yes               No preguntar (auto-aceptar npm install)
  -h, --help              Muestra esta ayuda

Ejemplos:
  npx tsx src/create-gentle-vanguard.ts --name mi-app
  npx tsx src/create-gentle-vanguard.ts --name mi-app --target ../mi-app --dry-run
`);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { noInstall: false, dryRun: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name' || a === '-n') {
      const v = argv[i + 1];
      if (v) {
        args.name = v;
        i++;
      }
    } else if (a === '--target' || a === '-t') {
      const v = argv[i + 1];
      if (v) {
        args.target = v;
        i++;
      }
    } else if (a === '--no-install') {
      args.noInstall = true;
    } else if (a === '--dry-run' || a === '-d') {
      args.dryRun = true;
    } else if (a === '--yes' || a === '-y') {
      args.yes = true;
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

async function askQuestion(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
}

// ─── Copy engine ──────────────────────────────────────────────────────

/**
 * Walks the source project and returns the relative paths of every file that
 * should be scaffolded (top-level allowlist + ignore list applied).
 */
export function walkProject(root: string, entries: readonly string[] = COPY_ENTRIES): string[] {
  const files: string[] = [];
  const dirs: string[] = [];

  for (const entry of entries) {
    const full = join(root, entry);
    if (!existsSync(full)) continue;
    if (isIgnored(entry)) continue;
    if (statSync(full).isDirectory()) dirs.push(full);
    else files.push(entry);
  }

  while (dirs.length > 0) {
    const dir = dirs.pop() as string;
    for (const dirent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, dirent.name);
      const rel = toPosix(relative(root, full));
      if (isIgnored(rel)) continue;
      if (dirent.isSymbolicLink()) continue;
      if (dirent.isDirectory()) dirs.push(full);
      else files.push(rel);
    }
  }

  return files.sort();
}

/** Copies the given relative files from source to target, returning the count. */
export function copyFiles(source: string, target: string, files: readonly string[]): number {
  let count = 0;
  for (const rel of files) {
    const destFile = join(target, rel);
    mkdirSync(resolve(destFile, '..'), { recursive: true });
    copyFileSync(join(source, rel), destFile);
    count++;
  }
  return count;
}

function writeGeneratedFiles(target: string, projectName: string): void {
  const pkg = `${JSON.stringify(buildBasePackageJson(projectName), null, 2)}\n`;
  writeFileSync(join(target, 'package.json'), pkg);
  writeFileSync(join(target, 'README.md'), buildReadme(projectName));
}

// ─── Reporting ────────────────────────────────────────────────────────

function printDryRun(source: string, target: string, plan: readonly string[]): void {
  const MAX_SAMPLES = 12;
  const byTop = new Map<string, string[]>();
  for (const rel of plan) {
    const top = rel.split('/')[0] ?? '';
    const list = byTop.get(top);
    if (list) list.push(rel);
    else byTop.set(top, [rel]);
  }

  console.log(`\n[create-gentle-vanguard] DRY-RUN — lo que se copiaría desde:\n  ${source}`);
  console.log(`  Hacia:\n  ${target}\n`);

  for (const [top, list] of [...byTop.entries()].sort()) {
    console.log(`  [${top}] ${list.length} archivos`);
    for (const sample of list.slice(0, MAX_SAMPLES)) console.log(`      ${sample}`);
    if (list.length > MAX_SAMPLES) {
      console.log(`      ... y ${list.length - MAX_SAMPLES} más`);
    }
  }

  let bytes = 0;
  for (const rel of plan) {
    try {
      bytes += statSync(join(source, rel)).size;
    } catch {
      // file disappeared during planning — skip
    }
  }
  const mb = (bytes / 1024 / 1024).toFixed(1);
  console.log(`\n  TOTAL: ${plan.length} archivos, ~${mb} MB`);
  console.log('  GENERADO: package.json (base) + README.md\n');
}

function printNextSteps(target: string): void {
  console.log(`[create-gentle-vanguard] Listo. Siguientes pasos:

  1. cd ${target}
  2. npm install                    # si no se ejecutó antes
  3. npm run stack:setup            # deps, Nexus DB, git hooks, graphify
  4. npm run stack:setup:dry        # preview antes de aplicar
  5. npm start                      # dashboard / quick-start

  Referencia: docs/product/CREATE-GENTLE-VANGUARD.md
`);
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const source = resolve(process.cwd());

  if (!existsSync(source) || !existsSync(join(source, 'config', 'orchestrator.json'))) {
    console.error(
      '[create-gentle-vanguard] ERROR: no se encontró el stack en "' +
        source +
        '" (falta config/orchestrator.json). Ejecuta desde la raíz del repositorio.',
    );
    process.exit(1);
  }

  let projectName: string;
  let target: string;
  if (args.target) {
    target = resolve(args.target);
    projectName = sanitizeProjectName(args.name ?? basename(target));
  } else {
    let name = args.name;
    if (!name && process.stdin.isTTY) {
      const answer = await askQuestion('Nombre del proyecto (Enter para "gentle-vanguard-app"): ');
      if (answer) name = answer;
    }
    projectName = sanitizeProjectName(name ?? 'gentle-vanguard-app');
    target = resolve(process.cwd(), projectName);
  }

  const plan = walkProject(source);

  if (args.dryRun) {
    printDryRun(source, target, plan);
    return;
  }

  if (existsSync(target) && readdirSync(target).length > 0) {
    console.error(
      `[create-gentle-vanguard] ERROR: el directorio destino ya existe y no está vacío: ${target}`,
    );
    process.exit(1);
  }

  console.log(`\n[create-gentle-vanguard] Creando proyecto "${projectName}" en:\n  ${target}\n`);

  mkdirSync(target, { recursive: true });
  const copied = copyFiles(source, target, plan);
  writeGeneratedFiles(target, projectName);
  console.log(
    `[create-gentle-vanguard] Copiados ${copied} archivos (config, src, adapters, scripts, rules, tests, docs, .opencode).`,
  );
  console.log('[create-gentle-vanguard] Generados package.json (base) y README.md.');

  if (!args.noInstall) {
    let doInstall = args.yes;
    if (!doInstall && process.stdin.isTTY) {
      const answer = await askQuestion('\n¿Ejecutar "npm install" ahora? (y/N): ');
      doInstall = answer === 'y' || answer === 'yes';
    } else if (!doInstall) {
      doInstall = true;
    }

    if (doInstall) {
      console.log('\n[create-gentle-vanguard] Ejecutando npm install...\n');
      const result = runSync('npm', ['install'], {
        cwd: target,
        stdio: 'inherit',
        timeout: 600_000,
      });
      if (result.status !== 0) {
        console.error(
          '[create-gentle-vanguard] npm install falló. Revísalo o ejecútalo manualmente (o usa --no-install).',
        );
      }
    } else {
      console.log(
        '[create-gentle-vanguard] Omitiendo npm install. Ejecútalo manualmente: cd <proyecto> && npm install',
      );
    }
  }

  printNextSteps(target);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[create-gentle-vanguard] [FATAL]', err);
    process.exit(1);
  });
}
