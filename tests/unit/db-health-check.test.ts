import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import Database from 'better-sqlite3';
import { inspectSqliteDatabase } from '../../scripts/recovery/db-health-inspector.js';

const repoRoot = process.cwd();
const checkerPath = resolve(repoRoot, 'scripts/recovery/db-health-check.ts');
const tsxLoader = resolve(repoRoot, 'node_modules/tsx/dist/loader.mjs');

function runChecker(fixtureRoot: string) {
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(tsxLoader).href, checkerPath], {
    cwd: fixtureRoot,
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
    env: {
      ...process.env,
      HOME: fixtureRoot,
      USERPROFILE: fixtureRoot,
    },
  });
  return {
    ...result,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`.replace(/\x1b\[[0-9;]*m/g, ''),
  };
}

function createNexusFixture(fixtureRoot: string): void {
  const path = join(fixtureRoot, '.runtime', 'gentle-vanguard.db');
  mkdirSync(join(fixtureRoot, '.runtime'), { recursive: true });
  const database = new Database(path);
  database.exec(`
    CREATE TABLE events (id TEXT PRIMARY KEY);
    CREATE TABLE metric_snapshots (id TEXT PRIMARY KEY);
    CREATE TABLE sessions (id TEXT PRIMARY KEY);
  `);
  database.close();
}

test('reports a healthy CodeGraph database from a Windows path with spaces', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'gv db health '));
  createNexusFixture(fixtureRoot);
  const codeGraphDirectory = join(fixtureRoot, '.codegraph');
  mkdirSync(codeGraphDirectory, { recursive: true });
  const databasePath = join(codeGraphDirectory, 'graph.db');
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE nodes (id TEXT PRIMARY KEY);
    CREATE TABLE edges (id TEXT PRIMARY KEY);
    CREATE TABLE files (id TEXT PRIMARY KEY);
    CREATE TABLE unresolved_refs (id TEXT PRIMARY KEY);
    CREATE TABLE schema_versions (version INTEGER PRIMARY KEY);
    CREATE TABLE project_metadata (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO nodes (id) VALUES ('node-1');
  `);
  database.close();

  const engramPaths = [
    join(fixtureRoot, '.engram-data', 'engram.db'),
    join(fixtureRoot, '.engram', 'global', '.engram', 'memory.db'),
  ];
  for (const engramPath of engramPaths) {
    mkdirSync(join(engramPath, '..'), { recursive: true });
    new Database(engramPath).close();
  }

  try {
    const result = runChecker(fixtureRoot);
    assert.equal(result.error, undefined, result.output);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /HEALTHY.*CodeGraph\/graph\.db/);
    assert.match(result.output, /HEALTHY.*Nexus\/gentle-vanguard\.db/);
    assert.match(result.output, /Saludables: 4\/4/);
    assert.doesNotMatch(result.output, /Attempting WAL checkpoint|REINDEX|INTEGRITY_CHECK failed/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('does not repair or classify an unreadable database as confirmed corruption', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'gv unreadable database '));
  createNexusFixture(fixtureRoot);
  const codeGraphDirectory = join(fixtureRoot, '.codegraph');
  mkdirSync(codeGraphDirectory, { recursive: true });
  const databasePath = join(codeGraphDirectory, 'graph.db');
  writeFileSync(databasePath, 'not a SQLite database');
  const beforeHash = createHash('sha256').update(readFileSync(databasePath)).digest('hex');

  try {
    const result = runChecker(fixtureRoot);
    const afterHash = createHash('sha256').update(readFileSync(databasePath)).digest('hex');
    assert.equal(result.error, undefined, result.output);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /UNVERIFIED.*CodeGraph\/graph\.db/);
    assert.match(result.output, /INTEGRITY_CHECK unavailable/);
    assert.doesNotMatch(result.output, /Attempting WAL checkpoint|REINDEX/);
    assert.equal(afterHash, beforeHash, 'health inspection must leave unreadable database bytes untouched');
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('reports an unreadable SQLite path as unavailable instead of corruption', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'gv sqlite unavailable '));
  try {
    const inspection = inspectSqliteDatabase(fixtureRoot);
    assert.equal(inspection.integrity.status, 'unavailable');
    assert.equal(inspection.tables.status, 'unavailable');
    assert.equal(inspection.rows.status, 'unavailable');
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
