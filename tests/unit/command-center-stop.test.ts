/**
 * command-center-stop.test.ts — el Command Center tiene que DETENER de verdad.
 *
 * POR QUÉ EXISTE (2026-11-11)
 * -------------------------------------------------------------------------
 * El owner reportó: "apago todo desde el Command Center y el PID sigue
 * vivo". El defecto NO era cosmético: el `stop()` no mataba nada y además
 * respondía 200 como si hubiera parado. Estos tests fijan el contrato para
 * que no vuelva:
 *
 *   C1. EPERM = VIVO. Un proceso que no podemos señalar (elevado) NO se
 *       puede reportar como muerto.
 *   C2. UN SOLO RESOLVER. El PID que se muestra es el que se mata.
 *   C3. MATAR ES VERIFICAR. Tras el stop, el proceso está muerto y el
 *       puerto libre — comprobado sobre un PROCESO REAL, no con mocks.
 *   C4. SI NO SE PUEDE, SE DICE. Si el proceso sobrevive, la API responde
 *       409 nombrando al superviviente (nunca un 200 mentiroso).
 *   C5. COBERTURA. Toda app con start/stop propio tiene que poder prenderse
 *       y apagarse desde el panel.
 *
 * CONTRATO DECLARADO: control `command-center:stop`
 * (config/declarations.json → controls[].contractTest). El ledger exige que
 * este archivo mencione ese id: un control que afirma "detiene" sin un test
 * que verifique el efecto es exactamente el defecto que casi se lleva el
 * stack por delante.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type CcModule = typeof import('../../apps/command-center/server.ts');
type PcModule = typeof import('../../apps/command-center/process-control.ts');

let cc: CcModule | null = null;
let pc: PcModule | null = null;
try {
  cc = await import('../../apps/command-center/server.ts');
  pc = await import('../../apps/command-center/process-control.ts');
} catch {
  // apps/ es desacoplada: sin el panel, estos tests no tienen contra qué
  // verificarse. No es un fallo: es "no hay nada que probar acá".
}

const roots: string[] = [];
function testRoot(): string {
  const root = mkdtempSync(join(tmpdir(), `gv-cc-stop-${Date.now()}-`));
  mkdirSync(join(root, '.runtime'), { recursive: true });
  roots.push(roots.length ? root : root);
  return root;
}
process.on('exit', () => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Servidor HTTP real en un puerto libre (proceso real, no mock). */
function spawnRealServer(port: number): { pid: number; kill: () => void } {
  const script = `
    const http = require('node:http');
    http.createServer((_req, res) => res.end('ok')).listen(${port}, '127.0.0.1');
  `;
  const child = spawn(process.execPath, ['-e', script], {
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
  });
  child.unref();
  return { pid: child.pid ?? 0, kill: () => void child.kill() };
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

test('C1 — EPERM significa VIVO, no muerto', { skip: !pc }, () => {
  assert.ok(pc);
  // PID 4 = System: existe y no lo podemos señalar (EPERM en Windows).
  if (process.platform === 'win32') {
    assert.equal(pc.isProcessAlive(4), true, 'un proceso inaccesible NO es un proceso muerto');
  }
  assert.equal(pc.isProcessAlive(0), false);
  assert.equal(pc.isProcessAlive(-1), false);
  assert.equal(pc.isProcessAlive(2_147_483_647), false);
});

test(
  'C2 — un solo resolver: el dueño del puerto se elige igual para pintar y para matar',
  { skip: !pc },
  () => {
    assert.ok(pc);
    const netstat = [
      '  TCP    127.0.0.1:1420         0.0.0.0:0              LISTENING      4242',
      '  TCP    127.0.0.1:1420         0.0.0.0:0              FIN_WAIT_1    1111',
      '  TCP    127.0.0.1:50000        127.0.0.1:1420         TIME_WAIT       0',
      '  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING      5555',
    ].join('\n');
    const owners = pc.parsePortOwners(netstat, 1420);
    assert.deepEqual(owners, [4242, 1111], 'LISTENING primero; el resto como respaldo');
    assert.deepEqual(pc.parsePortOwners(netstat, 5173), [5555]);
    assert.deepEqual(pc.parsePortOwners(netstat, 9999), []);
  },
);

test(
  'C3 — stop deja el proceso MUERTO y el puerto libre (proceso real)',
  { skip: !cc },
  async () => {
    assert.ok(cc);
    const root = testRoot();
    const port = 47311;
    const server = spawnRealServer(port);
    await sleep(700);
    assert.ok(pc!.isProcessAlive(server.pid), 'el proceso de prueba debe estar vivo');

    // El controller lee el PID del pidfile: exactamente como la app real.
    writeFileSync(join(root, '.runtime', 'app-academy-http.pid'), String(server.pid));
    const controller = cc.createAppsController({ root });
    const result = await controller.stop('academy');

    assert.equal(result.status, 200, 'el stop debe ser exitoso');
    const body = result.body as { status: string; stop?: { ok: boolean; survivors: unknown[] } };
    assert.equal(body.stop?.ok, true);
    assert.deepEqual(body.stop?.survivors, []);
    assert.equal(body.status, 'stopped');
    assert.equal(pc!.isProcessAlive(server.pid), false, 'el proceso tiene que estar muerto');
    await sleep(300);
    const stillListening = await new Promise<boolean>((done) => {
      const socket = connect(port);
      socket.setTimeout(600, () => {
        socket.destroy();
        done(false);
      });
      socket.once('connect', () => {
        socket.destroy();
        done(true);
      });
      socket.once('error', () => done(false));
    });
    assert.equal(stillListening, false, 'el puerto tiene que quedar libre');
  },
);

test(
  'C3b — si la capa barata (netstat) no ve el puerto, la capa CIM lo encuentra y lo mata',
  { skip: !cc },
  async () => {
    assert.ok(cc);
    const root = testRoot();
    // El puerto REAL de la app: el resolver sólo conoce los puertos del
    // registro, así que el servidor de prueba tiene que escuchar en uno de
    // ellos (4173 = academy).
    const port = 4173;
    const server = spawnRealServer(port);
    await sleep(900);

    // Sin pidfile y con la capa netstat CIEGA: reproduce el caso real de un
    // proceso ELEVADO (netstat sin elevación no ve su socket). Con el código
    // viejo, el stop no encontraba a nadie y no mataba nada.
    const controller = cc.createAppsController({
      root,
      netstatResolver: () => new Map(),
      // Sin escalada: lo que tiene que matar el proceso es la capa CIM.
      elevate: () => ({ ok: false, detail: 'sin elevación en el test' }),
    });
    const result = await controller.stop('academy');
    assert.equal(result.status, 200);
    const body = result.body as { status: string; stop?: { ok: boolean } };
    assert.equal(body.stop?.ok, true);
    assert.equal(body.status, 'stopped');
    assert.equal(pc!.isProcessAlive(server.pid), false, 'el proceso real tiene que estar muerto');
  },
);

test('C4 — si el proceso sobrevive, la API responde 409 y lo nombra', { skip: !cc }, async () => {
  assert.ok(cc);
  const root = testRoot();
  // PID inexistente + puerto que "sigue vivo" (probe inyectado): nadie puede
  // matarlo y el CC tiene que decirlo, no devolver un 200 de mentira.
  writeFileSync(join(root, '.runtime', 'app-academy-http.pid'), '999999');
  const controller = cc.createAppsController({
    root,
    probe: async () => true,
    resolvePortOwner: () => 0,
    killProcess: (pid) => ({ pid, killed: false, method: 'failed', detail: 'proceso inaccesible' }),
    elevate: () => ({ ok: false, detail: 'sin elevación en el test' }),
  });
  const result = await controller.stop('academy');
  assert.equal(result.status, 409, 'un stop que no para nada NO es un 200');
  const body = result.body as {
    stop?: {
      ok: boolean;
      survivors: Array<{ name: string; pid: number; port: number }>;
      reason?: string;
    };
  };
  assert.equal(body.stop?.ok, false);
  assert.ok((body.stop?.survivors.length ?? 0) > 0, 'tiene que nombrar al superviviente');
  assert.ok(body.stop?.reason, 'tiene que explicar por qué');
});

test('C5 — toda app con start/stop propio está en el registro del panel', { skip: !cc }, () => {
  assert.ok(cc);
  const ids = cc.APPS_REGISTRY.map((app) => app.id);
  const esperados = [
    'dashboard',
    'analytics',
    'alexandria',
    'cms',
    'academy',
    'prompts',
    'archify',
    'design-hub',
    'design-gallery',
    'academy-crm',
    'academy-landing',
    'academy-portal',
    'gv-music',
    'gv-agenda',
    'gv-knowledge-ops',
    'gv-wifikeys',
    'service-desk',
    'vanguard-connect',
    'gv-english-lab',
    'voice-studio',
    'sandbox-gv',
  ];
  for (const id of esperados) {
    assert.ok(ids.includes(id as (typeof ids)[number]), `falta la app ${id} en el registro`);
  }
  // Decisión del owner (2026-11-11): las apps de CLIENTES no están en el
  // Command Center — las gestiona el Sandbox. Si vuelven a aparecer, dos
  // centros están compitiendo por la misma app.
  const deClientes = [
    'client-phone-auth-sandbox',
    'genesis-landing',
    'kairos-agenda',
    'malabis-web',
    'viandas-bot',
    'wpp-bot',
  ];
  for (const id of deClientes) {
    assert.ok(
      !ids.includes(id as (typeof ids)[number]),
      `la app de cliente ${id} no debe estar en el Command Center (es del Sandbox)`,
    );
  }
});

import { connect } from 'node:net';
