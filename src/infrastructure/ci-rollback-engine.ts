#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { runSync } from '../core/run-command.js';

interface RollbackConfig {
  autoRollback: boolean;
  maxRollbackAttempts: number;
  safeBranches: string[];
  notifyChannels: string[];
  requireApproval: boolean;
}

interface RollbackRecord {
  timestamp: string;
  jobName: string;
  reason: string;
  branch: string;
  commitBefore: string;
  commitAfter?: string;
  status: string;
  error?: string;
}

interface StatusResult {
  branch: string;
  isSafe: boolean;
  autoRollback: boolean;
}

function getRepoRoot(): string {
  if (process.env.GENTLE_VANGUARD_BASE_DIR) return process.env.GENTLE_VANGUARD_BASE_DIR;
  let root = resolve(import.meta.dirname ?? process.cwd(), '..');
  while (root && !existsSync(join(root, 'config', 'orchestrator.json'))) {
    const parent = resolve(root, '..');
    if (parent === root) break;
    root = parent;
  }
  if (!existsSync(join(root, 'config', 'orchestrator.json'))) root = process.cwd();
  return root;
}

function loadConfig(repoRoot: string): { rollback: RollbackConfig } {
  const configPath = join(repoRoot, 'config', 'ci-self-heal.json');
  const defaultConfig = {
    rollback: {
      autoRollback: true,
      maxRollbackAttempts: 2,
      safeBranches: ['main', 'master', 'develop'],
      notifyChannels: ['dashboard', 'audit'],
      requireApproval: false,
    },
  };
  if (existsSync(configPath)) {
    try {
      return JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      return defaultConfig;
    }
  }
  return defaultConfig;
}

function gitCmd(repoRoot: string, args: string[]): string {
  return runSync('git', ['-C', repoRoot, ...args], {
    windowsHide: true,
  }).stdout.trim();
}

function getCurrentBranch(repoRoot: string): string {
  try {
    return gitCmd(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  } catch {
    return 'unknown';
  }
}

function getLastCommit(repoRoot: string): string {
  try {
    return gitCmd(repoRoot, ['log', '--oneline', '-1']);
  } catch {
    return 'unknown';
  }
}

function getCommitHash(repoRoot: string): string {
  try {
    return gitCmd(repoRoot, ['rev-parse', 'HEAD']);
  } catch {
    return 'unknown';
  }
}

function doStatus(repoRoot: string, config: { rollback: RollbackConfig }): StatusResult {
  const currentBranch = getCurrentBranch(repoRoot);
  const isSafe = config.rollback.safeBranches.includes(currentBranch);
  const lastCommit = getLastCommit(repoRoot);
  const rollbackDir = join(repoRoot, '.session', 'rollbacks');

  console.log(`\x1b[36m[ROLLBACK] Status:\x1b[0m`);
  const branchColor = isSafe ? '\x1b[32m' : '\x1b[33m';
  console.log(
    `  Branch: ${currentBranch} ${branchColor}${isSafe ? '(safe)' : '(not safe — rollback requires approval)'}\x1b[0m`,
  );
  console.log(`  \x1b[90mLast commit: ${lastCommit}\x1b[0m`);
  console.log(`  \x1b[90mAuto-rollback: ${config.rollback.autoRollback}\x1b[0m`);
  console.log(`  \x1b[90mRecent rollbacks:\x1b[0m`);

  if (existsSync(rollbackDir)) {
    const logs = readdirSync(rollbackDir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, 5);
    for (const log of logs) {
      try {
        const data = JSON.parse(readFileSync(join(rollbackDir, log), 'utf-8')) as RollbackRecord;
        console.log(`    \x1b[33m${data.timestamp} — ${data.jobName}: ${data.reason}\x1b[0m`);
      } catch {
        // skip unparseable logs
      }
    }
  }

  return { branch: currentBranch, isSafe, autoRollback: config.rollback.autoRollback };
}

function doRollback(
  repoRoot: string,
  config: { rollback: RollbackConfig },
  jobName: string,
  reason: string,
  dryRun: boolean,
): Record<string, unknown> {
  const currentBranch = getCurrentBranch(repoRoot);
  const isSafe = config.rollback.safeBranches.includes(currentBranch);

  if (!isSafe && config.rollback.requireApproval) {
    throw new Error(
      `[ROLLBACK] Branch '${currentBranch}' is not in safe list and requires approval`,
    );
  }

  if (!config.rollback.autoRollback) {
    console.log(
      '\x1b[33m[ROLLBACK] Auto-rollback is disabled — manual intervention required\x1b[0m',
    );
    return { status: 'skipped', reason: 'autoRollback disabled' };
  }

  console.log(`\x1b[36m[ROLLBACK] Initiating rollback for job: ${jobName}\x1b[0m`);
  console.log(`\x1b[33m[ROLLBACK] Reason: ${reason}\x1b[0m`);

  if (dryRun) {
    console.log('\x1b[33m[DRY-RUN] Would execute: git revert HEAD --no-edit\x1b[0m');
    console.log('\x1b[33m[DRY-RUN] Would execute: git push origin ' + currentBranch + '\x1b[0m');
    return {
      status: 'dryrun',
      commands: ['git revert HEAD --no-edit', `git push origin ${currentBranch}`],
    };
  }

  const rollbackRecord: RollbackRecord = {
    timestamp: new Date().toISOString(),
    jobName,
    reason,
    branch: currentBranch,
    commitBefore: getCommitHash(repoRoot),
    status: '',
  };

  try {
    runSync('git', ['-C', repoRoot, 'revert', 'HEAD', '--no-edit'], {
      stdio: 'pipe',
      windowsHide: true,
    });
    runSync('git', ['-C', repoRoot, 'push', 'origin', currentBranch], {
      stdio: 'pipe',
      windowsHide: true,
    });

    const commitAfter = getCommitHash(repoRoot);
    rollbackRecord.commitAfter = commitAfter;
    rollbackRecord.status = 'success';

    console.log(`\x1b[32m[ROLLBACK] Success — reverted to ${commitAfter}\x1b[0m`);

    const auditDir = process.env.GENTLE_TENANT_AUDIT_DIR
      ? process.env.GENTLE_TENANT_AUDIT_DIR
      : join(repoRoot, '.session', 'audit');
    const incidentsDir = join(auditDir, 'incidents');
    mkdirSync(incidentsDir, { recursive: true });
    const incidentFile = join(
      incidentsDir,
      `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-rollback.json`,
    );
    writeFileSync(incidentFile, JSON.stringify(rollbackRecord, null, 2), 'utf-8');
    console.log(`\x1b[90m[ROLLBACK] Incident logged: ${incidentFile}\x1b[0m`);
  } catch (e) {
    rollbackRecord.status = 'failed';
    rollbackRecord.error = e instanceof Error ? e.message : String(e);
    console.error(`\x1b[31m[ROLLBACK] Failed: ${rollbackRecord.error}\x1b[0m`);
  }

  const rollbackDir = join(repoRoot, '.session', 'rollbacks');
  mkdirSync(rollbackDir, { recursive: true });
  const logFile = join(
    rollbackDir,
    `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`,
  );
  writeFileSync(logFile, JSON.stringify(rollbackRecord, null, 2), 'utf-8');

  return rollbackRecord as unknown as Record<string, unknown>;
}

function doLog(repoRoot: string): RollbackRecord[] {
  const rollbackDir = join(repoRoot, '.session', 'rollbacks');
  if (!existsSync(rollbackDir)) {
    console.log('\x1b[90m[ROLLBACK] No rollback history\x1b[0m');
    return [];
  }

  const logs = readdirSync(rollbackDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse();

  if (logs.length === 0) {
    console.log('\x1b[90m[ROLLBACK] No rollback history\x1b[0m');
    return [];
  }

  console.log('\x1b[36m[ROLLBACK] History:\x1b[0m');
  const records: RollbackRecord[] = [];
  for (const log of logs) {
    try {
      const data = JSON.parse(readFileSync(join(rollbackDir, log), 'utf-8')) as RollbackRecord;
      records.push(data);
      const color = data.status === 'success' ? '\x1b[32m' : '\x1b[31m';
      console.log(
        `  ${color}${data.timestamp} | ${data.jobName} | ${data.status} | ${data.reason}\x1b[0m`,
      );
    } catch {
      // skip unparseable
    }
  }

  return records;
}

function main() {
  const args = process.argv.slice(2);
  const action = args.find((a) => a.startsWith('--action='))?.split('=')[1] ?? 'rollback';
  const jobName = args.find((a) => a.startsWith('--jobName='))?.split('=')[1] ?? 'unknown';
  const reason = args.find((a) => a.startsWith('--reason='))?.split('=')[1] ?? 'No reason provided';
  const dryRun = args.includes('--dryRun');

  const repoRoot = getRepoRoot();
  const config = loadConfig(repoRoot);

  switch (action) {
    case 'status': {
      const result = doStatus(repoRoot, config);
      console.log(JSON.stringify(result));
      break;
    }
    case 'rollback': {
      const result = doRollback(repoRoot, config, jobName, reason, dryRun);
      console.log(JSON.stringify(result));
      break;
    }
    case 'log': {
      const result = doLog(repoRoot);
      console.log(JSON.stringify(result));
      break;
    }
    default:
      console.error(`\x1b[31mUnknown action: ${action}\x1b[0m`);
      process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
