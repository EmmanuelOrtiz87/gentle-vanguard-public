import type Database from 'better-sqlite3';

/** Format a date using the machine's local calendar, matching token_usage timestamps. */
export function getLocalDayKey(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Real tokens for a local calendar day. token_usage is an aggregate of
 * token_transactions, so both sources are compared and the larger wins instead
 * of being added (which would double count).
 */
export function readDailyTokenTotal(db: Database.Database, dayKey = getLocalDayKey()): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS total
       FROM token_usage WHERE date(timestamp) = ?`,
    )
    .get(dayKey) as { total?: number } | undefined;
  const usage = Number(row?.total ?? 0) || 0;

  let transactions = 0;
  try {
    const hasTx = db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'token_transactions'`)
      .get();
    if (hasTx) {
      const tx = db
        .prepare(
          `SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS total
           FROM token_transactions WHERE date(created_at) = ?`,
        )
        .get(dayKey) as { total?: number } | undefined;
      transactions = Number(tx?.total ?? 0) || 0;
    }
  } catch {
    /* transactions table may lag schema — usage is still valid */
  }

  return Math.max(usage, transactions);
}
