#!/usr/bin/env node
/**
 * Backup, verify y status de la memoria persistente Engram.
 *
 * Contexto (auditoría 2026-11-18, P0-1): el backup histórico copiaba `.engram/`
 * — el export de chunks, ~6 MB — y nunca tocaba la base real (`~/.engram/
 * engram.db`, ~150 MB + WAL). Los 125 snapshots diarios en `.backups/engram/`
 * no contenían una sola observación: se reportaba "Backup complete" sin haber
 * respaldado la memoria. Este script hace un backup online del SQLite
 * (WAL-safe, con el daemon escribiendo), verifica `integrity_check` sobre la
 * copia y guarda el export de chunks como artefacto secundario.
 *
 * Modos: backup (default), verify, status.
 */
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveEngramDbPath } from '../knowledge/engram-paths.js';
import { runSync } from '../core/run-command.js';

const ROOT = resolve(process.cwd());
const FORMAT = 'sqlite-online-v1';

function findRepoRoot(dir: string): string {
  let current = resolve(dir);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(current, 'config', 'orchestrator.json'))) return current;
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return dir;
}

const root =
  process.env.GENTLE_VANGUARD_BASE_DIR && existsSync(process.env.GENTLE_VANGUARD_BASE_DIR)
    ? process.env.GENTLE_VANGUARD_BASE_DIR
    : findRepoRoot(ROOT);
const engramExportDir = join(root, '.engram');
const backupLogFile = join(root, 'logs', 'engram-backup.log');
const markerFile = join(root, '.runtime', 'engram-last-backup.json');

let quiet = false;

function log(msg: string, level: string): void {
  if (quiet && level !== 'ERR') return;
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  try {
    const dir = join(root, 'logs');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(backupLogFile, `[${ts}] [${level}] ${msg}\n`, { flag: 'a' });
  } catch {
    /* ignore */
  }
  const color = {
    INFO: '\x1b[36m',
    OK: '\x1b[32m',
    WARN: '\x1b[33m',
    ERR: '\x1b[31m',
    RESET: '\x1b[0m',
  } as Record<string, string>;
  console.log(`${color[level] || ''}[BACKUP::${level}] ${msg}${color.RESET || ''}`);
}

function localDateStr(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function writeChecksums(dir: string): number {
  const lines: string[] = [];
  function walk(current: string): void {
    for (const e of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name !== 'checksums.sha256') {
        lines.push(`${sha256File(full)} *${full.slice(dir.length + 1)}`);
      }
    }
  }
  walk(dir);
  writeFileSync(join(dir, 'checksums.sha256'), lines.join('\n'), 'utf-8');
  return lines.length;
}

function readCounts(dbPath: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    counts.observations = (
      db.prepare('SELECT count(*) c FROM observations WHERE deleted_at IS NULL').get() as {
        c: number;
      }
    ).c;
    counts.sessions = (db.prepare('SELECT count(*) c FROM sessions').get() as { c: number }).c;
    for (const [key, sql] of [
      ['relations', 'SELECT count(*) c FROM memory_relations'],
      ['prompts', 'SELECT count(*) c FROM user_prompts'],
    ] as const) {
      try {
        counts[key] = (db.prepare(sql).get() as { c: number }).c;
      } catch {
        /* tabla opcional según versión */
      }
    }
  } finally {
    db.close();
  }
  return counts;
}

function integrityCheck(dbPath: string): { ok: boolean; result: string } {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare('PRAGMA integrity_check').all() as Array<Record<string, unknown>>;
    const messages = rows.map((r) => String(Object.values(r)[0]));
    return { ok: messages.length === 1 && messages[0] === 'ok', result: messages.join('; ') };
  } finally {
    db.close();
  }
}

function copyTree(src: string, dest: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  mkdirSync(dest, { recursive: true });
  for (const e of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, e.name);
    const d = join(dest, e.name);
    if (e.isDirectory()) {
      const sub = copyTree(s, d);
      files += sub.files;
      bytes += sub.bytes;
    } else {
      copyFileSync(s, d);
      files++;
      bytes += statSync(d).size;
    }
  }
  return { files, bytes };
}

function writeMarker(data: Record<string, unknown>): void {
  try {
    mkdirSync(join(root, '.runtime'), { recursive: true });
    writeFileSync(markerFile, JSON.stringify(data, null, 2), 'utf-8');
  } catch {
    /* marker is telemetry, not the backup */
  }
}

async function backupDatabase(dbPath: string, dest: string): Promise<void> {
  const tmp = `${dest}.tmp`;
  if (existsSync(tmp)) rmSync(tmp, { force: true });
  const source = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(tmp);
  } finally {
    source.close();
  }
  if (existsSync(dest)) rmSync(dest, { force: true });
  renameSync(tmp, dest);
}

async function invokeBackup(dateArg: string, outputDir: string): Promise<boolean> {
  const dbPath = resolveEngramDbPath();
  if (!existsSync(dbPath)) {
    log(`Engram DB not found: ${dbPath} (ENGRAM_DATA_DIR/engram.db)`, 'ERR');
    writeMarker({ timestamp: new Date().toISOString(), status: 'FAILED', reason: 'db-not-found' });
    return false;
  }
  const sizeMB = Math.round(statSync(dbPath).size / 1024 / 1024);
  log(`Starting online backup of ${dbPath} (${sizeMB}MB, WAL included)...`, 'INFO');

  const dateStr = dateArg || localDateStr();
  const backupDir = join(outputDir, dateStr);
  mkdirSync(backupDir, { recursive: true });
  const destDb = join(backupDir, 'engram.db');

  const started = Date.now();
  await backupDatabase(dbPath, destDb);
  const dbBytes = statSync(destDb).size;
  log(`SQLite online backup written (${Math.round(dbBytes / 1024 / 1024)}MB)`, 'OK');

  const integrity = integrityCheck(destDb);
  if (!integrity.ok) {
    log(`Backup integrity_check FAILED: ${integrity.result}`, 'ERR');
    writeMarker({
      timestamp: new Date().toISOString(),
      status: 'FAILED',
      reason: 'integrity-check',
      detail: integrity.result,
      dateDir: dateStr,
    });
    return false;
  }
  log('Backup integrity_check PASSED', 'OK');

  const counts = readCounts(destDb);
  const sha256 = sha256File(destDb);

  let syncExport = { files: 0, bytes: 0 };
  if (existsSync(engramExportDir)) {
    syncExport = copyTree(engramExportDir, join(backupDir, 'sync-export'));
    log(
      `Sync export copied (${syncExport.files} files, ${Math.round(syncExport.bytes / 1024)}KB)`,
      'OK',
    );
  }

  const manifest = {
    format: FORMAT,
    date: dateStr,
    createdAt: new Date().toISOString(),
    source: dbPath,
    dbBytes,
    dbSha256: sha256,
    integrity: 'ok',
    counts,
    syncExport,
    engramVersion: readEngramVersion(),
    durationMs: Date.now() - started,
  };
  writeFileSync(join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  const checksums = writeChecksums(backupDir);

  writeMarker({
    timestamp: new Date().toISOString(),
    status: 'SUCCESS',
    dateDir: dateStr,
    dbBytes,
    dbSha256: sha256,
    counts,
  });
  log(
    `Backup complete: ${Math.round(dbBytes / 1024 / 1024)}MB DB, ${counts.observations ?? '?'} observaciones, ${checksums} checksums (${dateStr})`,
    'OK',
  );
  return true;
}

function readEngramVersion(): string {
  try {
    const r = runSync('engram', ['--version'], { timeout: 15_000, stdio: 'pipe' });
    return (r.stdout || '').trim().replace(/^engram\s+v?/, '') || 'unknown';
  } catch {
    return 'unknown';
  }
}

function latestBackups(outputDir: string): string[] {
  if (!existsSync(outputDir)) return [];
  return readdirSync(outputDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{8}$/.test(d.name))
    .map((d) => d.name)
    .sort()
    .reverse();
}

function verifyLatest(outputDir: string, dirArg: string): boolean {
  const dir = dirArg || latestBackups(outputDir)[0];
  if (!dir) {
    log('No dated backup to verify', 'ERR');
    return false;
  }
  const backupDir = join(outputDir, dir);
  const dbPath = join(backupDir, 'engram.db');
  const manifestPath = join(backupDir, 'manifest.json');
  if (!existsSync(dbPath) || !existsSync(manifestPath)) {
    log(`${dir}: missing engram.db or manifest.json`, 'ERR');
    return false;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
    dbSha256?: string;
    counts?: Record<string, number>;
  };
  const integrity = integrityCheck(dbPath);
  if (!integrity.ok) {
    log(`${dir}: integrity_check FAILED (${integrity.result})`, 'ERR');
    return false;
  }
  const sha256 = sha256File(dbPath);
  if (manifest.dbSha256 && manifest.dbSha256 !== sha256) {
    log(
      `${dir}: sha256 mismatch (manifest ${manifest.dbSha256.slice(0, 12)}…, file ${sha256.slice(0, 12)}…)`,
      'ERR',
    );
    return false;
  }
  log(
    `${dir}: OK (integrity ok, sha256 match, ${manifest.counts?.observations ?? '?'} observaciones)`,
    'OK',
  );
  return true;
}

function pruneBackups(outputDir: string, keep: number): void {
  const dirs = latestBackups(outputDir);
  for (const dir of dirs.slice(keep)) {
    const manifestPath = join(outputDir, dir, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as { format?: string };
      if (manifest.format !== FORMAT) continue;
      rmSync(join(outputDir, dir), { recursive: true, force: true });
      log(`Pruned old backup ${dir}`, 'INFO');
    } catch {
      /* unreadable manifest: keep the directory */
    }
  }
}

function invokeStatus(outputDir: string): void {
  const dbPath = resolveEngramDbPath();
  const dbOk = existsSync(dbPath);
  const dirs = latestBackups(outputDir);
  const latest = dirs[0];
  const legacy = existsSync(outputDir)
    ? readdirSync(outputDir, { withFileTypes: true }).filter((d) => {
        if (!d.isDirectory() || /^\d{8}$/.test(d.name)) return false;
        return !existsSync(join(outputDir, d.name, 'engram.db'));
      }).length
    : 0;

  console.log('\n=== Engram Backup Status ===');
  console.log(
    `Source: ${dbPath} (${dbOk ? `${Math.round(statSync(dbPath).size / 1024 / 1024)}MB` : 'NOT FOUND'})`,
  );
  console.log(`Dated SQLite backups: ${dirs.length}${latest ? ` (latest ${latest})` : ''}`);
  for (const dir of dirs.slice(0, 5)) {
    const manifestPath = join(outputDir, dir, 'manifest.json');
    if (!existsSync(manifestPath)) {
      console.log(`  ${dir}: no manifest`);
      continue;
    }
    try {
      const m = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
        dbBytes?: number;
        counts?: Record<string, number>;
        createdAt?: string;
        format?: string;
      };
      if (m.format !== FORMAT) {
        console.log(`  ${dir}: legacy manifest (no DB snapshot)`);
        continue;
      }
      const ageDays = Math.floor((Date.now() - Date.parse(m.createdAt ?? '')) / 86_400_000);
      console.log(
        `  ${dir}: ${Math.round((m.dbBytes ?? 0) / 1024 / 1024)}MB, ${m.counts?.observations ?? '?'} observaciones, hace ${ageDays}d`,
      );
    } catch {
      console.log(`  ${dir}: manifest parse error`);
    }
  }
  if (legacy > 0) {
    console.log(
      `Legacy chunk-only backups (sin DB, no verificables): ${legacy} — candidatos a limpieza manual`,
    );
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const flag = (name: string, fallback = '') => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
  };
  const mode = flag('--mode', 'backup');
  quiet = args.includes('--quiet');
  const outputDir = resolve(flag('--output-dir', join(root, '.backups', 'engram')));

  switch (mode) {
    case 'backup': {
      const ok = await invokeBackup(flag('--date', ''), outputDir);
      if (ok && args.includes('--prune')) {
        pruneBackups(outputDir, Number(flag('--keep', '7')) || 7);
      }
      return ok ? 0 : 1;
    }
    case 'verify':
      return verifyLatest(outputDir, flag('--dir', '')) ? 0 : 1;
    case 'status':
      invokeStatus(outputDir);
      return 0;
    default:
      console.error(`Unknown mode: ${mode}`);
      return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().then((code) => process.exit(code));
}
