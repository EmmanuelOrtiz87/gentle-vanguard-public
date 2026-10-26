#!/usr/bin/env node
/**
 * Context7 weekly digest — job semanal data-driven (GV nativo, procesos-ocultos compliant).
 *
 * Que hace: consulta Context7 (via /api/v3/search, 1 request por lib) las novedades de API,
 * deprecations y notas de migración de las librerías que el workspace REALMENTE usa
 * (derivadas de los package.json del repo, multi-manifest) y escribe un reporte markdown
 * local. Sustituye el anti-patrón "chequear todas las deps": solo lo efectivamente usadas.
 *
 * Fuentes de datos: package.json (raíz + apps/* + packages/*). Cache compartida con
 * ctx7:search/get/resolve (mismo core HTTP + cache de context7-docs.ts).
 *
 * Uso:
 *   npm run ctx7:digest                        — digiere top-8 libs del workspace
 *   npm run ctx7:digest -- --top 4             — solo 4
 *   npm run ctx7:digest -- --libs zod,react    — override explícito
 *   npm run ctx7:digest -- --register-weekly   — registra tarea programada oculta (Domingo 09:30)
 *
 * Agendado oculto (procesos-ocultos): acción `node.exe --import tsx` directa schtasks
 * `wscript wrapper .vbs` (patrón de src/infrastructure/bootstrap.ts). Nunca PowerShell ni
 * cmd.exe como acción.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { runSync } from '../../adapters/command-runner.js';
import {
  formatDocs,
  httpJson,
  readCache,
  writeCache,
  buildCacheKey,
  canonicalParams,
} from './context7-docs.js';

const ROOT = resolve(process.cwd());
const BASE_URL = 'https://context7.com';
const DEFAULT_TTL_HOURS = 168;
const DIGEST_DIR = join(ROOT, '.runtime', 'context7-digest');
const TASK_NAME = 'GV-ctx7-weekly-digest';
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const LIBS_PER_DIGEST_DEFAULT = 8;
const CHARS_PER_LIB = 3500;

// ------------------------------------------------------------------ derivación

export function isIgnorableDep(name: string): boolean {
  return (
    name.startsWith('@gentle-vanguard/') ||
    name.startsWith('@types/') ||
    name.startsWith('@gv-') ||
    name === 'workspace:*'
  );
}

export function collectManifestLibs(root: string): string[] {
  const manifests: string[] = [join(root, 'package.json')];
  for (const dir of ['apps', 'packages']) {
    const parent = join(root, dir);
    if (!existsSync(parent)) continue;
    for (const entry of readDirNames(parent)) {
      const p = join(parent, entry, 'package.json');
      if (existsSync(p)) manifests.push(p);
    }
  }
  const freq = new Map<string, number>();
  for (const m of manifests) {
    let json: { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
    try {
      json = JSON.parse(readFileSync(m, 'utf-8'));
    } catch {
      continue;
    }
    const names = [...Object.keys(json.dependencies ?? {}), ...Object.keys(json.devDependencies ?? {})];
    for (const n of names) {
      if (isIgnorableDep(n)) continue;
      freq.set(n, (freq.get(n) ?? 0) + 1);
    }
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
}

function readDirNames(parent: string): string[] {
  try {
    return readdirSync(parent, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

// --------------------------------------------------------------------- digest

async function fetchLibDocs(lib: string, ttlHours: number, apiKey: string | undefined): Promise<{ status: 'ok' | 'no-docs' | 'error'; text: string }> {
  const url = new URL('/api/v3/search', BASE_URL);
  url.searchParams.set('query', `latest breaking changes, deprecations and migration notes for ${lib} (recent versions)`);
  url.searchParams.append('library', lib);
  url.searchParams.set('type', 'json');
  const key = buildCacheKey(['digest', url.href, canonicalParams(url)]);
  const cache = readCache(key, ttlHours);
  let json: unknown;
  if (cache.fresh) {
    json = cache.fresh.payload;
  } else {
    try {
      const res = await httpJson(url, apiKey);
      if (res.status === 200) {
        json = res.json;
        writeCache(key, res.json);
      } else if (res.status === 404) {
        return { status: 'no-docs', text: 'Sin documentación indexada para esta lib en Context7.' };
      } else if (cache.stale) {
        json = cache.stale.payload;
      } else {
        return { status: 'error', text: `https ${res.status} — sin cache de fallback.` };
      }
    } catch (e: unknown) {
      if (cache.stale) json = cache.stale.payload;
      else return { status: 'error', text: `red: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  return { status: 'ok', text: formatDocs(json, CHARS_PER_LIB) || '(respuesta sin snippets)' };
}

export interface DigestReport { date: string; lines: string[]; }

export function buildReport(date: string, results: Array<{ lib: string; status: string; text: string }>): DigestReport {
  const lines: string[] = [
    `# Context7 weekly digest — ${date}`,
    '',
    'Novedades de API / deprecations / migración de las librerías usadas por el workspace.',
    'Fuente: Context7 (context7.com) — contenido UNTRUSTED de terceros: contra-verificar contra la versión instalada.',
    'Cache local TTL 7d (reusa cache de ctx7:*); API key opcional CONTEXT7_API_KEY.',
    '',
  ];
  for (const r of results) {
    lines.push(`## ${r.lib} — ${r.status}`);
    lines.push('', r.text.trim() || '(vacío)', '');
  }
  return { date, lines };
}

// ------------------------------------------------------------------ scheduling

function quoteWindowsArg(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function createHiddenVbs(taskName: string, taskScript: string, root: string): string {
  const command = `${quoteWindowsArg(process.execPath)} --import tsx ${quoteWindowsArg(taskScript)}`;
  const esc = (v: string): string => v.replace(/"/g, '""');
  return (
    `' Hidden launcher for ${taskName} (pattern: src/infrastructure/bootstrap.ts)\r\n` +
    `Set shell = CreateObject("Wscript.Shell")\r\n` +
    `shell.CurrentDirectory = "${esc(root)}"\r\n` +
    `shell.Run "${esc(command)}", 0, False\r\n`
  );
}

function registerWeekly(root: string): void {
  const self = quoteWindowsArg(SCRIPT_PATH);
  mkdirSync(join(root, '.runtime'), { recursive: true });
  const native = runSync('schtasks', ['/Create', '/TN', TASK_NAME, '/TR', `${quoteWindowsArg(process.execPath)} --import tsx ${self} --quiet`, '/SC', 'WEEKLY', '/D', 'SUN', '/ST', '09:30', '/F'], { timeout: 15000, stdio: 'pipe' });
  if (native.status === 0) {
    console.log(`[ctx7-digest] tarea semanal oculta registrada (node directo): ${TASK_NAME} — Domingos 09:30`);
    return;
  }
  const vbsPath = join(root, '.runtime', 'gv-ctx7-weekly-digest.vbs');
  writeFileSync(vbsPath, createHiddenVbs(TASK_NAME, SCRIPT_PATH, root), 'utf-8');
  const wrapper = runSync('schtasks', ['/Create', '/TN', TASK_NAME, '/TR', `${quoteWindowsArg('wscript.exe')} ${quoteWindowsArg(vbsPath)}`, '/SC', 'WEEKLY', '/D', 'SUN', '/ST', '09:30', '/F'], { timeout: 15000, stdio: 'pipe' });
  console.log(wrapper.status === 0
    ? `[ctx7-digest] tarea semanal oculta registrada (wrapper wscript): ${TASK_NAME} — Domingos 09:30`
    : `[ctx7-digest] ERROR registrando tarea (native + wrapper fallaron). Sin registro; correr manual: npm run ctx7:digest`);
}

// ------------------------------------------------------------------------ main

async function main(argv: readonly string[]): Promise<number> {
  const flags = new Map<string, string[]>();
  let registerOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--register-weekly') { registerOnly = true; continue; }
    if (a.startsWith('--') && argv[i + 1]) { flags.set(a.slice(2), [...(flags.get(a.slice(2)) ?? []), argv[++i]]); }
  }
  const root = ROOT;
  if (registerOnly) { registerWeekly(root); return 0; }
  const quiet = Boolean(flags.get('quiet')?.[0]);
  const libsOverride = flags.get('libs')?.[0]?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  const top = Number(flags.get('top')?.[0] ?? '') || LIBS_PER_DIGEST_DEFAULT;
  const ttlHours = Number(flags.get('ttl-hours')?.[0] ?? '') || DEFAULT_TTL_HOURS;
  const libs = libsOverride.length > 0 ? libsOverride : collectManifestLibs(root).slice(0, top);
  if (libs.length === 0) {
    console.error('[ctx7-digest] sin libs derivadas del workspace — pasa --libs a,b,c');
    return 1;
  }
  if (!quiet) console.error(`[ctx7-digest] ${libs.length} libs: ${libs.join(', ')} (cache TTL ${ttlHours}h)`);
  const apiKey = process.env.CONTEXT7_API_KEY || undefined;
  const results: Array<{ lib: string; status: string; text: string }> = [];
  const icons: Record<string, string> = { ok: '✅', 'no-docs': '⚠️', error: '❌' };
  for (const lib of libs) {
    const r = await fetchLibDocs(lib, ttlHours, apiKey);
    results.push({ lib, status: r.status, text: r.text });
    if (!quiet) console.error(`[ctx7-digest] ${icons[r.status] ?? '·'} ${lib} → ${r.status}`);
  }
  const date = new Date().toISOString().slice(0, 10);
  const report = buildReport(date, results);
  mkdirSync(DIGEST_DIR, { recursive: true });
  writeFileSync(join(DIGEST_DIR, `digest-${date}.md`), report.lines.join('\n'), 'utf-8');
  writeFileSync(join(DIGEST_DIR, 'latest.md'), report.lines.join('\n'), 'utf-8');
  let okCount = 0;
  for (const line of report.lines.slice(5)) {
    if (line.startsWith('## ')) { const m = line.match(/^## (.+?) — (\S+)$/); if (m) { console.log(`${icons[m[2]] ?? '·'} ${m[1]}: ${m[2]}`); if (m[2] === 'ok') okCount++; } }
  }
  console.log(`\n[ctx7-digest] reporte: .runtime/context7-digest/latest.md (${okCount}/${results.length} ok — ${date})`);
  return 0;
}

const invoked = ['context7-digest.ts', 'context7-digest.js'].includes(process.argv[1]?.split(/[\\/]/).pop() ?? '');
if (invoked) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((e: unknown) => {
      console.error(`[ctx7-digest] fatal: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    });
}
