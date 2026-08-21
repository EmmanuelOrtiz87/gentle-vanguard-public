#!/usr/bin/env node
/**
 * Skill auto-patch — auto-applies nudges by documenting failure patterns in SKILL.md.
 * TS migration of scripts/skills/skill-auto-patch.ps1
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

interface Nudge {
  nudgeId: string;
  date: string;
  skillName: string;
  trigger: string;
  issueType: string;
  evidence: string;
  fixPattern: string;
  urgent: boolean;
  applied: boolean;
}

interface NudgeEntry {
  nudge: Nudge;
  path: string;
}

interface PatchResult {
  nudgeId: string;
  skill: string;
  action: 'patched' | 'skipped' | 'failed';
  reason: string;
}

interface UsageMetric {
  skillName: string;
  useCount: number;
  failureCount: number;
  failurePatterns: Array<{
    errorType: string;
    timestamp: string;
    description: string;
    fixApplied: string | null;
  }>;
  successRate: number;
}

const ROOT = resolve(process.cwd());

function findRepoRoot(dir: string): string {
  let current = resolve(dir);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return dir;
}

const repoRoot =
  process.env.GENTLE_VANGUARD_BASE_DIR && existsSync(process.env.GENTLE_VANGUARD_BASE_DIR)
    ? process.env.GENTLE_VANGUARD_BASE_DIR
    : findRepoRoot(ROOT);
const nudgeDir = join(repoRoot, '.session', 'skill-nudges');
const skillsDir = join(repoRoot, 'skills');

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function padRight(s: string, len: number): string {
  return s.length > len ? s.substring(0, len - 3) + '...' : s + ' '.repeat(len - s.length);
}

function log(level: 'OK' | 'WARN' | 'ERROR' | 'APPLY' | 'INFO', message: string): void {
  const prefix = `[${level}]`;
  console.log(`${prefix} ${message}`);
}

// Parse CLI args
const args = process.argv.slice(2);
const autoApply = args.includes('--auto-apply');
const skillName = (() => {
  const idx = args.indexOf('--skill-name');
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  const idx2 = args.indexOf('--skill');
  if (idx2 !== -1 && idx2 + 1 < args.length) return args[idx2 + 1];
  return '';
})();
const reportMode = args.includes('--report');

function getPendingNudges(): NudgeEntry[] {
  if (!existsSync(nudgeDir)) return [];
  const files = readdirSync(nudgeDir).filter((f) => f.endsWith('.json') && f !== '.sequence');
  const pending: NudgeEntry[] = [];
  for (const file of files) {
    try {
      const nudge: Nudge = JSON.parse(readFileSync(join(nudgeDir, file), 'utf-8'));
      if (nudge.applied) continue;
      if (skillName && nudge.skillName !== skillName) continue;
      pending.push({ nudge, path: join(nudgeDir, file) });
    } catch (e) {
      log('WARN', `Failed to parse ${file}: ${e}`);
    }
  }
  return pending;
}

function getSkillMdPath(skill: string): string | null {
  const direct = join(skillsDir, skill, 'SKILL.md');
  if (existsSync(direct)) return direct;
  const lower = join(skillsDir, skill, 'skill.md');
  if (existsSync(lower)) return lower;

  if (!existsSync(skillsDir)) return null;
  const dirs = readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const d of dirs) {
    const dirName = d.name;
    if (dirName === skill || dirName === `${skill}-skill`) {
      const mdPath = join(skillsDir, dirName, 'SKILL.md');
      if (existsSync(mdPath)) return mdPath;
    }
  }
  return null;
}

function addFailureSectionToSkill(
  mdPath: string,
  fixPattern: string,
  skill: string,
  failures: Array<{
    errorType: string;
    timestamp: string;
    description: string;
    fixApplied: string | null;
  }>,
): boolean {
  const content = readFileSync(mdPath, 'utf-8');

  const hasIssues = /## Known Issues/i.test(content);
  const hasFailures = /## Failure Patterns/i.test(content);
  if (hasIssues || hasFailures) {
    log('WARN', `${skill} already has Known Issues / Failure Patterns section`);
    return false;
  }

  const lines: string[] = [];
  lines.push('');
  lines.push('## Known Issues');
  lines.push('');
  lines.push('The following failure pattern has been detected and documented automatically:');
  lines.push('');
  lines.push(`- **Issue**: ${fixPattern}`);

  if (failures.length > 0) {
    const distinct = [...new Set(failures.map((f) => f.errorType))];
    lines.push(`- **Error types observed**: ${distinct.join(', ')}`);
  }

  lines.push('');
  lines.push(`> Auto-documented by skill-auto-patch on ${new Date().toISOString().split('T')[0]}.`);
  lines.push('');

  const newContent = content.trimEnd() + '\n' + lines.join('\n');
  writeFileSync(mdPath, newContent, 'utf-8');
  return true;
}

function invokeAutoPatch(): PatchResult[] {
  const pending = getPendingNudges();
  if (pending.length === 0) {
    log('OK', 'No pending nudges to process');
    return [];
  }

  const applied: PatchResult[] = [];
  for (const entry of pending) {
    const { nudge, path } = entry;
    log('INFO', `Evaluating ${nudge.nudgeId} (${nudge.skillName}, ${nudge.issueType})`);

    let shouldApply = false;
    let reason = '';

    if (nudge.urgent) {
      shouldApply = true;
      reason = 'urgent flag set';
    } else if (autoApply) {
      shouldApply = true;
      reason = '--auto-apply flag';
    } else {
      const samePattern = pending.filter(
        (p) =>
          p.nudge.skillName === nudge.skillName &&
          p.nudge.fixPattern === nudge.fixPattern &&
          p.nudge.nudgeId !== nudge.nudgeId,
      );
      if (samePattern.length >= 1) {
        shouldApply = true;
        reason = `fixPattern repeated ${samePattern.length + 1} times`;
      }
    }

    if (!shouldApply) {
      log('WARN', `Skipping ${nudge.nudgeId} — not urgent, use --auto-apply`);
      applied.push({
        nudgeId: nudge.nudgeId,
        skill: nudge.skillName,
        action: 'skipped',
        reason: 'not urgent, use --auto-apply',
      });
      continue;
    }

    const mdPath = getSkillMdPath(nudge.skillName);
    if (!mdPath) {
      log('ERROR', `SKILL.md not found for ${nudge.skillName}`);
      applied.push({
        nudgeId: nudge.nudgeId,
        skill: nudge.skillName,
        action: 'failed',
        reason: 'SKILL.md not found',
      });
      continue;
    }

    log('APPLY', `Applying patch to ${mdPath}`);

    // Load usage metrics to get failure patterns
    let failures: Array<{
      errorType: string;
      timestamp: string;
      description: string;
      fixApplied: string | null;
    }> = [];
    const usagePath = join(repoRoot, '.session', 'skill-usage', `${nudge.skillName}.json`);
    if (existsSync(usagePath)) {
      try {
        const um: UsageMetric = JSON.parse(readFileSync(usagePath, 'utf-8'));
        failures = um.failurePatterns || [];
      } catch {
        /* ignore */
      }
    }

    const patched = addFailureSectionToSkill(mdPath, nudge.fixPattern, nudge.skillName, failures);
    if (patched) {
      nudge.applied = true;
      writeFileSync(path, JSON.stringify(nudge, null, 2), 'utf-8');
      log('APPLY', `Patched ${nudge.skillName} with: ${nudge.fixPattern}`);
      applied.push({ nudgeId: nudge.nudgeId, skill: nudge.skillName, action: 'patched', reason });
    } else {
      applied.push({
        nudgeId: nudge.nudgeId,
        skill: nudge.skillName,
        action: 'skipped',
        reason: 'section already exists',
      });
    }
  }

  return applied;
}

function invokeReport(): void {
  if (!existsSync(nudgeDir)) {
    log('INFO', 'No nudge files found');
    return;
  }
  const files = readdirSync(nudgeDir).filter((f) => f.endsWith('.json') && f !== '.sequence');
  if (files.length === 0) {
    log('INFO', 'No nudge files found');
    return;
  }

  log('INFO', '=== Auto-Patch Dry Run ===');
  const rows: Array<{
    nudgeId: string;
    skill: string;
    issueType: string;
    urgent: boolean;
    fix: string;
    skillMd: string;
    wouldPatch: boolean;
  }> = [];

  for (const file of files) {
    try {
      const nudge: Nudge = JSON.parse(readFileSync(join(nudgeDir, file), 'utf-8'));
      if (nudge.applied) continue;
      if (skillName && nudge.skillName !== skillName) continue;
      const mdPath = getSkillMdPath(nudge.skillName);
      const mdExists = mdPath ? 'found' : 'NOT FOUND';
      rows.push({
        nudgeId: nudge.nudgeId,
        skill: nudge.skillName,
        issueType: nudge.issueType,
        urgent: nudge.urgent,
        fix: nudge.fixPattern,
        skillMd: mdExists,
        wouldPatch: nudge.urgent || autoApply,
      });
    } catch {
      /* skip corrupt */
    }
  }

  if (rows.length === 0) {
    log('OK', 'No pending nudges matching criteria');
    return;
  }

  console.log(
    padRight('Nudge', 30),
    padRight('Skill', 20),
    padRight('Type', 12),
    padRight('Urgent', 8),
    padRight('SKILL.md', 12),
    'Would Patch',
  );
  console.log(
    padRight('-----', 30),
    padRight('-----', 20),
    padRight('----', 12),
    padRight('------', 8),
    padRight('-------', 12),
    '-----------',
  );
  let wouldPatchCount = 0;
  for (const row of rows) {
    const urgent = row.urgent ? 'yes' : 'no';
    const wp = row.wouldPatch ? 'yes' : 'no-dry';
    if (row.wouldPatch) wouldPatchCount++;
    console.log(
      padRight(row.nudgeId, 30),
      padRight(row.skill, 20),
      padRight(row.issueType, 12),
      padRight(urgent, 8),
      padRight(row.skillMd, 12),
      wp,
    );
  }
  log('INFO', `${rows.length} pending, ${wouldPatchCount} would be applied`);
}

// === Main ===
ensureDir(nudgeDir);

if (reportMode) {
  invokeReport();
  process.exit(0);
}

const results = invokeAutoPatch();
const patched = results.filter((r) => r.action === 'patched');
const skipped = results.filter((r) => r.action === 'skipped');
const failed = results.filter((r) => r.action === 'failed');

log('OK', `Results: ${patched.length} patched, ${skipped.length} skipped, ${failed.length} failed`);

if (patched.length > 0) {
  log('OK', 'Patched skills:');
  for (const p of patched) {
    log('OK', `  - ${p.skill} (${p.reason})`);
  }
}

process.exit(0);
