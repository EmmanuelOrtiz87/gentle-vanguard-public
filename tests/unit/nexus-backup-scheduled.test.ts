import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { runScheduledBackup } from '../../src/ops/nexus-backup-scheduled.ts';

test('scheduled Nexus backup reports success only when backup and retention both succeed', () => {
  const calls: string[][] = [];
  const messages: string[] = [];
  const status = runScheduledBackup(
    'C:\\workspace',
    (_command, args) => {
      calls.push(args);
      return { status: 0, stderr: '', stdout: '', error: null, signal: null };
    },
    (message) => messages.push(message),
  );

  assert.equal(status, 0);
  assert.deepEqual(calls, [
    ['--import', 'tsx', join('C:\\workspace', 'scripts', 'database', 'db-backup.ts'), 'backup'],
    [
      '--import',
      'tsx',
      join('C:\\workspace', 'scripts', 'database', 'db-backup.ts'),
      'prune',
      '--keep',
      '14',
    ],
  ]);
  assert.deepEqual(messages, ['backup: OK', 'prune: OK (keep 14)']);
});

test('scheduled Nexus backup reports failure but still runs retention after backup fails', () => {
  const calls: string[][] = [];
  const messages: string[] = [];
  const status = runScheduledBackup(
    'C:\\workspace',
    (_command, args) => {
      calls.push(args);
      return {
        status: args.includes('backup') ? 1 : 0,
        stderr: args.includes('backup') ? 'disk unavailable' : '',
        stdout: '',
        error: null,
        signal: null,
      };
    },
    (message) => messages.push(message),
  );

  assert.equal(status, 1);
  assert.equal(calls.length, 2);
  assert.match(messages[0], /backup: FAIL.*disk unavailable/);
  assert.equal(messages[1], 'prune: OK (keep 14)');
});

test('scheduled Nexus backup reports failure when retention fails', () => {
  const messages: string[] = [];
  const status = runScheduledBackup(
    'C:\\workspace',
    (_command, args) => ({
      status: args.includes('prune') ? 2 : 0,
      stderr: args.includes('prune') ? 'retention failed' : '',
      stdout: '',
      error: null,
      signal: null,
    }),
    (message) => messages.push(message),
  );

  assert.equal(status, 1);
  assert.deepEqual(messages, ['backup: OK', 'prune: FAIL (exit 2) retention failed']);
});

test('scheduled Nexus backup reports exceptions as failure', () => {
  const messages: string[] = [];
  const status = runScheduledBackup(
    'C:\\workspace',
    () => {
      throw new Error('sqlite3 could not start');
    },
    (message) => messages.push(message),
  );

  assert.equal(status, 1);
  assert.equal(messages.length, 2);
  assert.match(messages[0], /backup: FAIL.*sqlite3 could not start/);
  assert.match(messages[1], /prune: FAIL.*sqlite3 could not start/);
});
