import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { runSync } from '../core/run-command.js';

type GitRead = (args: string[]) => string | null;
type FilePair = (path: string) => [string | null, string | null];

const ALEXANDRIA_DOC_BUILDERS =
  /^scripts\/alexandria\/(?:build-doc(?:-guia|-propuesta|-tecnico)?|docx-kit|md-blocks|section-(?:costs|khorall|propuesta-publicacion))\.ts$/;

// These paths have their own stack checks. They do not provide app runtime inputs.
const STACK_ONLY = new Set([
  'config/session-autostart.config.json',
  'scripts/maintenance/verify-client-docs.mjs',
  // Tooling del stack: no alimentan runtime de apps (el gate lo abria antes de
  // correr ningun check por alcance desconocido).
  '.deadcode-baseline.txt',
  // Canon de servidores MCP del stack. Lo consumen los HOSTS de agentes
  // (mcp-usage-audit, codegraph-toggle, json-lint); ninguna app lo lee en
  // runtime -> no aporta entrada de runtime a las apps.
  '.mcp.json',
  'knip.json',
  'src/git/prepush-app-scope.ts',
  'src/git/prepush-app-scope.test.ts',
  'src/git/prepush-gate.ts',
  'src/ops/apps-health-report.ts',
  'src/ops/stack-audit-apps.ts',
  'src/ops/stack-apps-audit-scheduled.ts',
  'src/ops/engram-dedupe.ts',
  'src/tools/codegraph-usage-audit.ts',
  'src/git/app-audit-receipts.ts',
  // Read-only token diagnostics consumed by stack CLI/doctor, not application runtime.
  'src/tokens/token-safety.ts',
  'src/tokens/native-compaction.ts',
  'tests/unit/tokens/native-compaction.test.ts',
  'tests/unit/zcode-sync.test.ts',
  // These launch agent MCPs only; app OpenCode consumers read model/provider fields.
  'src/tools/mcp-native-launch.ts',
  'tests/unit/mcp-native-launch.test.ts',
  // Skill metadata is consumed by agent loaders; these files do not feed app runtime.
  ...[
    'code-review-and-quality',
    'context-engineering',
    'debugging-and-error-recovery',
    'planning-and-task-breakdown',
    'test-driven-development',
    'web-research',
  ].map((name) => `skills/${name}/SKILL.md`),
  'src/tools/validate-opencode-config.ts',
  'reports/audits/model-catalog-latest.json',
  'reports/audits/workspace-reconciliation-2026-11-17.json',
  'tests/unit/apps-health-report.test.ts',
  'tests/unit/prepush-gate-skip-apps.test.ts',
  'tests/unit/validate-opencode-config.test.ts',
  'tests/unit/stack-audit-apps.test.ts',
  'tests/unit/app-audit-receipts.test.ts',
]);
const LAUNCHER_APPS: Record<string, string> = {
  'scripts/start-voice-stack.ts': 'voice-studio',
  'src/ops/app-launcher.ts': 'gv-music',
  'src/ops/dashboard-start.ts': 'web-dashboard',
};
const CONFIGS = new Set([
  'assets/tokens.json',
  'config/app-validation-contracts.json',
  'package.json',
  'opencode.json',
]);
const CONTRACT_SECTIONS = new Set(['safeLocalTestScripts', 'nativeTestSuites', 'naDeclarations']);

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected JSON object');
  return value as Record<string, unknown>;
}

function configImpact(
  path: string,
  [before, after]: ReturnType<FilePair>,
): string[] | 'full' | null {
  if (before === null || after === null) return null;
  try {
    const old = object(JSON.parse(before));
    const next = object(JSON.parse(after));
    if (path === 'opencode.json') {
      // Keep model/provider/agent and all MCP settings except these commands in scope.
      for (const config of [old, next]) {
        const servers = object(object(config.mcp).servers);
        for (const name of ['codegraph', 'chrome-devtools', 'memory', 'filesystem']) {
          if (servers[name]) delete object(servers[name]).command;
        }
      }
      // Un cambio de modelo/proveedor/MCP afecta a todas las apps que consumen
      // agentes: el impacto es GLOBAL (barrido completo), no "desconocido".
      // Antes devolvia null y el gate abortaba antes de correr ningun check.
      return isDeepStrictEqual(old, next) ? [] : 'full';
    }
    if (path === 'package.json' || path === 'assets/tokens.json') {
      const [section, property] =
        path === 'package.json' ? ['scripts', 'apps:health'] : ['meta', 'generated'];
      delete object(old[section])[property];
      delete object(next[section])[property];
      return isDeepStrictEqual(old, next) ? [] : 'full';
    }
    const apps = new Set<string>();
    for (const section of new Set([...Object.keys(old), ...Object.keys(next)])) {
      if (isDeepStrictEqual(old[section], next[section])) continue;
      if (!CONTRACT_SECTIONS.has(section)) return null;
      const previousApps = object(old[section] ?? {});
      const nextApps = object(next[section] ?? {});
      for (const app of new Set([...Object.keys(previousApps), ...Object.keys(nextApps)])) {
        if (!isDeepStrictEqual(previousApps[app], nextApps[app])) apps.add(app);
      }
    }
    return [...apps];
  } catch {
    return null;
  }
}

/**
 * Superficie que NO aporta runtime a las apps y tiene sus propios checks
 * (docs-consistency, decks-facts-drift, normative-audit, la suite unitaria):
 * documentacion, skills, reportes generados y tests del stack.
 */
const NO_APP_IMPACT =
  /^(?:docs|rules|knowledge-base|reports|skills|tests)\/.+|(?:AGENTS|GETTING-STARTED|CLAUDE|README|CHANGELOG|CONTRIBUTING)\.md$|^\.lefthook\.yml$/;

/**
 * Superficie COMPARTIDA del stack: codigo y configuracion que las apps pueden
 * importar o leer (src/**, scripts/**, config/**). El impacto no es de una app
 * puntual: es de todas -> barrido completo (`full`), no "desconocido".
 *
 * Por que importa: `unknown` aborta el gate antes de correr ningun check, asi
 * que si el codigo del stack no esta clasificado, el push queda bloqueado para
 * siempre (medido 2026-11-18: 158 rutas sin mapa de impacto abortaban el
 * composite de pre-push). "No conozco el impacto" y "el impacto es global" son
 * cosas distintas: la segunda tiene una respuesta honesta (barrido completo).
 */
const SHARED_STACK = /^(?:src|scripts|config)\//;

/**
 * Archivos de RAIZ que NO aportan runtime a las apps: documentacion, ignores,
 * configuracion de editor/lint, ejemplos y locks de superficies que no son
 * apps. Declararlos evita que tocarlos aborte el push por "alcance desconocido"
 * (medido 2026-11-18: 50 archivos de raiz sin mapa; entre ellos `.mcp.json`,
 * que el propio stack cambia al activar/desactivar un MCP).
 *
 * Solo raiz (`^[^/]+$`): un archivo con directorio se clasifica por su
 * superficie, no por su nombre.
 */
const ROOT_INERT = new Set([
  '.clineignore',
  '.clinerules',
  '.cursorrules',
  '.dockerignore',
  '.editorconfig',
  '.env.example',
  '.env.local.example',
  '.gitattributes',
  '.gitignore',
  '.gitleaks.toml',
  '.graphifyignore',
  '.markdownlint-cli2.jsonc',
  '.markdownlint.json',
  '.markdownlint.jsonc',
  '.markdownlintignore',
  '.prettierignore',
  '.prettierrc',
  '.qoderignore',
  '.secretlintignore',
  '.secretlintrc.json',
  '.trivyignore',
  '.trufflehogignore',
  '.zcodeignore',
  'LICENSE',
  'VERSION',
  'renovate.json',
  'skills-lock.json',
  'tui.json',
]);

/**
 * Archivos de RAIZ que SÍ son toolchain compartida: cambian como se compila,
 * testea o despliega el stack entero. Impacto global declarado (`full`), no
 * "desconocido": el push no barre el catalogo (eso lo hace la cadencia) pero
 * tampoco aborta.
 */
const ROOT_SHARED = new Set([
  '.node-version',
  '.npmrc',
  '.nvmrc',
  'Dockerfile',
  'bun.lock',
  'docker-compose.test.yml',
  'docker-compose.yml',
  'eslint.config.js',
  'gv-app',
  'netlify.toml',
  'pnpm-workspace.yaml',
  'pyproject.toml',
  'start.bat',
  'stryker.config.json',
  'tsconfig.json',
  'vitest.config.ts',
  'vitest.eval.config.ts',
  'vitest.public-web.config.ts',
]);

/**
 * Superficies del repo que NO son runtime de apps: espejos publicados
 * (`public/`), plantillas de scaffolding (`templates/`), CI (`.github/`), plugins
 * de clientes (`.windsurf/`, `.cursor/`, `.cline/`, `.opencode/`, `.codex/`),
 * datos de research/eval/finetune y archivos de configuracion de clientes.
 *
 * Por que importa: `unknown` aborta el gate ANTES de correr ningun check.
 * Medido 2026-11-18: 2.056 de 14.830 archivos rastreados caian en `unknown`
 * (todo `public/skills/**`, `.windsurf/plugins/**`, `templates/**`, ...), o
 * sea que tocar cualquiera de ellos dejaba el push bloqueado para siempre.
 *
 * Declarar la SUPERFICIE (no cada archivo) es lo que evita que la lista se
 * desactualice con cada archivo nuevo.
 */
const NO_APP_SURFACES =
  /^(?:public|templates|tools|styles|releases|research|output|demos|plugins|provenance|bench|deprecated|policies|content|openspec|examples|\.archive|\.github|\.windsurf|\.cursor|\.cline|\.codex|\.opencode|\.continue|\.agents|\.antigravity|\.vscode|\.impeccable|\.design-hub|\.devcontainer|\.event-bus|\.ft|\.eval|\.test|\.zcode|\.workspace)\//;

/**
 * Superficies del repo con codigo o assets que una app puede importar o leer:
 * paquetes, assets de marca, scripts protegidos, adaptadores, deploy y
 * estilos. Impacto global declarado (`full`): no se barren en el push (eso lo
 * hace la cadencia) pero tampoco abortan.
 *
 * `assets/tokens.json` queda fuera: tiene su propio contrato de secciones
 * (ver `configImpact`), asi que se clasifica despues, no antes.
 */
const SHARED_SURFACES = /^(?:packages|assets|protected|adapters|deploy|launcher)\//;

export interface AppScope {
  mode: 'none' | 'apps' | 'full' | 'unknown';
  apps: string[];
  reason: string;
}

/** Unknown impact blocks before any suite; it never grants authority for a global run. */
export function assertKnownAppScope(scope: Pick<AppScope, 'mode' | 'reason'>): void {
  if (scope.mode === 'unknown') {
    throw new Error(
      `Alcance de apps no resuelto: ${scope.reason}. Identificar consumidores antes de ejecutar suites.`,
    );
  }
}

export function classifyAppScope(paths: readonly string[] | null, readFiles?: FilePair): AppScope {
  if (!paths) return { mode: 'unknown', apps: [], reason: 'Rango Git no verificable' };

  const apps = new Set<string>();
  const shared: string[] = [];
  const unknown: string[] = [];
  for (const path of paths) {
    if (
      ALEXANDRIA_DOC_BUILDERS.test(path) ||
      STACK_ONLY.has(path) ||
      NO_APP_IMPACT.test(path) ||
      /^(?:README|CHANGELOG|CONTRIBUTING)\.md$/.test(path) ||
      /^(?:docs|rules|knowledge-base\/04-sessions)\/.+\.(?:md|docx|pdf)$/i.test(path) ||
      /^docs\/sessions\/metrics\/.+\.json$/.test(path) ||
      /^docs\/presentations\/decks\/(?:content\/|build\/manual\.js$)/.test(path) ||
      NO_APP_SURFACES.test(path) ||
      // Archivo suelto en la raiz de `apps/` (p.ej. apps/.gitignore): no es una
      // app, es el ignore del directorio.
      /^apps\/[^/]+$/.test(path)
    )
      continue;
    if (ROOT_INERT.has(path) || (!path.includes('/') && path.endsWith('.md'))) continue;
    if (ROOT_SHARED.has(path)) {
      shared.push(path);
      continue;
    }
    const app =
      /^apps\/([^/]+)\/.+/.exec(path)?.[1] ??
      (Object.hasOwn(LAUNCHER_APPS, path) ? LAUNCHER_APPS[path] : undefined);
    if (app) {
      apps.add(app);
      continue;
    }
    if (
      /^(?:packages\/shared\/|shared\/)/.test(path) ||
      ['pnpm-lock.yaml', 'package-lock.json'].includes(path) ||
      (SHARED_STACK.test(path) && !CONFIGS.has(path)) ||
      (SHARED_SURFACES.test(path) && !CONFIGS.has(path))
    ) {
      shared.push(path);
      continue;
    }
    const impact = CONFIGS.has(path) && readFiles ? configImpact(path, readFiles(path)) : null;
    if (impact === 'full') shared.push(path);
    else if (impact === null) unknown.push(path);
    else for (const affected of impact) apps.add(affected);
  }

  if (unknown.length)
    return {
      mode: 'unknown',
      apps: [...apps].sort(),
      reason: `Sin mapa de impacto: ${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? ` (+${unknown.length - 5})` : ''}`,
    };
  if (shared.length)
    return {
      mode: 'full',
      apps: [],
      reason: `Dependencias compartidas identificadas: ${shared.join(', ')}`,
    };

  return apps.size
    ? {
        mode: 'apps',
        apps: [...apps].sort(),
        reason: 'Cambios directos o dependencias de apps identificadas',
      }
    : {
        mode: 'none',
        apps: [],
        reason: paths.length ? 'Cambios sin impacto en apps' : 'Sin diferencias',
      };
}

const ROOT = resolve(import.meta.dirname, '..', '..');
const git: GitRead = (args) => {
  const result = runSync('git', args, { cwd: ROOT, timeout: 5_000 });
  return result.status === 0 ? result.stdout : null;
};

export function readWorkingFile(path: string): string | null {
  try {
    return readFileSync(resolve(ROOT, path), 'utf8');
  } catch {
    return null;
  }
}

export function inspectAppScope(
  base?: string,
  head = 'HEAD',
  readGit: GitRead = git,
  readWorktree?: (path: string) => string | null,
) {
  const source = base === undefined ? 'tracking-estimate' : 'explicit';
  const commit = (ref: string) =>
    readGit(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`])?.trim();
  const from = commit(base ?? '@{push}');
  const to = commit(head);
  const diff =
    from && to && readGit(['merge-base', '--is-ancestor', from, to]) !== null
      ? readGit(['diff', '--name-only', '--no-renames', '-z', from, to, '--'])
      : null;
  const paths = diff?.split('\0').filter(Boolean) ?? null;
  const published = classifyAppScope(paths, (path) => [
    readGit(['show', `${from}:${path}`]),
    readGit(['show', `${to}:${path}`]),
  ]);
  let impact = published;
  if (readWorktree && to && published.mode !== 'unknown') {
    const tracked = readGit(['diff', '--name-only', '--no-renames', '-z', to, '--']);
    const untracked = readGit(['ls-files', '--others', '--exclude-standard', '-z']);
    const local = classifyAppScope(
      tracked === null || untracked === null
        ? null
        : (tracked + untracked).split('\0').filter(Boolean),
      (path) => [readGit(['show', `${to}:${path}`]), readWorktree(path)],
    );
    if (local.mode === 'unknown' || local.mode === 'full') impact = local;
    else if (local.mode === 'apps' && published.mode !== 'full') {
      impact = { ...local, apps: [...new Set([...published.apps, ...local.apps])].sort() };
    }
  }
  return {
    source,
    base: from ?? null,
    head: to ?? null,
    files: paths?.length ?? null,
    ...impact,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const [base, head] = args.filter((arg) => arg !== '--include-worktree');
  console.log(
    JSON.stringify(
      inspectAppScope(
        base,
        head,
        git,
        args.includes('--include-worktree') ? readWorkingFile : undefined,
      ),
      null,
      2,
    ),
  );
}
