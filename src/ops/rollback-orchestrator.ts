#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  copyFileSync,
} from 'fs';
import { join, dirname } from 'path';

import { runNpxTsxSync } from '../core/run-command.js';

const ROOT = process.cwd();
const SESSION_DIR = join(ROOT, '.session');
const CHECKPOINT_DIR = join(SESSION_DIR, 'checkpoints');
const MANIFEST_DIR = join(SESSION_DIR, 'manifests');

interface HealthResult {
  healthy: boolean;
  passed: number;
  failed: number;
  total: number;
}

interface RollbackResult {
  restored: number;
  errors: number;
}

interface VerificationResult {
  checkpointId: string;
  status: string;
  valid: number;
  invalid: number;
  missing: number;
}

interface ManifestFile {
  path: string;
  size?: number;
  sha256?: string;
}

interface Manifest {
  checkpointId: string;
  createdAt: string;
  label?: string;
  files: ManifestFile[];
  count?: number;
  totalSize?: number;
}

let checkpointId = '';
let label = '';
let skipHealthCheck = false;
let dryRun = false;
let autoBackup = false;
let force = false;
let quiet = false;

function parseArgs() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--checkpoint-id':
        checkpointId = args[++i] ?? '';
        break;
      case '--label':
        label = args[++i] ?? '';
        break;
      case '--skip-health-check':
        skipHealthCheck = true;
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--auto-backup':
        autoBackup = true;
        break;
      case '--force':
        force = true;
        break;
      case '--quiet':
        quiet = true;
        break;
    }
  }
}

function log(message: string, level: string = 'INFO') {
  const t = new Date().toISOString().replace('T', ' ').slice(0, 19);
  if (!quiet) {
    const colors: Record<string, string> = {
      INFO: '\x1b[36m',
      WARN: '\x1b[33m',
      ERROR: '\x1b[31m',
      SUCCESS: '\x1b[32m',
    };
    console.log(`${colors[level] || ''}[${t}] [ROLLBACK] [${level}] ${message}\x1b[0m`);
  }
  try {
    writeFileSync(join(SESSION_DIR, 'rollback.log'), `[${t}] [${level}] ${message}\n`, {
      flag: 'a',
    });
  } catch {
    // silently ignore
  }
}

function getCheckpointPath(id: string): string {
  return join(CHECKPOINT_DIR, id);
}

function getManifestPath(id: string): string {
  return join(MANIFEST_DIR, `${id}.json`);
}

function resolveCheckpointId(): string {
  if (checkpointId) return checkpointId;

  if (label && existsSync(MANIFEST_DIR)) {
    const manifests = readdirSync(MANIFEST_DIR, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.json'))
      .sort(
        (a, b) =>
          statSync(join(MANIFEST_DIR, b.name)).mtimeMs -
          statSync(join(MANIFEST_DIR, a.name)).mtimeMs,
      );

    for (const m of manifests) {
      try {
        const content = JSON.parse(readFileSync(join(MANIFEST_DIR, m.name), 'utf8')) as Manifest;
        if (content.label === label) return content.checkpointId;
      } catch {
        // skip corrupt manifest
      }
    }
    throw new Error(`No checkpoint found with label: ${label}`);
  }

  const dirs = readdirSync(CHECKPOINT_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .sort(
      (a, b) =>
        statSync(join(CHECKPOINT_DIR, b.name)).birthtimeMs -
        statSync(join(CHECKPOINT_DIR, a.name)).birthtimeMs,
    );

  if (dirs.length === 0) throw new Error('No checkpoints available');
  return dirs[0].name;
}

function testHealthy(): HealthResult {
  const checks: (() => boolean)[] = [
    () => existsSync(SESSION_DIR),
    () => !existsSync(join(SESSION_DIR, 'checkpoint.lock')),
    () => {
      const walk = (dir: string): number => {
        if (!existsSync(dir)) return 0;
        let count = 0;
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory()) count += walk(join(dir, e.name));
          else if (e.isFile()) count++;
        }
        return count;
      };
      return walk(SESSION_DIR) > 0;
    },
  ];

  let passed = 0;
  let failed = 0;
  for (const check of checks) {
    try {
      if (check()) passed++;
      else failed++;
    } catch {
      failed++;
    }
  }

  return { healthy: failed === 0, passed, failed, total: checks.length };
}

function testCheckpointValid(id: string): boolean {
  const target = getCheckpointPath(id);
  if (!existsSync(target)) return false;

  const mPath = getManifestPath(id);
  if (!existsSync(mPath)) return false;

  let manifest: Manifest;
  try {
    manifest = JSON.parse(readFileSync(mPath, 'utf8'));
  } catch {
    return false;
  }

  const walkFiles = (dir: string): string[] => {
    if (!existsSync(dir)) return [];
    const files: string[] = [];
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) files.push(...walkFiles(join(dir, e.name)));
      else if (e.isFile()) files.push(join(dir, e.name));
    }
    return files;
  };

  const fileCount = walkFiles(target).length;
  if (fileCount === 0) return false;

  const manifestCount = manifest.count ?? manifest.files.length;
  if (manifestCount !== fileCount) return false;

  let filesOk = 0;
  for (const f of manifest.files) {
    const fp = join(target, f.path);
    if (existsSync(fp)) filesOk++;
  }

  return filesOk === manifest.files.length;
}

function createPreRollbackBackup(): string {
  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  const randomHex = Array.from({ length: 4 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join('');
  const backupId = `pre-rollback-${dateStr}-${randomHex}`;
  const backupTarget = join(CHECKPOINT_DIR, backupId);

  mkdirSync(backupTarget, { recursive: true });

  const walkAndCopy = (dir: string): void => {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const srcPath = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'checkpoints' || e.name === 'manifests' || e.name === 'snapshots') continue;
        walkAndCopy(srcPath);
      } else if (e.isFile()) {
        const rel = srcPath.slice(SESSION_DIR.length + 1);
        const dest = join(backupTarget, rel);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(srcPath, dest);
      }
    }
  };

  walkAndCopy(SESSION_DIR);

  const backupFileCount = (() => {
    const walk = (dir: string): number => {
      let count = 0;
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) count += walk(join(dir, e.name));
        else if (e.isFile()) count++;
      }
      return count;
    };
    return walk(backupTarget);
  })();

  const backupManifest: Manifest = {
    checkpointId: backupId,
    createdAt: new Date().toISOString(),
    label: `Auto-backup before rollback to ${checkpointId}`,
    files: [],
    count: backupFileCount,
  };

  mkdirSync(MANIFEST_DIR, { recursive: true });
  writeFileSync(getManifestPath(backupId), JSON.stringify(backupManifest, null, 2), 'utf8');

  log(`Auto-backup created: ${backupId}`, 'SUCCESS');
  return backupId;
}

function invokeRollback(id: string): RollbackResult {
  const target = getCheckpointPath(id);
  const walkFiles = (dir: string, baseLen: number): string[] => {
    const files: string[] = [];
    const dirEntries = readdirSync(dir, { withFileTypes: true });
    for (const e of dirEntries) {
      const fullPath = join(dir, e.name);
      if (e.isDirectory()) files.push(...walkFiles(fullPath, baseLen));
      else if (e.isFile()) files.push(fullPath);
    }
    return files;
  };

  const files = walkFiles(target, target.length);
  let restored = 0;
  let errors = 0;

  for (const filePath of files) {
    try {
      const relPath = filePath.slice(target.length + 1);
      const destPath = join(SESSION_DIR, relPath);
      const destDir = dirname(destPath);
      if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
      copyFileSync(filePath, destPath);
      restored++;
    } catch (err) {
      log(`Failed to restore ${filePath}: ${(err as Error).message}`, 'ERROR');
      errors++;
    }
  }

  return { restored, errors };
}

parseArgs();

try {
  const resolvedId = resolveCheckpointId();
  checkpointId = resolvedId;
  log(`Rollback target: ${checkpointId}`, 'INFO');

  if (dryRun) {
    const status = testCheckpointValid(checkpointId);
    const health = testHealthy();
    log(`DRY RUN: checkpoint valid=${status}, system healthy=${health.healthy}`, 'INFO');
    const wouldRestore = status
      ? (() => {
          const walk = (dir: string): number => {
            let count = 0;
            const entries = readdirSync(dir, { withFileTypes: true });
            for (const e of entries) {
              if (e.isDirectory()) count += walk(join(dir, e.name));
              else if (e.isFile()) count++;
            }
            return count;
          };
          return walk(getCheckpointPath(checkpointId));
        })()
      : 0;
    console.log(
      JSON.stringify({ dryRun: true, checkpointId, valid: status, health, wouldRestore }),
    );
    process.exit(0);
  }

  if (!skipHealthCheck) {
    const health = testHealthy();
    if (!health.healthy) {
      const msg = `Health check failed (${health.failed}/${health.total} checks). Use --skip-health-check to force.`;
      if (force) {
        log(`${msg} — proceeding due to --force`, 'WARN');
      } else {
        throw new Error(msg);
      }
    }
    log(`Health check: ${health.passed}/${health.total} passed`, 'SUCCESS');
  }

  const valid = testCheckpointValid(checkpointId);
  if (!valid) {
    const msg = `Checkpoint ${checkpointId} is corrupted or incomplete`;
    if (force) {
      log(`${msg} — proceeding due to --force`, 'WARN');
    } else {
      throw new Error(msg);
    }
  }
  log('Checkpoint integrity verified', 'SUCCESS');

  let autoBackupId: string | null = null;
  if (autoBackup) {
    autoBackupId = createPreRollbackBackup();
  }

  const result = invokeRollback(checkpointId);

  const ckptMgr = join(ROOT, 'src', 'checkpoint-manager.ts');
  // CLI signature: checkpoint-manager.ts verify <checkpointId>
  // (root defaults to cwd — the checkpoint store lives under <root>/.session).
  const spawnResult = runNpxTsxSync(ckptMgr, ['verify', checkpointId], {});
  let verification: VerificationResult | null = null;
  try {
    verification = JSON.parse(spawnResult.stdout) as VerificationResult;
  } catch {
    log('Verification output could not be parsed', 'WARN');
  }

  log(
    `Rollback to ${checkpointId} complete: ${result.restored} restored, ${result.errors} errors`,
    'SUCCESS',
  );

  const output: Record<string, unknown> = {
    checkpointId,
    restored: result.restored,
    errors: result.errors,
    verification: verification?.status ?? 'UNKNOWN',
    autoBackupId,
  };
  console.log(JSON.stringify(output));
} catch (err) {
  log((err as Error).message, 'ERROR');
  process.exit(1);
}
