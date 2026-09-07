import Database from 'better-sqlite3';
import type { ContractResultRecord } from '../manager';

export class ContractRepo {
  constructor(private db: Database.Database) {}

  insertContractResult(
    contractId: string,
    status: string,
    sessionId?: string,
    result?: string,
    durationMs?: number,
  ): void {
    this.db
      .prepare(
        `INSERT INTO contract_results (contract_id, session_id, status, result, duration_ms, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(contractId, sessionId ?? null, status, result ?? null, durationMs ?? null);
  }

  getContractResultsBySession(sessionId: string): ContractResultRecord[] {
    return this.db
      .prepare('SELECT * FROM contract_results WHERE session_id = ? ORDER BY created_at DESC')
      .all(sessionId) as ContractResultRecord[];
  }
}
