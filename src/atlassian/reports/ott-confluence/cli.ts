/**
 * Informe OTT Confluence — pipeline reproducible (collect → build → render).
 *
 *   npm run atlassian:report -- collect [--spaces=OTT,DGOBACKEND,TS,DESIGN] [--jira=false]
 *   npm run atlassian:report -- build [--date=2026-11-24] [--data-dir=...] [--out-dir=...]
 *   npm run atlassian:report -- render [--date=2026-11-24] [--out-dir=...]
 *   npm run atlassian:report -- all
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEFAULT_SPACES, collectAll, listSpaces, pageFileFor, probeAnalytics } from './collect-atlassian.js';
import { renderReportHtml } from './template.js';
import { renderPdf } from './render-pdf-report.js';
import { loadConfluence } from './client.js';
import type { OtherSpace, ReportBundle, SpaceInfo } from './types.js';

const DEFAULT_DATA_DIR = '.runtime/censor/ott-analysis';
const DEFAULT_OUT_DIR = 'docs/atlassian';
const DEFAULT_CENSUS = 'run-2026-11-14T17-19-03-143Z.json';
const SECONDARY_SPACES = new Set(['OTT', 'DGOBACKEND']);

function parseFlags(argv: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (const item of argv) {
    if (!item.startsWith('--')) continue;
    const [key, value] = item.slice(2).split('=');
    flags[key] = value === undefined ? true : value;
  }
  return flags;
}

const flagString = (v: string | boolean | undefined, fallback: string) =>
  typeof v === 'string' ? v : fallback;
const flagBool = (v: string | boolean | undefined, fallback: boolean) =>
  typeof v === 'string' ? v !== 'false' && v !== '0' : typeof v === 'boolean' ? v : fallback;

function readJson<T>(path: string, hint: string): T {
  if (!existsSync(path)) {
    throw new Error(`Falta ${path}. ${hint}`);
  }
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function latestCensus(runsDir: string): string | null {
  if (!existsSync(runsDir)) return null;
  const files = readdirSync(runsDir)
    .filter((f) => /^run-.*\.json$/.test(f))
    .sort();
  return files.length ? join(runsDir, files[files.length - 1]) : null;
}

interface BuildOptions {
  date: string;
  dataDir: string;
  outDir: string;
  census?: string;
}

function buildReport(options: BuildOptions): { htmlPath: string; bytes: number; census: string } {
  const dataDir = resolve(options.dataDir);
  const outDir = resolve(options.outDir);
  const hint = 'Corré primero: npm run atlassian:report -- collect';

  const pages = readJson<ReportBundle['pages']>(join(dataDir, 'pages.json'), hint);
  const dgo = readJson<ReportBundle['dgo']>(join(dataDir, 'dgobackend-pages.json'), hint);
  const field = readJson<ReportBundle['field']>(
    join(dataDir, 'incidents-by-system-field.json'),
    hint,
  );
  const kw = readJson<ReportBundle['kw']>(join(dataDir, 'incidents.json'), hint);
  const totals = readJson<ReportBundle['totals']>(join(dataDir, 'incident-totals.json'), hint);
  const extra = readJson<ReportBundle['extra']>(join(dataDir, 'report-extra.json'), hint);
  const tree = readJson<ReportBundle['tree']>(join(dataDir, 'tree-level2.json'), hint);

  const runsDir = resolve('.runtime/censor/runs');
  const censusPath = options.census
    ? resolve(options.census)
    : existsSync(join(runsDir, DEFAULT_CENSUS))
      ? join(runsDir, DEFAULT_CENSUS)
      : latestCensus(runsDir);
  if (!censusPath) throw new Error(`No hay censo en ${runsDir} (corré el censo de Censor).`);
  const census = readJson<ReportBundle['census']>(censusPath, '');

  const spacesPath = join(dataDir, 'spaces.json');
  const spaceList = existsSync(spacesPath) ? readJson<SpaceInfo[]>(spacesPath, '') : [];
  const names = new Map(spaceList.map((s) => [s.key, s.name]));
  const others: OtherSpace[] = [];
  const candidateKeys = spaceList.length
    ? spaceList.map((s) => s.key)
    : DEFAULT_SPACES;
  for (const key of candidateKeys) {
    if (SECONDARY_SPACES.has(key.toUpperCase())) continue;
    const file = join(dataDir, pageFileFor(key));
    if (!existsSync(file)) continue;
    others.push({
      key,
      name: names.get(key) ?? key,
      pages: readJson<OtherSpace['pages']>(file, ''),
    });
  }

  const analyticsPath = join(dataDir, 'analytics-probe.json');
  const bundle: ReportBundle = {
    pages,
    dgo,
    field,
    kw,
    totals,
    extra,
    census,
    tree,
    others,
    analytics: existsSync(analyticsPath)
      ? readJson<NonNullable<ReportBundle['analytics']>>(analyticsPath, '')
      : undefined,
    stamp: options.date,
    now: `${options.date}T18:00:00Z`,
  };

  const html = renderReportHtml(bundle);
  mkdirSync(outDir, { recursive: true });
  const htmlPath = join(outDir, `OTT-CONFLUENCE-ANALISIS-${options.date}.html`);
  writeFileSync(htmlPath, html);
  return { htmlPath, bytes: html.length, census: censusPath };
}

async function runRender(date: string, outDir: string) {
  const htmlPath = resolve(outDir, `OTT-CONFLUENCE-ANALISIS-${date}.html`);
  const pdfPath = resolve(outDir, `OTT-CONFLUENCE-ANALISIS-${date}.pdf`);
  if (!existsSync(htmlPath)) {
    throw new Error(`Falta ${htmlPath}. Corré: npm run atlassian:report -- build --date=${date}`);
  }
  const dateLabel = date.split('-').reverse().join('/');
  return renderPdf({
    htmlPath,
    pdfPath,
    label: 'Confluence OTT · Análisis',
    dateLabel,
  });
}

async function main(): Promise<void> {
  const [command = 'help', ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  const dataDir = flagString(flags['data-dir'], DEFAULT_DATA_DIR);
  const outDir = flagString(flags['out-dir'], DEFAULT_OUT_DIR);
  const date = flagString(flags.date, new Date().toLocaleDateString('sv-SE'));

  if (command === 'collect') {
    const spaces = flagString(flags.spaces, DEFAULT_SPACES.join(','))
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const written = await collectAll({
      spaces,
      includeJira: flagBool(flags.jira, true),
      rootId: flagString(flags.root, '45944688'),
      dataDir,
    });
    console.log(JSON.stringify({ command, spaces, dataDir, written }, null, 2));
    return;
  }

  if (command === 'probe') {
    const api = await loadConfluence('OTT');
    const spaceList = await listSpaces(api);
    const analytics = await probeAnalytics(api, flagString(flags.root, '45944688'));
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'spaces.json'), JSON.stringify(spaceList, null, 1));
    writeFileSync(join(dataDir, 'analytics-probe.json'), JSON.stringify(analytics, null, 1));
    console.log(JSON.stringify({ command, spaces: spaceList.length, analytics }, null, 2));
    return;
  }

  if (command === 'build') {
    const result = buildReport({
      date,
      dataDir,
      outDir,
      census: typeof flags.census === 'string' ? flags.census : undefined,
    });
    console.log(JSON.stringify({ command, ...result }, null, 2));
    return;
  }

  if (command === 'render') {
    const result = await runRender(date, outDir);
    console.log(JSON.stringify({ command, ...result }, null, 2));
    return;
  }

  if (command === 'all') {
    const spaces = flagString(flags.spaces, DEFAULT_SPACES.join(','))
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const written = await collectAll({
      spaces,
      includeJira: flagBool(flags.jira, true),
      rootId: flagString(flags.root, '45944688'),
      dataDir,
    });
    const built = buildReport({ date, dataDir, outDir });
    const rendered = await runRender(date, outDir);
    console.log(JSON.stringify({ command, spaces, written, ...built, ...rendered }, null, 2));
    return;
  }

  console.log(
    [
      'Uso: npm run atlassian:report -- <collect|probe|build|render|all> [flags]',
      '  --spaces=OTT,DGOBACKEND,TS,DESIGN   espacios a colectar (collect/all)',
      '  --jira=false                        omitir Jira (collect/all)',
      '  --date=YYYY-MM-DD                   fecha del informe (default: hoy)',
      '  --data-dir=.runtime/censor/ott-analysis',
      '  --out-dir=docs/atlassian',
      '  --census=<archivo>                  censo a usar (default: el del informe)',
    ].join('\n'),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
