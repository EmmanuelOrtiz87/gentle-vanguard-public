import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { ROOT } from '../shared.ts';
import type { SwarmWorkerData } from '../../src/types/dashboard.ts';
import { dbAvailable, getDb } from './helpers.ts';

// ─── Swarm Workers ────────────────────────────────────────────────────

export const SWARM_WORK_DIR = join(ROOT, '.session', 'swarm-workers');
export const RESULTS_DIR = join(ROOT, '.session', 'swarm-results');

export function getSwarmWorkers(): SwarmWorkerData {
  const empty: SwarmWorkerData = {
    activeCount: 0,
    completedCount: 0,
    failedCount: 0,
    workers: [],
    lastReport: null,
    reports: 0,
  };

  try {
    // Read worker directories
    const workerDirs = existsSync(SWARM_WORK_DIR)
      ? readdirSync(SWARM_WORK_DIR).filter((d) => {
          try {
            return existsSync(join(SWARM_WORK_DIR, d, 'output.json'));
          } catch {
            return false;
          }
        })
      : [];

    const workers: SwarmWorkerData['workers'] = [];
    let active = 0,
      completed = 0,
      failed = 0;

    for (const dir of workerDirs.slice(-50)) {
      // limit to last 50 workers
      try {
        const outputPath = join(SWARM_WORK_DIR, dir, 'output.json');
        if (!existsSync(outputPath)) continue;
        const data = JSON.parse(readFileSync(outputPath, 'utf-8'));
        const entry = {
          skill: data.skill || dir,
          status: data.status || 'unknown',
          started: data.started || '',
          finished: data.finished || undefined,
          exitCode: data.exitCode ?? null,
          output: (data.stdout || data.output || '').substring(0, 200),
          error: data.stderr || data.error || null,
          workerDir: join(SWARM_WORK_DIR, dir),
        };
        workers.push(entry);
        if (entry.status === 'running') active++;
        else if (entry.status === 'completed') completed++;
        else if (entry.status === 'failed') failed++;
      } catch {
        /* skip unreadable */
      }
    }

    // Read latest report
    let lastReport: string | null = null;
    const reportFiles = existsSync(RESULTS_DIR)
      ? readdirSync(RESULTS_DIR)
          .filter((f) => f.startsWith('swarm-report') && f.endsWith('.md'))
          .sort()
          .reverse()
      : [];
    const reports = reportFiles.length;
    if (reportFiles.length > 0) {
      try {
        const content = readFileSync(join(RESULTS_DIR, reportFiles[0]), 'utf-8');
        const taskMatch = content.match(/\*\*Task\*\*: (.+)/);
        const resultsMatch = content.match(/\*\*Results\*\*: (.+)/);
        lastReport = `${taskMatch?.[1] ?? 'unknown'} [${resultsMatch?.[1] ?? '?'}]`;
      } catch {
        /* skip */
      }
    }

    // Nexus fallback: no swarm worker dirs → derive workers from real
    // subagent activity in token_transactions (agent per message).
    if (workers.length === 0 && dbAvailable()) {
      try {
        const rows = getDb()
          .getDb()
          .prepare(
            `SELECT agent,
                    COUNT(*) AS messages,
                    SUM(input_tokens + output_tokens) AS tokens,
                    MIN(created_at) AS first_seen,
                    MAX(created_at) AS last_seen,
                    COALESCE(MAX(model), 'unknown') AS model
             FROM token_transactions
             WHERE agent IS NOT NULL AND agent != ''
             GROUP BY agent
             ORDER BY last_seen DESC
             LIMIT 20`,
          )
          .all() as Array<{
          agent: string;
          messages: number;
          tokens: number;
          first_seen: string;
          last_seen: string;
          model: string;
        }>;
        for (const r of rows) {
          const isRoot = r.agent === 'ROOT' || r.agent === 'orchestrator';
          workers.push({
            skill: r.agent,
            status: 'completed',
            started: r.first_seen,
            finished: r.last_seen,
            exitCode: 0,
            output: `${r.messages} mensajes · ${r.tokens ?? 0} tokens · ${r.model}`,
            error: null,
            workerDir: 'nexus://token_transactions',
          });
          if (isRoot) continue; // orchestrator tracked separately, not a worker
          completed++;
        }
      } catch {
        /* fall through to empty */
      }
    }

    return {
      activeCount: active,
      completedCount: completed,
      failedCount: failed,
      workers,
      lastReport,
      reports,
    };
  } catch {
    return empty;
  }
}
