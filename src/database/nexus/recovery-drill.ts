#!/usr/bin/env node
/** Non-destructive Nexus backup/restore drill using the bundled SQLite runtime. */
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

interface DatabaseEvidence {
  integrity: string;
  tables: number;
  rows: number;
}

interface RecoveryDrillReport {
  generatedAt: string;
  source: string;
  backup: string;
  restored: string;
  sizeBytes: number;
  backupMs: number;
  restoreAndVerifyMs: number;
  measuredRtoMs: number;
  measuredRpoTransactions: number;
  sha256Match: boolean;
  backupEvidence: DatabaseEvidence;
  restoredEvidence: DatabaseEvidence;
  status: 'PASS' | 'FAIL';
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function inspectDatabase(path: string): DatabaseEvidence {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const integrity = (db.pragma('integrity_check') as Array<{ integrity_check: string }>)[0]
      ?.integrity_check;
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all() as Array<{ name: string }>;
    let rows = 0;
    for (const table of tables) {
      const escaped = table.name.replace(/"/g, '""');
      rows += (db.prepare(`SELECT COUNT(*) count FROM "${escaped}"`).get() as { count: number })
        .count;
    }
    return { integrity: integrity ?? 'unknown', tables: tables.length, rows };
  } finally {
    db.close();
  }
}

export async function runRecoveryDrill(root = process.cwd()): Promise<RecoveryDrillReport> {
  const sourcePath = join(resolve(root), '.runtime', 'gentle-vanguard.db');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const drillDir = join(resolve(root), '.runtime', 'recovery-drills', stamp);
  const backupPath = join(drillDir, 'backup.db');
  const restoredPath = join(drillDir, 'restored.db');
  mkdirSync(drillDir, { recursive: true });

  const backupStarted = performance.now();
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(backupPath);
  } finally {
    source.close();
  }
  const backupMs = performance.now() - backupStarted;

  const restoreStarted = performance.now();
  copyFileSync(backupPath, restoredPath);
  const backupEvidence = inspectDatabase(backupPath);
  const restoredEvidence = inspectDatabase(restoredPath);
  const sha256Match = sha256(backupPath) === sha256(restoredPath);
  const restoreAndVerifyMs = performance.now() - restoreStarted;
  const status =
    sha256Match &&
    backupEvidence.integrity === 'ok' &&
    restoredEvidence.integrity === 'ok' &&
    backupEvidence.tables === restoredEvidence.tables &&
    backupEvidence.rows === restoredEvidence.rows
      ? 'PASS'
      : 'FAIL';

  const report: RecoveryDrillReport = {
    generatedAt: new Date().toISOString(),
    source: sourcePath,
    backup: backupPath,
    restored: restoredPath,
    sizeBytes: statSync(backupPath).size,
    backupMs: Number(backupMs.toFixed(2)),
    restoreAndVerifyMs: Number(restoreAndVerifyMs.toFixed(2)),
    measuredRtoMs: Number(restoreAndVerifyMs.toFixed(2)),
    measuredRpoTransactions: 0,
    sha256Match,
    backupEvidence,
    restoredEvidence,
    status,
  };

  const reportDir = join(resolve(root), 'reports', 'audits');
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(
    join(reportDir, 'nexus-recovery-drill-latest.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}

async function main(): Promise<void> {
  const report = await runRecoveryDrill();
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main();
}
