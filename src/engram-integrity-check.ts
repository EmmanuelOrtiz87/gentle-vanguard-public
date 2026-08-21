#!/usr/bin/env node
/**
 * Engram Integrity Check — Verifies and repairs Engram memory system integrity.
 *
 * Modes: check, repair, checksums, status
 * - check: Full 5-point integrity verification (manifest, DB, checksums, chunks, backups)
 * - repair: Auto-repair missing checksums, chunks dir, manifest
 * - checksums: Regenerate SHA256 checksums
 * - status: Lightweight summary
 *
 * Migrated from: scripts/utilities/memory/ENGRAM/engram-integrity-check.ps1
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  openSync,
  readSync,
  closeSync,
} from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { createHash } from 'crypto';

const ROOT = resolve(process.cwd());

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('-')) {
      const key = arg.slice(1);
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        args[key] = next;
        i++;
      } else {
        args[key] = 'true';
      }
    }
  }
  return args;
}

let quiet = false;
let exitCode = 0;

function log(msg: string, status: 'INFO' | 'OK' | 'WARN' | 'ERR' | 'FATAL' = 'INFO') {
  if (quiet && status !== 'ERR') return;
  const colors: Record<string, string> = {
    INFO: '\x1b[36m',
    OK: '\x1b[32m',
    WARN: '\x1b[33m',
    ERR: '\x1b[31m',
    FATAL: '\x1b[35m',
  };
  console.log(`${colors[status] ?? ''}[INTEGRITY::${status}] ${msg}\x1b[0m`);
}

function writeResult(test: string, result: 'PASS' | 'FAIL') {
  const icon = result === 'PASS' ? '\x1b[32m[OK]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
  console.log(`  ${icon} ${test}`);
  if (result !== 'PASS') exitCode = 1;
}

function sha256(filePath: string): string {
  const data = readFileSync(filePath);
  return createHash('sha256').update(data).digest('hex').toUpperCase();
}

// ===== Checksums =====

function newChecksums(engramDir: string, _dbPath: string, checksumPath: string): string[] {
  log('Generating SHA256 checksums...', 'INFO');
  const checksums: string[] = [];
  const chunksDir = join(engramDir, 'chunks');
  if (existsSync(chunksDir)) {
    for (const f of readdirSync(chunksDir).filter((f) => f.endsWith('.jsonl.gz'))) {
      const hash = sha256(join(chunksDir, f));
      checksums.push(`${hash} *chunks/${f}`);
    }
  }
  // Also checksum the manifest (exclude checksums.sha256 to avoid self-reference loop)
  const manifestPath = join(engramDir, 'manifest.json');
  if (existsSync(manifestPath)) {
    const hash = sha256(manifestPath);
    checksums.push(`${hash} *manifest.json`);
  }
  writeFileSync(checksumPath, checksums.join('\n') + '\n', 'utf-8');
  log(`Checksums written: ${checksums.length} files`, 'OK');
  return checksums;
}

function verifyChecksums(engramDir: string, _dbPath: string, checksumPath: string): boolean {
  log('Verifying checksums...', 'INFO');
  if (!existsSync(checksumPath)) {
    log(`No checksums file found at ${checksumPath}`, 'WARN');
    writeResult('Checksums file exists', 'FAIL');
    return false;
  }
  let errors = 0;
  let verified = 0;
  const lines = readFileSync(checksumPath, 'utf-8')
    .split('\n')
    .filter((l) => l.trim());
  for (const line of lines) {
    const match = line.match(/^([0-9a-fA-F]{64}) \*(\S+)$/);
    if (match) {
      const [, expectedHash, fileName] = match;
      // Files are stored as chunks/<name> or just <name> (manifest)
      // Handle both old format (just filename) and new format (chunks/ prefix)
      const filePath = fileName.startsWith('chunks/')
        ? join(engramDir, fileName)
        : fileName.endsWith('.jsonl.gz')
          ? join(engramDir, 'chunks', fileName)
          : join(engramDir, fileName);
      if (existsSync(filePath)) {
        const actualHash = sha256(filePath);
        if (actualHash === expectedHash) {
          verified++;
        } else {
          log(`Hash MISMATCH: ${fileName}`, 'ERR');
          writeResult(`Checksum: ${fileName}`, 'FAIL');
          errors++;
        }
      } else {
        log(`File not found: ${fileName}`, 'ERR');
        writeResult(`File exists: ${fileName}`, 'FAIL');
        errors++;
      }
    }
  }
  if (errors === 0) {
    log(`All ${verified} checksums verified OK`, 'OK');
    writeResult('Checksum integrity', 'PASS');
    return true;
  }
  log(`${errors} checksum mismatches found`, 'ERR');
  return false;
}

// ===== Manifest =====

function verifyManifest(engramDir: string, manifestPath: string): boolean {
  log('Verifying manifest...', 'INFO');
  if (!existsSync(manifestPath)) {
    log('Manifest not found', 'WARN');
    writeResult('Manifest exists', 'FAIL');
    return false;
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    let valid = manifest.version === 1 && Array.isArray(manifest.chunks);
    if (valid) {
      const chunksDir = join(engramDir, 'chunks');
      for (const chunk of manifest.chunks) {
        const chunkPath = join(chunksDir, `${chunk.id}.jsonl.gz`);
        if (!existsSync(chunkPath)) {
          log(`Manifest references missing chunk: ${chunk.id}`, 'WARN');
          writeResult(`Chunk ${chunk.id} exists`, 'FAIL');
          valid = false;
        }
      }
    }
    if (valid) {
      writeResult('Manifest integrity', 'PASS');
    } else {
      log('Manifest validation failed', 'ERR');
    }
    return valid;
  } catch (e: unknown) {
    log(`Manifest parse error: ${e instanceof Error ? e.message : String(e)}`, 'ERR');
    writeResult('Manifest is valid JSON', 'FAIL');
    return false;
  }
}

// ===== Chunks Verification (Engram v1.19+ uses jsonl.gz chunks, not SQLite) =====

function verifyChunksIntegrity(engramDir: string): boolean {
  log('Verifying chunks data...', 'INFO');
  const chunksDir = join(engramDir, 'chunks');
  if (!existsSync(chunksDir)) {
    log('Chunks directory not found', 'WARN');
    writeResult('Chunks directory exists', 'FAIL');
    return false;
  }
  const chunkFiles = readdirSync(chunksDir).filter((f) => f.endsWith('.jsonl.gz'));
  if (chunkFiles.length === 0) {
    log('No chunk files found', 'WARN');
    writeResult('Chunks have content', 'FAIL');
    return false;
  }
  let validCount = 0;
  let totalSize = 0;
  for (const f of chunkFiles) {
    const fp = join(chunksDir, f);
    try {
      const st = statSync(fp);
      totalSize += st.size;
      // Verify gzip magic header (0x1f 0x8b)
      const fd = openSync(fp, 'r');
      const header = Buffer.alloc(2);
      readSync(fd, header, 0, 2, 0);
      closeSync(fd);
      if (header[0] === 0x1f && header[1] === 0x8b) {
        validCount++;
      } else {
        log(`Invalid gzip header in ${f}`, 'WARN');
      }
    } catch {
      log(`Cannot read ${f}`, 'WARN');
    }
  }
  const totalKB = (totalSize / 1024).toFixed(1);
  if (validCount === chunkFiles.length) {
    writeResult(`Chunks (${chunkFiles.length} files, ${totalKB}KB)`, 'PASS');
    return true;
  }
  writeResult(`Chunks integrity (${validCount}/${chunkFiles.length} valid)`, 'FAIL');
  return false;
}

// ===== Full Check =====

function invokeIntegrityCheck(
  engramDir: string,
  dbPath: string,
  checksumPath: string,
  manifestPath: string,
  backupDir: string,
): boolean {
  log('=== Full Integrity Check ===', 'INFO');
  let allPass = true;

  log('1) Manifest', 'INFO');
  if (!verifyManifest(engramDir, manifestPath)) allPass = false;

  log('2) Chunks data integrity', 'INFO');
  if (!verifyChunksIntegrity(engramDir)) allPass = false;

  log('3) Checksums', 'INFO');
  if (existsSync(checksumPath)) {
    if (!verifyChecksums(engramDir, dbPath, checksumPath)) allPass = false;
  } else {
    log('No checksums file  --  run with -Mode checksums to create', 'WARN');
  }

  log('4) Chunks directory', 'INFO');
  const chunksDir = join(engramDir, 'chunks');
  if (!existsSync(chunksDir)) {
    log('Chunks directory missing', 'WARN');
    writeResult('Chunks directory', 'FAIL');
    allPass = false;
  } else {
    const chunkCount = readdirSync(chunksDir).filter((f) => f.endsWith('.jsonl.gz')).length;
    if (chunkCount > 0) {
      writeResult(`Chunks directory (${chunkCount} files)`, 'PASS');
    } else {
      log('Chunks directory is empty', 'WARN');
      writeResult('Chunks have content', 'FAIL');
      allPass = false;
    }
  }

  log('5) Backup verification', 'INFO');
  if (existsSync(backupDir)) {
    const backupDirs = readdirSync(backupDir).filter((f) => {
      try {
        return statSync(join(backupDir, f)).isDirectory();
      } catch {
        return false;
      }
    });
    if (backupDirs.length > 0) {
      const latestBackup = backupDirs.sort().reverse()[0];
      const latestPath = join(backupDir, latestBackup);
      // Support both old format (.db) and new format (.jsonl.gz chunks)
      // Check for chunks in root or chunks/ subdirectory (new format)
      const chunkFilesRoot = readdirSync(latestPath).filter((f) => f.endsWith('.jsonl.gz'));
      const chunksSubDir = join(latestPath, 'chunks');
      const chunkFilesSub = existsSync(chunksSubDir)
        ? readdirSync(chunksSubDir).filter((f) => f.endsWith('.jsonl.gz'))
        : [];
      const chunkFiles = chunkFilesRoot.length > 0 ? chunkFilesRoot : chunkFilesSub;
      if (chunkFiles.length > 0) {
        const totalSize = chunkFiles.reduce(
          (sum, f) =>
            sum + statSync(join(chunkFilesSub.length > 0 ? chunksSubDir : latestPath, f)).size,
          0,
        );
        writeResult(
          `Latest backup (${latestBackup}, ${Math.round(totalSize / 1024)}KB, ${chunkFiles.length} chunks)`,
          'PASS',
        );
      } else {
        const dbFiles = readdirSync(latestPath).filter((f) => f.endsWith('.db'));
        if (dbFiles.length > 0) {
          const totalSize = dbFiles.reduce((sum, f) => sum + statSync(join(latestPath, f)).size, 0);
          writeResult(
            `Latest backup (${latestBackup}, legacy ${Math.round(totalSize / 1024)}KB db)`,
            'PASS',
          );
        } else {
          log('Latest backup may be incomplete', 'WARN');
          writeResult('Backup integrity', 'FAIL');
          allPass = false;
        }
      }
    }
  } else {
    log('No backup directory found', 'WARN');
    writeResult('Backup exists', 'FAIL');
  }

  if (allPass) {
    log('INTEGRITY: ALL PASS', 'OK');
  } else {
    log(`INTEGRITY: ${exitCode} FAILURES DETECTED`, 'ERR');
  }
  return allPass;
}

// ===== Auto-Repair =====

function invokeAutoRepair(
  engramDir: string,
  dbPath: string,
  checksumPath: string,
  manifestPath: string,
): number {
  log('Attempting auto-repair...', 'WARN');
  let repairs = 0;

  if (!existsSync(checksumPath)) {
    log('Generating new checksums...', 'INFO');
    newChecksums(engramDir, dbPath, checksumPath);
    repairs++;
  }

  const chunksDir = join(engramDir, 'chunks');
  if (!existsSync(chunksDir)) {
    mkdirSync(chunksDir, { recursive: true });
    log('Created missing chunks directory', 'OK');
    repairs++;
  }

  let manifestExists = false;
  if (existsSync(manifestPath)) {
    try {
      JSON.parse(readFileSync(manifestPath, 'utf-8'));
      manifestExists = true;
    } catch {
      /* broken manifest */
    }
  }
  if (!manifestExists) {
    writeFileSync(manifestPath, JSON.stringify({ version: 1, chunks: [] }, null, 2));
    log('Rebuilt manifest', 'OK');
    repairs++;
  }

  if (repairs > 0) {
    log(`Auto-repair completed: ${repairs} fixes`, 'OK');
  } else {
    log('No repairs needed', 'INFO');
  }
  return repairs;
}

// ===== Status =====

function invokeStatus(engramDir: string, dbPath: string, checksumPath: string, backupDir: string) {
  log('=== Engram Integrity Status ===', 'INFO');
  const chunksDir = join(engramDir, 'chunks');
  const chunkCount = existsSync(chunksDir)
    ? readdirSync(chunksDir).filter((f) => f.endsWith('.jsonl.gz')).length
    : 0;
  const dbOk = existsSync(dbPath);
  const dbSize = dbOk ? `${(statSync(dbPath).size / 1024).toFixed(0)}` : 'N/A';
  const checksumsOk = existsSync(checksumPath);
  const backupOk = existsSync(backupDir);
  const backupCount = backupOk
    ? readdirSync(backupDir).filter((f) => {
        try {
          return statSync(join(backupDir, f)).isDirectory();
        } catch {
          return false;
        }
      }).length
    : 0;

  console.log(`  Database: ${dbOk ? `[OK] ${dbSize}KB` : '[FAIL] Not found'}`);
  console.log(`  Chunks: ${chunkCount} files`);
  console.log(`  Checksums: ${checksumsOk ? '[OK] Present' : '[FAIL] Missing'}`);
  console.log(`  Backups: ${backupCount} snapshots`);
}

// ===== MAIN =====

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv);
  const mode = args['Mode'] ?? 'check';
  quiet = args['Quiet'] === 'true';

  const engramDir = args['EngramDir'] || join(ROOT, '.engram');
  const backupDir = args['BackupDir'] || join(ROOT, '.backups', 'engram');
  const dbPath = join(ROOT, '.engram-data', 'engram.db');
  const checksumPath = join(engramDir, 'checksums.sha256');
  const manifestPath = join(engramDir, 'manifest.json');

  switch (mode) {
    case 'check':
      invokeIntegrityCheck(engramDir, dbPath, checksumPath, manifestPath, backupDir);
      process.exit(exitCode);
      break;
    case 'repair': {
      const checkResult = invokeIntegrityCheck(
        engramDir,
        dbPath,
        checksumPath,
        manifestPath,
        backupDir,
      );
      invokeAutoRepair(engramDir, dbPath, checksumPath, manifestPath);
      if (!checkResult) {
        log('=== Re-checking after repair ===', 'INFO');
        invokeIntegrityCheck(engramDir, dbPath, checksumPath, manifestPath, backupDir);
      }
      process.exit(exitCode);
      break;
    }
    case 'checksums':
      newChecksums(engramDir, dbPath, checksumPath);
      log("Checksums regenerated. Run 'check' to verify.", 'OK');
      break;
    case 'status':
      invokeStatus(engramDir, dbPath, checksumPath, backupDir);
      break;
    default:
      console.error(`Unknown mode: ${mode}`);
      process.exit(1);
  }
}
