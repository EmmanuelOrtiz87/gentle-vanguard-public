import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

import { BacklogRepo } from '../../src/database/nexus//repositories/BacklogRepo';
import { MigrationRunner } from '../../src/database/nexus//repositories/MigrationRunner';

const root = join(import.meta.dirname, '..', '..');
const cli = join(root, 'src', 'cli', 'backlog.ts');

function runCli(dbDir: string, args: string[], tenant?: string): string {
  return execFileSync(process.execPath, ['--import', 'tsx', cli, ...args], {
    cwd: root,
    env: {
      ...process.env,
      GENTLE_VANGUARD_DB_DIR: dbDir,
      ...(tenant ? { GENTLE_TENANT_ID: tenant } : {}),
    },
    encoding: 'utf8',
  });
}

test('CLI writes records equivalent to BacklogRepo reads', () => {
  const dbDir = mkdtempSync(join(tmpdir(), 'gentle-vanguard-backlog-'));
  try {
    const output = runCli(dbDir, [
      'add',
      '--type',
      'bug',
      '--title',
      'Equivalent item',
      '--severity',
      'high',
      '--tags',
      'cli,repo',
      '--comment',
      'Created by CLI',
    ]);
    assert.match(output, /Created: BL-/);
    const db = new Database(join(dbDir, 'gentle-vanguard.db'));
    new MigrationRunner(db).runMigrations();
    const repo = new BacklogRepo(db);
    const items = repo.listItems({ search: 'Equivalent item' }, 'gentle-vanguard');
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'Equivalent item');
    assert.deepEqual(items[0].tags, ['cli', 'repo']);
    assert.equal(repo.getComments(items[0].id, 'gentle-vanguard')[0].content, 'Created by CLI');
    db.close();
  } finally {
    rmSync(dbDir, { recursive: true, force: true });
  }
});

test('CLI default and explicit tenant contexts remain isolated', () => {
  const dbDir = mkdtempSync(join(tmpdir(), 'gentle-vanguard-backlog-'));
  try {
    runCli(dbDir, ['add', '--type', 'task', '--title', 'Default tenant']);
    runCli(dbDir, ['add', '--type', 'task', '--title', 'Other tenant'], 'other-tenant');
    const defaultList = runCli(dbDir, ['list']);
    const otherList = runCli(dbDir, ['list'], 'other-tenant');
    assert.match(defaultList, /Default tenant/);
    assert.doesNotMatch(defaultList, /Other tenant/);
    assert.match(otherList, /Other tenant/);
    assert.doesNotMatch(otherList, /Default tenant/);
  } finally {
    rmSync(dbDir, { recursive: true, force: true });
  }
});
