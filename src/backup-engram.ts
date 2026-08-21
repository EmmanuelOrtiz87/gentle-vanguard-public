#!/usr/bin/env node
/**
 * Backup, restore, verify y status de memoria persistente Engram.
 * TS migration of scripts/utilities/ops/BACKUP-RESTORE/backup-engram.ps1
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  copyFileSync,
  writeFileSync,
  statSync,
} from 'fs';
import { join, resolve } from 'path';
import { runNpxTsxSync } from './core/run-command.js';
import { createHash } from 'crypto';
import { pathToFileURL } from 'url';
import { getEffectiveProcessTimeout } from './core/timeout-config';

const ROOT = resolve(process.cwd());

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
const engramDir = join(root, '.engram');
const backupLogFile = join(root, 'logs', 'engram-backup.log');

function log(msg: string, level: string, quiet: boolean): void {
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

function sha256File(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

function newChecksumFile(dir: string): number {
  const lines: string[] = [];
  function walk(current: string): void {
    for (const e of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        const hash = sha256File(full);
        const rel = full.slice(dir.length + 1);
        lines.push(`${hash} *${rel}`);
      }
    }
  }
  walk(dir);
  writeFileSync(join(dir, 'checksums.sha256'), lines.join('\n'), 'utf-8');
  return lines.length;
}

function invokeBackup(
  date: string,
  outputDir: string,
  integrityCheck: boolean,
  quiet: boolean,
): boolean {
  log('Starting Engram backup...', 'INFO', quiet);
  if (!existsSync(engramDir)) {
    log(`Engram directory not found: ${engramDir}`, 'ERR', quiet);
    return false;
  }

  const integrityScriptTs = join(root, 'src', 'engram-integrity-check.ts');
  const integrityScript = integrityScriptTs;

  if (integrityCheck && existsSync(integrityScript)) {
    const icChecksumPath = join(root, '.engram', 'checksums.sha256');
    if (!existsSync(icChecksumPath)) {
      log('Generating initial SHA256 checksums...', 'INFO', quiet);
      try {
        runNpxTsxSync(integrityScript, ['-Mode', 'checksums', '-Quiet'], {
          cwd: root,
          timeout: getEffectiveProcessTimeout('long_running'),
        });
      } catch {
        /* ignore */
      }
    }
    log('Pre-backup integrity check...', 'INFO', quiet);
    try {
      runNpxTsxSync(integrityScript, ['-Mode', 'check', '-Quiet'], {
        cwd: root,
        timeout: getEffectiveProcessTimeout('long_running'),
      });
      log('Pre-backup integrity PASSED', 'OK', quiet);
    } catch {
      log(
        `Integrity check FAILED — run repair first: ${integrityScript} -Mode repair`,
        'ERR',
        quiet,
      );
      return false;
    }
  }

  const dateStr = date || new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const backupDir = join(outputDir, dateStr);
  mkdirSync(backupDir, { recursive: true });

  // Engram v1.19+ uses chunks format (jsonl.gz) under .engram/
  let totalSizeKB = 0;
  let fileCount = 0;
  let chunksCount = 0;

  function countAndSize(d: string): void {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) {
        countAndSize(full);
        continue;
      }
      fileCount++;
      totalSizeKB += Math.round((statSync(full).size / 1024) * 10) / 10;
      if (e.name.endsWith('.jsonl.gz')) chunksCount++;
    }
  }
  countAndSize(engramDir);

  // Copy all files recursively
  function copyDir(src: string, dest: string): void {
    mkdirSync(dest, { recursive: true });
    for (const e of readdirSync(src, { withFileTypes: true })) {
      const s = join(src, e.name);
      const d = join(dest, e.name);
      if (e.isDirectory()) copyDir(s, d);
      else copyFileSync(s, d);
    }
  }
  copyDir(engramDir, backupDir);

  log(
    `Engram data backed up (${fileCount} files, ${chunksCount} chunks, ${Math.round(totalSizeKB)}KB total)`,
    'OK',
    quiet,
  );

  const csCount = newChecksumFile(backupDir);
  log(`SHA256 checksums generated (${csCount} files)`, 'OK', quiet);

  const manifest = {
    date: dateStr,
    totalFiles: fileCount,
    totalSizeKB: Math.round(totalSizeKB),
    chunksCount,
    checksumFiles: csCount,
    integrityCheckPassed: integrityCheck,
    engramVersion: '1.19.0',
    timestamp: new Date().toISOString(),
  };
  writeFileSync(join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  log(
    `Backup complete: ${fileCount} files, ${chunksCount} chunks, ${Math.round(totalSizeKB)}KB total, ${csCount} checksums`,
    'OK',
    quiet,
  );
  return true;
}

function main(): void {
  const args = process.argv.slice(2);
  const mode = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'backup';
  const date = args.includes('--date') ? args[args.indexOf('--date') + 1] : '';
  let outputDir = args.includes('--output-dir') ? args[args.indexOf('--output-dir') + 1] : '';
  const integrityCheck = !args.includes('--no-integrity-check');
  const quiet = args.includes('--quiet');

  if (!outputDir) outputDir = join(root, '.backups', 'engram');

  function countEngramFiles(dir: string): {
    fileCount: number;
    chunksCount: number;
    totalSizeKB: number;
  } {
    let fileCount = 0,
      chunksCount = 0,
      totalSizeKB = 0;
    function walk(d: string): void {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, e.name);
        if (e.isDirectory()) {
          walk(full);
          continue;
        }
        fileCount++;
        totalSizeKB += Math.round((statSync(full).size / 1024) * 10) / 10;
        if (e.name.endsWith('.jsonl.gz')) chunksCount++;
      }
    }
    if (existsSync(dir)) walk(dir);
    return { fileCount, chunksCount, totalSizeKB };
  }

  switch (mode) {
    case 'backup': {
      process.exit(invokeBackup(date, outputDir, integrityCheck, quiet) ? 0 : 1);
      break;
    }
    case 'status': {
      const backupDirs = existsSync(outputDir)
        ? readdirSync(outputDir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name)
            .sort()
            .reverse()
        : [];
      const srcStats = countEngramFiles(engramDir);
      if (quiet) {
        const latest = backupDirs[0] || 'none';
        const integrityOk =
          latest !== 'none' ? existsSync(join(outputDir, latest, 'checksums.sha256')) : false;
        console.log(
          `Backups:${backupDirs.length} Files:${srcStats.fileCount} Chunks:${srcStats.chunksCount} Integrity:${integrityOk}`,
        );
      } else {
        console.log(`\n=== Engram Backup Status ===`);
        console.log(
          `Source: ${engramDir} (${srcStats.fileCount} files, ${srcStats.chunksCount} chunks, ${Math.round(srcStats.totalSizeKB)}KB)`,
        );
        console.log(`Backups found: ${backupDirs.length}`);
        for (const d of backupDirs.slice(0, 10)) {
          const mPath = join(outputDir, d, 'manifest.json');
          if (existsSync(mPath)) {
            try {
              const m = JSON.parse(readFileSync(mPath, 'utf-8'));
              console.log(
                `  ${d}: ${m.totalSizeKB || '?'}KB, ${m.totalFiles || 0} files, ${m.chunksCount || 0} chunks`,
              );
            } catch {
              console.log(`  ${d}: manifest parse error`);
            }
          } else console.log(`  ${d}: no manifest`);
        }
      }
      process.exit(0);
      break;
    }
    default:
      console.error(`Unknown mode: ${mode}`);
      process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
