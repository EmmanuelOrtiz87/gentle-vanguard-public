#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { runSync } from './core/run-command.js';
import { getTokenUsage } from './tokens/token-usage-reader.js';

type Scope = 'full' | 'sessions' | 'token' | 'live' | 'git' | 'pr' | 'cost';

interface CollectorArgs {
  scope: Scope;
  quiet: boolean;
}

function parseArgs(): CollectorArgs {
  const args = process.argv.slice(2);
  let scope: Scope = 'full';
  const scopeIdx = args.indexOf('--scope');
  if (scopeIdx !== -1 && scopeIdx + 1 < args.length) {
    const val = args[scopeIdx + 1] as Scope;
    if (['full', 'sessions', 'token', 'live', 'git', 'pr', 'cost'].includes(val)) scope = val;
  }
  return { scope, quiet: args.includes('--quiet') || args.includes('-q') };
}

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

const ROOT = resolve(process.cwd());
const repoRoot =
  process.env.GENTLE_VANGUARD_BASE_DIR && existsSync(process.env.GENTLE_VANGUARD_BASE_DIR)
    ? process.env.GENTLE_VANGUARD_BASE_DIR
    : findRepoRoot(ROOT);
const outDir = join(repoRoot, '.runtime', 'metrics');
const sessionsDir = join(repoRoot, 'session');
const tokenState = join(repoRoot, '.session', 'token-autopilot-state.json');
const liveObsPath = join(repoRoot, 'reports', 'stack-live-observability-latest.json');

mkdirSync(outDir, { recursive: true });
mkdirSync(join(outDir, 'aggregates'), { recursive: true });
mkdirSync(join(outDir, 'snapshots'), { recursive: true });

function log(m: string, quiet: boolean): void {
  if (!quiet) console.log(`[METRICS] ${m}`);
}

function runGit(args: string[], cwd?: string): string {
  try {
    return runSync('git', args, { cwd: cwd || repoRoot, stdio: 'pipe' }).stdout.trim();
  } catch {
    return '';
  }
}

function tryReadJson(p: string): Record<string, unknown> | null {
  try {
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    /* ignore */
  }
  return null;
}

function writeJson(p: string, data: unknown, _depth = 3): void {
  writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

interface GitMetrics {
  collectedAt: string;
  totalCommits: number;
  monthCommits: number;
  weekCommits: number;
  todayCommits: number;
  linesAdded30: number;
  linesRemoved30: number;
  authors: Record<string, number>;
  authorCount: number;
  topAuthor: string | null;
}

function collectGitMetrics(quiet: boolean): GitMetrics {
  log('Collecting git metrics...', quiet);
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const weekStart = new Date(now.getTime() - now.getDay() * 86400000).toISOString().slice(0, 10);

  const totalCommits = parseInt(runGit(['rev-list', '--count', 'HEAD']) || '0', 10);
  const monthCommits = runGit(['log', '--oneline', `--since="${monthStart}"`])
    .split('\n')
    .filter(Boolean).length;
  const weekCommits = runGit(['log', '--oneline', `--since="${weekStart}"`])
    .split('\n')
    .filter(Boolean).length;
  const todayCommits = runGit(['log', '--oneline', `--since="${today}"`])
    .split('\n')
    .filter(Boolean).length;

  const authors: Record<string, number> = {};
  const shortlog = runGit(['shortlog', '-sn', '--all']);
  for (const line of shortlog.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(.+)$/);
    if (m) authors[m[2]] = parseInt(m[1], 10);
  }

  let linesAdded = 0,
    linesRemoved = 0;
  const diffStat = runGit(['diff', '--stat', 'HEAD~30..HEAD']);
  for (const line of diffStat.split('\n')) {
    const addM = line.match(/(\d+) insertion/);
    if (addM) linesAdded += parseInt(addM[1], 10);
    const delM = line.match(/(\d+) deletion/);
    if (delM) linesRemoved += parseInt(delM[1], 10);
  }

  const authorEntries = Object.entries(authors);
  const topAuthor =
    authorEntries.length > 0 ? authorEntries.sort((a, b) => b[1] - a[1])[0][0] : null;

  const gm: GitMetrics = {
    collectedAt: new Date().toISOString(),
    totalCommits,
    monthCommits,
    weekCommits,
    todayCommits,
    linesAdded30: linesAdded,
    linesRemoved30: linesRemoved,
    authors,
    authorCount: authorEntries.length,
    topAuthor,
  };

  writeJson(join(outDir, 'git.json'), gm);
  log(
    `Git: ${totalCommits} total, ${monthCommits} month, ${todayCommits} today, ${linesAdded}+/${linesRemoved}- lines (30 commits)`,
    quiet,
  );
  return gm;
}

interface PRMetrics {
  collectedAt: string;
  total: number;
  open: number;
  merged: number;
  closed: number;
  totalAdditions: number;
  totalDeletions: number;
  avgReviewTimeHours: number;
  recent: unknown[];
}

function collectPRMetrics(quiet: boolean): PRMetrics {
  log('Collecting PR metrics...', quiet);
  const pm: PRMetrics = {
    collectedAt: new Date().toISOString(),
    total: 0,
    open: 0,
    merged: 0,
    closed: 0,
    totalAdditions: 0,
    totalDeletions: 0,
    avgReviewTimeHours: 0,
    recent: [],
  };

  try {
    runSync('gh', ['--version'], { stdio: 'pipe' });
  } catch {
    writeJson(join(outDir, 'pr.json'), pm);
    log('PR: gh CLI not available', quiet);
    return pm;
  }

  try {
    const raw = runSync(
      'gh',
      [
        'pr',
        'list',
        '--state',
        'all',
        '--limit',
        '100',
        '--json',
        'number,title,state,createdAt,closedAt,mergedAt,additions,deletions,author',
      ],
      { stdio: 'pipe' },
    ).stdout.trim();
    const prs = JSON.parse(raw) as Array<Record<string, unknown>>;
    pm.total = prs.length;
    pm.merged = prs.filter((p) => (p.state as string)?.toUpperCase() === 'MERGED').length;
    pm.open = prs.filter((p) => (p.state as string)?.toUpperCase() === 'OPEN').length;
    pm.closed = prs.filter((p) => (p.state as string)?.toUpperCase() === 'CLOSED').length;
    pm.totalAdditions = prs.reduce(
      (s, p) => s + (typeof p.additions === 'number' ? p.additions : 0),
      0,
    );
    pm.totalDeletions = prs.reduce(
      (s, p) => s + (typeof p.deletions === 'number' ? p.deletions : 0),
      0,
    );

    const reviewTimes: number[] = [];
    for (const pr of prs) {
      if (pr.createdAt && (pr.mergedAt || pr.closedAt)) {
        const end = pr.mergedAt || pr.closedAt;
        const hours =
          (new Date(end as string).getTime() - new Date(pr.createdAt as string).getTime()) /
          3600000;
        if (hours >= 0) reviewTimes.push(hours);
      }
    }
    if (reviewTimes.length > 0) {
      pm.avgReviewTimeHours =
        Math.round((reviewTimes.reduce((a, b) => a + b, 0) / reviewTimes.length) * 10) / 10;
    }

    const sorted = [...prs].sort(
      (a, b) =>
        new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime(),
    );
    pm.recent = sorted.slice(0, 10);
  } catch {
    log('PR: collection failed', quiet);
  }

  writeJson(join(outDir, 'pr.json'), pm, 4);
  log(`PR: ${pm.total} total, ${pm.merged} merged, avg ${pm.avgReviewTimeHours}h lifecycle`, quiet);
  return pm;
}

interface SessionMetrics {
  collectedAt: string;
  total: number;
  active: number;
  inactive: number;
  today: number;
  avgDurationSec: number;
  totalDurationMin: number;
  latestId: string;
  latestStart: string;
}

interface SessionEntry {
  sessionId?: string;
  startTime?: string;
  status?: string;
  mode?: string;
  project?: string;
  durationSec: number;
  isToday: boolean;
  sourceFile: string;
}

function collectSessionMetrics(quiet: boolean): SessionEntry[] {
  log('Collecting session metrics...', quiet);
  const sessions: SessionEntry[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (existsSync(sessionsDir)) {
    // Native directory scan — no shell glob needed (quoting-safe).
    const files = readdirSync(sessionsDir)
      .filter((f) => f.startsWith('session-') && f.endsWith('.json'))
      .join('\n');
    if (files) {
      for (const f of files.split('\n')) {
        const fp = join(sessionsDir, f.trim());
        try {
          const raw = readFileSync(fp, 'utf8');
          const s = JSON.parse(raw);
          const start = s.startTime ? new Date(s.startTime) : new Date();
          const stat = existsSync(fp) ? start : new Date();
          const durSec = Math.max(0, Math.floor((stat.getTime() - start.getTime()) / 1000));
          sessions.push({
            sessionId: s.sessionId,
            startTime: s.startTime,
            status: s.status,
            mode: s.mode,
            project: s.project,
            durationSec: durSec,
            isToday: start.getTime() >= today.getTime(),
            sourceFile: f.trim(),
          });
        } catch {
          /* skip parse errors */
        }
      }
    }
  }

  const active = sessions.filter((s) => s.status === 'active').length;
  const total = sessions.length;
  const todaySessions = sessions.filter((s) => s.isToday).length;
  const durations = sessions.filter((s) => s.durationSec > 0).map((s) => s.durationSec);
  const avgDurSec =
    durations.length > 0 ? Math.floor(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
  const totalDurMin =
    durations.length > 0 ? Math.floor(durations.reduce((a, b) => a + b, 0) / 60) : 0;
  const sorted = [...sessions].sort(
    (a, b) => (a.startTime || '').localeCompare(b.startTime || '') * -1,
  );
  const latest = sorted[0];

  const sm: SessionMetrics = {
    collectedAt: new Date().toISOString(),
    total,
    active,
    inactive: total - active,
    today: todaySessions,
    avgDurationSec: avgDurSec,
    totalDurationMin: totalDurMin,
    latestId: latest?.sessionId || 'none',
    latestStart: latest?.startTime || '',
  };

  writeJson(join(outDir, 'sessions.json'), sm);
  log(
    `Sessions: ${total} total, ${active} active, ${todaySessions} today, ${totalDurMin}m total`,
    quiet,
  );
  return sessions;
}

interface TokenMetrics {
  collectedAt: string;
  status: string;
  usedToday: number;
  budget: number;
  pct: number;
  ratePer1M: number;
  estCost: number;
  monthForecast: number;
  monthForecastCost: number;
  baselineTokens: number;
  savedTokens: number;
  modeledSavings: number;
}

function collectTokenMetrics(quiet: boolean): TokenMetrics {
  log('Collecting token metrics...', quiet);
  const tm: TokenMetrics = {
    collectedAt: new Date().toISOString(),
    status: 'unknown',
    usedToday: 0,
    budget: 120000,
    pct: 0,
    ratePer1M: 10,
    estCost: 0,
    monthForecast: 0,
    monthForecastCost: 0,
    baselineTokens: 0,
    savedTokens: 0,
    modeledSavings: 0,
  };

  const tokenData = tryReadJson(tokenState);
  if (tokenData) tm.status = (tokenData.lastStatus as string) || 'unknown';

  const usage = getTokenUsage();
  tm.usedToday = usage.used;
  tm.budget = usage.budget;
  tm.pct = usage.percentage;
  tm.status = usage.status;

  const ratePer1M = 10;
  tm.estCost = Math.round((tm.usedToday / 1e6) * ratePer1M * 10000) / 10000;
  const now = new Date();
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dom = now.getDate();
  tm.monthForecast = dom > 0 ? Math.floor((tm.usedToday / dom) * dim) : 0;
  tm.monthForecastCost = Math.round((tm.monthForecast / 1e6) * ratePer1M * 100) / 100;
  tm.baselineTokens = Math.round(tm.usedToday * 1.4);
  tm.savedTokens = Math.max(0, tm.baselineTokens - tm.usedToday);
  tm.modeledSavings = Math.round((tm.savedTokens / 1e6) * ratePer1M * 10000) / 10000;

  writeJson(join(outDir, 'token.json'), tm);
  log(
    `Tokens: ${tm.usedToday}/${tm.budget} (${tm.pct}%) cost=$${tm.estCost} forecast=$${tm.monthForecastCost} saved=$${tm.modeledSavings}`,
    quiet,
  );
  return tm;
}

interface LiveMetrics {
  collectedAt: string;
  trafficLight: string;
  routingTotal: number;
  routingAcc: string;
  benchmarkPass: number;
  benchmarkFail: number;
  hasData: boolean;
}

function collectLiveMetrics(quiet: boolean): LiveMetrics {
  log('Collecting live observability metrics...', quiet);
  const live: LiveMetrics = {
    collectedAt: new Date().toISOString(),
    trafficLight: 'GREEN',
    routingTotal: 0,
    routingAcc: '0%',
    benchmarkPass: 0,
    benchmarkFail: 0,
    hasData: false,
  };

  const obs = tryReadJson(liveObsPath);
  if (obs) {
    if (obs.executive_traffic_light) live.trafficLight = obs.executive_traffic_light as string;
    if (obs.routing) {
      const r = obs.routing as Record<string, unknown>;
      live.routingTotal = (r.total as number) || 0;
      live.routingAcc = (r.accuracy as string) || '0%';
    }
    if (obs.benchmark) {
      const b = obs.benchmark as Record<string, unknown>;
      live.benchmarkPass = (b.pass as number) || 0;
      live.benchmarkFail = (b.fail as number) || 0;
    }
    live.hasData = true;
  }

  writeJson(join(outDir, 'live.json'), live);
  log(`Live: light=${live.trafficLight} routing=${live.routingAcc}`, quiet);
  return live;
}

interface CostMetrics {
  collectedAt: string;
  ratePer1M: number;
  actualCost: number;
  monthForecastCost: number;
  baselineTokens: number;
  savedTokens: number;
  modeledSavings: number;
  savingsPct: number;
}

function collectCostMetrics(quiet: boolean): CostMetrics {
  log('Collecting cost & savings projections...', quiet);
  const token = collectTokenMetrics(quiet);
  const cost: CostMetrics = {
    collectedAt: new Date().toISOString(),
    ratePer1M: token.ratePer1M,
    actualCost: token.estCost,
    monthForecastCost: token.monthForecastCost,
    baselineTokens: token.baselineTokens,
    savedTokens: token.savedTokens,
    modeledSavings: token.modeledSavings,
    savingsPct:
      token.baselineTokens > 0
        ? Math.round((token.savedTokens / token.baselineTokens) * 1000) / 10
        : 0,
  };

  writeJson(join(outDir, 'cost.json'), cost);
  log(
    `Cost: actual=$${cost.actualCost} forecast=$${cost.monthForecastCost} saved=$${cost.modeledSavings} (${cost.savingsPct}% savings)`,
    quiet,
  );
  return cost;
}

function collectAllMetrics(quiet: boolean): void {
  const s = collectSessionMetrics(quiet);
  const t = collectTokenMetrics(quiet);
  const l = collectLiveMetrics(quiet);
  const g = collectGitMetrics(quiet);
  const p = collectPRMetrics(quiet);
  const c = collectCostMetrics(quiet);

  const activeCount = s.filter((x) => x.status === 'active').length;
  const todayCount = s.filter((x) => x.isToday).length;
  const durations = s.filter((x) => x.durationSec > 0).map((x) => x.durationSec);
  const avgDur = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const totalMin = durations.length > 0 ? Math.floor(durations.reduce((a, b) => a + b, 0) / 60) : 0;
  const sorted = [...s].sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '') * -1);

  const all = {
    collectedAt: new Date().toISOString(),
    sessions: {
      total: s.length,
      active: activeCount,
      today: todayCount,
      avgDurationSec: avgDur,
      totalDurationMin: totalMin,
      latest: sorted[0]?.sessionId || null,
    },
    token: t,
    live: l,
    git: g,
    pr: p,
    cost: c,
  };

  writeJson(join(outDir, 'consolidated.json'), all);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  copyFileSync(
    join(outDir, 'consolidated.json'),
    join(outDir, 'snapshots', `snapshot-${stamp}.json`),
  );
  log('Consolidated written to .runtime/metrics/consolidated.json', quiet);
}

function main(): void {
  const args = parseArgs();
  switch (args.scope) {
    case 'sessions':
      collectSessionMetrics(args.quiet);
      break;
    case 'token':
      collectTokenMetrics(args.quiet);
      break;
    case 'live':
      collectLiveMetrics(args.quiet);
      break;
    case 'git':
      collectGitMetrics(args.quiet);
      break;
    case 'pr':
      collectPRMetrics(args.quiet);
      break;
    case 'cost':
      collectCostMetrics(args.quiet);
      break;
    case 'full':
    default:
      collectAllMetrics(args.quiet);
      break;
  }
}

main();
