import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyAppScope } from '../../src/git/prepush-app-scope.ts';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (path: string): string | null => {
  try {
    return readFileSync(resolve(ROOT, path), 'utf8');
  } catch {
    return null;
  }
};
/** Lee el par (antes, despues) como "sin cambios": el alcance se prueba por ruta. */
const sameContent = (path: string): [string | null, string | null] => [read(path), read(path)];

describe('clasificador de alcance de apps', () => {
  it('un archivo de app detecta la app', () => {
    const scope = classifyAppScope(['apps/gv-analytics/src/index.ts'], sameContent);
    assert.equal(scope.mode, 'apps');
    assert.deepEqual(scope.apps, ['gv-analytics']);
  });

  it('superficie compartida del stack: impacto global, no desconocido', () => {
    const scope = classifyAppScope(['config/codegraph.config.json'], sameContent);
    assert.equal(scope.mode, 'full');
    // Semántica CONTRATADA (meta-auditoría 2026-11-20, exclusión levantada
    // 2026-11-21): `full` significa "barrido GLOBAL" y `apps: []` es la
    // representación correcta — NO significa "ninguna app". La lista `apps`
    // solo se llena en modo 'apps'; un consumidor que itere scope.apps en
    // modo 'full' está leyendo mal el contrato (por eso el gate NO corre la
    // auditoría en 'full': la hace la cadencia, no el push).
    assert.deepEqual(scope.apps, []);
  });

  it('el canon de MCP (.mcp.json) no aporta runtime de apps', () => {
    const scope = classifyAppScope(['.mcp.json'], sameContent);
    assert.equal(scope.mode, 'none');
    assert.doesNotMatch(scope.reason, /Sin mapa de impacto/);
  });

  it('toolchain de raiz declara impacto global', () => {
    for (const path of ['tsconfig.json', 'Dockerfile', 'vitest.config.ts', 'pnpm-workspace.yaml']) {
      const scope = classifyAppScope([path], sameContent);
      assert.equal(scope.mode, 'full', `${path} deberia ser 'full'`);
    }
  });

  it('docs, ignores y ejemplos de raiz no impactan apps', () => {
    for (const path of ['README.md', 'SECURITY.md', '.gitignore', '.env.example', 'LICENSE']) {
      const scope = classifyAppScope([path], sameContent);
      assert.equal(scope.mode, 'none', `${path} deberia ser 'none'`);
    }
  });

  it('una ruta sin declarar sigue abortando (el guard no se relaja)', () => {
    const scope = classifyAppScope(['archivo-sin-mapa.bin'], sameContent);
    assert.equal(scope.mode, 'unknown');
    assert.match(scope.reason, /Sin mapa de impacto/);
  });

  it('CONTRATO: todo archivo rastreado tiene mapa de impacto declarado', () => {
    // `-z` para que git NO entrecomille los paths con caracteres no-ASCII:
    // sin eso, un archivo con acentos llega como `"skills/.../xxx.html"` y el
    // clasificador lo ve como un path desconocido (falso positivo).
    const raw = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf-8' });
    const files = raw.split('\0').filter(Boolean);
    const undeclared = files.filter(
      (file) => classifyAppScope([file], sameContent).mode === 'unknown',
    );
    assert.deepEqual(
      undeclared,
      [],
      `Archivos sin mapa de impacto (abortan el push): ${undeclared.slice(0, 10).join(', ')}${undeclared.length > 10 ? ` (+${undeclared.length - 10})` : ''}`,
    );
  });
});
