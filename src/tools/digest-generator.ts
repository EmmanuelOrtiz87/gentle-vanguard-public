#!/usr/bin/env node
/**
 * Generates proactive daily/status digests summarizing system activity.
 * TS migration of scripts/utilities/reporting/DIGEST/digest-generator.ps1
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { runSync } from '../core/run-command.js';
import { pathToFileURL } from 'url';
import { getEffectiveProcessTimeout } from '../core/timeout-config';

type DigestMode = 'daily' | 'status' | 'weekly';

const ROOT = resolve(process.cwd());

function findRepoRoot(dir: string): string {
  let current = resolve(dir);
  while (current) {
    if (existsSync(join(current, 'config', 'orchestrator.json'))) return current;
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return dir;
}

function main(): void {
  const args = process.argv.slice(2);
  const mode = (
    args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'status'
  ) as DigestMode;
  const asJson = args.includes('--json') || args.includes('-JSON');
  const show = args.includes('--show') || args.includes('-Show');
  const noExit = args.includes('--no-exit') || args.includes('-NoExit');

  const repoRoot =
    process.env.GENTLE_VANGUARD_BASE_DIR && existsSync(process.env.GENTLE_VANGUARD_BASE_DIR)
      ? process.env.GENTLE_VANGUARD_BASE_DIR
      : findRepoRoot(ROOT);

  const digestDir = join(repoRoot, '.session', 'digests');
  mkdirSync(digestDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const digestFile = join(digestDir, `${today}.md`);

  const sessionFile = join(repoRoot, '.session', 'session.json');
  const summaryFile = join(join(repoRoot, 'scripts'), '.session', 'startup-summary.json');
  const feedbackFile = join(repoRoot, '.session', 'feedback', 'feedback.jsonl');
  const proposalsDir = join(repoRoot, '.local', 'improvement-proposals');
  const tokenFile = join(repoRoot, '.session', 'token-spend.json');

  let sessionId = '';
  if (existsSync(sessionFile)) {
    try {
      sessionId = JSON.parse(readFileSync(sessionFile, 'utf-8')).sessionId || '';
    } catch {
      /* ignore */
    }
  }

  let platform = '';
  let tool = '';
  if (existsSync(summaryFile)) {
    try {
      const s = JSON.parse(readFileSync(summaryFile, 'utf-8'));
      platform = s.platform || '';
      tool = s.tool || '';
    } catch {
      /* ignore */
    }
  }

  let branch = '';
  let commitCount = 0;
  try {
    branch = runSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: repoRoot,
      timeout: getEffectiveProcessTimeout('git'),
    }).stdout.trim();
    const since = new Date(Date.now() - 86400000).toISOString().slice(0, 19);
    const log = runSync('git', ['log', '--oneline', `--since=${since}`], {
      cwd: repoRoot,
      timeout: getEffectiveProcessTimeout('git'),
    }).stdout;
    commitCount = log.trim() ? log.split('\n').length : 0;
  } catch {
    /* git not available */
  }

  let healthStatus = 'unknown';
  const healthScript = join(
    repoRoot,
    'scripts',
    'utilities',
    'SKILLS-TOOLS',
    'ensure-tools-active.ps1',
  );
  if (existsSync(healthScript)) {
    try {
      const r = runSync('pwsh', ['-NoProfile', '-File', healthScript, '-AutoStart', '-Quiet'], {
        cwd: repoRoot,
        timeout: getEffectiveProcessTimeout('health_check'),
      });
      if (r.status === 0) healthStatus = 'ok';
      else healthStatus = 'warn';
    } catch {
      healthStatus = 'warn';
    }
  }

  let feedbackEntries: Array<{
    timestamp?: string;
    rate?: number;
    action?: string;
    comment?: string;
  }> = [];
  if (existsSync(feedbackFile)) {
    try {
      const raw = readFileSync(feedbackFile, 'utf-8')
        .split('\n')
        .filter((l) => l.trim());
      feedbackEntries = raw
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {
      /* ignore */
    }
  }
  const weekAgo = Date.now() - 7 * 86400000;
  const recentFeedback = feedbackEntries.filter(
    (e) => e.timestamp && new Date(e.timestamp).getTime() >= weekAgo,
  );
  const rated = recentFeedback.filter((e) => (e.rate ?? 0) > 0);
  const avgRating =
    rated.length > 0
      ? Math.round((rated.reduce((s, e) => s + (e.rate ?? 0), 0) / rated.length) * 10) / 10
      : 0;

  let pendingProposals = 0;
  if (existsSync(proposalsDir)) {
    try {
      pendingProposals = readdirSync(proposalsDir).filter((f) => f.endsWith('.json')).length;
    } catch {
      /* ignore */
    }
  }

  let tokenSpend = '';
  if (existsSync(tokenFile)) {
    try {
      const t = JSON.parse(readFileSync(tokenFile, 'utf-8'));
      tokenSpend = t.totalCost ? `$${Math.round(t.totalCost * 100) / 100}` : 'N/A';
    } catch {
      /* ignore */
    }
  }

  if (asJson) {
    console.log(
      JSON.stringify({
        date: today,
        mode,
        sessionId,
        platform,
        tool,
        branch,
        commits24h: commitCount,
        health: healthStatus,
        feedback: { totalRecent: recentFeedback.length, avgRating },
        proposals: { pending: pendingProposals },
        tokenSpend,
      }),
    );
    if (!noExit) process.exit(0);
    return;
  }

  const lines: string[] = [];
  lines.push(
    `# Digest: ${today}`,
    `**Mode**: ${mode}  |  **Session**: ${sessionId}  |  **Platform**: ${platform}  |  **Tool**: ${tool}`,
  );
  if (branch) lines.push(`**Branch**: ${branch}  |  **Commits (24h)**: ${commitCount}`);
  lines.push(
    '',
    '## Health',
    `- System: ${{ ok: 'OK', warn: 'Warning', unknown: 'Unknown' }[healthStatus] || 'Unknown'}`,
  );
  if (tokenSpend) lines.push(`- Token spend: ${tokenSpend}`);
  lines.push('');

  if (recentFeedback.length > 0) {
    lines.push(
      `## Feedback (7 days)`,
      `- Entries: ${recentFeedback.length}, Avg rating: ${avgRating}/5`,
    );
    for (const e of rated.filter((e) => (e.rate ?? 0) <= 2)) {
      lines.push(`  - * ${e.rate}/5 (${e.action || ''}): '${e.comment || ''}'`);
    }
    lines.push('');
  }

  if (pendingProposals > 0) {
    lines.push(
      `## Pending Proposals`,
      `- ${pendingProposals} pending improvement(s)`,
      `- Run \`gv learning apply\` or \`gv digest\` to review`,
      '',
    );
  }

  lines.push(
    '## Next Steps',
    '- Review digest: `gv digest`',
    '- Submit feedback: `gv feedback rate 4 -Action <action> -Comment "..."`',
    '- Apply learnings: `gv learning auto`',
    '-',
  );

  const digest = lines.join('\n');
  writeFileSync(digestFile, digest, 'utf-8');
  console.log(`[OK] Digest saved to ${digestFile}`);

  if (mode === 'status' || show) process.stdout.write(`\n${digest}\n`);
  if (!noExit) process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
