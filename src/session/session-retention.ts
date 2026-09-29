#!/usr/bin/env node
/**
 * Session Retention Manager
 *
 * Gestiona la retención de archivos de sesión, checkpoints y backups
 * según políticas definidas:
 * - Máximo 10 sesiones históricas (configurable)
 * - Máximo 5 checkpoints por sesión
 * - Máximo 3 backups rotativos
 * - Cleanup automático de archivos temporales
 *
 * Uso:
 *   npx tsx src/session/session-retention.ts prune
 *   npx tsx src/session/session-retention.ts status
 *   npx tsx src/session/session-retention.ts prune --dry-run
 */

import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

const ROOT = resolve(process.cwd());

// Configuration
const CONFIG = {
  maxSessionFiles: 10,
  maxCheckpointsPerSession: 5,
  maxBackups: 3,
  maxCloseReports: 20,
  sessionAgeThresholdDays: 30, // Always keep sessions from last 30 days
  highScoreThreshold: 80, // Keep 5 extra sessions with score > 80
  extraHighScoreSessions: 5,
};

interface SessionInfo {
  filename: string;
  path: string;
  mtime: number;
  score?: number;
  hasCheckpoint: boolean;
}

function log(msg: string, type: 'info' | 'warn' | 'ok' = 'info') {
  const prefix = type === 'ok' ? '✅' : type === 'warn' ? '⚠️' : '📋';
  console.log(`${prefix} [RETENTION] ${msg}`);
}

function getSessionDir(): string {
  return join(ROOT, '.session');
}

function getRuntimeDir(): string {
  return join(ROOT, '.runtime');
}

function getCheckpointsDir(): string {
  return join(getSessionDir(), 'checkpoints');
}

/**
 * Get all session files sorted by modification time (newest first)
 */
function getSessionFiles(): SessionInfo[] {
  const sessionDir = getSessionDir();
  if (!existsSync(sessionDir)) return [];

  const files = readdirSync(sessionDir)
    .filter((f) => f.startsWith('session-') && f.endsWith('.json') && f !== 'session-current.json')
    .map((f) => {
      const fp = join(sessionDir, f);
      const stats = statSync(fp);
      let score: number | undefined;
      try {
        const data = JSON.parse(readFileSync(fp, 'utf-8'));
        score = data.qualityScore;
      } catch {
        // ignore
      }
      return {
        filename: f,
        path: fp,
        mtime: stats.mtimeMs,
        score,
        hasCheckpoint: false,
      };
    })
    .sort((a, b) => b.mtime - a.mtime);

  return files;
}

/**
 * Get all checkpoint directories
 */
function getCheckpoints(): string[] {
  const ckptDir = getCheckpointsDir();
  if (!existsSync(ckptDir)) return [];

  return readdirSync(ckptDir)
    .filter((f) => f.startsWith('ckpt-'))
    .map((f) => join(ckptDir, f))
    .sort()
    .reverse();
}

/**
 * Get all backup files
 */
function getBackups(): string[] {
  const backupDir = join(getRuntimeDir(), 'backups');
  if (!existsSync(backupDir)) return [];

  return readdirSync(backupDir)
    .filter((f) => f.endsWith('.db') || f.endsWith('.zip') || f.endsWith('.tar.gz'))
    .map((f) => join(backupDir, f))
    .sort()
    .reverse();
}

/**
 * Get close reports
 */
function getCloseReports(): string[] {
  const sessionDir = getSessionDir();
  if (!existsSync(sessionDir)) return [];

  return readdirSync(sessionDir)
    .filter((f) => f.startsWith('close-report-') && f.endsWith('.json'))
    .map((f) => join(sessionDir, f))
    .sort()
    .reverse();
}

/**
 * Get temp file registry entries
 */
function getTempFiles(): { path: string; age: number; status: string }[] {
  const registryPath = join(getSessionDir(), 'temp-file-registry.json');
  if (!existsSync(registryPath)) return [];

  try {
    const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
    const entries = registry.entries || [];
    const now = Date.now();
    return entries.map((e: { path: string; createdAt?: string; status?: string }) => ({
      path: e.path,
      age: e.createdAt ? now - new Date(e.createdAt).getTime() : 0,
      status: e.status || 'unknown',
    }));
  } catch {
    return [];
  }
}

/**
 * Prune old session files
 */
function pruneSessions(dryRun: boolean): { removed: number; kept: number } {
  const sessions = getSessionFiles();
  if (sessions.length <= CONFIG.maxSessionFiles) {
    log(`Sessions (${sessions.length}) within limit (${CONFIG.maxSessionFiles})`);
    return { removed: 0, kept: sessions.length };
  }

  const now = Date.now();
  const thirtyDaysAgo = now - CONFIG.sessionAgeThresholdDays * 24 * 60 * 60 * 1000;

  // Separate sessions by score
  const highScoreSessions = sessions.filter((s) => (s.score || 0) >= CONFIG.highScoreThreshold);
  const normalSessions = sessions.filter((s) => (s.score || 0) < CONFIG.highScoreThreshold);

  // Determine how many to keep
  const keepHighScore = Math.min(highScoreSessions.length, CONFIG.extraHighScoreSessions + 5);
  const keepNormal = CONFIG.maxSessionFiles - keepHighScore;

  // Sessions to keep
  const keepList = [
    ...highScoreSessions.slice(0, keepHighScore),
    ...normalSessions.slice(0, keepNormal),
  ].map((s) => s.path);

  // Add sessions from last 30 days regardless of count
  const recentSessions = sessions.filter((s) => s.mtime > thirtyDaysAgo);
  for (const s of recentSessions) {
    if (!keepList.includes(s.path)) {
      keepList.push(s.path);
    }
  }

  // Sessions to remove
  const toRemove = sessions.filter((s) => !keepList.includes(s.path));

  let removed = 0;
  for (const session of toRemove) {
    if (dryRun) {
      log(`[DRY-RUN] Would remove: ${session.filename} (score: ${session.score || 'N/A'})`);
    } else {
      try {
        rmSync(session.path, { force: true });
        log(`Removed: ${session.filename}`, 'ok');
        removed++;
      } catch (e) {
        log(`Failed to remove ${session.filename}: ${e}`, 'warn');
      }
    }
  }

  log(`Session retention: ${removed} removed, ${sessions.length - removed} kept`);
  return { removed, kept: sessions.length - removed };
}

/**
 * Prune old checkpoints (keep only latest N per session pattern)
 */
function pruneCheckpoints(dryRun: boolean): { removed: number; kept: number } {
  const checkpoints = getCheckpoints();
  if (checkpoints.length <= CONFIG.maxCheckpointsPerSession) {
    log(`Checkpoints (${checkpoints.length}) within limit (${CONFIG.maxCheckpointsPerSession})`);
    return { removed: 0, kept: checkpoints.length };
  }

  const toRemove = checkpoints.slice(CONFIG.maxCheckpointsPerSession);
  let removed = 0;

  for (const ckpt of toRemove) {
    if (dryRun) {
      log(`[DRY-RUN] Would remove checkpoint: ${ckpt}`);
    } else {
      try {
        rmSync(ckpt, { recursive: true, force: true });
        log(`Removed checkpoint: ${ckpt.split(/[\\/]/).pop()}`, 'ok');
        removed++;
      } catch (e) {
        log(`Failed to remove checkpoint: ${e}`, 'warn');
      }
    }
  }

  log(`Checkpoint retention: ${removed} removed, ${checkpoints.length - removed} kept`);
  return { removed, kept: checkpoints.length - removed };
}

/**
 * Prune old backups (keep only latest N)
 */
function pruneBackups(dryRun: boolean): { removed: number; kept: number } {
  const backups = getBackups();
  if (backups.length <= CONFIG.maxBackups) {
    log(`Backups (${backups.length}) within limit (${CONFIG.maxBackups})`);
    return { removed: 0, kept: backups.length };
  }

  const toRemove = backups.slice(CONFIG.maxBackups);
  let removed = 0;

  for (const backup of toRemove) {
    if (dryRun) {
      log(`[DRY-RUN] Would remove backup: ${backup}`);
    } else {
      try {
        rmSync(backup, { force: true });
        log(`Removed backup: ${backup.split(/[\\/]/).pop()}`, 'ok');
        removed++;
      } catch (e) {
        log(`Failed to remove backup: ${e}`, 'warn');
      }
    }
  }

  log(`Backup retention: ${removed} removed, ${backups.length - removed} kept`);
  return { removed, kept: backups.length - removed };
}

/**
 * Prune old close reports
 */
function pruneCloseReports(dryRun: boolean): { removed: number; kept: number } {
  const reports = getCloseReports();
  if (reports.length <= CONFIG.maxCloseReports) {
    log(`Close reports (${reports.length}) within limit (${CONFIG.maxCloseReports})`);
    return { removed: 0, kept: reports.length };
  }

  const toRemove = reports.slice(CONFIG.maxCloseReports);
  let removed = 0;

  for (const report of toRemove) {
    if (dryRun) {
      log(`[DRY-RUN] Would remove report: ${report}`);
    } else {
      try {
        rmSync(report, { force: true });
        log(`Removed report: ${report.split(/[\\/]/).pop()}`, 'ok');
        removed++;
      } catch (e) {
        log(`Failed to remove report: ${e}`, 'warn');
      }
    }
  }

  log(`Close report retention: ${removed} removed, ${reports.length - removed} kept`);
  return { removed, kept: reports.length - removed };
}

/**
 * Clean temp files older than threshold
 */
function cleanOldTempFiles(dryRun: boolean): { removed: number; kept: number } {
  const tempFiles = getTempFiles();
  const oneWeekAgo = 7 * 24 * 60 * 60 * 1000;

  const oldTemps = tempFiles.filter((t) => t.age > oneWeekAgo && t.status === 'temporary');

  let removed = 0;
  for (const temp of oldTemps) {
    if (dryRun) {
      log(`[DRY-RUN] Would clean temp file: ${temp.path}`);
    } else {
      try {
        const fullPath = join(ROOT, temp.path);
        if (existsSync(fullPath)) {
          rmSync(fullPath, { force: true });
          removed++;
        }
      } catch {
        // ignore
      }
    }
  }

  log(`Temp file cleanup: ${removed} removed, ${tempFiles.length - oldTemps.length} kept`);
  return { removed, kept: tempFiles.length - removed };
}

/**
 * Print retention status
 */
function printStatus() {
  console.log('\n═══════════════════════════════════════════');
  console.log('  SESSION RETENTION STATUS');
  console.log('═══════════════════════════════════════════\n');

  const sessions = getSessionFiles();
  const checkpoints = getCheckpoints();
  const backups = getBackups();
  const reports = getCloseReports();
  const tempFiles = getTempFiles();

  console.log(`📁 Session Files: ${sessions.length} (max: ${CONFIG.maxSessionFiles})`);
  if (sessions.length > CONFIG.maxSessionFiles) {
    console.log(`   ⚠️  OVER LIMIT - run prune`);
  }

  console.log(`📦 Checkpoints: ${checkpoints.length} (max: ${CONFIG.maxCheckpointsPerSession})`);
  if (checkpoints.length > CONFIG.maxCheckpointsPerSession) {
    console.log(`   ⚠️  OVER LIMIT - run prune`);
  }

  console.log(`💾 Backups: ${backups.length} (max: ${CONFIG.maxBackups})`);
  if (backups.length > CONFIG.maxBackups) {
    console.log(`   ⚠️  OVER LIMIT - run prune`);
  }

  console.log(`📄 Close Reports: ${reports.length} (max: ${CONFIG.maxCloseReports})`);
  if (reports.length > CONFIG.maxCloseReports) {
    console.log(`   ⚠️  OVER LIMIT - run prune`);
  }

  console.log(`🗑️  Temp Files: ${tempFiles.length} (auto-cleanup on exit)`);

  console.log('\n─── Recent Sessions ───');
  for (const s of sessions.slice(0, 5)) {
    const date = new Date(s.mtime).toISOString().slice(0, 16).replace('T', ' ');
    const score = s.score !== undefined ? `score: ${s.score}` : 'no score';
    console.log(
      `  ${date} — ${s.filename.split('-').slice(1).join('-').replace('.json', '')} [${score}]`,
    );
  }
  if (sessions.length > 5) {
    console.log(`  ... and ${sessions.length - 5} more`);
  }

  console.log('\n═══════════════════════════════════════════\n');
}

/**
 * Full prune operation
 */
function runPrune(dryRun: boolean = false) {
  if (dryRun) {
    log('Running in DRY-RUN mode - no files will be deleted');
  }

  console.log('\n═══════════════════════════════════════════');
  console.log(dryRun ? '  PRUNE (DRY RUN)' : '  PRUNE');
  console.log('═══════════════════════════════════════════\n');

  const sessionResult = pruneSessions(dryRun);
  const checkpointResult = pruneCheckpoints(dryRun);
  const backupResult = pruneBackups(dryRun);
  const reportResult = pruneCloseReports(dryRun);
  const tempResult = cleanOldTempFiles(dryRun);

  console.log('\n─── Summary ───');
  console.log(`Sessions: ${sessionResult.removed} removed, ${sessionResult.kept} kept`);
  console.log(`Checkpoints: ${checkpointResult.removed} removed, ${checkpointResult.kept} kept`);
  console.log(`Backups: ${backupResult.removed} removed, ${backupResult.kept} kept`);
  console.log(`Close Reports: ${reportResult.removed} removed, ${reportResult.kept} kept`);
  console.log(`Temp Files: ${tempResult.removed} removed, ${tempResult.kept} kept`);

  console.log('\n═══════════════════════════════════════════\n');

  return {
    sessions: sessionResult,
    checkpoints: checkpointResult,
    backups: backupResult,
    reports: reportResult,
    temps: tempResult,
  };
}

// CLI
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log('Session Retention Manager');
    console.log('');
    console.log('Usage:');
    console.log('  npx tsx src/session/session-retention.ts prune [--dry-run]');
    console.log('  npx tsx src/session/session-retention.ts status');
    console.log('');
    console.log('Commands:');
    console.log('  prune     - Remove old sessions, checkpoints, backups');
    console.log('  status    - Show current retention status');
    console.log('  --dry-run - Show what would be removed without deleting');
  } else if (args[0] === 'prune') {
    const dryRun = args.includes('--dry-run') || args.includes('-n');
    runPrune(dryRun);
  } else if (args[0] === 'status') {
    printStatus();
  } else {
    // Default: show status
    printStatus();
  }
}
