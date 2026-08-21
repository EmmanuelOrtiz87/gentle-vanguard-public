#!/usr/bin/env node
/**
 * Message Token Logger — registra de forma garantizada cada mensaje/turno
 * en Nexus: inserta en `token_usage` (segmentado prompt/completion) y en
 * `events` (event sourcing append-only, type='message.token_usage').
 *
 * Uso:
 *   npx tsx src/message-token-logger.ts \
 *     --session-id <sid> --input <n> --output <n> [--turn <label>] \
 *     [--model <model>] [--cost <usd>] [--quiet]
 *
 * La escritura es idempotente por turno (event_id derivado de turn+timestamp)
 * y no bloqueante: cualquier fallo de Nexus se registra en un log local sin
 * romper el flujo del stack.
 */

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);

const ROOT = path.resolve(process.cwd());
const RUNTIME_DIR = path.join(ROOT, '.runtime');
const SESSION_DIR = path.join(ROOT, '.session');
const NEXUS_DB_PATH = path.join(RUNTIME_DIR, 'gentle-vanguard.db');
const LOG_FILE = path.join(RUNTIME_DIR, 'message-token-logger.log');

function now(): string {
  return new Date().toISOString();
}

function log(msg: string, quiet: boolean): void {
  if (quiet) return;
  console.log(`[MESSAGE-TOKEN] ${msg}`);
}

function appendLog(msg: string): void {
  try {
    fs.appendFileSync(LOG_FILE, `${now()} ${msg}\n`, 'utf-8');
  } catch {
    /* ignore */
  }
}

function readSessionId(explicit: string): string {
  if (explicit) return explicit;
  const fp = path.join(SESSION_DIR, 'session-current.json');
  try {
    if (fs.existsSync(fp)) {
      const data = JSON.parse(fs.readFileSync(fp, 'utf-8')) as Record<string, unknown>;
      const sid = String(data.sessionId ?? data.id ?? '').trim();
      if (sid) return sid;
    }
  } catch {
    /* ignore */
  }
  return `session-${now().slice(0, 10).replace(/-/g, '')}`;
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') || argv[i].startsWith('-')) {
      const key = argv[i].replace(/^-+/, '');
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        args[key] = next;
        i++;
      } else {
        args[key] = 'true';
      }
    }
  }
  return args;
}

/**
 * Registra el mensaje en Nexus. Devuelve { recorded: boolean, reason?: string }.
 * - Inserta en token_usage (session_id, prompt_tokens, completion_tokens, cost, model)
 * - Inserta en events (type='message.token_usage', payload JSON con el desglose)
 */
export function recordMessage(opts: {
  sessionId: string;
  input: number;
  output: number;
  turn: string;
  model: string;
  cost: number;
}): { recorded: boolean; reason?: string; rowId?: number } {
  try {
    const Database = _require('better-sqlite3');
    if (!fs.existsSync(NEXUS_DB_PATH)) {
      return { recorded: false, reason: `Nexus DB not found at ${NEXUS_DB_PATH}` };
    }
    const db = new Database(NEXUS_DB_PATH);
    try {
      const insert = db.prepare(
        `INSERT INTO token_usage (session_id, prompt_tokens, completion_tokens, cost, model, timestamp)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      );
      const info = insert.run(
        opts.sessionId,
        opts.input,
        opts.output,
        opts.cost,
        opts.model || null,
      );
      const rowId = Number(info.lastInsertRowid);

      const payload = JSON.stringify({
        event: 'message.token_usage',
        session_id: opts.sessionId,
        input_tokens: opts.input,
        output_tokens: opts.output,
        total_tokens: opts.input + opts.output,
        cost_usd: opts.cost,
        model: opts.model || 'unknown',
        turn: opts.turn || 'message',
        token_usage_row_id: rowId,
        recorded_at: now(),
      });
      db.prepare('INSERT INTO events (type, payload) VALUES (?, ?)').run(
        'message.token_usage',
        payload,
      );

      return { recorded: true, rowId };
    } finally {
      db.close();
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    appendLog(`FAILED session=${opts.sessionId} turn=${opts.turn}: ${reason}`);
    return { recorded: false, reason };
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const quiet = args['quiet'] === 'true' || process.argv.slice(2).some((a) => a === '--quiet');

  const sessionId = readSessionId(args['session-id'] || args['SessionId'] || '');
  const input = Math.max(0, parseInt(args['input'] || args['InputTokens'] || '0', 10));
  const output = Math.max(0, parseInt(args['output'] || args['OutputTokens'] || '0', 10));
  const turn = args['turn'] || args['TurnLabel'] || 'message';
  const model = args['model'] || args['Model'] || 'unknown';
  const cost = parseFloat(args['cost'] || args['Cost'] || '0') || 0;

  if (input === 0 && output === 0) {
    log('skip (0 tokens)', quiet);
    return;
  }

  const result = recordMessage({ sessionId, input, output, turn, model, cost });

  if (result.recorded) {
    appendLog(
      `RECORDED session=${sessionId} in=${input} out=${output} total=${input + output} turn=${turn} row=${result.rowId}`,
    );
    log(
      `recorded session=${sessionId} in=${input} out=${output} total=${input + output} turn=${turn}`,
      quiet,
    );
  } else {
    log(`WARN not recorded: ${result.reason}`, quiet);
  }

  // Exit 0 always — non-blocking by design.
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
