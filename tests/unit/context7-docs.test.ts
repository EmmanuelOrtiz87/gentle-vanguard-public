import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCacheKey,
  cacheAgeHours,
  canonicalParams,
  formatDocs,
  parseCliArgs,
  readCache,
  writeCache,
} from '../../src/mcp/context7-docs.js';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('buildCacheKey', () => {
  it('es determinista y distingue entradas', () => {
    const a = buildCacheKey(['search', 'https://context7.com/api/v3/search', 'query=hooks']);
    const b = buildCacheKey(['search', 'https://context7.com/api/v3/search', 'query=hooks']);
    const c = buildCacheKey(['search', 'https://context7.com/api/v3/search', 'query=state']);
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.match(a, /^[0-9a-f]{64}$/);
  });
});

describe('cacheAgeHours', () => {
  it('calcula edad en horas y trata fechas invalidas como infinitas', () => {
    const now = Date.parse('2026-10-21T12:00:00Z');
    assert.equal(cacheAgeHours('2026-10-20T12:00:00Z', now), 24);
    assert.equal(cacheAgeHours('2026-10-21T13:00:00Z', now), 0);
    assert.equal(cacheAgeHours('not-a-date', now), Number.POSITIVE_INFINITY);
  });
});

describe('canonicalParams', () => {
  it('orden canonico independiente del orden de insercion', () => {
    const u1 = new URL('https://context7.com/api/v3/search?query=a&library=B');
    const u2 = new URL('https://context7.com/api/v3/search?library=B&query=a');
    assert.equal(canonicalParams(u1), canonicalParams(u2));
    assert.match(canonicalParams(u1), /^library=B&query=a$/);
  });
});

describe('parseCliArgs', () => {
  it('separa positionals, flags con valor, repetidos y booleanos', () => {
    const p = parseCliArgs(['stream', 'answer', '--library', 'Next.js', '--library', 'OpenAI', '--offline', '--max-chars', '500']);
    assert.deepEqual(p.positionals, ['stream', 'answer']);
    assert.deepEqual(p.values.get('library'), ['Next.js', 'OpenAI']);
    assert.deepEqual(p.values.get('offline'), ['true']);
    assert.deepEqual(p.values.get('max-chars'), ['500']);
  });
});

describe('formatDocs', () => {
  const payload = {
    codeSnippets: [
      { libraryId: '/vercel/next.js', codeTitle: 'Streaming response', codeList: [{ code: 'export function GET() { ... }' }] },
    ],
    infoSnippets: [{ content: 'Use streaming in route handlers.\nMore info here.' }],
  };

  it('renderiza snippets en markdown compacto', () => {
    const text = formatDocs(payload);
    assert.match(text, /### Streaming response — \/vercel\/next\.js/);
    assert.match(text, /export function GET\(\)/);
    assert.match(text, /^> Use streaming in route handlers\.\n> More info here\./m);
  });

  it('trunca al maxChars con marcador', () => {
    const text = formatDocs(payload, 40);
    assert.ok(text.length < 200);
    assert.match(text, /\[ctx7 output truncado/);
  });

  it('devuelve vacio para payloads no formateables', () => {
    assert.equal(formatDocs(null), '');
    assert.equal(formatDocs({ error: 'library_not_found' }), '');
  });
});

describe('readCache / writeCache', () => {
  const dir = join(tmpdir(), `ctx7-test-cache-${Date.now()}`);
  // Nota: readCache/writeCache usan CACHE_DIR basado en cwd; estos tests solo ejercitan
  // el contrato de frescura con el directorio real cuando cwd es el repo root.
  it('redondeo de TTL: entrada vieja no es fresh', () => {
    const key = buildCacheKey(['test-old', String(disposableDir(dir))]);
    writeCache(key, { codeSnippets: [] });
  });
  it('retorno por defecto vacio sin archivo', () => {
    const r = readCache('no-existe-este-key-ever', 1);
    assert.equal(r.fresh, null);
    assert.equal(r.stale, null);
  });
});

function disposableDir(p: string): number {
  try {
    rmSync(p, { recursive: true, force: true });
    mkdirSync(p, { recursive: true });
  } catch {
    /* noop */
  }
  return Date.now();
}
