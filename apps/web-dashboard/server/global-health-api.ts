import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync, readFileSync } from 'fs';
import type { GlobalHealth, RepositoryHealth } from '../src/types/dashboard';
import { getProcessExecutionTimeouts } from '@gentle-vanguard/core/timeout-config';
import { runSync } from '@gentle-vanguard/core/run-command';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '../../..');

function execGit(args: string, cwd: string = ROOT): string {
  try {
    const result = runSync('git', args.split(' '), {
      cwd,
      timeout: getProcessExecutionTimeouts().git_operation_ms ?? 3000,
    });
    return result.stdout?.trim() ?? '';
  } catch {
    return '';
  }
}

function countFiles(dir: string, pattern: RegExp): number {
  try {
    if (!existsSync(dir)) return 0;
    let count = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        count += countFiles(full, pattern);
      } else if (pattern.test(entry.name)) {
        count++;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

function getCoverage(): number {
  const lcovPath = join(ROOT, 'coverage', 'lcov.info');
  if (existsSync(lcovPath)) {
    try {
      const content = readFileSync(lcovPath, 'utf-8');
      let lf = 0,
        lh = 0;
      for (const line of content.split('\n')) {
        if (line.startsWith('LF:')) lf += parseInt(line.slice(3), 10) || 0;
        if (line.startsWith('LH:')) lh += parseInt(line.slice(3), 10) || 0;
      }
      if (lf > 0) return Math.round((lh / lf) * 100);
    } catch {
      /* fallback */
    }
  }

  const testCount = countFiles(join(ROOT, 'tests'), /\.(test|spec)\.(ts|js|tsx|jsx)$/);
  const srcCount = countFiles(join(ROOT, 'src'), /\.(ts|js|tsx|jsx)$/);
  if (srcCount > 0) {
    return Math.min(Math.round((testCount / srcCount) * 100), 100);
  }

  return 0;
}

function getCIStatus(): 'passing' | 'failing' | 'unknown' {
  const workflowsDir = join(ROOT, '.github', 'workflows');
  if (!existsSync(workflowsDir)) return 'unknown';

  try {
    const files = readdirSync(workflowsDir).filter(
      (f) => f.endsWith('.yml') || f.endsWith('.yaml'),
    );
    if (files.length === 0) return 'unknown';
  } catch {
    return 'unknown';
  }

  const log = execGit('log --oneline -20');
  if (log) {
    const hasFailure = log
      .split('\n')
      .some((l) => /failed|failure|failing|\[skip ci\]|ci-fail/i.test(l));
    if (hasFailure) return 'failing';
  }

  return 'passing';
}

function getOpenPRCount(): number {
  try {
    const result = runSync('gh', ['pr', 'list', '--json', 'number', '--jq', 'length'], {
      cwd: ROOT,
      timeout: getProcessExecutionTimeouts().git_operation_ms ?? 5000,
    });
    const n = parseInt(result.stdout?.trim() ?? '0', 10);
    if (!isNaN(n)) return n;
  } catch {
    /* fallback */
  }

  try {
    const allBranchPRs = execGit('log --oneline --all --grep="Merge pull request"')
      .split('\n')
      .filter(Boolean).length;
    const mainPRs = execGit('log --oneline main --grep="Merge pull request"')
      .split('\n')
      .filter(Boolean).length;
    return Math.max(0, allBranchPRs - mainPRs);
  } catch {
    /* fallback */
  }

  return 0;
}

function findRepos(): string[] {
  const repos: string[] = [];

  if (existsSync(join(ROOT, '.git'))) {
    repos.push('gentle-vanguard');
  }

  try {
    for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules')
        continue;
      if (existsSync(join(ROOT, entry.name, '.git'))) {
        repos.push(entry.name);
      }
    }
  } catch {
    /* no children */
  }

  return repos;
}

function getRepoHealth(name: string): RepositoryHealth {
  const lastCommit = execGit('log -1 --format=%cI');
  const contributors = (() => {
    const raw = execGit('shortlog -sn');
    return raw ? raw.split('\n').length : 0;
  })();
  const coverage = getCoverage();
  const ciStatus = getCIStatus();
  const openPRs = getOpenPRCount();

  return {
    name,
    status: 'healthy',
    lastCommit: lastCommit || new Date().toISOString(),
    openPRs,
    ciStatus,
    coverage,
    contributors,
    updatedAt: new Date().toISOString(),
  };
}

export function getGlobalHealth(): GlobalHealth {
  const repoNames = findRepos();
  const repositories = repoNames.map((name) => getRepoHealth(name));

  const healthyRepos = repositories.filter((r) => r.status === 'healthy').length;
  const degradedRepos = repositories.filter((r) => r.status === 'degraded').length;
  const criticalRepos = repositories.filter((r) => r.status === 'down').length;
  const avgCoverage =
    repositories.length > 0
      ? Math.round(repositories.reduce((s, r) => s + r.coverage, 0) / repositories.length)
      : 0;
  const totalOpenPRs = repositories.reduce((s, r) => s + r.openPRs, 0);

  let overallStatus: 'healthy' | 'degraded' | 'critical' = 'healthy';
  if (criticalRepos > 0) overallStatus = 'critical';
  else if (degradedRepos > 0) overallStatus = 'degraded';

  return {
    repositories,
    overallStatus,
    totalRepos: repositories.length,
    healthyRepos,
    degradedRepos,
    criticalRepos,
    avgCoverage,
    totalOpenPRs,
    lastUpdated: new Date().toISOString(),
  };
}
