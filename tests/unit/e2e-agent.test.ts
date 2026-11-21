/**
 * e2e-agent.test.ts — el agente E2E nativo (NORM-E2E-001) resuelve la app desde
 * la tarea, exige un smoke existente y devuelve preguntas de clarificación en
 * vez de proceder con supuestos (GB-20261120 S6, MAST FM-2.2).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolveE2eTarget } from '../../src/agents/e2e-agent.js';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const TSX_LOADER = pathToFileURL(join(repoRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href;

const dirs: string[] = [];
function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gv-e2e-'));
  dirs.push(dir);
  return dir;
}

test('una app mencionada en la tarea resuelve su smoke por orden de extensión', () => {
  const root = tempRepo();
  mkdirSync(join(root, 'apps', 'gv-agenda', 'tests'), { recursive: true });
  writeFileSync(join(root, 'apps', 'gv-agenda', 'tests', 'e2e-smoke.mjs'), 'console.log(1)');
  const target = resolveE2eTarget('Corré el smoke e2e de gv-agenda y traé evidencia', root);
  assert.ok(!('clarification' in target));
  assert.equal(target.app, 'gv-agenda');
  assert.match(target.script, /e2e-smoke\.mjs$/);
});

test('sin app nombrada devuelve clarificación, no supuestos', () => {
  const root = tempRepo();
  mkdirSync(join(root, 'apps', 'censor'), { recursive: true });
  const target = resolveE2eTarget('validá la app', root);
  assert.ok('clarification' in target);
  assert.match(target.clarification, /app/i);
});

test('dos apps mencionadas pide desambiguación', () => {
  const root = tempRepo();
  mkdirSync(join(root, 'apps', 'censor'), { recursive: true });
  mkdirSync(join(root, 'apps', 'voice-studio'), { recursive: true });
  const target = resolveE2eTarget('validá censor y voice-studio', root);
  assert.ok('clarification' in target);
  assert.match(target.clarification, /censor/);
});

test('app sin smoke devuelve la norma (NORM-E2E-001 exige crearlo)', () => {
  const root = tempRepo();
  mkdirSync(join(root, 'apps', 'genesis-landing'), { recursive: true });
  const target = resolveE2eTarget('validá genesis-landing', root);
  assert.ok('clarification' in target);
  assert.match(target.clarification, /NORM-E2E-001/);
});

test('el dominio e2e enruta al e2e-agent por encima de testing genérico', () => {
  // Idioma del repo (tests/delegation/auto-delegation.test.ts): el recomendador
  // corre como subproceso con el loader tsx absoluto — importarlo en el proceso
  // de test deja los handles de Nexus abiertos y marca el archivo como fallido.
  const dir = mkdtempSync(join(tmpdir(), 'gv-e2e-route-'));
  dirs.push(dir);
  const res = spawnSync(
    process.execPath,
    [
      '--import',
      TSX_LOADER,
      join(repoRoot, 'src', 'orchestration', 'recommend-agent.ts'),
      '--task',
      'run e2e smoke de gv-agenda con evidencia',
    ],
    { cwd: dir, encoding: 'utf-8', timeout: 120_000, windowsHide: true },
  );
  assert.equal(
    res.status,
    0,
    `recommend-agent falló: ${res.stdout?.slice(0, 300)} ${res.stderr?.slice(0, 300)}`,
  );
  const start = res.stdout.indexOf('{');
  const end = res.stdout.lastIndexOf('}');
  const result = JSON.parse(res.stdout.slice(start, end + 1)) as {
    domain: string;
    recommended: string;
  };
  assert.equal(result.domain, 'e2e');
  assert.equal(result.recommended, 'e2e-agent');
});
