#!/usr/bin/env node

/**
 * protect.ts — AES-256 encryption for build packaging (TS replacement for build/protect-gentle-vanguard.ps1)
 *
 * Encrypts core scripts with AES-256-GCM for distribution.
 *
 * Usage:
 *   npx tsx src/cli/protect.ts                    # Encrypt all scripts
 *   npx tsx src/cli/protect.ts --dry-run           # Dry run
 *   npx tsx src/cli/protect.ts --key-path <path>   # Custom key path
 */

import { createCipheriv, randomBytes } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, resolve, relative, extname } from 'path';

const ROOT = resolve(process.cwd());
const BUILD_DIR = join(ROOT, 'build');
const PROTECTED_DIR = join(BUILD_DIR, 'protected');
const PUBLIC_DIR = join(BUILD_DIR, 'public');
const KEYS_DIR = join(ROOT, 'keys');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('-DryRun');
const keyPath = args.includes('--key-path')
  ? args[args.indexOf('--key-path') + 1] || join(KEYS_DIR, 'master.key')
  : join(KEYS_DIR, 'master.key');

const ALGORITHM = 'aes-256-gcm';

function log(msg: string): void {
  console.log(`  [PROTECT] ${msg}`);
}

function ok(msg: string): void {
  console.log(`  [OK] ${msg}`);
}

function warn(msg: string): void {
  console.log(`  [WARN] ${msg}`);
}

function err(msg: string): void {
  console.error(`  [ERROR] ${msg}`);
}

// Core directories and files to protect
const SOURCE_DIRS = ['src', 'scripts'];
const ALLOWED_EXTENSIONS = ['.ts', '.js', '.json', '.ps1', '.md'];

function getSourceFiles(): string[] {
  const files: string[] = [];
  for (const dir of SOURCE_DIRS) {
    const fullPath = join(ROOT, dir);
    if (!existsSync(fullPath)) {
      warn(`Source dir not found: ${dir}`);
      continue;
    }
    collectFiles(fullPath, files);
  }
  return files;
}

function collectFiles(dir: string, result: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '.git', 'dist', 'protected'].includes(entry.name)) {
        collectFiles(full, result);
      }
    } else if (ALLOWED_EXTENSIONS.includes(extname(entry.name))) {
      result.push(full);
    }
  }
}

function getOrCreateKey(): Buffer {
  if (existsSync(keyPath)) {
    const key = readFileSync(keyPath);
    if (key.length !== 32) {
      warn(`Key size is ${key.length} bytes, expected 32. Regenerating...`);
      return generateAndSaveKey();
    }
    return key;
  }
  return generateAndSaveKey();
}

function generateAndSaveKey(): Buffer {
  const key = randomBytes(32);
  if (!dryRun) {
    if (!existsSync(KEYS_DIR)) mkdirSync(KEYS_DIR, { recursive: true });
    writeFileSync(keyPath, key);
    ok(`Generated new master key: ${keyPath}`);
  } else {
    log(`[DRY-RUN] Would generate key at ${keyPath}`);
  }
  return key;
}

function encryptFile(inputPath: string, key: Buffer, outputDir: string): string | null {
  const relativePath = relative(ROOT, inputPath);
  const outputPath = join(outputDir, relativePath + '.enc');

  try {
    const data = readFileSync(inputPath);
    const iv = randomBytes(16);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Format: IV (16) + AuthTag (16) + Encrypted data
    const payload = Buffer.concat([iv, authTag, encrypted]);
    if (!dryRun) {
      const outDir = join(
        outputDir,
        relative(ROOT, inputPath).split(/[/\\]/).slice(0, -1).join('/'),
      );
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      writeFileSync(outputPath, payload);
    }
    return outputPath;
  } catch (e) {
    err(`Failed to encrypt ${relativePath}: ${(e as Error).message}`);
    return null;
  }
}

function main(): void {
  console.log('');
  console.log('========================================');
  console.log('  Protect Gentle-Vanguard (TS)');
  console.log('========================================');
  console.log('');

  if (dryRun) log('DRY RUN MODE — no files will be written');

  // Ensure output dirs
  if (!dryRun) {
    if (!existsSync(PROTECTED_DIR)) mkdirSync(PROTECTED_DIR, { recursive: true });
    if (!existsSync(PUBLIC_DIR)) mkdirSync(PUBLIC_DIR, { recursive: true });
  }

  // Get or create master key
  const key = getOrCreateKey();
  ok(`Key ready (${key.length} bytes)`);

  // Get source files
  const files = getSourceFiles();
  log(`Found ${files.length} files to protect`);

  // Encrypt each file
  let successCount = 0;
  let failCount = 0;

  for (const file of files) {
    const relPath = relative(ROOT, file);

    // Check file size
    const size = statSync(file).size;
    if (size > 10 * 1024 * 1024) {
      // 10MB
      warn(`Skipping large file: ${relPath} (${(size / 1024 / 1024).toFixed(2)} MB)`);
      continue;
    }

    const result = encryptFile(file, key, PROTECTED_DIR);
    if (result) {
      if (!dryRun) ok(`Encrypted: ${relPath}`);
      else log(`[DRY-RUN] Would encrypt: ${relPath}`);
      successCount++;
    } else {
      failCount++;
    }
  }

  // Generate public manifest
  if (!dryRun) {
    const manifest = {
      timestamp: new Date().toISOString(),
      algorithm: ALGORITHM,
      keyPath: relative(ROOT, keyPath),
      totalFiles: files.length,
      encryptedFiles: successCount,
      failedFiles: failCount,
    };
    writeFileSync(join(PUBLIC_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }

  console.log('');
  log(`Summary: ${successCount} encrypted, ${failCount} failed, ${files.length} total`);
  if (dryRun) {
    log('DRY RUN — no files were written');
  } else {
    ok(`Protected: ${PROTECTED_DIR}`);
    ok(`Manifest: ${join(PUBLIC_DIR, 'manifest.json')}`);
  }

  process.exit(failCount > 0 ? 1 : 0);
}

main();
