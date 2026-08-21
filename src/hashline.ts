#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

interface HashLineEntry {
  line: number;
  hash: string;
  content_preview: string;
}

interface FileHashData {
  path: string;
  total_lines: number;
  line_hashes: Record<string, HashLineEntry>;
  file_hash: string;
  updated: string;
}

interface HashDatabase {
  version: string;
  created: string;
  last_init: string;
  files: Record<string, FileHashData>;
}

interface VerifyIssue {
  line: number;
  type: 'deleted' | 'added' | 'modified';
  stored_hash?: string;
  current_hash?: string;
  stored_preview?: string;
  current_preview?: string;
}

const ROOT = process.cwd();
let dbPath = path.join(ROOT, '.runtime', 'hashline-db.json');

const EXTENSIONS =
  /\.(ps1|psm1|psd1|ts|tsx|js|jsx|json|yml|yaml|md|css|scss|html|cs|go|py|rs|java|kt|swift)$/;
const EXCLUDE_DIRS =
  /\\node_modules\\|\\\.git\\|\\dist\\|\\\.runtime\\|\\coverage\\|\\\.engram-data\\|\\session\\|\\\.event-bus\\|\\deprecated\\|\\tools\\/;

function log(msg: string, color?: string, quiet?: boolean) {
  if (quiet) return;
  const colors: Record<string, string> = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m',
    white: '\x1b[37m',
  };
  const reset = '\x1b[0m';
  console.log(`${(color ? colors[color] : '') || ''}${msg}${reset}`);
}

function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readDb(): HashDatabase {
  if (fs.existsSync(dbPath)) {
    try {
      const raw = fs.readFileSync(dbPath, 'utf-8');
      const data = JSON.parse(raw) as HashDatabase;
      if (!data.files) data.files = {};
      return data;
    } catch {
      return { version: '', created: '', last_init: '', files: {} };
    }
  }
  return { version: '', created: '', last_init: '', files: {} };
}

function writeDb(db: HashDatabase) {
  ensureDir(path.dirname(dbPath));
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf-8');
}

function getRelativePath(absPath: string): string {
  if (!path.isAbsolute(absPath)) return absPath;
  const rel = path.relative(ROOT, absPath);
  return rel.startsWith('..') ? absPath : rel;
}

function getLineHash(line: string): string {
  return createHash('sha256').update(line, 'utf8').digest('hex');
}

function getFileLines(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  return content.split(/\r?\n/);
}

function makePreview(line: string): string {
  return line.length > 80 ? line.substring(0, 80) : line;
}

function makeEntry(line: string, lineNum: number): HashLineEntry {
  return { line: lineNum, hash: getLineHash(line), content_preview: makePreview(line) };
}

function nowISO(): string {
  return new Date().toISOString();
}

function walkDir(dirPath: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.test(fullPath)) continue;
      results.push(...walkDir(fullPath));
    } else if (entry.isFile() && EXTENSIONS.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

function buildLineHashes(lines: string[]): Record<string, HashLineEntry> {
  const hashes: Record<string, HashLineEntry> = {};
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    hashes[String(lineNum)] = makeEntry(lines[i] ?? '', lineNum);
  }
  return hashes;
}

function actionInit(targetPath?: string, quiet?: boolean, asJson?: boolean) {
  const db = readDb();
  const files = targetPath
    ? (() => {
        const stat = fs.statSync(targetPath, { throwIfNoEntry: false });
        if (!stat) {
          log('[ERROR] Path not found: ' + targetPath, 'red', quiet);
          process.exit(1);
        }
        return stat.isDirectory() ? walkDir(targetPath) : [targetPath];
      })()
    : walkDir(ROOT);

  let count = 0;
  for (const filePath of files) {
    const relPath = getRelativePath(filePath);
    const lines = getFileLines(filePath);
    if (lines.length === 0) continue;
    db.files[relPath] = {
      path: relPath,
      total_lines: lines.length,
      line_hashes: buildLineHashes(lines),
      file_hash: getLineHash(lines.join('\n')),
      updated: nowISO(),
    };
    count++;
  }

  if (!db.version) db.version = '1.0';
  if (!db.created) db.created = nowISO();
  db.last_init = nowISO();
  writeDb(db);
  log(`[HASHLINE] Initialized ${count} files`, 'green', quiet);
  if (asJson) console.log(JSON.stringify({ status: 'ok', files_initialized: count }));
}

function actionVerify(filePath: string, fix?: boolean, quiet?: boolean, asJson?: boolean) {
  const db = readDb();
  const relPath = getRelativePath(filePath);

  if (!db.files[relPath]) {
    log(`[HASHLINE] No hash data for: ${relPath}. Run 'init' first.`, 'yellow', quiet);
    if (asJson) console.log(JSON.stringify({ status: 'no-data', path: relPath }));
    return;
  }

  const lines = getFileLines(filePath);
  const stored = db.files[relPath];
  const issues: VerifyIssue[] = [];

  const maxLines = Math.max(lines.length, stored.total_lines);
  for (let i = 0; i < maxLines; i++) {
    const lineNum = i + 1;
    const currentLine = i < lines.length ? lines[i] : null;
    const storedLine = stored.line_hashes[String(lineNum)];

    if (currentLine === null && storedLine) {
      issues.push({ line: lineNum, type: 'deleted', stored_hash: storedLine.hash });
    } else if (currentLine !== null && !storedLine) {
      issues.push({ line: lineNum, type: 'added', current_hash: getLineHash(currentLine) });
    } else if (currentLine !== null && storedLine) {
      const currentHash = getLineHash(currentLine);
      if (currentHash !== storedLine.hash) {
        issues.push({
          line: lineNum,
          type: 'modified',
          stored_hash: storedLine.hash,
          current_hash: currentHash,
          stored_preview: storedLine.content_preview,
          current_preview: makePreview(currentLine),
        });
      }
    }
  }

  if (issues.length === 0 && lines.length === stored.total_lines) {
    log(`[HASHLINE] OK: ${relPath} (${lines.length} lines, all hashes match)`, 'green', quiet);
    if (asJson) console.log(JSON.stringify({ status: 'ok', path: relPath, issues: [] }));
    return;
  }

  log(`[HASHLINE] ISSUES: ${relPath} (${issues.length} changes)`, 'yellow', quiet);
  for (const issue of issues) {
    switch (issue.type) {
      case 'modified':
        log(`  L${issue.line} MODIFIED`, 'yellow', quiet);
        log(`    was: '${issue.stored_preview}'`, 'gray', quiet);
        log(`    now: '${issue.current_preview}'`, 'gray', quiet);
        break;
      case 'deleted':
        log(`  L${issue.line} DELETED`, 'red', quiet);
        break;
      case 'added':
        log(`  L${issue.line} ADDED`, 'green', quiet);
        break;
    }
  }

  if (fix) {
    log(`[HASHLINE] Updating hashes for ${relPath}...`, 'cyan', quiet);
    db.files[relPath].line_hashes = buildLineHashes(lines);
    db.files[relPath].total_lines = lines.length;
    db.files[relPath].file_hash = getLineHash(lines.join('\n'));
    db.files[relPath].updated = nowISO();
    writeDb(db);
    log(`[HASHLINE] Hashes updated for ${relPath}`, 'green', quiet);
  }

  if (asJson) {
    console.log(
      JSON.stringify({
        status: issues.length === 0 ? 'ok' : 'issues',
        path: relPath,
        issues,
      }),
    );
  }
}

function actionUpdate(filePath: string, quiet?: boolean, asJson?: boolean) {
  const relPath = getRelativePath(filePath);

  if (!fs.existsSync(filePath)) {
    const db = readDb();
    if (db.files[relPath]) {
      delete db.files[relPath];
      writeDb(db);
      log(`[HASHLINE] Removed deleted file: ${relPath}`, 'yellow', quiet);
    }
    if (asJson) console.log(JSON.stringify({ status: 'removed', path: relPath }));
    return;
  }

  const db = readDb();
  const lines = getFileLines(filePath);
  db.files[relPath] = {
    path: relPath,
    total_lines: lines.length,
    line_hashes: buildLineHashes(lines),
    file_hash: getLineHash(lines.join('\n')),
    updated: nowISO(),
  };
  writeDb(db);
  log(`[HASHLINE] Updated: ${relPath} (${lines.length} lines)`, 'green', quiet);
  if (asJson)
    console.log(JSON.stringify({ status: 'updated', path: relPath, lines: lines.length }));
}

function actionStatus(quiet?: boolean, asJson?: boolean) {
  const db = readDb();
  const fileCount = Object.keys(db.files).length;
  let totalLines = 0;
  let totalHashes = 0;
  for (const key of Object.keys(db.files)) {
    totalLines += db.files[key].total_lines;
    totalHashes += Object.keys(db.files[key].line_hashes).length;
  }
  const dbSize = fs.existsSync(dbPath)
    ? `${(fs.statSync(dbPath).size / 1024).toFixed(2)} KB`
    : '0 KB';

  log('=== HASHLINE STATUS ===', 'cyan', quiet);
  log(`  Database: ${dbPath} (${dbSize})`, 'gray', quiet);
  log(`  Version: ${db.version}`, 'white', quiet);
  log(`  Files tracked: ${fileCount}`, 'white', quiet);
  log(`  Total lines: ${totalLines}`, 'white', quiet);
  log(`  Total hashes: ${totalHashes}`, 'white', quiet);
  log(`  Last init: ${db.last_init}`, 'gray', quiet);

  if (asJson) {
    console.log(
      JSON.stringify({
        status: 'active',
        version: db.version,
        files_tracked: fileCount,
        total_lines: totalLines,
        total_hashes: totalHashes,
        database: dbPath,
        created: db.created,
        last_init: db.last_init,
      }),
    );
  }
}

function actionPrune(quiet?: boolean, asJson?: boolean) {
  const db = readDb();
  const toRemove: string[] = [];
  for (const key of Object.keys(db.files)) {
    if (!fs.existsSync(path.join(ROOT, key))) {
      toRemove.push(key);
    }
  }
  for (const name of toRemove) delete db.files[name];
  writeDb(db);
  log(`[HASHLINE] Pruned ${toRemove.length} stale entries`, 'green', quiet);
  if (asJson) console.log(JSON.stringify({ status: 'pruned', removed: toRemove.length }));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result: Record<string, string | boolean | undefined> = { action: 'status' };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--action':
        result.action = args[++i] || 'status';
        break;
      case '--file':
        result.file = args[++i] || '';
        break;
      case '--storage':
        result.storage = args[++i];
        break;
      case '--fix':
        result.fix = true;
        break;
      case '--json':
        result.asJson = true;
        break;
      case '--quiet':
        result.quiet = true;
        break;
    }
  }
  return result;
}

function main() {
  const cli = parseArgs();

  if (cli.storage && typeof cli.storage === 'string') {
    const p = path.resolve(ROOT, cli.storage);
    ensureDir(path.dirname(p));
    dbPath = p;
  }

  switch (cli.action) {
    case 'init':
      actionInit(cli.file as string | undefined, cli.quiet as boolean, cli.asJson as boolean);
      break;
    case 'verify':
      if (!cli.file) {
        log('[ERROR] --file required for verify', 'red', cli.quiet as boolean);
        process.exit(1);
      }
      actionVerify(
        cli.file as string,
        cli.fix as boolean,
        cli.quiet as boolean,
        cli.asJson as boolean,
      );
      break;
    case 'update':
      if (!cli.file) {
        log('[ERROR] --file required for update', 'red', cli.quiet as boolean);
        process.exit(1);
      }
      actionUpdate(cli.file as string, cli.quiet as boolean, cli.asJson as boolean);
      break;
    case 'status':
      actionStatus(cli.quiet as boolean, cli.asJson as boolean);
      break;
    case 'prune':
      actionPrune(cli.quiet as boolean, cli.asJson as boolean);
      break;
    default:
      log('[ERROR] Unknown action: ' + cli.action, 'red', cli.quiet as boolean);
      process.exit(1);
  }
}

main();
