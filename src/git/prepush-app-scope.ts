import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runSync } from '../core/run-command.js';

type GitRead = (args: string[]) => string | null;

const ALEXANDRIA_DOC_BUILDERS =
  /^scripts\/alexandria\/(?:build-doc(?:-guia|-propuesta|-tecnico)?|docx-kit|md-blocks|section-(?:costs|khorall|propuesta-publicacion))\.ts$/;

export interface AppScope {
  mode: 'none' | 'apps' | 'full';
  apps: string[];
  reason: string;
}

export function classifyAppScope(paths: readonly string[] | null): AppScope {
  if (!paths) return { mode: 'full', apps: [], reason: 'Rango Git no verificable' };

  const apps = new Set<string>();
  for (const path of paths) {
    if (
      ALEXANDRIA_DOC_BUILDERS.test(path) ||
      /^(?:README|CHANGELOG|CONTRIBUTING)\.md$/.test(path) ||
      (path.startsWith('docs/') && /\.(?:md|docx|pdf)$/i.test(path))
    )
      continue;
    const app = /^apps\/([^/]+)\/.+/.exec(path)?.[1];
    if (!app)
      return { mode: 'full', apps: [], reason: `Insumo compartido o alcance desconocido: ${path}` };
    apps.add(app);
  }

  return apps.size
    ? { mode: 'apps', apps: [...apps].sort(), reason: 'Rutas directas de aplicaciones' }
    : { mode: 'none', apps: [], reason: paths.length ? 'Solo documentación' : 'Sin diferencias' };
}

const ROOT = resolve(import.meta.dirname, '..', '..');
const git: GitRead = (args) => {
  const result = runSync('git', args, { cwd: ROOT, timeout: 5_000 });
  return result.status === 0 ? result.stdout : null;
};

export function inspectAppScope(base?: string, head = 'HEAD', readGit: GitRead = git) {
  const source = base === undefined ? 'tracking-estimate' : 'explicit';
  const commit = (ref: string) =>
    readGit(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`])?.trim();
  const from = commit(base ?? '@{push}');
  const to = commit(head);
  let paths: string[] | null = null;
  if (from && to && readGit(['merge-base', '--is-ancestor', from, to]) !== null) {
    const diff = readGit(['diff', '--name-only', '--no-renames', '-z', from, to, '--']);
    paths = diff === null ? null : diff.split('\0').filter(Boolean);
  }
  return {
    source,
    base: from ?? null,
    head: to ?? null,
    files: paths?.length ?? null,
    ...classifyAppScope(paths),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [base, head] = process.argv.slice(2);
  console.log(JSON.stringify(inspectAppScope(base, head), null, 2));
}
