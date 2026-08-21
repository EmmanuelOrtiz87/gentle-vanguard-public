#!/usr/bin/env node
/**
 * Skill nudge — generates nudges for failing skills based on usage metrics.
 * TS migration of scripts/skills/skill-nudge.ps1
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

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

interface SkillMetric {
  skillName: string;
  useCount: number;
  lastUsedAt: string | null;
  failureCount: number;
  failurePatterns: Array<{ errorType: string; timestamp: string; description: string }>;
  successRate: number;
  lastOutcome: string | null;
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
const usageDir = join(repoRoot, '.session', 'skill-usage');
const nudgeDir = join(repoRoot, '.session', 'skill-nudges');

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function getNudgeSequence(): number {
  const seqFile = join(nudgeDir, '.sequence');
  let seq = 1;
  if (existsSync(seqFile)) {
    try {
      seq = parseInt(readFileSync(seqFile, 'utf-8').trim(), 10) + 1;
    } catch {
      /* */
    }
  }
  writeFileSync(seqFile, String(seq), 'utf-8');
  return seq;
}

function getPreviousFailures(skillName: string): number {
  const files = existsSync(nudgeDir)
    ? readdirSync(nudgeDir).filter((f) => f.endsWith('.json') && f !== '.sequence')
    : [];
  let total = 0;
  for (const f of files) {
    try {
      const n: Nudge = JSON.parse(readFileSync(join(nudgeDir, f), 'utf-8'));
      if (n.skillName === skillName && n.issueType === 'failure_pattern') total++;
    } catch {
      /* */
    }
  }
  return total;
}

function writeNudge(
  skillName: string,
  issueType: string,
  evidence: string,
  fixPattern: string,
  urgent: boolean,
): Nudge {
  ensureDir(nudgeDir);
  const seq = getNudgeSequence();
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const nudgeId = `nudge-${date}-${String(seq).padStart(3, '0')}`;
  const nudge: Nudge = {
    nudgeId,
    date: new Date().toISOString(),
    skillName,
    trigger: 'auto',
    issueType,
    evidence,
    fixPattern,
    urgent,
    applied: false,
  };
  writeFileSync(join(nudgeDir, `${nudgeId}.json`), JSON.stringify(nudge, null, 2), 'utf-8');
  console.log(`[NUDGE] Created ${nudgeId} (${issueType}, urgent=${urgent})`);
  return nudge;
}

function generateNudges(): void {
  ensureDir(usageDir);
  ensureDir(nudgeDir);

  const usageFiles = existsSync(usageDir)
    ? readdirSync(usageDir).filter((f) => f.endsWith('.json'))
    : [];
  if (usageFiles.length === 0) {
    console.log('[INFO] No usage data found');
    return;
  }

  const allMetrics: SkillMetric[] = [];
  const sessionFailures: Record<string, { failures: number; hasFailures: boolean }> = {};
  const today = new Date().toISOString().slice(0, 10);

  for (const f of usageFiles) {
    try {
      const m: SkillMetric = JSON.parse(readFileSync(join(usageDir, f), 'utf-8'));
      allMetrics.push(m);
      const lastUse = m.lastUsedAt ? new Date(m.lastUsedAt) : null;
      if (lastUse && lastUse.toISOString().slice(0, 10) === today && m.lastOutcome === 'failure') {
        if (!sessionFailures[m.skillName])
          sessionFailures[m.skillName] = { failures: 0, hasFailures: false };
        sessionFailures[m.skillName].failures++;
        sessionFailures[m.skillName].hasFailures = true;
      }
      if (m.failureCount > 0) {
        if (!sessionFailures[m.skillName])
          sessionFailures[m.skillName] = { failures: 0, hasFailures: false };
        sessionFailures[m.skillName].hasFailures = true;
      }
    } catch {
      /* */
    }
  }

  let nudgeCount = 0;
  for (const m of allMetrics) {
    const sf = sessionFailures[m.skillName];
    if (!sf) continue;

    if (sf.hasFailures && m.failureCount > 0) {
      const skillMdPath = join(repoRoot, 'skills', m.skillName, 'SKILL.md');
      const altPath = join(repoRoot, 'skills', m.skillName, 'skill.md');
      let hasSection = false;
      if (existsSync(skillMdPath))
        hasSection = /## Known Issues|## Failure Patterns/.test(readFileSync(skillMdPath, 'utf-8'));
      else if (existsSync(altPath))
        hasSection = /## Known Issues|## Failure Patterns/.test(readFileSync(altPath, 'utf-8'));
      if (hasSection) {
        console.log(`[NUDGE] Skip ${m.skillName} — Known Issues section already exists`);
        continue;
      }

      const evidence = `${m.failureCount} total failures, ${sf.failures} in current session`;
      const errorType = m.failurePatterns[0]?.errorType || '';
      const fixPattern =
        {
          timeout: 'Add timeout configuration and retry logic',
          syntax: 'Add syntax validation before execution',
          logic: 'Review conditional logic and edge cases',
          missing_dependency: 'Add dependency check at start of skill execution',
        }[errorType] || 'Review failure patterns and update SKILL.md with known issues';
      const pastCount = getPreviousFailures(m.skillName);
      const isUrgent = pastCount >= 3 || (m.useCount >= 5 && m.successRate < 0.5);
      writeNudge(m.skillName, 'failure_pattern', evidence, fixPattern, isUrgent);
      nudgeCount++;
    }

    if (m.useCount >= 10 && m.successRate < 0.7) {
      const evidence = `Success rate ${m.successRate} after ${m.useCount} uses`;
      const isUrgent = m.successRate < 0.4;
      writeNudge(
        m.skillName,
        'declining_rate',
        evidence,
        'Review skill triggers and core rules for accuracy',
        isUrgent,
      );
      nudgeCount++;
    }

    if (m.useCount <= 1 && !m.lastUsedAt) {
      const metricFile = join(usageDir, `${m.skillName}.json`);
      if (existsSync(metricFile)) {
        try {
          const created = new Date(readFileSync(metricFile, 'utf-8').slice(0, 10));
          const ageDays = (Date.now() - created.getTime()) / 86400000;
          if (ageDays > 7) {
            writeNudge(
              m.skillName,
              'underused',
              `Never used in ${Math.round(ageDays)} days`,
              'Check if skill triggers are too narrow or skill is deprecated',
              false,
            );
            nudgeCount++;
          }
        } catch {
          /* */
        }
      }
    }
  }

  console.log(`[OK] Generated ${nudgeCount} nudges`);
}

function showReport(): void {
  const nudgeFiles = existsSync(nudgeDir)
    ? readdirSync(nudgeDir)
        .filter((f) => f.endsWith('.json') && f !== '.sequence')
        .sort()
        .reverse()
    : [];
  if (nudgeFiles.length === 0) {
    console.log('[INFO] No nudges found');
    return;
  }

  console.log(`\n=== Skill Nudge Report ===`);
  let urgentCount = 0,
    pendingCount = 0;
  for (const f of nudgeFiles) {
    try {
      const n: Nudge = JSON.parse(readFileSync(join(nudgeDir, f), 'utf-8'));
      if (n.urgent) urgentCount++;
      if (!n.applied) pendingCount++;
      console.log(
        `${n.nudgeId} | ${n.skillName} | ${n.issueType} | ${n.urgent ? 'yes' : 'no'} | ${n.applied ? 'yes' : 'no'}`,
      );
    } catch {
      /* */
    }
  }
  console.log(`\nTotal: ${nudgeFiles.length} | Urgent: ${urgentCount} | Pending: ${pendingCount}`);
}

function main(): void {
  const args = process.argv.slice(2);
  const report = args.includes('--report');

  if (report) {
    showReport();
    return;
  }
  generateNudges();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
