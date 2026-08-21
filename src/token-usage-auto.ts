#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { runNpxTsxSync } from './core/run-command.js';
import { createRequire } from 'module';
import { recordMessage } from './message-token-logger.js';
import { readSessionState, saveSessionState } from './core/session-context-log.js';

const _require = createRequire(import.meta.url);

// Lazy SQLite connection for Nexus DB dual-write
let _nexusDb: any = null;
function getNexusDb(): any {
  if (_nexusDb) return _nexusDb;
  try {
    const Database = _require('better-sqlite3');
    const dbPath = join(resolve(process.cwd()), '.runtime', 'gentle-vanguard.db');
    if (existsSync(dbPath)) {
      _nexusDb = new Database(dbPath);
      return _nexusDb;
    }
  } catch {
    // SQLite not available
  }
  return null;
}

function writeTokenToNexus(
  sessionId: string,
  promptTokens: number,
  completionTokens: number,
  model: string,
): void {
  try {
    const db = getNexusDb();
    if (db) {
      db.prepare(
        `INSERT INTO token_usage (session_id, prompt_tokens, completion_tokens, cost, model, timestamp)
         VALUES (?, ?, ?, 0, ?, datetime('now'))`,
      ).run(sessionId, promptTokens, completionTokens, model || null);
    }
  } catch {
    // Dual-write failure is non-critical
  }
}

export interface TokenUsageArgs {
  InputTokens?: number;
  OutputTokens?: number;
  ContextChars?: number;
  SessionId?: string;
  TurnLabel?: string;
  InputSummary?: string;
  OutputSummary?: string;
  ToolCalls?: string;
  Model?: string;
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('-')) {
      const key = arg.replace(/^-+/, '');
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

function findRepoRoot(start: string): string {
  const root = resolve(start);
  let current = root;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(current, 'config', 'orchestrator.json'))) return current;
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return root;
}

function main() {
  const raw = parseArgs(process.argv);
  const args: TokenUsageArgs = {
    InputTokens: raw['InputTokens'] ? parseInt(raw['InputTokens'], 10) : 0,
    OutputTokens: raw['OutputTokens'] ? parseInt(raw['OutputTokens'], 10) : 0,
    ContextChars: raw['ContextChars'] ? parseInt(raw['ContextChars'], 10) : 0,
    SessionId: raw['SessionId'] ?? '',
    TurnLabel: raw['TurnLabel'] ?? '',
    InputSummary: raw['InputSummary'] ?? '',
    OutputSummary: raw['OutputSummary'] ?? '',
    ToolCalls: raw['ToolCalls'] ?? '',
    Model: raw['Model'] ?? '',
  };

  const {
    ContextChars = 0,
    TurnLabel = '',
    InputSummary = '',
    OutputSummary = '',
    ToolCalls = '',
    Model = '',
  } = args;
  let { InputTokens = 0, OutputTokens = 0, SessionId = '' } = args;

  const ROOT = process.env.GENTLE_VANGUARD_BASE_DIR
    ? resolve(process.env.GENTLE_VANGUARD_BASE_DIR)
    : findRepoRoot(process.cwd());

  if (!SessionId) {
    const tokenFile = join(ROOT, '.session', 'token-usage.json');
    if (existsSync(tokenFile)) {
      try {
        const td = JSON.parse(readFileSync(tokenFile, 'utf8')) as Record<string, unknown>;
        if (typeof td.sessionId === 'string') SessionId = td.sessionId;
      } catch {
        // ignore parse errors
      }
    }
  }

  if (!SessionId) {
    const sessionDir = join(ROOT, '.session');
    if (existsSync(sessionDir)) {
      try {
        const files = readdirSync(sessionDir)
          .filter((f) => f.startsWith('session-') && f.endsWith('.json'))
          .sort()
          .reverse();
        if (files.length > 0) {
          const sd = JSON.parse(readFileSync(join(sessionDir, files[0]), 'utf8')) as Record<
            string,
            unknown
          >;
          if (typeof sd.sessionId === 'string') SessionId = sd.sessionId;
        }
      } catch {
        // ignore
      }
    }
  }

  // TS migration: token-usage-notifier.ps1 → src/token-usage-notifier.ts
  const notifierTs = join(ROOT, 'src', 'token-usage-notifier.ts');
  if (existsSync(notifierTs)) {
    if (InputTokens === 0 && OutputTokens === 0) {
      InputTokens = Math.max(1, Math.floor(ContextChars / 4));
      OutputTokens = Math.max(1, Math.floor(500 / 4));
    }
    runNpxTsxSync(
      notifierTs,
      [
        '-Action',
        'accumulate',
        '-InputTokens',
        String(InputTokens),
        '-OutputTokens',
        String(OutputTokens),
      ],
      {
        cwd: ROOT,
        stdio: 'ignore',
      },
    );
  }

  // TS migration: session-context-log.ps1 → src/core/session-context-log.ts
  try {
    const ctxDir = join(ROOT, '.session', 'context-log');
    if (!existsSync(ctxDir)) {
      import('fs').then(({ mkdirSync }) => mkdirSync(ctxDir, { recursive: true })).catch(() => {});
    }
    const prev = readSessionState(SessionId);
    const now = new Date().toISOString();
    const newState = {
      sessionId: SessionId,
      agent: Model || 'auto-detected',
      status: 'active' as const,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      totalTokens: (prev?.totalTokens ?? 0) + InputTokens + OutputTokens,
      totalCost: prev?.totalCost ?? 0,
      messageCount: (prev?.messageCount ?? 0) + 1,
      turns: [
        ...(prev?.turns ?? []),
        {
          inputTokens: InputTokens,
          outputTokens: OutputTokens,
          timestamp: now,
          message: TurnLabel || 'message',
          inputSummary: InputSummary || undefined,
          outputSummary: OutputSummary || undefined,
          toolCalls: ToolCalls || undefined,
        },
      ],
    };
    saveSessionState(newState);
  } catch {
    // Non-blocking by design
  }

  // Nexus DB dual-write: persist tokens to SQLite
  writeTokenToNexus(SessionId, InputTokens, OutputTokens, Model);

  // Message token logger: guaranteed per-message record in Nexus
  // (token_usage + events append-only) — in-process, non-blocking.
  try {
    if (InputTokens > 0 || OutputTokens > 0) {
      recordMessage({
        sessionId: SessionId,
        input: InputTokens,
        output: OutputTokens,
        turn: TurnLabel || 'message',
        model: Model || 'auto-detected',
        cost: 0,
      });
    }
  } catch {
    // Non-blocking by design
  }

  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
