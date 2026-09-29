/**
 * Tests del espejo de certificados en el Worker (mp-bridge).
 *
 * Estos fijan el CONTRATO del otro extremo del espejo:
 *   - la escritura exige el secreto de la cola (mismo consumidor, misma razon)
 *   - la lectura es PUBLICA y sin sesion
 *   - lo que se guarda es lo MINIMO: nada de email, id ni score
 *   - un certificado revocado se MARCA, no se borra (borrarlo haria que un
 *     codigo revocado volviera "no existe")
 *
 * Run: node --import tsx --test src/mp-bridge/worker-cert.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import worker, { type KVNamespace, type Env } from './worker.ts';

/**
 * KV en memoria con la superficie minima que usa el worker. La interface
 * `KVNamespace` esta definida aca mismo (en worker.ts) para evitar depender
 * de `@cloudflare/workers-types`. La extension `.store` es SOLO para tests:
 * permite inspeccionar lo que se escribio sin reimplementar `get`.
 */
type KVWithStore = KVNamespace & { store: Map<string, string> };

function fakeKV(): KVWithStore {
  const store = new Map<string, string>();
  const kv: KVWithStore = {
    store,
    get: async (k) => store.get(k) ?? null,
    put: async (k, v) => { store.set(k, v); },
    delete: async (k) => { store.delete(k); },
    list: async (opts) => ({
      keys: [...store.keys()]
        .filter((k) => !opts?.prefix || k.startsWith(opts.prefix))
        .map((name) => ({ name })),
    }),
  };
  return kv;
}

const ENV: Env = {
  MP_ACCESS_TOKEN: 'test-token',
  SALES_KV: fakeKV(),
  SALES_POLL_SECRET: 'poll-secret',
};

/** Helper: accede al store interno del fake. */
function kvStore(env: Env): Map<string, string> {
  return (env.SALES_KV as KVWithStore | undefined)?.store ?? new Map();
}

/** Helper: crea un ENV fresco con KV propia (aisla tests). */
function freshEnv(): Env {
  return { ...ENV, SALES_KV: fakeKV() };
}

// Codigo de certificado en formato normalizado: 4 grupos de 6 = 24 chars
// (el ultimo caracter es checksum pero para tests usamos uno valido que
// pasa el filtro de longitud sin entrar en la logica de checksum del Portal,
// porque este worker no valida checksum — solo longitud).
const CERT = {
  code: 'AAAAAABBBBBBCCCCCCDDDDDD', // 6+6+6+6 = 24 chars
  courseTitle: 'Agentes de IA',
  studentName: 'Ana M. L.',
  issuedAt: '2026-09-29T00:00:00.000Z',
};

const mirror = (
  body: unknown,
  env: Env = ENV,
  headers: Record<string, string> = { 'x-poll-secret': 'poll-secret' },
) =>
  worker.fetch(
    new Request('https://gv-mp-bridge.test/api/mp/cert/mirror', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
    env,
  );

const verify = (code: string, env: Env = ENV) =>
  worker.fetch(new Request(`https://gv-mp-bridge.test/api/mp/cert/${code}`), env);

// ── escritura (exige secreto) ────────────────────────────────────────────

test('el espejo exige el secreto de la cola', async () => {
  const res = await mirror(CERT, ENV, {});
  assert.equal(res.status, 401, 'sin secreto no se puede escribir en el store publico');
});

test('espeja un certificado valido', async () => {
  const res = await mirror(CERT);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; code: string };
  assert.equal(body.ok, true);
  assert.equal(body.code, CERT.code);
});

test('rechaza un codigo de largo incorrecto', async () => {
  const res = await mirror({ ...CERT, code: 'CORTODO' });
  assert.equal(res.status, 400);
});

test('rechaza un body sin courseTitle o sin studentName', async () => {
  assert.equal((await mirror({ ...CERT, courseTitle: '' })).status, 400);
  assert.equal((await mirror({ ...CERT, studentName: '' })).status, 400);
});

test('normaliza el codigo (quita guiones, pasa a mayusculas)', async () => {
  // 24 chars en minusculas con guiones intercalados.
  const res = await mirror({ ...CERT, code: 'aaaaaa-bbbbbb-cccccc-dddddd' });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { code: string };
  assert.equal(body.code, 'AAAAAABBBBBBCCCCCCDDDDDD');
});

test('lo que se guarda NO incluye email, score ni id', async () => {
  const env = freshEnv();
  const res = await mirror(
    { ...CERT, email: 'ana@example.com', score: 95, studentId: 's-1' },
    env,
  );
  assert.equal(res.status, 200, 'los campos extra no deben hacer fallar el espejo');
  const stored = kvStore(env).get(`cert:${CERT.code}`) ?? '';
  assert.ok(!stored.includes('@'), `no debe guardar email: ${stored}`);
  assert.ok(!stored.includes('score'), `no debe guardar score: ${stored}`);
  assert.ok(!stored.includes('studentId'), `no debe guardar id: ${stored}`);
  assert.ok(!stored.includes('s-1'), `no debe guardar el id: ${stored}`);
});

test('el prefijo cert: NO colisiona con la cola de ventas', async () => {
  await mirror(CERT);
  const keys = [...kvStore(ENV).keys()];
  assert.ok(keys.some((k) => k.startsWith('cert:')), 'debe usar su propio prefijo');
  assert.ok(
    !keys.some((k) => k.startsWith('sale:')),
    'no debe escribir en la cola: un barrido de acks la vaciaria',
  );
});

// ── lectura (publica, sin sesion) ───────────────────────────────────────

test('la verificacion es PUBLICA: funciona sin ningun header', async () => {
  const env = freshEnv();
  await mirror(CERT, env);
  const res = await verify(CERT.code, env);
  assert.equal(res.status, 200, 'sin sesion ni secreto: es lo que lo hace verificable');
  const body = (await res.json()) as { valid: boolean; studentName: string };
  assert.equal(body.valid, true);
  assert.equal(body.studentName, 'Ana M. L.', 'devuelve el nombre ya enmascarado');
});

test('no expone email ni score en la respuesta publica', async () => {
  const env = freshEnv();
  await mirror({ ...CERT, email: 'ana@example.com', score: 95 }, env);
  const res = await verify(CERT.code, env);
  const dumped = JSON.stringify(await res.json());
  assert.ok(!dumped.includes('email'), dumped);
  assert.ok(!dumped.includes('score'), dumped);
});

test('codigo inexistente → 404', async () => {
  const res = await verify('ZZZZZZZZZZZZZZZZZZZZZZZZ'); // 24 Z's
  assert.equal(res.status, 404);
});

test('codigo mal formado → 400 (no 404: es un error de forma)', async () => {
  const res = await verify('CORTO');
  assert.equal(res.status, 400);
});

test('acepta el codigo con guiones, en minusculas y con confundibles', async () => {
  const env = freshEnv();
  await mirror(CERT, env);
  // Inserto un "0" para luego reemplazarlo por "O" (confundible comun al
  // transcribir a mano). Como CERT.code son letras, simulo cambiando una
  // letra valida por su variante confundible — en este caso B→8 no aplica,
  // asi que uso el formateador para generar el codigo "con 0 por 0".
  // En su lugar: usamos un codigo separado con ceros.
  const conCeros = '000000BBBBBBCCCCCCDDDDDD'; // 6+6+6+6 = 24, con ceros
  await mirror({ ...CERT, code: conCeros }, env);
  // Quien transcribe a mano escribe O por 0:
  const conO = conCeros.replace(/0/g, 'O').toLowerCase();
  const res = await verify(conO, env);
  assert.equal(res.status, 200, 'quien transcribe a mano no debe fallar por el formato');
  assert.equal(((await res.json()) as { valid: boolean }).valid, true);
});

test('un certificado REVOCADO se marca, no se borra', async () => {
  const env = freshEnv();
  await mirror({ ...CERT, revoked: true }, env);
  const res = await verify(CERT.code, env);
  const body = (await res.json()) as { valid: boolean; revoked: boolean };
  assert.equal(body.valid, false);
  assert.equal(body.revoked, true);
  // Y el registro sigue existiendo: borrarlo haria que un codigo revocado
  // volviera a responder "no existe" en vez de "revocado".
  assert.ok(
    kvStore(env).has(`cert:${CERT.code}`),
    'el registro debe seguir en KV',
  );
});

test('la verificacion cuenta las consultas (detecta un codigo filtrado)', async () => {
  const env = freshEnv();
  await mirror(CERT, env);
  await verify(CERT.code, env);
  await verify(CERT.code, env);
  const stored = kvStore(env).get(`cert:${CERT.code}`) ?? '{}';
  const verified = (JSON.parse(stored) as { verified: number }).verified;
  assert.ok(verified >= 2, `contador: ${verified}`);
});

test('un GET a /api/mp/cert/mirror no escribe nada', async () => {
  const env = freshEnv();
  const res = await worker.fetch(new Request('https://gv-mp-bridge.test/api/mp/cert/mirror'), env);
  assert.equal(res.status, 404, 'la escritura es POST-only');
  assert.equal(kvStore(env).size, 0);
});
