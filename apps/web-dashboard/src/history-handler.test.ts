import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { deriveSource, listSessions, sessionDetail } from '../server/handlers/history';

function setup() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE token_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    cost REAL,
    model TEXT,
    timestamp TEXT,
    tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard'
  )`);
  db.exec(`CREATE TABLE token_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL,
    session_id TEXT,
    agent TEXT,
    model TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    reasoning_tokens INTEGER,
    cache_read_tokens INTEGER,
    cache_write_tokens INTEGER,
    cost REAL,
    created_at TEXT,
    tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard'
  )`);
  db.exec(`CREATE TABLE traces (
    span_id TEXT PRIMARY KEY,
    trace_id TEXT,
    parent_span_id TEXT,
    name TEXT,
    start_time INTEGER,
    end_time INTEGER,
    duration INTEGER,
    status TEXT,
    model TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost REAL,
    session_id TEXT,
    attributes TEXT,
    tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard'
  )`);
  db.exec(`CREATE TABLE token_savings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT,
    session_id TEXT,
    category TEXT,
    saved_tokens INTEGER,
    source TEXT,
    created_at TEXT,
    tenant_id TEXT NOT NULL DEFAULT 'gentle-vanguard'
  )`);

  const usage = db.prepare(
    `INSERT INTO token_usage (session_id, prompt_tokens, completion_tokens, total_tokens, cost, model, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  // ZCode: 2 requests, 100K tokens
  usage.run('sess_zcode1', 60_000, 40_000, 100_000, 0.5, 'GLM-5.3-Flash', '2026-09-06 10:00:00');
  usage.run('sess_zcode1', 30_000, 10_000, 40_000, 0.2, 'GLM-5.3-Flash', '2026-09-06 11:00:00');
  // MiniMax: 1 request, 1M tokens
  usage.run('ses_minimax1', 900_000, 100_000, 1_000_000, 0, 'big-pickle', '2026-09-05 09:00:00');
  // OpenCode vieja (fuera de 7d pero dentro de 90d)
  usage.run('session-20260701T1200', 5_000, 5_000, 10_000, 0, 'gpt-4o', '2026-07-01 12:00:00');

  const tx = db.prepare(
    `INSERT INTO token_transactions (message_id, session_id, agent, model, input_tokens, output_tokens, cache_read_tokens, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  tx.run('m1', 'sess_zcode1', 'orchestrator', 'GLM-5.3-Flash', 60_000, 40_000, 5_000, '2026-09-06 10:00:00');
  tx.run('m2', 'sess_zcode1', 'subagent', 'GLM-5.3-Flash', 30_000, 10_000, 0, '2026-09-06 11:00:00');
  tx.run('m3', 'ses_minimax1', 'orchestrator', 'big-pickle', 900_000, 100_000, 0, '2026-09-05 09:00:00');

  const trace = db.prepare(
    `INSERT INTO traces (span_id, trace_id, name, start_time, end_time, duration, status, session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  trace.run('sp1', 'tr1', 'verify', 1786000000000, 1786000001500, 1500, 'completed', 'sess_zcode1');
  // Sesión solo-trazas (sesiones del stack: existen en traces, no en token_usage)
  trace.run('sp2', 'tr2', 'agent-run', 1786000010000, 1786000040000, 3000, 'completed', 'sess-stack1');
  trace.run('sp3', 'tr3', 'session-start', 1786000050000, 1786000050200, 200, 'completed', 'sess-stack1');

  const savings = db.prepare(
    `INSERT INTO token_savings (message_id, session_id, category, saved_tokens, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  savings.run('m1', 'sess_zcode1', 'response-cache', 25_000, 'token-ingest', '2026-09-06 10:00:00');

  return db;
}

describe('deriveSource', () => {
  it('mapea prefijos conocidos', () => {
    expect(deriveSource('sess_abc')).toBe('zcode');
    expect(deriveSource('ses_abc')).toBe('minimax');
    expect(deriveSource('sess-abc')).toBe('stack');
    expect(deriveSource('session-20260901T0029')).toBe('stack');
    expect(deriveSource('123e4567-e89b-12d3-a456-426614174000')).toBe('codex');
    expect(deriveSource('test-nexus-connection')).toBe('otro');
    expect(deriveSource(null)).toBe('otro');
  });
});

describe('listSessions', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = setup();
  });

  it('lista todas las sesiones ordenadas por actividad', () => {
    const result = listSessions(db, {
      from: null, to: null, source: null, model: null, q: null,
      limit: 25, offset: 0, sort: 'recent',
    });
    // zcode1 (usage) + minimax1 (usage) + opencode (usage) + sess-stack1 (solo trazas)
    expect(result.totals.sessions).toBe(4);
    expect(result.totals.totalTokens).toBe(1_150_000);
    expect(result.sessions[0].sessionId).toBe('sess_zcode1');
    // 2 requests de usage + 1 span de traces = actividad combinada
    expect(result.sessions[0].requests).toBe(3);
    expect(result.sessions[0].source).toBe('zcode');
    expect(result.sessions[0].hasTraces).toBe(true);
    // sesiones sin trazas
    const minimax = result.sessions.find((s) => s.source === 'minimax');
    expect(minimax?.hasTraces).toBe(false);
    expect(minimax?.totalTokens).toBe(1_000_000);
  });

  it('incluye sesiones solo-trazas (stack) con sus tokens de traces', () => {
    const result = listSessions(db, {
      from: null, to: null, source: 'stack', model: null, q: null,
      limit: 25, offset: 0, sort: 'recent',
    });
    expect(result.totals.sessions).toBe(2); // sess-stack1 (traces) + session-20260701T1200 (usage)
    const stack = result.sessions.find((x) => x.sessionId === 'sess-stack1')!;
    expect(stack.source).toBe('stack');
    expect(stack.requests).toBe(2);
    expect(stack.hasTraces).toBe(true);

    const detail = sessionDetail(db, 'sess-stack1');
    expect(detail).not.toBeNull();
    expect(detail!.traces).toHaveLength(2);
    expect(detail!.traces.map((t) => t.name).sort()).toEqual(['agent-run', 'session-start']);
    expect(detail!.session.lastAt).toBeTruthy();
  });

  it('filtra por fuente (heurística de prefijo en SQL)', () => {
    const result = listSessions(db, {
      from: null, to: null, source: 'zcode', model: null, q: null,
      limit: 25, offset: 0, sort: 'recent',
    });
    expect(result.totals.sessions).toBe(1);
    expect(result.sessions.every((s) => s.source === 'zcode')).toBe(true);
  });

  it('filtra por rango de fechas', () => {
    const result = listSessions(db, {
      from: '2026-09-04', to: '2026-09-06', source: null, model: null, q: null,
      limit: 25, offset: 0, sort: 'recent',
    });
    // La sesión opencode del 2026-07-01 queda fuera
    expect(result.totals.sessions).toBe(2);
  });

  it('filtra por modelo y por búsqueda q', () => {
    const byModel = listSessions(db, {
      from: null, to: null, source: null, model: 'big-pickle', q: null,
      limit: 25, offset: 0, sort: 'recent',
    });
    expect(byModel.totals.sessions).toBe(1);

    const byQ = listSessions(db, {
      from: null, to: null, source: null, model: null, q: 'zcode1',
      limit: 25, offset: 0, sort: 'recent',
    });
    expect(byQ.totals.sessions).toBe(1);
    expect(byQ.sessions[0].sessionId).toBe('sess_zcode1');
  });

  it('ordena por tokens y pagina', () => {
    const sorted = listSessions(db, {
      from: null, to: null, source: null, model: null, q: null,
      limit: 25, offset: 0, sort: 'tokens',
    });
    expect(sorted.sessions[0].totalTokens).toBe(1_000_000);

    const page2 = listSessions(db, {
      from: null, to: null, source: null, model: null, q: null,
      limit: 2, offset: 2, sort: 'recent',
    });
    // 4 sesiones totales: la página 2 trae las 2 restantes
    expect(page2.sessions).toHaveLength(2);
    expect(page2.totals.sessions).toBe(4);
  });
});

describe('sessionDetail', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = setup();
  });

  it('devuelve el drill-down completo de una sesión', () => {
    const detail = sessionDetail(db, 'sess_zcode1');
    expect(detail).not.toBeNull();
    expect(detail!.session.requests).toBe(2);
    expect(detail!.session.totalTokens).toBe(140_000);
    expect(detail!.transactions).toHaveLength(2);
    expect(detail!.transactionsTotal).toBe(2);
    expect(detail!.transactions[0].cache_read_tokens).toBe(0); // más reciente primero
    expect(detail!.traces).toHaveLength(1);
    expect(detail!.traces[0].name).toBe('verify');
    expect(detail!.savings[0].saved).toBe(25_000);
    expect(detail!.savings[0].category).toBe('response-cache');
  });

  it('devuelve null para sesión inexistente', () => {
    expect(sessionDetail(db, 'no-existe')).toBeNull();
  });
});
