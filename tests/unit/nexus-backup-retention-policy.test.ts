import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const RETENTION = 14;

describe('Nexus backup retention policy', () => {
  it('uses one retention count across automatic and manual pruning paths', () => {
    const sessionRetention = readFileSync(
      resolve(ROOT, 'src', 'session', 'session-retention.ts'),
      'utf8',
    );
    const backupCli = readFileSync(resolve(ROOT, 'scripts', 'database', 'db-backup.ts'), 'utf8');
    const scheduledBackup = readFileSync(
      resolve(ROOT, 'src', 'ops', 'nexus-backup-scheduled.ts'),
      'utf8',
    );
    const sessionConfigSource = readFileSync(
      resolve(ROOT, 'config', 'session-autostart.config.json'),
      'utf8',
    );
    const sessionConfig = JSON.parse(sessionConfigSource);
    const packageConfig = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

    assert.equal(sessionRetention.match(/maxBackups:\s*(\d+)/)?.[1], String(RETENTION));
    assert.equal(sessionConfig.retention.maxBackups, RETENTION);
    assert.match(sessionConfigSource, /max 10 sessions, 5 checkpoints, 14 backups/);
    assert.equal(
      packageConfig.scripts['db:prune:backup'].match(/--keep\s+(\d+)/)?.[1],
      String(RETENTION),
    );
    assert.equal(
      backupCli.match(/parseInt\(args\[keepIdx \+ 1\], 10\) : (\d+)/)?.[1],
      String(RETENTION),
    );
    assert.match(scheduledBackup, /'--keep', '14'/);
  });
});
