/**
 * CONTRATO del probe de INFERENCIA REAL (src/tools/model-inference-probe.ts).
 *
 * Reproduce el fallo real (2026-11-06): la evidencia de salud de modelos era
 * un `GET /models` — "el proveedor es alcanzable". Eso NO dice si el modelo
 * RESPONDE. Medido en esta maquina: el catalogo de `opencode-zen-C` devolvia
 * 45 modelos (alcanzable) y TODOS respondian
 * `FreeUsageLimitError` (cuota agotada). El tier `go` pedia suscripcion
 * activa. El gate anterior no podia ver ninguno de los dos casos.
 *
 * Este archivo verifica el contrato en las DOS direcciones:
 *   - POSITIVO: una inferencia real exitosa deja veredicto PASS y exit 0.
 *   - NEGATIVO: una inferencia real fallida deja veredicto FAIL y exit 1.
 *   - NEGATIVO: la AUSENCIA de evidencia NO es un PASS (exit 2, indeterminado).
 *   - NEGATIVO: la evidencia VENCIDA NO es un PASS (exit 2).
 *   - NEGATIVO: un fallo de TRANSPORTE no es un FAIL del modelo (exit 2).
 *
 * Corre con:
 *   node --import tsx --test src/tools/model-inference-probe.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  evaluateInferenceEntry,
  findInferenceEntry,
  loadInferenceEvidence,
  type InferenceEvidenceFile,
} from '../ml/model-inference-evidence.js';

const ROOT = join(import.meta.dirname, '..', '..');
const PROBE = join(ROOT, 'src', 'tools', 'model-inference-probe.ts');

interface Scenario {
  status: number;
  body: string;
  /** Si esta presente, el servidor exige el header de sesion. */
  requireSessionHeader?: boolean;
  /** Retraso de la respuesta: simula la carga de un modelo local. */
  delayMs?: number;
}

let server: Server | undefined;
let baseUrl = '';
let scenario: Scenario = { status: 200, body: '{}' };
let lastRequest: { path: string; body: string; sessionHeader: string | undefined } | undefined;

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      lastRequest = {
        path: req.url || '',
        body,
        sessionHeader: req.headers['x-opencode-session'] as string | undefined,
      };
      if (scenario.requireSessionHeader && !lastRequest.sessionHeader) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              type: 'MissingSessionID',
              message: 'Request is missing x-opencode-session',
            },
          }),
        );
        return;
      }
      if (scenario.delayMs) {
        await new Promise((r) => setTimeout(r, scenario.delayMs));
      }
      res.writeHead(scenario.status, { 'Content-Type': 'application/json' });
      res.end(scenario.body);
    });
  });
  await new Promise<void>((resolve) => {
    server!.listen(0, '127.0.0.1', async () => {
      const { port } = server!.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}/v1`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve) => server!.close(() => resolve()));
});

interface RunResult {
  code: number | null;
  stdout: string;
  json: Record<string, unknown> | null;
}

/**
 * Ejecuta el probe como proceso real: el exit code ES el contrato.
 *
 * `spawn` (async) y NO `spawnSync`: el servidor HTTP de esta suite vive en el
 * proceso de test, asi que con spawnSync el event loop queda bloqueado y el
 * hijo se queda esperando una respuesta que nunca llega (20 s de timeout).
 */
function runProbe(
  args: string[],
  env: Record<string, string> = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', PROBE, ...args], {
      cwd: ROOT,
      windowsHide: true,
      env: { ...process.env, ...env },
    });
    let stdout = '';
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', async () => {});
    child.on('close', (code) => {
      let json: Record<string, unknown> | null = null;
      try {
        json = JSON.parse(stdout) as Record<string, unknown>;
      } catch {
        json = null;
      }
      resolve({ code, stdout, json });
    });
  });
}

/** Config + auth temporales apuntando al servidor local. */
function makeProviderEnv(dir: string, providerId = 'test-provider'): Record<string, string> {
  const configPath = join(dir, 'opencode.json');
  const authPath = join(dir, 'auth.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      provider: {
        [providerId]: {
          npm: '@ai-sdk/openai-compatible',
          options: { baseURL: baseUrl },
          models: { 'probe-model': {} },
        },
      },
    }),
    'utf-8',
  );
  writeFileSync(authPath, JSON.stringify({ [providerId]: { type: 'api', key: 'test-key' } }), 'utf-8');
  return { OPENCODE_CONFIG: configPath, OPENCODE_AUTH_FILE: authPath };
}

let workDir = '';
before(() => {
  workDir = mkdtempSync(join(tmpdir(), 'gv-inference-probe-'));
});
after(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('model-inference-probe: contrato de exit codes', () => {
  it('POSITIVO: inferencia real exitosa -> exit 0 y veredicto PASS', async () => {
    scenario = {
      status: 200,
      body: JSON.stringify({
        id: 'chatcmpl-1',
        choices: [{ message: { role: 'assistant', content: 'P' } }],
        usage: { prompt_tokens: 7, completion_tokens: 1 },
      }),
    };
    const env = makeProviderEnv(workDir);
    const evidencePath = join(workDir, 'evidence.json');
    const result = await runProbe(
      ['--json', '--no-db', '--model', 'test-provider/probe-model', '--evidence', evidencePath],
      env,
    );

    assert.equal(result.code, 0, `esperaba exit 0, obtuve ${result.code}: ${result.stdout}`);
    const json = result.json as { overall: string; results: Array<{ status: string }> };
    assert.equal(json.overall, 'PASS');
    assert.equal(json.results[0].status, 'OK');

    // El POST debe ser una inferencia real y minima (max_tokens 1).
    assert.ok(lastRequest, 'el probe no hizo ninguna peticion');
    assert.equal(lastRequest.path, '/v1/chat/completions');
    const sent = JSON.parse(lastRequest.body) as { model: string; max_tokens: number };
    assert.equal(sent.model, 'probe-model');
    assert.equal(sent.max_tokens, 1);

    // La evidencia escrita se evalua como PASS.
    const file = loadInferenceEvidence(evidencePath);
    assert.ok(file, 'no se escribio evidencia');
    const entry = findInferenceEntry(file, 'test-provider/probe-model');
    assert.equal(evaluateInferenceEntry(entry, file.ttlSeconds), 'PASS');
  });

  it('NEGATIVO: el proveedor RESPONDE con error de cuota -> exit 1 y veredicto FAIL', async () => {
    scenario = {
      status: 402,
      body: JSON.stringify({ error: { type: 'creditserror', message: 'insufficient balance' } }),
    };
    const env = makeProviderEnv(workDir);
    const evidencePath = join(workDir, 'evidence-quota.json');
    const result = await runProbe(
      ['--json', '--no-db', '--model', 'test-provider/probe-model', '--evidence', evidencePath],
      env,
    );

    assert.equal(result.code, 1, `esperaba exit 1, obtuve ${result.code}: ${result.stdout}`);
    const json = result.json as { overall: string; results: Array<{ status: string; quota: boolean }> };
    assert.equal(json.overall, 'FAIL');
    // El CUERPO manda sobre el codigo HTTP: 402 no es "error de permisos".
    assert.equal(json.results[0].status, 'INSUFFICIENT_BALANCE');
    assert.equal(json.results[0].quota, true);

    const file = loadInferenceEvidence(evidencePath);
    assert.ok(file, 'no se escribio evidencia');
    const entry = findInferenceEntry(file, 'test-provider/probe-model');
    assert.equal(evaluateInferenceEntry(entry, file.ttlSeconds), 'FAIL');
  });

  it('NEGATIVO: el tier que exige sesion sin el header -> NO se puede inferir', async () => {
    scenario = { status: 400, body: '{"error":{"type":"MissingSessionID"}}', requireSessionHeader: true };
    const env = makeProviderEnv(workDir);
    const result = await runProbe(
      ['--json', '--no-db', '--model', 'test-provider/probe-model', '--evidence', join(workDir, 'e2.json')],
      env,
    );
    assert.equal(result.code, 1, 'un 400 del proveedor es un fallo comprobado');
    assert.ok(
      lastRequest?.sessionHeader,
      'el probe debe enviar x-opencode-session (el tier go lo exige)',
    );
  });

  it('NEGATIVO: la evidencia guarda UNA entrada por slot (misma instancia de catalogo)', async () => {
    // `slot-A` y `slot-B` son el mismo provider (mismo base): si el probe
    // acumula las dos entradas, la vieja tapa la nueva y el veredicto
    // "sin veredicto" (TTL vencido) tapea un exito reciente.
    scenario = {
      status: 200,
      body: JSON.stringify({ choices: [{ message: { content: 'P' } }], usage: { completion_tokens: 1 } }),
    };
    const dir = join(workDir, 'slot');
    mkdirSync(dir, { recursive: true });
    const configPath = join(dir, 'opencode.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        provider: {
          'slot-A': { npm: '@ai-sdk/openai-compatible', options: { baseURL: baseUrl }, models: { 'm': {} } },
          'slot-B': { npm: '@ai-sdk/openai-compatible', options: { baseURL: baseUrl }, models: { 'm': {} } },
        },
      }),
      'utf-8',
    );
    const authPath = join(dir, 'auth.json');
    writeFileSync(
      authPath,
      JSON.stringify({ 'slot-A': { type: 'api', key: 'k' }, 'slot-B': { type: 'api', key: 'k' } }),
      'utf-8',
    );
    const evidencePath = join(dir, 'evidence.json');
    const env = { OPENCODE_CONFIG: configPath, OPENCODE_AUTH_FILE: authPath };

    await runProbe(['--json', '--no-db', '--model', 'slot-A/m', '--evidence', evidencePath], env);
    await runProbe(['--json', '--no-db', '--model', 'slot-B/m', '--evidence', evidencePath], env);

    const file = loadInferenceEvidence(evidencePath);
    assert.ok(file, 'no se escribio evidencia');
    const keys = Object.keys(file.results);
    assert.equal(keys.length, 1, `se esperaba 1 entrada por slot, hay ${keys.length}: ${keys.join(', ')}`);
    assert.ok(keys[0].endsWith('/m'));
  });

  it('POSITIVO: un destino LOCAL usa el presupuesto de carga, no el de red', async () => {
    // Un modelo local tarda en CARGAR (medido: 30,9 s en frio), no en viajar.
    // Con el presupuesto de red el probe nunca llegaria a responder y la
    // evidencia local seria siempre INDETERMINADA.
    scenario = {
      status: 200,
      body: JSON.stringify({ choices: [{ message: { content: 'P' } }], usage: { completion_tokens: 1 } }),
      delayMs: 1200,
    };
    const env = makeProviderEnv(workDir);
    const evidencePath = join(workDir, 'evidence-local.json');
    const result = await runProbe(
      [
        '--json',
        '--no-db',
        '--model',
        'test-provider/probe-model',
        '--evidence',
        evidencePath,
        '--timeout',
        '300',
        '--local-timeout',
        '15000',
      ],
      env,
    );
    assert.equal(result.code, 0, `esperaba exit 0, obtuve ${result.code}: ${result.stdout}`);
  });

it('NEGATIVO: un destino REMOTO usa el presupuesto de red', async () => {
    // 192.0.2.0/24 es TEST-NET-1 (no enrutable): el probe debe agotar el
    // presupuesto de RED (300 ms), no el local (15 s).
    const dir = join(workDir, 'remote');
    mkdirSync(dir, { recursive: true });
    const configPath = join(dir, 'opencode.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        provider: {
          'remote-provider': {
            npm: '@ai-sdk/openai-compatible',
            options: { baseURL: 'http://192.0.2.1:9/v1' },
            models: { 'probe-model': {} },
          },
        },
      }),
      'utf-8',
    );
    const authPath = join(dir, 'auth.json');
    writeFileSync(authPath, JSON.stringify({ 'remote-provider': { type: 'api', key: 'k' } }), 'utf-8');

    const started = Date.now();
    const result = await runProbe(
      [
        '--json',
        '--no-db',
        '--model',
        'remote-provider/probe-model',
        '--evidence',
        join(dir, 'evidence.json'),
        '--timeout',
        '800',
        '--local-timeout',
        '20000',
      ],
      { OPENCODE_CONFIG: configPath, OPENCODE_AUTH_FILE: authPath },
    );
    const elapsed = Date.now() - started;
    assert.equal(result.code, 2, `esperaba exit 2 (indeterminado), obtuve ${result.code}`);
    assert.ok(elapsed < 10_000, `el probe tardo ${elapsed}ms: no aplico el presupuesto de red`);
  });

it('NEGATIVO: fallo de TRANSPORTE no es un FAIL del modelo -> exit 2', async () => {
    const dir = join(workDir, 'closed');
    mkdirSync(dir, { recursive: true });
    const configPath = join(dir, 'opencode.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        provider: {
          'dead-provider': {
            npm: '@ai-sdk/openai-compatible',
            options: { baseURL: 'http://127.0.0.1:1/v1' },
            models: { 'probe-model': {} },
          },
        },
      }),
      'utf-8',
    );
    const authPath = join(dir, 'auth.json');
    writeFileSync(authPath, JSON.stringify({ 'dead-provider': { type: 'api', key: 'k' } }), 'utf-8');

    const evidencePath = join(dir, 'evidence.json');
    const result = await runProbe(
      [
        '--json',
        '--no-db',
        '--model',
        'dead-provider/probe-model',
        '--evidence',
        evidencePath,
        '--timeout',
        '3000',
      ],
      { OPENCODE_CONFIG: configPath, OPENCODE_AUTH_FILE: authPath },
    );

    assert.equal(result.code, 2, `esperaba exit 2 (indeterminado), obtuve ${result.code}`);
    const json = result.json as { overall: string; results: Array<{ responded: boolean }> };
    assert.equal(json.overall, 'UNKNOWN');
    assert.equal(json.results[0].responded, false, 'sin respuesta no hay veredicto del modelo');

    const file = loadInferenceEvidence(evidencePath);
    assert.ok(file, 'no se escribio evidencia');
    const entry = findInferenceEntry(file, 'dead-provider/probe-model');
    assert.equal(evaluateInferenceEntry(entry, file.ttlSeconds), 'UNKNOWN');
  });
});

describe('model-inference-probe: --check (no sondea, evalua evidencia)', () => {
  it('NEGATIVO: sin evidencia -> exit 2 (la ausencia NO es PASS)', async () => {
    const result = await runProbe([
      '--check',
      '--json',
      '--model',
      'test-provider/probe-model',
      '--evidence',
      join(workDir, 'no-existe.json'),
    ]);
    assert.equal(result.code, 2, `esperaba exit 2, obtuve ${result.code}: ${result.stdout}`);
  });

  it('NEGATIVO: evidencia VENCIDA -> exit 2 (TTL respetado)', async () => {
    const evidencePath = join(workDir, 'stale.json');
    writeFileSync(
      evidencePath,
      JSON.stringify({
        version: 1,
        generatedAt: new Date(Date.now() - 3_600_000).toISOString(),
        ttlSeconds: 60,
        targets: ['test-provider/probe-model'],
        results: {
          'test-provider/probe-model': {
            status: 'OK',
            responded: true,
            quota: false,
            checkedAt: new Date(Date.now() - 3_600_000).toISOString(),
          },
        },
      }),
      'utf-8',
    );
    const result = await runProbe([
      '--check',
      '--json',
      '--model',
      'test-provider/probe-model',
      '--evidence',
      evidencePath,
    ]);
    assert.equal(result.code, 2, `esperaba exit 2 (evidencia vencida), obtuve ${result.code}`);
  });

  it('NEGATIVO: evidencia fresca con fallo -> exit 1', async () => {
    const evidencePath = join(workDir, 'failed.json');
    writeFileSync(
      evidencePath,
      JSON.stringify({
        version: 1,
        generatedAt: new Date().toISOString(),
        ttlSeconds: 900,
        targets: ['test-provider/probe-model'],
        results: {
          'test-provider/probe-model': {
            status: 'USAGE_LIMIT',
            responded: true,
            quota: true,
            checkedAt: new Date().toISOString(),
          },
        },
      }),
      'utf-8',
    );
    const result = await runProbe([
      '--check',
      '--json',
      '--model',
      'test-provider/probe-model',
      '--evidence',
      evidencePath,
    ]);
    assert.equal(result.code, 1, `esperaba exit 1, obtuve ${result.code}: ${result.stdout}`);
  });

  it('POSITIVO: evidencia fresca con inferencia OK -> exit 0', async () => {
    const evidencePath = join(workDir, 'ok.json');
    writeFileSync(
      evidencePath,
      JSON.stringify({
        version: 1,
        generatedAt: new Date().toISOString(),
        ttlSeconds: 900,
        targets: ['test-provider/probe-model'],
        results: {
          'test-provider/probe-model': {
            status: 'OK',
            responded: true,
            quota: false,
            checkedAt: new Date().toISOString(),
          },
        },
      }),
      'utf-8',
    );
    const result = await runProbe([
      '--check',
      '--json',
      '--model',
      'test-provider/probe-model',
      '--evidence',
      evidencePath,
    ]);
    assert.equal(result.code, 0, `esperaba exit 0, obtuve ${result.code}: ${result.stdout}`);
  });
});

describe('model-inference-evidence: la ausencia de evidencia no es PASS', () => {
  it('NEGATIVO: entrada ausente -> UNKNOWN', async () => {
    assert.equal(evaluateInferenceEntry(undefined, 900), 'UNKNOWN');
  });

  it('NEGATIVO: entrada sin respuesta (transporte) -> UNKNOWN, no FAIL', async () => {
    const entry = {
      status: 'NETWORK_ERROR' as const,
      responded: false,
      quota: false,
      checkedAt: new Date().toISOString(),
    };
    assert.equal(evaluateInferenceEntry(entry, 900), 'UNKNOWN');
  });

  it('NEGATIVO: evidencia de otro modelo no califica al pedido', async () => {
    const file: InferenceEvidenceFile = {
      version: 1,
      generatedAt: new Date().toISOString(),
      ttlSeconds: 900,
      targets: ['otro/modelo'],
      results: {
        'otro/modelo': {
          status: 'OK',
          responded: true,
          quota: false,
          checkedAt: new Date().toISOString(),
        },
      },
    };
    assert.equal(findInferenceEntry(file, 'mi/modelo'), undefined);
    assert.equal(evaluateInferenceEntry(findInferenceEntry(file, 'mi/modelo'), 900), 'UNKNOWN');
  });

  it('POSITIVO: el alias de provider (opencode-go-C vs opencode-go) resuelve al mismo modelo', async () => {
    const file: InferenceEvidenceFile = {
      version: 1,
      generatedAt: new Date().toISOString(),
      ttlSeconds: 900,
      targets: ['opencode-go-C/gpt-5.6-luna'],
      results: {
        'opencode-go-C/gpt-5.6-luna': {
          status: 'OK',
          responded: true,
          quota: false,
          checkedAt: new Date().toISOString(),
        },
      },
    };
    const entry = findInferenceEntry(file, 'opencode-go/gpt-5.6-luna');
    assert.ok(entry, 'el alias de provider debe resolver');
    assert.equal(evaluateInferenceEntry(entry, 900), 'PASS');
  });

  it('NEGATIVO: entre dos instancias del mismo provider gana la entrada MAS FRESCA', async () => {
    // El mismo modelo sondeado bajo `opencode-go-C` (viejo) y `opencode-go-A`
    // (nuevo): quedarse con la primera haria que un exito reciente se leyera
    // como "sin veredicto" (TTL vencido).
    const file: InferenceEvidenceFile = {
      version: 1,
      generatedAt: new Date().toISOString(),
      ttlSeconds: 900,
      targets: ['opencode-go-C/gpt-5.6-luna', 'opencode-go-A/gpt-5.6-luna'],
      results: {
        'opencode-go-C/gpt-5.6-luna': {
          status: 'USAGE_LIMIT',
          responded: true,
          quota: true,
          checkedAt: new Date(Date.now() - 3_600_000).toISOString(),
        },
        'opencode-go-A/gpt-5.6-luna': {
          status: 'OK',
          responded: true,
          quota: false,
          checkedAt: new Date().toISOString(),
        },
      },
    };
    const entry = findInferenceEntry(file, 'opencode-go/gpt-5.6-luna');
    assert.ok(entry, 'debe resolver');
    assert.equal(entry.status, 'OK', 'gana la entrada fresca, no la primera');
    assert.equal(evaluateInferenceEntry(entry, 900), 'PASS');
  });
});
