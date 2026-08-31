import Database from 'better-sqlite3';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// Fuentes por herramienta (extensible). opencode es la principal (corre el stack).
export function opencodeDbPath(): string | null {
  const candidates = [
    join(process.env.USERPROFILE || '', '.local', 'share', 'opencode', 'opencode.db'),
    join(process.env.HOME || '', '.local', 'share', 'opencode', 'opencode.db'),
    join(process.env.LOCALAPPDATA || '', 'opencode', 'opencode.db'),
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

export interface SessionUsage {
  sessionId: string;
  tokensInput: number;
  tokensOutput: number;
  tokensReasoning: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  cost: number;
  model: string;
  provider: string;
  timeUpdated: number;
}

/** Lee las sesiones con uso real desde la DB de opencode (readonly). */
export function readOpencodeSessions(dbPath: string, sinceTimeUpdated = 0): SessionUsage[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .prepare(
        `SELECT id, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read,
                tokens_cache_write, cost, model, time_updated
         FROM session
         WHERE (tokens_input > 0 OR tokens_output > 0)
           AND time_updated >= ?
         ORDER BY time_updated ASC`,
      )
      .all(sinceTimeUpdated) as Array<{
      id: string;
      tokens_input: number | null;
      tokens_output: number | null;
      tokens_reasoning: number | null;
      tokens_cache_read: number | null;
      tokens_cache_write: number | null;
      cost: number | null;
      model: string | null;
      time_updated: number;
    }>;
    return rows.map((r) => {
      let model = r.model || '';
      let provider = '';
      try {
        const m = JSON.parse(r.model || '{}') as { id?: string; providerID?: string };
        model = m.id || model;
        provider = m.providerID || '';
      } catch {
        /* model is a plain string */
      }
      return {
        sessionId: r.id,
        tokensInput: r.tokens_input ?? 0,
        tokensOutput: r.tokens_output ?? 0,
        tokensReasoning: r.tokens_reasoning ?? 0,
        tokensCacheRead: r.tokens_cache_read ?? 0,
        tokensCacheWrite: r.tokens_cache_write ?? 0,
        cost: r.cost ?? 0,
        model,
        provider,
        timeUpdated: r.time_updated,
      };
    });
  } finally {
    db.close();
  }
}

// ─── Fuente ZCode (~/.zcode/cli/rollout/model-io-*.jsonl) ──────────────────────

export function zcodeRolloutDir(): string | null {
  const candidates = [
    join(process.env.USERPROFILE || process.env.HOME || '', '.zcode', 'cli', 'rollout'),
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

export interface ZcodeRolloutRecord {
  requestId: string;
  sessionId?: string;
  startedAt?: string;
  completedAt?: string;
  model?: { modelId?: string; providerId?: string; role?: string };
  response?: {
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
    };
  };
}

/** Parsea los JSONL de rollout de ZCode (un registro por request al modelo). */
export function readZcodeRollout(sinceCompletedMs = 0): {
  sessions: SessionUsage[];
  txns: TransactionUsage[];
} {
  const dir = zcodeRolloutDir();
  if (!dir) return { sessions: [], txns: [] };
  const bySession = new Map<string, SessionUsage>();
  const txns: TransactionUsage[] = [];
  const files: string[] = [];
  try {
    for (const f of readdirSync(dir)) {
      if (f.startsWith('model-io-') && f.endsWith('.jsonl')) files.push(join(dir, f));
    }
  } catch {
    return { sessions: [], txns: [] };
  }
  for (const file of files) {
    let lines: string[];
    try {
      lines = readFileSync(file, 'utf8').trim().split('\n');
    } catch {
      continue;
    }
    for (const line of lines) {
      let r: ZcodeRolloutRecord;
      try {
        r = JSON.parse(line) as ZcodeRolloutRecord;
      } catch {
        continue;
      }
      const completed = r.completedAt ? Date.parse(r.completedAt) : 0;
      if (!Number.isFinite(completed) || completed < sinceCompletedMs) continue;
      const u = r.response?.usage;
      if (!u || ((u.inputTokens ?? 0) === 0 && (u.outputTokens ?? 0) === 0)) continue;
      const sessionId = r.sessionId || file.replace(/^model-io-|\.jsonl$/g, '') || 'zcode-unknown';
      const model = r.model?.modelId || 'unknown';
      const agent: 'orchestrator' | 'subagent' =
        r.model?.role && r.model.role !== 'main' ? 'subagent' : 'orchestrator';
      txns.push({
        sessionId,
        messageId: `zcode:${r.requestId}`,
        role: 'assistant',
        agent,
        model,
        input: u.inputTokens ?? 0,
        output: u.outputTokens ?? 0,
        reasoning: 0,
        cacheRead: u.cacheReadTokens ?? 0,
        cacheWrite: u.cacheWriteTokens ?? 0,
        cost: 0, // GLM coding-plan: costo incluido en suscripción, sin metered cost
        timeCreated: completed,
      });
      const cur =
        bySession.get(sessionId) ??
        ({
          sessionId,
          tokensInput: 0,
          tokensOutput: 0,
          tokensReasoning: 0,
          tokensCacheRead: 0,
          tokensCacheWrite: 0,
          cost: 0,
          model,
          provider: r.model?.providerId || 'zcode',
          timeUpdated: 0,
        } satisfies SessionUsage);
      cur.tokensInput += u.inputTokens ?? 0;
      cur.tokensOutput += u.outputTokens ?? 0;
      cur.tokensCacheRead += u.cacheReadTokens ?? 0;
      cur.tokensCacheWrite += u.cacheWriteTokens ?? 0;
      cur.timeUpdated = Math.max(cur.timeUpdated, completed);
      bySession.set(sessionId, cur);
    }
  }
  return { sessions: [...bySession.values()], txns };
}

// ─── Fuente Codex (~/.codex/sessions/**/rollout-*.jsonl) ──────────────────────

export function codexSessionsDir(): string | null {
  const p = join(process.env.USERPROFILE || process.env.HOME || '', '.codex', 'sessions');
  return existsSync(p) ? p : null;
}

/** Walk recursivo simple para encontrar rollout-*.jsonl. */
export function walkJsonl(dir: string, acc: string[] = []): string[] {
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walkJsonl(p, acc);
      else if (e.isFile() && e.name.startsWith('rollout-') && e.name.endsWith('.jsonl'))
        acc.push(p);
    }
  } catch {
    /* non-fatal */
  }
  return acc;
}

/**
 * Codex persiste eventos `token_count` con usage ACUMULADO (`total_token_usage`) y
 * DELTA del turno (`last_token_usage`). Ingerimos los deltas como transacciones.
 */
export function readCodexRollout(sinceMs = 0): {
  sessions: SessionUsage[];
  txns: TransactionUsage[];
} {
  const dir = codexSessionsDir();
  if (!dir) return { sessions: [], txns: [] };
  const bySession = new Map<string, SessionUsage>();
  const txns: TransactionUsage[] = [];
  for (const file of walkJsonl(dir)) {
    let lines: string[];
    try {
      lines = readFileSync(file, 'utf8').trim().split('\n');
    } catch {
      continue;
    }
    const sessionId = file.match(/rollout-[\dT-]*-([0-9a-f-]{36})\.jsonl$/)?.[1] ?? 'codex-unknown';
    for (const line of lines) {
      if (!line.includes('token_count')) continue;
      let evt: {
        timestamp?: string;
        payload?: {
          type?: string;
          info?: {
            last_token_usage?: {
              input_tokens?: number;
              output_tokens?: number;
              reasoning_output_tokens?: number;
              cached_input_tokens?: number;
              total_tokens?: number;
            };
          };
        };
      };
      try {
        evt = JSON.parse(line) as typeof evt;
      } catch {
        continue;
      }
      const u = evt.payload?.info?.last_token_usage;
      if (!u || ((u.input_tokens ?? 0) === 0 && (u.output_tokens ?? 0) === 0)) continue;
      const ts = evt.timestamp ? Date.parse(evt.timestamp) : 0;
      if (!Number.isFinite(ts) || ts < sinceMs) continue;
      txns.push({
        sessionId,
        messageId: `codex:${sessionId}:${ts}:${txns.length}`,
        role: 'assistant',
        agent: 'orchestrator',
        model: 'codex',
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        reasoning: u.reasoning_output_tokens ?? 0,
        cacheRead: u.cached_input_tokens ?? 0,
        cacheWrite: 0,
        cost: 0, // plan ChatGPT: sin costo metered
        timeCreated: ts,
      });
      const cur =
        bySession.get(sessionId) ??
        ({
          sessionId,
          tokensInput: 0,
          tokensOutput: 0,
          tokensReasoning: 0,
          tokensCacheRead: 0,
          tokensCacheWrite: 0,
          cost: 0,
          model: 'codex',
          provider: 'openai',
          timeUpdated: 0,
        } satisfies SessionUsage);
      cur.tokensInput += u.input_tokens ?? 0;
      cur.tokensOutput += u.output_tokens ?? 0;
      cur.tokensReasoning += u.reasoning_output_tokens ?? 0;
      cur.tokensCacheRead += u.cached_input_tokens ?? 0;
      cur.timeUpdated = Math.max(cur.timeUpdated, ts);
      bySession.set(sessionId, cur);
    }
  }
  return { sessions: [...bySession.values()], txns };
}

// ─── Fuente MiniMax Code (~/.minimax/v2/sqlite/runtime-state.sqlite) ──────────

export function minimaxDbPath(): string | null {
  const p = join(
    process.env.USERPROFILE || process.env.HOME || '',
    '.minimax',
    'v2',
    'sqlite',
    'runtime-state.sqlite',
  );
  return existsSync(p) ? p : null;
}

/**
 * MiniMax Code persiste usage por turno en `local_runtime_token_usage`.
 * `mavis` es el agente orquestador; explore/verifier/worker son subagentes.
 */
export function readMinimaxUsage(sinceMs = 0): {
  sessions: SessionUsage[];
  txns: TransactionUsage[];
} {
  const dbPath = minimaxDbPath();
  if (!dbPath) return { sessions: [], txns: [] };
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .prepare(
        `SELECT id, session_id, agent_name, turn_id, model, ts, input_tokens, output_tokens,
                reasoning_tokens, cache_read_tokens, cache_write_tokens, cost_usd
         FROM local_runtime_token_usage WHERE ts >= ? ORDER BY ts ASC`,
      )
      .all(sinceMs) as Array<{
      id: number;
      session_id: string;
      agent_name: string;
      turn_id: string | null;
      model: string | null;
      ts: number;
      input_tokens: number;
      output_tokens: number;
      reasoning_tokens: number;
      cache_read_tokens: number;
      cache_write_tokens: number;
      cost_usd: number | null;
    }>;
    const bySession = new Map<string, SessionUsage>();
    const txns: TransactionUsage[] = rows.map((r) => {
      const agent = r.agent_name && r.agent_name !== 'mavis' ? 'subagent' : 'orchestrator';
      const cur =
        bySession.get(r.session_id) ??
        ({
          sessionId: r.session_id,
          tokensInput: 0,
          tokensOutput: 0,
          tokensReasoning: 0,
          tokensCacheRead: 0,
          tokensCacheWrite: 0,
          cost: 0,
          model: r.model || 'MiniMax-M3',
          provider: 'minimax',
          timeUpdated: 0,
        } satisfies SessionUsage);
      cur.tokensInput += r.input_tokens;
      cur.tokensOutput += r.output_tokens;
      cur.tokensReasoning += r.reasoning_tokens;
      cur.tokensCacheRead += r.cache_read_tokens;
      cur.tokensCacheWrite += r.cache_write_tokens;
      cur.cost += r.cost_usd ?? 0;
      cur.timeUpdated = Math.max(cur.timeUpdated, r.ts);
      bySession.set(r.session_id, cur);
      return {
        sessionId: r.session_id,
        messageId: `minimax:${r.id}`,
        role: 'assistant',
        agent,
        model: r.model || 'MiniMax-M3',
        input: r.input_tokens,
        output: r.output_tokens,
        reasoning: r.reasoning_tokens,
        cacheRead: r.cache_read_tokens,
        cacheWrite: r.cache_write_tokens,
        cost: r.cost_usd ?? 0,
        timeCreated: r.ts,
      };
    });
    return { sessions: [...bySession.values()], txns };
  } finally {
    db.close();
  }
}

/** Pasada de ingesta completa. Devuelve resumen. */
export interface TransactionUsage {
  sessionId: string;
  messageId: string;
  role: string;
  agent: 'orchestrator' | 'subagent';
  model: string;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  timeCreated: number;
}

/**
 * Trazabilidad granular: lee los mensajes assistant con tokens reales de la
 * tabla `message` (data JSON) + jerarquía de sesiones (parent_id) para
 * distinguir orquestador (parent ROOT) de subagentes.
 */
export function readOpencodeTransactions(dbPath: string, sinceTimeCreated = 0): TransactionUsage[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    // jerarquía: session_id -> es subagente si parent_id != 'ROOT'
    const sessions = db.prepare(`SELECT id, parent_id FROM session`).all() as Array<{
      id: string;
      parent_id: string | null;
    }>;
    const agentOf = new Map<string, 'orchestrator' | 'subagent'>();
    for (const s of sessions) {
      agentOf.set(s.id, !s.parent_id || s.parent_id === 'ROOT' ? 'orchestrator' : 'subagent');
    }
    const rows = db
      .prepare(
        `SELECT id, session_id, data, time_created FROM message
         WHERE data LIKE '%assistant%' AND time_created >= ? ORDER BY time_created ASC`,
      )
      .all(sinceTimeCreated) as Array<{
      id: string;
      session_id: string;
      data: string;
      time_created: number;
    }>;
    const out: TransactionUsage[] = [];
    for (const r of rows) {
      try {
        const d = JSON.parse(r.data) as {
          role?: string;
          modelID?: string;
          cost?: number;
          tokens?: {
            input?: number;
            output?: number;
            reasoning?: number;
            cache?: { read?: number; write?: number };
          };
        };
        if (d.role !== 'assistant' || !d.tokens) continue;
        out.push({
          sessionId: r.session_id,
          messageId: r.id,
          role: d.role,
          agent: agentOf.get(r.session_id) ?? 'orchestrator',
          model: d.modelID || '',
          input: d.tokens.input ?? 0,
          output: d.tokens.output ?? 0,
          reasoning: d.tokens.reasoning ?? 0,
          cacheRead: d.tokens.cache?.read ?? 0,
          cacheWrite: d.tokens.cache?.write ?? 0,
          cost: d.cost ?? 0,
          timeCreated: r.time_created,
        });
      } catch {
        /* línea malformada */
      }
    }
    return out;
  } finally {
    db.close();
  }
}
