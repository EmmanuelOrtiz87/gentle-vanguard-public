import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { nativeCompaction } from '../../../src/tokens/native-compaction.js';

function fixture(run: (dir: string, db: Database.Database, path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'gv-compaction-'));
  const path = join(dir, 'state.sqlite');
  const db = new Database(path);
  try {
    run(dir, db, path);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('OpenCode counts completed summaries, not requests or file-diff summary objects', () => {
  fixture((dir, db, path) => {
    db.exec(
      'CREATE TABLE session(id TEXT, directory TEXT); CREATE TABLE message(session_id TEXT, data TEXT); CREATE TABLE part(session_id TEXT, data TEXT);',
    );
    db.prepare('INSERT INTO session VALUES (?,?)').run('a', dir);
    const insert = db.prepare('INSERT INTO message VALUES (?,?)');
    insert.run(
      'a',
      JSON.stringify({ role: 'assistant', summary: true, time: { completed: 10 }, finish: 'stop' }),
    );
    insert.run(
      'a',
      JSON.stringify({ role: 'assistant', summary: { files: 1 }, time: { completed: 11 } }),
    );
    insert.run(
      'a',
      JSON.stringify({
        role: 'assistant',
        summary: true,
        error: { name: 'failed' },
        time: { completed: 12 },
      }),
    );
    db.prepare('INSERT INTO part VALUES (?,?)').run('a', JSON.stringify({ type: 'compaction' }));
    const result = nativeCompaction('OpenCode', dir, path);
    assert.equal(result.completed, 1);
    assert.equal(result.requested, 1);
    assert.equal(result.last?.at, 10);
    assert.equal(result.status, 'observed');
    assert.equal(nativeCompaction('OpenCode', join(dir, 'other'), path).completed, 0);
  });
});

test('ZCode distinguishes completed/failed/interrupted and prefers true post count', () => {
  fixture((dir, db, path) => {
    db.exec(
      'CREATE TABLE session(id TEXT,directory TEXT); CREATE TABLE part(session_id TEXT,data TEXT);',
    );
    db.prepare('INSERT INTO session VALUES (?,?)').run('a', dir);
    const insert = db.prepare('INSERT INTO part VALUES (?,?)');
    for (const [status, at] of [
      ['completed', 10],
      ['failed', 20],
      ['interrupted', 30],
    ] as const) {
      insert.run(
        'a',
        JSON.stringify({
          type: 'timeline',
          timelineType: 'context_compaction',
          status,
          preCompactTokenCount: 619176,
          postCompactTokenCount: 566201,
          truePostCompactTokenCount: 39157,
          time: { end: at },
        }),
      );
    }
    insert.run('a', JSON.stringify({ type: 'compaction' }));
    const result = nativeCompaction('ZCode', dir, path);
    assert.equal(result.completed, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.interrupted, 1);
    assert.deepEqual(result.last, { at: 10, beforeTokens: 619176, afterTokens: 39157 });
  });
});

test('MiniMax follows native history directory, skips corrupt lines and never returns summaries', () => {
  fixture((dir, db, path) => {
    db.exec(
      'CREATE TABLE local_runtime_sessions(workspace_dir TEXT,project_workspace_dir TEXT,history_relative_dir TEXT,updated_at_ms INTEGER);',
    );
    const history = join(dir, 'sessions');
    mkdirSync(join(history, 'safe'), { recursive: true });
    db.prepare('INSERT INTO local_runtime_sessions VALUES (?,?,?,?)').run(dir, '', 'safe', 1);
    writeFileSync(
      join(history, 'safe', 'messages.jsonl'),
      'broken\n' +
        JSON.stringify({
          message: {
            role: 'compactionSummary',
            summary: 'PRIVATE CONTENT',
            tokensBefore: 366047,
            timestamp: 10,
          },
        }) +
        '\n' +
        JSON.stringify({ message: { role: 'compactionSummary', summary: '', timestamp: 20 } }),
    );
    const result = nativeCompaction('MiniMax Code', dir, path, history);
    assert.equal(result.completed, 1);
    assert.equal(result.last?.beforeTokens, 366047);
    assert.equal(result.last?.afterTokens, null);
    assert.equal(JSON.stringify(result).includes('PRIVATE CONTENT'), false);
    db.prepare('UPDATE local_runtime_sessions SET history_relative_dir=?').run('../outside');
    assert.equal(nativeCompaction('MiniMax Code', dir, path, history).status, 'unknown');
  });
});

test('missing, corrupt or incompatible stores are unknown; valid empty evidence is not-observed', () => {
  fixture((dir, db, path) => {
    assert.equal(nativeCompaction('OpenCode', dir, path).status, 'unknown');
    assert.equal(nativeCompaction('ZCode', dir, join(dir, 'missing')).status, 'unknown');
    const broken = join(dir, 'broken');
    writeFileSync(broken, 'not a database');
    assert.equal(nativeCompaction('MiniMax Code', dir, broken).status, 'unknown');
    db.exec(
      'CREATE TABLE session(id TEXT,directory TEXT); CREATE TABLE message(session_id TEXT,data TEXT); CREATE TABLE part(session_id TEXT,data TEXT);',
    );
    assert.equal(nativeCompaction('OpenCode', dir, path).status, 'not-observed');
  });
});
