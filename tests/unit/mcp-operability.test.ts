/**
 * mcp-operability.test.ts — la cuarta verificacion de una capacidad MCP.
 *
 * El stack verifica que una capacidad este DECLARADA (politica), ALCANZABLE
 * (registro) y DESCUBRIBLE (mapa de demanda). Esta herramienta verifica la
 * cuarta: que la capacidad REALMENTE SIRVE, con una llamada real.
 *
 * Los invariantes que protege:
 *   1. la clasificacion distingue "falta una credencial del owner" de "falta
 *      un servicio externo": no es lo mismo, y el stack solo arregla el
 *      segundo;
 *   2. un payload vacio es "ok-sin-dato", no "ok": responder vacio no prueba
 *      que la capacidad tenga contenido;
 *   3. `{ROOT}` se expande en la sonda (el mapa es portable);
 *   4. toda intencion declara sonda: sin sonda, la capacidad no es
 *      verificable como operable.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classify,
  decideStatus,
  expandArgs,
  isEmptyPayload,
} from '../../src/tools/mcp-operability.js';
import { checkDemandMap, loadDemandMap } from '../../src/tools/mcp-suggest.js';

describe('probe de operabilidad MCP', () => {
  it('una cuota mensual agotada no es operable aunque falte isError', () => {
    const message =
      'Monthly quota exceeded. Create a free API key at https://context7.com/dashboard for more requests.';
    assert.equal(classify(undefined, message, false), 'requiere-config');
    assert.equal(classify(undefined, [{ type: 'text', text: message }], false), 'requiere-config');
    assert.equal(
      classify(undefined, 'Documentation: handle Monthly quota exceeded responses.'),
      'ok',
    );
    assert.equal(classify(undefined, { results: [{ text: message }] }), 'ok');
  });
  it('un 401 con OAuth es "requiere-config", no un fallo del stack', () => {
    // Medido: `mercadopago` responde 401 porque el token vive en el cliente.
    const status = classify(
      'Streamable HTTP error: {"code":401,"message":"Authentication failed"}',
      undefined,
    );
    assert.equal(status, 'requiere-config');
  });

  it('un servicio externo caido es "dependencia-caida" (el stack lo puede arreglar)', () => {
    // Medido: `browse` sin relay responde "relay is not reachable".
    const status = classify('browse relay is not reachable at http://127.0.0.1:19988', undefined);
    assert.equal(status, 'dependencia-caida');
  });

  it('cualquier otro error es "roto"', () => {
    assert.equal(classify('boom', undefined), 'roto');
  });

  it('un payload vacio es ok-sin-dato, no ok', () => {
    assert.equal(classify(undefined, { entities: [], relations: [] }), 'ok-sin-dato');
    assert.equal(classify(undefined, []), 'ok-sin-dato');
    assert.equal(classify(undefined, { chains: [] }), 'ok-sin-dato');
  });

  it('un payload con contenido es ok', () => {
    assert.equal(classify(undefined, { totalChains: 3, chains: [{ id: 'a' }] }), 'ok');
    assert.equal(classify(undefined, 'texto con contenido'), 'ok');
  });

  it('reconoce el payload vacio sin falsos positivos', () => {
    assert.equal(isEmptyPayload({}), true);
    assert.equal(isEmptyPayload(null), true);
    assert.equal(isEmptyPayload('   '), true);
    assert.equal(isEmptyPayload({ entities: [], relations: [] }), true);
    // Un objeto con datos pero sin las claves de coleccion no esta vacio.
    assert.equal(isEmptyPayload({ version: '2.0.0', mode: 'dark-first' }), false);
  });

  it('un JSON serializado se mira como objeto, no como texto', () => {
    // Medido 2026-11-18: las tools MCP devuelven TEXTO. `{entities: [],
    // relations: []}` llegaba como string y se clasificaba `ok` (con dato)
    // cuando el grafo estaba vacio.
    assert.equal(isEmptyPayload('{"entities":[],"relations":[]}'), true);
    assert.equal(isEmptyPayload('{"totalChains":0,"chains":[]}'), true);
    assert.equal(isEmptyPayload('{"entities":[{"name":"x"}]}'), false);
  });

  it('el array de contenido MCP se mira por su texto', () => {
    // La forma real de la respuesta MCP: [{type:'text', text:'...'}].
    assert.equal(isEmptyPayload([{ type: 'text', text: '{"entities":[],"relations":[]}' }]), true);
    assert.equal(isEmptyPayload([{ type: 'text', text: '{"entities":[{"name":"x"}]}' }]), false);
    assert.equal(isEmptyPayload([]), true);
  });

  it('una tool que devuelve isError NO es una capacidad sana', () => {
    // Medido: context7 rechazaba los argumentos de la sonda y el probe lo
    // daba como `ok` porque el detalle venia en el contenido, no en `error`.
    assert.equal(
      classify(undefined, 'libraryName: expected string, received undefined', true),
      'roto',
    );
    assert.equal(classify(undefined, 'some data', false), 'ok');
  });

  it('un timeout es "timeout", no "roto": no se puede afirmar que este roto', () => {
    // Medido 2026-11-18 22:18: el check dio FAIL (1 roto) y a las 22:22 dio
    // PASS (0 roto) sin ningun cambio. Un timeout con la maquina cargada no
    // prueba que la capacidad este rota.
    assert.equal(classify('ETIMEDOUT: probe timeout after 30000ms', undefined), 'timeout');
    assert.equal(classify('Request timed out', undefined), 'timeout');
  });

  it('un fallo unico que no se reproduce es "intermitente" (no bloquea)', () => {
    // La confirmacion: un fallo sin repetir NO se declara roto.
    assert.equal(decideStatus({ status: 'roto' }, { status: 'ok' }), 'intermitente');
    assert.equal(decideStatus({ status: 'roto' }, { status: 'ok-sin-dato' }), 'intermitente');
    assert.equal(decideStatus({ status: 'timeout' }, { status: 'ok' }), 'intermitente');
  });

  it('un fallo reproducible es "roto" (el stack lo tiene que arreglar)', () => {
    assert.equal(decideStatus({ status: 'roto' }, { status: 'roto' }), 'roto');
    assert.equal(decideStatus({ status: 'timeout' }, { status: 'roto' }), 'roto');
  });

  it('dos timeouts NO son "roto": quedan como timeout (no bloquean)', () => {
    assert.equal(decideStatus({ status: 'timeout' }, { status: 'timeout' }), 'timeout');
    assert.equal(decideStatus({ status: 'roto' }, { status: 'timeout' }), 'timeout');
  });

  it('un estado sano no se reintenta ni se cambia', () => {
    assert.equal(decideStatus({ status: 'ok' }, { status: 'roto' }), 'ok');
    assert.equal(decideStatus({ status: 'requiere-config' }, { status: 'ok' }), 'requiere-config');
    assert.equal(
      decideStatus({ status: 'dependencia-caida' }, { status: 'ok' }),
      'dependencia-caida',
    );
  });

  it('expande {ROOT} en los argumentos de la sonda', () => {
    const args = expandArgs({ path: '{ROOT}/config', depth: 2, flag: true }, 'C:\\repo');
    assert.equal(args.path, 'C:\\repo/config');
    assert.equal(args.depth, 2);
    assert.equal(args.flag, true);
  });

  it('toda intencion declara sonda de operabilidad', () => {
    const map = loadDemandMap();
    for (const intent of map.intents) {
      assert.ok(intent.probe?.tool, `la intencion ${intent.id} no declara sonda`);
    }
    const result = checkDemandMap();
    assert.ok(result.ok, `invariantes rotos:\n${result.problems.join('\n')}`);
  });
});
