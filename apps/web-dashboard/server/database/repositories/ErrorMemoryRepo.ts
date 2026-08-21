import Database from 'better-sqlite3';

export class ErrorMemoryRepo {
  constructor(private db: Database.Database) {}

  saveErrorMemory(data: {
    bug: string;
    rootCause: string;
    fix: string;
    file?: string;
    pattern?: string;
    severity?: string;
    sessionId?: string;
  }): number {
    const result = this.db
      .prepare(
        `INSERT INTO error_memory (bug, root_cause, fix, file, pattern, severity, session_id, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        data.bug,
        data.rootCause,
        data.fix,
        data.file ?? null,
        data.pattern ?? null,
        data.severity ?? 'medium',
        data.sessionId ?? null,
      );
    console.log(
      `[DB] Error memory saved: "${data.bug.substring(0, 60)}..." (id=${result.lastInsertRowid})`,
    );
    return Number(result.lastInsertRowid);
  }

  findErrorsByFile(file: string): Array<Record<string, unknown>> {
    return this.db
      .prepare('SELECT * FROM error_memory WHERE file = ? ORDER BY created_at DESC LIMIT 10')
      .all(file) as any[];
  }

  findErrorsByPattern(pattern: string): Array<Record<string, unknown>> {
    return this.db
      .prepare('SELECT * FROM error_memory WHERE pattern = ? ORDER BY created_at DESC LIMIT 10')
      .all(pattern) as any[];
  }

  searchErrors(keyword: string, limit = 5): Array<Record<string, unknown>> {
    const like = `%${keyword}%`;
    return this.db
      .prepare(
        `SELECT * FROM error_memory
                WHERE bug LIKE ? OR root_cause LIKE ? OR fix LIKE ? OR file LIKE ?
                ORDER BY created_at DESC LIMIT ?`,
      )
      .all(like, like, like, like, limit) as any[];
  }

  getRecentErrors(limit = 20): Array<Record<string, unknown>> {
    return this.db
      .prepare('SELECT * FROM error_memory ORDER BY updated_at DESC LIMIT ?')
      .all(limit) as any[];
  }

  getErrorById(id: number): Record<string, unknown> | null {
    return (this.db.prepare('SELECT * FROM error_memory WHERE id = ?').get(id) as any) ?? null;
  }

  pruneErrorMemory(days = 365): number {
    return this.db
      .prepare(`DELETE FROM error_memory WHERE created_at < datetime('now', ? || ' days')`)
      .run(`-${days}`).changes;
  }
}
