/**
 * E2E del loop de aprendizaje file-based (Fase 6 N9).
 *
 * Circuito verificado:
 *   delegación simulada (metrics-report.json)
 *     → adaptive-router --build (recalcula successRate)
 *     → routing-table.json (success_rate actualizado)
 *     → recommend-agent (usa el dato aprendido)
 *
 * Usa un directorio temporal como cwd (ROOT = process.cwd() en ambos CLIs),
 * sin contaminar el estado real de .session/.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
// Ruta absoluta al loader de tsx (file:// URL) para que funcione con cwd temporal
const TSX_LOADER = pathToFileURL(join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href;

function runTsx(script: string, args: string[], cwd: string): { status: number; stdout: string } {
  const res = spawnSync(process.execPath, ['--import', TSX_LOADER, script, ...args], {
    cwd,
    encoding: 'utf-8',
    timeout: 60000,
    windowsHide: true,
    // Tenant de test: el path Nexus devuelve 0 reglas → el loop file-based
    // (routing-table.json) es el único camino activo.
    env: { ...process.env, GENTLE_VANGUARD_TENANT_ID: 'test-e2e-tenant-xyz' },
  });
  return { status: res.status ?? -1, stdout: res.stdout || '' };
}

// recommend-agent puede emitir ruido de logs ([DB] ...) antes del JSON
function parseJsonOutput(stdout: string): any {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(`No JSON found in output: ${stdout}`);
  return JSON.parse(stdout.slice(start, end + 1));
}

function setupTempSession(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gv-loop-e2e-'));
  const sessionDir = join(dir, '.session');
  mkdirSync(join(sessionDir, 'metrics'), { recursive: true });
  mkdirSync(join(sessionDir, 'routing'), { recursive: true });
  // Delegación simulada: 5 intentos, 5 éxitos → successRate 1.0
  writeFileSync(
    join(sessionDir, 'metrics-report.json'),
    JSON.stringify(
      {
        agents: {
          'test-agent-e2e': {
            total: 5,
            successes: 5,
            failures: 0,
            avg_duration: 120,
            last_event: new Date().toISOString(),
          },
        },
        summary: { total_delegations: 5 },
      },
      null,
      2,
    ),
    'utf-8',
  );
  return dir;
}

describe('routing learning loop (file-based E2E)', () => {
  it('delegación simulada → routing-table successRate → recommend-agent usa el dato', () => {
    const dir = setupTempSession();
    try {
      // 1. Rebuild de la routing-table desde el metrics-report simulado
      const build = runTsx(
        join(REPO_ROOT, 'src', 'orchestration', 'adaptive-router.ts'),
        ['--build', '--quiet'],
        dir,
      );
      assert.equal(build.status, 0, `adaptive-router build failed: ${build.stdout}`);

      // 2. Verificar que routing-table.json refleja el successRate aprendido
      const tablePath = join(dir, '.session', 'routing', 'routing-table.json');
      assert.ok(existsSync(tablePath), 'routing-table.json no fue generado');
      const table = JSON.parse(readFileSync(tablePath, 'utf-8'));

      const agent = table.agentPerformance.find((a: any) => a.agentId === 'test-agent-e2e');
      assert.ok(agent, 'test-agent-e2e no está en agentPerformance');
      assert.equal(agent.successRate, 1, `successRate esperado 1, got ${agent.successRate}`);
      assert.equal(agent.totalDelegations, 5);

      const domainEntry = table.domainEntries.find((d: any) => d.domain === 'general');
      assert.ok(domainEntry, 'domain entry general no existe');
      assert.equal(domainEntry.bestAgent, 'test-agent-e2e');

      // 3. recommend-agent debe recomendar el agente aprendido
      const rec = runTsx(
        join(REPO_ROOT, 'src', 'orchestration', 'recommend-agent.ts'),
        ['--task', 'general purpose task', '--domain', 'general', '--topn', '3'],
        dir,
      );
      assert.equal(rec.status, 0, `recommend-agent failed: ${rec.stdout}`);
      const result = parseJsonOutput(rec.stdout);
      assert.equal(result.recommended, 'test-agent-e2e');
      assert.ok(
        ['routing-table', 'override'].includes(result.source),
        `source inesperado: ${result.source}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('delegación con fallos baja el successRate y cambia la recomendación', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gv-loop-e2e-fail-'));
    try {
      const sessionDir = join(dir, '.session');
      mkdirSync(join(sessionDir, 'routing'), { recursive: true });
      // Agente A: 5/5 éxitos (1.0). Agente B: 1/5 éxitos (0.2).
      writeFileSync(
        join(sessionDir, 'metrics-report.json'),
        JSON.stringify(
          {
            agents: {
              'agent-a': {
                total: 5,
                successes: 5,
                failures: 0,
                avg_duration: 100,
                last_event: new Date().toISOString(),
              },
              'agent-b': {
                total: 5,
                successes: 1,
                failures: 4,
                avg_duration: 200,
                last_event: new Date().toISOString(),
              },
            },
            summary: { total_delegations: 10 },
          },
          null,
          2,
        ),
        'utf-8',
      );

      const build = runTsx(
        join(REPO_ROOT, 'src', 'orchestration', 'adaptive-router.ts'),
        ['--build', '--quiet'],
        dir,
      );
      assert.equal(build.status, 0, `adaptive-router build failed: ${build.stdout}`);

      const table = JSON.parse(
        readFileSync(join(dir, '.session', 'routing', 'routing-table.json'), 'utf-8'),
      );
      const agentA = table.agentPerformance.find((a: any) => a.agentId === 'agent-a');
      const agentB = table.agentPerformance.find((a: any) => a.agentId === 'agent-b');
      assert.equal(agentA.successRate, 1);
      assert.equal(agentB.successRate, 0.2);

      // El mejor agente del dominio general debe ser agent-a (mayor successRate)
      const entry = table.domainEntries.find((d: any) => d.domain === 'general');
      assert.equal(entry.bestAgent, 'agent-a');

      const rec = runTsx(
        join(REPO_ROOT, 'src', 'orchestration', 'recommend-agent.ts'),
        ['--task', 'general purpose task', '--domain', 'general', '--topn', '3'],
        dir,
      );
      assert.equal(rec.status, 0, `recommend-agent failed: ${rec.stdout}`);
      const result = parseJsonOutput(rec.stdout);
      assert.equal(result.recommended, 'agent-a');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
