#!/usr/bin/env node
/**
 * Backfill de atribución en `token_transactions`: completa `agent_name` de
 * subagentes históricos que se ingirieron sin nombre.
 *
 * Fuentes de nombre:
 *  - OpenCode: columna `agent` o sufijo `(@<agent> subagent)` del título de la
 *    sesión hija (parent_id != ROOT).
 *  - ZCode: `querySource`/sessionId de cada request en los rollouts JSONL.
 *  - MiniMax: el nombre nunca llegó al ledger (NULL en origen) → queda unknown.
 *
 * Uso:
 *   npm run token:backfill:attribution             # dry-run (solo reporta)
 *   npm run token:backfill:attribution -- --apply  # backup online + UPDATE
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { pathToFileURL } from 'url';
import { opencodeDbPath, opencodeSubagentName, readZcodeRollout } from './token-ingest/readers.js';
import { NEXUS_DB_PATH } from './token-budget-usage.js';

interface Update {
  source: string;
  key: string;
  agentName: string;
}

function collectOpencodeNames(): Update[] {
  const path = opencodeDbPath();
  if (!path) return [];
  const db = new Database(path, { readonly: true });
  try {
    const rows = db
      .prepare(
        `SELECT id, agent, title FROM session
         WHERE parent_id IS NOT NULL AND parent_id != 'ROOT'`,
      )
      .all() as Array<{ id: string; agent: string | null; title: string | null }>;
    const out: Update[] = [];
    for (const row of rows) {
      const name = opencodeSubagentName(row);
      if (name) out.push({ source: 'opencode', key: row.id, agentName: name });
    }
    return out;
  } finally {
    db.close();
  }
}

function collectZcodeNames(): Update[] {
  const { txns } = readZcodeRollout(0);
  return txns
    .filter((t) => t.agent === 'subagent' && t.agentName)
    .map((t) => ({ source: 'zcode', key: t.messageId, agentName: t.agentName as string }));
}

async function main(): Promise<void> {
  const apply = process.argv.slice(2).includes('--apply');
  if (!existsSync(NEXUS_DB_PATH)) {
    console.error(`Nexus DB no existe: ${NEXUS_DB_PATH}`);
    process.exitCode = 1;
    return;
  }
  const updates = [...collectOpencodeNames(), ...collectZcodeNames()];

  const db = new Database(NEXUS_DB_PATH);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  try {
    if (apply) {
      const backupPath = join(
        process.cwd(),
        '.runtime',
        'backups',
        `nexus-attribution-${timestamp}.db`,
      );
      mkdirSync(dirname(backupPath), { recursive: true });
      await db.backup(backupPath);
      console.log(`Backup online: ${backupPath}`);
    }

    const bySession = db.prepare(
      `UPDATE token_transactions SET agent_name = ?
       WHERE session_id = ? AND agent = 'subagent' AND (agent_name IS NULL OR agent_name = '')`,
    );
    const byMessage = db.prepare(
      `UPDATE token_transactions SET agent_name = ?
       WHERE message_id = ? AND agent = 'subagent' AND (agent_name IS NULL OR agent_name = '')`,
    );
    const countBySession = db.prepare(
      `SELECT COUNT(*) AS n FROM token_transactions
       WHERE session_id = ? AND agent = 'subagent' AND (agent_name IS NULL OR agent_name = '')`,
    );
    const countByMessage = db.prepare(
      `SELECT COUNT(*) AS n FROM token_transactions
       WHERE message_id = ? AND agent = 'subagent' AND (agent_name IS NULL OR agent_name = '')`,
    );

    const summary: Record<string, { candidates: number; updated: number }> = {};
    const bump = (source: string, updated: number): void => {
      const cur = summary[source] ?? { candidates: 0, updated: 0 };
      cur.candidates++;
      cur.updated += updated;
      summary[source] = cur;
    };

    const run = db.transaction(() => {
      for (const u of updates) {
        const opencode = u.source === 'opencode';
        const changes = apply
          ? (opencode ? bySession : byMessage).run(u.agentName, u.key).changes
          : ((opencode ? countBySession : countByMessage).get(u.key) as { n: number }).n;
        bump(u.source, changes);
      }
    });
    run();

    const unnamedSubagents = db
      .prepare(
        `SELECT CASE
           WHEN message_id LIKE 'zcode:%' THEN 'zcode'
           WHEN message_id LIKE 'codex:%' THEN 'codex'
           WHEN message_id LIKE 'minimax:%' THEN 'minimax'
           WHEN message_id LIKE 'claude:%' THEN 'claude'
           ELSE 'opencode' END AS source,
           COUNT(*) AS n
         FROM token_transactions
         WHERE agent = 'subagent' AND (agent_name IS NULL OR agent_name = '')
         GROUP BY source ORDER BY n DESC`,
      )
      .all() as Array<{ source: string; n: number }>;

    console.log(
      JSON.stringify(
        {
          mode: apply ? 'apply' : 'dry-run',
          updates: updates.length,
          bySource: summary,
          remainingUnnamed: unnamedSubagents,
        },
        null,
        2,
      ),
    );
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
