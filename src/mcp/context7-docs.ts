#!/usr/bin/env node
/**
 * Context7 client nativo (Gentle-Vanguard, local-first).
 *
 * Conocimiento absorbido de fuentes oficiales (2026-10-21):
 *   - https://context7.com/docs/api-guide.md   — endpoints, autenticación, rate limits, errores
 *   - https://context7.com/llms.txt            — superficie de producto
 *   - README @upstash/context7-mcp@4.1.1       — hosted MCP https://mcp.context7.com/mcp
 *
 * Contratos:
 *   - Egress hardcodeado a https://context7.com. La URL nunca se construye con input del
 *     usuario → sin superficie SSRF.
 *   - API key OPCIONAL via env CONTEXT7_API_KEY (formato ctx7sk…). Anónimo funciona con
 *     rate limit bajo. 429 respeta `Retry-After`. Nunca se loggea la key.
 *   - Cache local en .runtime/context7-cache/ (gitignored). TTL default 7 días; caches
 *     stale se usan como fallback si falla la red (resiliencia local-first).
 *   - Output truncado (--max-chars, default 12000) para economía de tokens. Meta-líneas
 *     por stderr para dejar stdout limpio (docs puros).
 *   - La documentación servida es contenido de terceros UNTRUSTED: verifica contra la
 *     versión instalada antes de aplicar ejemplos.
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const BASE_URL = 'https://context7.com';
const CACHE_DIR = join(resolve(process.cwd()), '.runtime', 'context7-cache');
const DEFAULT_TTL_HOURS = 168; // 7 días — "updates relatively infrequent" (best practice oficial)
const DEFAULT_MAX_CHARS = 12000;

export interface ParsedArgs {
  positionals: string[];
  values: Map<string, string[]>;
}

export interface C7CodeItemHandle { code?: unknown; }
export interface C7SnippetHandle { codeTitle?: unknown; libraryId?: unknown; codeList?: C7CodeItemHandle[]; }
export interface C7InfoSnippetHandle { content?: unknown; }
export interface C7CacheEntry { fetchedAt: string; payload: unknown; }

interface HttpResult { status: number; json: unknown; }

// ---------------------------------------------------------------- pure helpers

export function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

export function buildCacheKey(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u001f')).digest('hex');
}

export function canonicalParams(url: URL): string {
  const kv: string[] = [];
  const keys = [...url.searchParams.keys()].sort();
  for (const k of keys) for (const v of url.searchParams.getAll(k)) kv.push(`${k}=${v}`);
  return kv.join('&');
}

export function cacheAgeHours(fetchedAt: string, now: number): number {
  const t = Date.parse(fetchedAt);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now - t) / 3_600_000);
}

export function asDocPayload(json: unknown): {
  codeSnippets?: C7SnippetHandle[];
  infoSnippets?: C7InfoSnippetHandle[];
} | null {
  if (typeof json !== 'object' || json === null) return null;
  const obj = json as Record<string, unknown>;
  const code = obj.codeSnippets ?? obj.infoSnippets;
  if (!Array.isArray(code)) return null;
  return {
    codeSnippets: Array.isArray(obj.codeSnippets) ? (obj.codeSnippets as C7SnippetHandle[]) : [],
    infoSnippets: Array.isArray(obj.infoSnippets) ? (obj.infoSnippets as C7InfoSnippetHandle[]) : [],
  };
}

export function formatDocs(json: unknown, maxChars = DEFAULT_MAX_CHARS): string {
  const doc = asDocPayload(json);
  if (!doc) return '';
  const out: string[] = [];
  (doc.codeSnippets ?? []).forEach((s, i) => {
    const title = str(s.codeTitle) || `snippet ${i + 1}`;
    const lib = str(s.libraryId);
    out.push(`### ${title}${lib ? ` — ${lib}` : ''}`);
    for (const c of s.codeList ?? []) {
      const code = str(c.code).trim();
      if (code) out.push('```', code, '```');
    }
  });
  for (const info of doc.infoSnippets ?? []) {
    const content = str(info.content).trim();
    if (content) out.push(`> ${content.replace(/\n+/g, '\n> ')}`);
  }
  let text = out.join('\n');
  if (text.length > maxChars) {
    text = `${text.slice(0, Math.max(0, maxChars))}\n\n…[ctx7 output truncado — refina el query o sube --max-chars]`;
  }
  return text;
}

export function parseCliArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const values = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.indexOf('--') === 0 && a.length > 2) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        const vals = values.get(key) ?? [];
        vals.push(next);
        values.set(key, vals);
        i++;
      } else {
        values.set(key, [...(values.get(key) ?? []), 'true']);
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, values };
}

// ------------------------------------------------------------------ cache I/O

export function readCache(key: string, ttlHours: number): { fresh: C7CacheEntry | null; stale: C7CacheEntry | null } {
  const path = join(CACHE_DIR, `${key}.json`);
  if (!existsSync(path)) return { fresh: null, stale: null };
  try {
    const entry = JSON.parse(readFileSync(path, 'utf-8')) as C7CacheEntry;
    const age = cacheAgeHours(entry.fetchedAt, Date.now());
    return age <= ttlHours ? { fresh: entry, stale: entry } : { fresh: null, stale: entry };
  } catch {
    return { fresh: null, stale: null };
  }
}

export function writeCache(key: string, payload: unknown): void {
  try {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    const entry: C7CacheEntry = { fetchedAt: new Date().toISOString(), payload };
    writeFileSync(join(CACHE_DIR, `${key}.json`), JSON.stringify(entry), 'utf-8');
  } catch {
    /* cache es best-effort; nunca bloquea la respuesta */
  }
}

// ------------------------------------------------------------------- HTTP core

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function errMsg(json: unknown): string {
  if (typeof json !== 'object' || json === null) return '';
  const obj = json as Record<string, unknown>;
  return `${str(obj.error)} ${str(obj.message)}`.trim();
}

export async function httpJson(url: URL, apiKey: string | undefined, maxRetries = 2): Promise<HttpResult> {
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { headers });
    } catch (e: unknown) {
      throw new Error(`network_error — ${e instanceof Error ? e.message : String(e)}`);
    }
    if (res.status === 429 || res.status === 503 || res.status === 504) {
      if (attempt >= maxRetries) {
        const json = (await res.json().catch(() => null)) as unknown;
        return { status: res.status, json };
      }
      const ra = Number(res.headers.get('retry-after'));
      const delayMs = Number.isFinite(ra) && ra > 0 ? Math.min(ra, 30) * 1000 : 1500 * 2 ** attempt;
      await sleep(delayMs);
      continue;
    }
    const json = (await res.json().catch(() => null)) as unknown;
    return { status: res.status, json };
  }
}

// ------------------------------------------------------------------- emitters

function emitMeta(line: string): void {
  console.error(`[ctx7] ${line}`);
}

function emitContent(res: HttpResult, args: ParsedArgs, source: string, ageHours: number | null): number {
  const maxChars = Number(args.values.get('max-chars')?.[0] ?? '') || DEFAULT_MAX_CHARS;
  const text = formatDocs(res.json, maxChars);
  if (!text) {
    emitMeta(`respuesta https ${res.status} sin snippets formateables`);
    return 2;
  }
  emitMeta(`source=${source} age=${ageHours === null ? 'n/a' : `${ageHours.toFixed(1)}h`} chars=${text.length} (docs UNTRUSTED — contra-verificar vs versión instalada)`);
  console.log(text);
  return 0;
}

// ------------------------------------------------------------------ commands

async function cmdSearch(args: ParsedArgs, apiKey: string | undefined): Promise<number> {
  const query = args.positionals.join(' ');
  if (!query) {
    console.error('uso: ctx7 search "<pregunta>" [--library <nombre>] [--language TypeScript] [--ttl-hours N] [--max-chars N] [--json] [--offline]');
    return 1;
  }
  const url = new URL('/api/v3/search', BASE_URL);
  url.searchParams.set('query', query);
  url.searchParams.set('type', 'json');
  for (const lib of args.values.get('library') ?? []) url.searchParams.append('library', lib);
  const language = args.values.get('language')?.[0];
  if (language) url.searchParams.set('language', language);
  return (await runCachedRequest(url, args, apiKey)).code;
}

async function cmdGet(args: ParsedArgs, apiKey: string | undefined): Promise<number> {
  let libraryId = args.values.get('library-id')?.[0];
  const query = args.positionals.join(' ') || args.values.get('query')?.[0] || '';
  if (!libraryId || !query) {
    console.error('uso: ctx7 get --library-id /vercel/next.js "<pregunta>" [--language TypeScript] [--ttl-hours N] [--max-chars N] [--offline]');
    return 1;
  }
  for (let hops = 0; hops < 3; hops++) {
    const url = new URL('/api/v2/context', BASE_URL);
    url.searchParams.set('libraryId', libraryId);
    url.searchParams.set('query', query);
    url.searchParams.set('type', 'json');
    const language = args.values.get('language')?.[0];
    if (language) url.searchParams.set('language', language);
    const result = await runCachedRequest(url, args, apiKey, { hops });
    if (result.redirectedTo) {
      emitMeta(`301 redirect — reintentando con libraryId=${result.redirectedTo}`);
      libraryId = result.redirectedTo;
      continue;
    }
    return result.code;
  }
  return 1;
}

interface RunResult { code: number; redirectedTo?: string; }

async function runCachedRequest(url: URL, args: ParsedArgs, apiKey: string | undefined, opts: { hops?: number } = {}): Promise<RunResult> {
  const seed = Boolean(args.values.get('offline')?.[0]) ? 'offline' : 'net';
  const key = buildCacheKey([seed, url.origin + url.pathname, canonicalParams(url)]);
  const ttlHours = Number(args.values.get('ttl-hours')?.[0] ?? '') || DEFAULT_TTL_HOURS;
  const offline = Boolean(args.values.get('offline')?.[0]);
  const cache = readCache(key, offline ? Number.POSITIVE_INFINITY : ttlHours);
  if (cache.fresh) return { code: emitContent({ status: 200, json: cache.fresh.payload }, args, 'cache-fresh', cacheAgeHours(cache.fresh.fetchedAt, Date.now())) };
  if (offline) {
    if (cache.stale) return { code: emitContent({ status: 200, json: cache.stale.payload }, args, 'cache-stale', cacheAgeHours(cache.stale.fetchedAt, Date.now())) };
    console.error('[ctx7] --offline sin cache disponible (corre una vez con red para poblar el cache)');
    return { code: 1 };
  }
  let res: HttpResult;
  try {
    res = await httpJson(url, apiKey);
  } catch (e: unknown) {
    if (cache.stale) {
      emitMeta('red no disponible — usando cache stale como fallback');
      return { code: emitContent({ status: 200, json: cache.stale.payload }, args, 'cache-stale', cacheAgeHours(cache.stale.fetchedAt, Date.now())) };
    }
    console.error(`[ctx7] ${e instanceof Error ? e.message : String(e)}`);
    return { code: 1 };
  }
  if (res.status === 200) {
    writeCache(key, res.json);
    return { code: emitContent(res, args, 'https', 0) };
  }
  if (res.status === 301 && typeof (res.json as Record<string, unknown> | null)?.redirectUrl === 'string') {
    if (opts.hops === undefined || opts.hops >= 2) return { code: 1 };
    return { code: 1, redirectedTo: String((res.json as Record<string, unknown>).redirectUrl) };
  }
  if (res.status === 404) {
    console.error('[ctx7] no_documentation_found — 404. Refina la query o la library hint.');
    return { code: 2 };
  }
  if (cache.stale && (res.status === 429 || res.status === 503 || res.status === 504)) {
    emitMeta(`rate limit / servicio caído (${res.status}) — usando cache stale como fallback`);
    return { code: emitContent({ status: 200, json: cache.stale.payload }, args, 'cache-stale', cacheAgeHours(cache.stale.fetchedAt, Date.now())) };
  }
  const hint = res.status === 401 ? ' — API key inválida (con CONTEXT7_API_KEY debe empezar con "ctx7sk"); el modo anónimo trabaja con límites bajos.' : '';
  console.error(`[ctx7] https ${res.status}${hint} ${errMsg(res.json)}`);
  return { code: 1 };
}

async function cmdResolve(args: ParsedArgs, apiKey: string | undefined): Promise<number> {
  const name = args.positionals.join(' ');
  if (!name) {
    console.error('uso: ctx7 resolve "<nombre de lib>" [--query "<intención>"]');
    return 1;
  }
  const url = new URL('/api/v2/libs/search', BASE_URL);
  url.searchParams.set('libraryName', name);
  const q = args.values.get('query')?.[0];
  if (q) url.searchParams.set('query', q);
  const result = await runCachedResolve(url, args, apiKey);
  const root = (result.json as Record<string, unknown> | null)?.results;
  if (result.status !== 200 || !Array.isArray(root) || root.length === 0) {
    console.error(`[ctx7] sin resultados (https ${result.status}) ${errMsg(result.json)}`);
    return 2;
  }
  emitMeta('libraryId = URL path del proyecto en context7.com — pásalo a: ctx7 get --library-id <id>');
  for (const r of (root as Record<string, unknown>[]).slice(0, 5)) {
    console.log(`- ${str(r.title)} (${str(r.id)})${str(r.description) ? ` — ${str(r.description)}` : ''}`);
  }
  return 0;
}

async function runCachedResolve(url: URL, args: ParsedArgs, apiKey: string | undefined): Promise<HttpResult> {
  const key = buildCacheKey(['resolve', url.origin + url.pathname, canonicalParams(url)]);
  const ttlHours = Number(args.values.get('ttl-hours')?.[0] ?? '') || DEFAULT_TTL_HOURS;
  const cache = readCache(key, ttlHours);
  if (cache.fresh) return { status: 200, json: cache.fresh.payload };
  try {
    const res = await httpJson(url, apiKey);
    if (res.status === 200) writeCache(key, res.json);
    return res;
  } catch (e: unknown) {
    if (cache.stale) {
      emitMeta('red no disponible — usando cache stale como fallback');
      return { status: 200, json: cache.stale.payload };
    }
    console.error(`[ctx7] ${e instanceof Error ? e.message : String(e)}`);
    return { status: 0, json: null };
  }
}

// ----------------------------------------------------------------------- main

function usage(): void {
  console.error(`ctx7 — cliente nativo Context7 (Gentle-Vanguard)
comandos:
  search "<pregunta>" [--library <nombre>]... [--language Lang]  — 1 request: resuelve libs + snippets
  get --library-id /owner/repo "<pregunta>" [--language Lang]    — docs de una lib específica (2 pasos evitados)
  resolve "<nombre de lib>" [--query "<intención>"]              — buscar libraryId
flags comunes:
  --ttl-hours N (default 168) · --max-chars N (default 12000) · --json · --offline
env:
  CONTEXT7_API_KEY      opcional (ctx7sk…) — sube los límites del plan free`);
}

async function main(argv: readonly string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const args = parseCliArgs(rest);
  const apiKey = process.env.CONTEXT7_API_KEY || undefined;
  switch (cmd) {
    case 'search': return cmdSearch(args, apiKey);
    case 'get': return cmdGet(args, apiKey);
    case 'resolve': return cmdResolve(args, apiKey);
    case '--help':
    case '-h':
    case undefined: usage(); return cmd === undefined ? 1 : 0;
    default:
      console.error(`[ctx7] comando desconocido: ${cmd}`);
      usage();
      return 1;
  }
}

const invoked = ['context7-docs.ts', 'context7-docs.js'].includes(
  process.argv[1]?.split(/[\\/]/).pop() ?? '',
);
if (invoked) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((e: unknown) => {
      console.error(`[ctx7] fatal: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    });
}
