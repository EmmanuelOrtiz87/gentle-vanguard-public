import type Database from 'better-sqlite3';

/** Format a date using the machine's local calendar, matching token_usage timestamps. */
export function getLocalDayKey(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Sum real token usage for a local calendar day. */
export function readDailyTokenTotal(db: Database.Database, dayKey = getLocalDayKey()): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS total
       FROM token_usage WHERE date(timestamp) = ?`,
    )
    .get(dayKey) as { total?: number } | undefined;
  return Number(row?.total ?? 0) || 0;
}
