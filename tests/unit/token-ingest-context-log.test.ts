/**
 * Item 12 del inventario — el productor de `.state.json` de la KB.
 *
 * Contexto: el dashboard de observabilidad y el resumen de KB leen el estado de
 * sesion de `.session/context-log/<session-id>/.state.json`. Ese archivo lo
 * escribia SOLO el hook PostToolUse de OpenCode/ZCode, con tokens ESTIMADOS por
 * el largo de los argumentos de la tool. Las sesiones reales de MiniMax Code
 * (y de cualquier host sin hook cableado) quedaban con `turns=0`,
 * `messageCount=0`, `totalTokens=0`: el productor no existia.
 *
 * Casos que fijan:
 *   1. El estado se arma con el uso REAL (input+output), no con estimaciones.
 *   2. `messageCount` es el numero de transacciones reales, no de escrituras.
 *   3. `status` distingue sesion viva de sesion terminada.
 *   4. Los turnos se acotan (los totales siguen siendo exactos) y se declara.
 *   5. Un id de sesion que no es seguro como carpeta NO se escribe (evita
 *      crear directorios basura a partir de rutas de archivo).
 *   6. La escritura es idempotente: sin cambios no se reescribe el archivo.
 *   7. La marca `usageAuthority: 'ingest-real'` deja constancia de que la
 *      autoridad del dato es la ingesta (el hook de estimaciones no lo pisa).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildSessionState,
  isSafeSessionId,
  toIso,
  writeSessionState,
  type SessionAggregate,
  type TurnRow,
} from '../../src/tokens/token-ingest/context-log-writer.ts';

const AGG: SessionAggregate = {
  sessionId: 'mvs_test123',
  transactions: 12,
  tokensInput: 1000,
  tokensOutput: 250,
  cacheRead: 9000,
  cost: 0,
  firstAt: '2026-11-18 04:43:42',
  lastAt: '2026-11-18 12:44:43',
  model: 'minimax/MiniMax-M3.1-Flash',
  agentName: 'mavis',
  provider: 'minimax',
};

const turn = (min: number, input = 10, output = 5): TurnRow => ({
  input,
  output,
  cacheRead: 100,
  createdAt: `2026-11-18 12:${String(min).padStart(2, '0')}:00`,
  model: 'minimax/MiniMax-M3.1-Flash',
});

describe('context-log-writer — productor de estado de sesion con uso real', () => {
  it('arma el estado con tokens reales (input+output), no estimaciones', () => {
    const state = buildSessionState(AGG, [turn(0)], 'ingest');
    assert.strictEqual(state.totalTokens, 1250);
    assert.strictEqual(state.messageCount, 12);
    assert.strictEqual(state.sessionId, 'mvs_test123');
    assert.strictEqual(state.agent, 'mavis');
    // La atribucion del host queda declarada (no "ingest" generico).
    assert.strictEqual(state.metadata?.source, 'minimax');
  });

  it('distingue sesion viva de sesion terminada', () => {
    const now = Date.parse('2026-11-18T12:50:00.000Z');
    const activa = buildSessionState(AGG, [turn(0)], 'ingest', now);
    assert.strictEqual(activa.status, 'active');

    const vieja = buildSessionState(
      { ...AGG, lastAt: '2026-11-18 04:00:00' },
      [turn(0)],
      'ingest',
      now,
    );
    assert.strictEqual(vieja.status, 'completed');
  });

  it('acota los turnos y declara el truncamiento (los totales siguen exactos)', () => {
    const many = Array.from({ length: 260 }, (_, i) => turn(i % 60, 1, 1));
    const state = buildSessionState({ ...AGG, transactions: 260 }, many, 'ingest');
    assert.strictEqual(state.turns.length, 200);
    assert.strictEqual(state.metadata?.turnsTruncated, true);
    assert.strictEqual(state.messageCount, 260);
  });

  it('declara el truncamiento cuando hay mas transacciones que turnos guardados', () => {
    // Caso real: la consulta trae los ultimos 200 turnos de 1631 transacciones.
    const state = buildSessionState({ ...AGG, transactions: 1631 }, [turn(1)], 'ingest');
    assert.strictEqual(state.turns.length, 1);
    assert.strictEqual(state.metadata?.turnsTruncated, true);
    assert.strictEqual(state.messageCount, 1631);
  });

  it('convierte el timestamp local de SQLite a ISO (preserva el instante local)', () => {
    // SQLite guarda `datetime('now','localtime')` → el string es hora local.
    // La conversión debe conservar ese instante, no shifting a UTC-naive.
    const expected = new Date('2026-11-18T12:44:43').toISOString();
    assert.strictEqual(toIso('2026-11-18 12:44:43'), expected);
    assert.ok(toIso('').length > 0);
  });

  it('rechaza ids de sesion que no son seguros como carpeta', () => {
    assert.ok(isSafeSessionId('mvs_7cbfaff46f5a4fee809c0bee58323499'));
    assert.ok(!isSafeSessionId('C:\\Users\\emman\\.zcode\\cli\\rollout\\model-io-no-session'));
    assert.ok(!isSafeSessionId('..'));
    assert.ok(!isSafeSessionId(''));
  });

  it('escribe el estado y es idempotente (sin cambios no reescribe)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gv-ctx-log-'));
    process.env.GENTLE_CONTEXT_LOG_DIR = dir;
    try {
      const state = buildSessionState(AGG, [turn(0)], 'ingest');
      assert.strictEqual(writeSessionState(state), true);
      const file = join(dir, 'mvs_test123', '.state.json');
      assert.ok(existsSync(file));
      const written = JSON.parse(readFileSync(file, 'utf-8'));
      assert.strictEqual(written.metadata.usageAuthority, 'ingest-real');
      assert.strictEqual(written.totalTokens, 1250);

      // Segunda pasada sin cambios → no reescribe.
      assert.strictEqual(writeSessionState(buildSessionState(AGG, [turn(0)], 'ingest')), false);

      // Con actividad nueva → reescribe.
      const nuevo = buildSessionState(
        { ...AGG, transactions: 13, tokensOutput: 400, lastAt: '2026-11-18 12:50:00' },
        [turn(1)],
        'ingest',
      );
      assert.strictEqual(writeSessionState(nuevo), true);
      const after = JSON.parse(readFileSync(file, 'utf-8'));
      assert.strictEqual(after.totalTokens, 1400);
      assert.strictEqual(after.messageCount, 13);
    } finally {
      delete process.env.GENTLE_CONTEXT_LOG_DIR;
    }
  });
});
