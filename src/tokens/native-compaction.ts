/** Read-only native evidence. Historical compaction is not proof of current config application. */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import Database from 'better-sqlite3';

type NativeTool = 'OpenCode' | 'ZCode' | 'MiniMax Code';
export interface CompactionEvidence {
  tool: NativeTool;
  status: 'observed' | 'not-observed' | 'unknown';
  scope: 'workspace-history';
  completed: number;
  requested: number;
  failed: number;
  interrupted: number;
  last: { at: number | null; beforeTokens: number | null; afterTokens: number | null } | null;
  detail: string;
}

const numeric = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const matches = (workspace: string, root: string) =>
  normalize(workspace) === normalize(root) ||
  normalize(workspace).startsWith(`${normalize(root)}/`);

export function nativeCompaction(
  tool: NativeTool,
  root: string,
  dbPath: string | null,
  historyRoot?: string,
): CompactionEvidence {
  const result: CompactionEvidence = {
    tool,
    status: 'unknown',
    scope: 'workspace-history',
    completed: 0,
    requested: 0,
    failed: 0,
    interrupted: 0,
    last: null,
    detail: 'almacén ausente, ilegible o esquema incompatible',
  };
  if (!dbPath || !existsSync(dbPath)) return result;
  let db: Database.Database | undefined;
  const complete = (at: unknown, before: unknown = null, after: unknown = null) => {
    result.completed++;
    const time = numeric(at);
    if (!result.last || (time ?? -1) > (result.last.at ?? -1)) {
      result.last = { at: time, beforeTokens: numeric(before), afterTokens: numeric(after) };
    }
  };
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    if (tool === 'MiniMax Code') {
      if (!historyRoot) return result;
      const sessions = db
        .prepare(
          `SELECT workspace_dir, project_workspace_dir, history_relative_dir
        FROM local_runtime_sessions ORDER BY updated_at_ms DESC`,
        )
        .iterate() as Iterable<{
        workspace_dir: string | null;
        project_workspace_dir: string | null;
        history_relative_dir: string | null;
      }>;
      let unreadable = false;
      for (const session of sessions) {
        const workspace = session.workspace_dir || session.project_workspace_dir;
        if (!workspace || !matches(workspace, root)) continue;
        if (!session.history_relative_dir) {
          unreadable = true;
          continue;
        }
        const directory = resolve(historyRoot, session.history_relative_dir);
        const rel = relative(resolve(historyRoot), directory);
        if (rel.startsWith('..') || isAbsolute(rel)) {
          unreadable = true;
          continue;
        }
        const path = join(directory, 'messages.jsonl');
        try {
          // Bound synchronous reads; an oversized/unavailable store must never imply zero events.
          if (statSync(path).size > 32 * 1024 * 1024) {
            unreadable = true;
            continue;
          }
          for (const line of readFileSync(path, 'utf8').split('\n')) {
            if (!line.includes('compactionSummary')) continue;
            try {
              const entry = JSON.parse(line);
              const message = entry.message ?? entry;
              if (
                message.role === 'compactionSummary' &&
                typeof message.summary === 'string' &&
                message.summary.trim()
              ) {
                complete(message.timestamp, message.tokensBefore);
              }
            } catch {
              unreadable = true;
            }
          }
        } catch {
          unreadable = true;
        }
      }
      if (unreadable && !result.completed) return result;
      if (unreadable) result.detail = 'evidencia parcial: algunos historiales no son legibles';
    } else {
      const sessions = db.prepare('SELECT id, directory FROM session').all() as Array<{
        id: string;
        directory: string;
      }>;
      const ids = sessions
        .filter((s) => s.directory && matches(s.directory, root))
        .map((s) => s.id);
      const parts = db.prepare(`SELECT json_extract(data,'$.type') AS type,
        json_extract(data,'$.timelineType') AS timeline,
        json_extract(data,'$.status') AS status,
        json_extract(data,'$.time.end') AS at,
        json_extract(data,'$.preCompactTokenCount') AS before_tokens,
        COALESCE(json_extract(data,'$.truePostCompactTokenCount'), json_extract(data,'$.postCompactTokenCount')) AS after_tokens
        FROM part WHERE session_id=? AND json_valid(data)
        AND (json_extract(data,'$.type')='compaction' OR json_extract(data,'$.timelineType')='context_compaction')`);
      const summaries =
        tool === 'OpenCode'
          ? db.prepare(`SELECT json_extract(data,'$.time.completed') AS at
        FROM message WHERE session_id=? AND json_valid(data)
        AND json_type(data,'$.summary')='true' AND json_extract(data,'$.role')='assistant'
        AND json_extract(data,'$.time.completed') IS NOT NULL
        AND json_extract(data,'$.error') IS NULL`)
          : null;
      for (const id of ids) {
        for (const row of parts.iterate(id) as Iterable<Record<string, unknown>>) {
          if (row.type === 'compaction') result.requested++;
          if (tool === 'ZCode' && row.timeline === 'context_compaction') {
            if (row.status === 'completed') complete(row.at, row.before_tokens, row.after_tokens);
            if (row.status === 'failed') result.failed++;
            if (row.status === 'interrupted') result.interrupted++;
          }
        }
        if (summaries)
          for (const row of summaries.iterate(id) as Iterable<{ at: unknown }>) complete(row.at);
      }
    }
    result.status = result.completed ? 'observed' : 'not-observed';
    if (!result.detail.startsWith('evidencia parcial'))
      result.detail = result.completed
        ? 'compactaciones históricas completadas; no acredita carga del perfil actual ni usage total'
        : 'sin compactaciones completadas en la evidencia disponible; no implica desactivación';
    return result;
  } catch {
    return result;
  } finally {
    db?.close();
  }
}
