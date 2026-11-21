/**
 * routing-eval.test.ts — el evaluador de recibos cierra la brecha 11 (los
 * recibos fluyen pero nadie los mira): resumen honesto por agente/dominio y
 * replay del recomendador SOLO sobre recibos con texto de tarea.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluateHits, type RoutingHit } from '../../src/orchestration/routing-eval.js';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const TSX_LOADER = pathToFileURL(join(repoRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href;
const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gv-routing-eval-'));
  dirs.push(dir);
  return dir;
}

test('resumen por agente con tasa real y duración media', () => {
  const hits: RoutingHit[] = [
    { agent: 'e2e-agent', domain: 'e2e', success: true, duration: 4000 },
    { agent: 'e2e-agent', domain: 'e2e', success: true, duration: 6000 },
    { agent: 'e2e-agent', domain: 'e2e', success: false, duration: 2000 },
  ];
  const r = evaluateHits(hits);
  assert.equal(r.total, 3);
  assert.equal(r.ok, 2);
  assert.equal(r.fail, 1);
  const e2e = r.byAgent.find((a) => a.agent === 'e2e-agent');
  assert.ok(e2e);
  assert.equal(e2e.rate.toFixed(4), (2 / 3).toFixed(4));
  assert.equal(e2e.avgDurationMs, 4000);
  assert.equal(r.byDomain['e2e'], 3);
});

test('la cobertura de replay es honesta: recibos sin tarea no se re-ejecutan', () => {
  const hits: RoutingHit[] = [
    { agent: 'editorial-agent', domain: 'editorial', success: true, duration: 45000 },
    { agent: 'editorial-agent', domain: 'editorial', success: false, duration: 120000 },
  ];
  const r = evaluateHits(hits);
  assert.equal(r.replay.replayable, 0);
  assert.equal(r.replay.agreed, 0);
  assert.equal(r.replay.disagreement.length, 0);
});

test('replay vía CLI: recibos con tarea se re-ejecutan y comparan (subproceso)', () => {
  const dir = tempDir();
  const hitsPath = join(dir, 'hits.jsonl');
  writeFileSync(
    hitsPath,
    JSON.stringify({
      agent: 'e2e-agent',
      domain: 'e2e',
      success: true,
      duration: 9000,
      task: 'run e2e smoke de gv-agenda',
    }) +
      '\n' +
      JSON.stringify({ agent: 'doc-agent', domain: 'editorial', success: true, duration: 1000 }),
  );
  const res = spawnSync(
    process.execPath,
    [
      '--import',
      TSX_LOADER,
      join(repoRoot, 'src', 'orchestration', 'routing-eval.ts'),
      '--hits',
      hitsPath,
      '--json',
    ],
    { cwd: dir, encoding: 'utf-8', timeout: 120_000, windowsHide: true },
  );
  assert.equal(res.status, 0, `routing-eval falló: ${res.stderr?.slice(0, 300)}`);
  // El bootstrap de Nexus antepone su log al JSON: extraer el objeto balanceado
  // (idioma de tests/delegation/auto-delegation.test.ts).
  const start = res.stdout.indexOf('{');
  const end = res.stdout.lastIndexOf('}');
  assert.ok(start !== -1 && end > start, `sin JSON en la salida: ${res.stdout.slice(0, 200)}`);
  const report = JSON.parse(res.stdout.slice(start, end + 1)) as ReturnType<typeof evaluateHits>;
  assert.equal(report.total, 2);
  assert.equal(report.replay.replayable, 1);
  // "run e2e smoke de gv-agenda" debe seguir enrutando a e2e-agent hoy.
  assert.equal(report.replay.agreed, 1);
  assert.equal(report.replay.disagreement.length, 0);
});

test('contrato repo-level: el dataset canónico entero enruta bien (detección de regresión de keywords)', () => {
  // Subproceso (idioma del repo): el router abre Nexus y el test no debe
  // heredar handles. Si este test falla, alguien rompió el mapa de keywords,
  // los intents editoriales o el filtro ADR-0034 — correr
  // npm run routing:eval -- --cases config/routing-eval-cases.json para ver el caso.
  const res = spawnSync(
    process.execPath,
    [
      '--import',
      TSX_LOADER,
      join(repoRoot, 'src', 'orchestration', 'routing-eval.ts'),
      '--cases',
      join(repoRoot, 'config', 'routing-eval-cases.json'),
    ],
    { cwd: repoRoot, encoding: 'utf-8', timeout: 180_000, windowsHide: true },
  );
  assert.equal(
    res.status,
    0,
    `dataset eval falló: ${res.stdout?.slice(0, 500)} ${res.stderr?.slice(0, 200)}`,
  );
  assert.match(res.stdout, /22\/22|dataset: \d+\/\d+/, 'reporte del dataset presente');
});
