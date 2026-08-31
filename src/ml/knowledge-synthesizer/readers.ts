import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { runSync } from '../../core/run-command.js';
import {
  AUDIT_DIR,
  DIGESTS_DIR,
  KB_VAULT,
  METRICS_FILE,
  REFLECTIONS_DIR,
  ROOT,
  loadJson,
  loadJsonLines,
} from './config.js';
import type { SynthOutput } from './types.js';

export interface SessionRecord {
  id: string;
  timestamp: string;
  type: string;
  status: string;
  message: string;
  date: string;
}

export function readAuditSessions(): SessionRecord[] {
  if (!existsSync(AUDIT_DIR)) return [];
  const files = readdirSync(AUDIT_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .sort();
  const sessions: SessionRecord[] = [];
  for (const f of files.slice(-20)) {
    const entries = loadJsonLines(join(AUDIT_DIR, f));
    for (const e of entries) {
      sessions.push({
        id: (e.id as string) || '',
        timestamp: (e.timestamp as string) || '',
        type: (e.type as string) || '',
        status: (e.status as string) || '',
        message: (e.message as string) || '',
        date: ((e.timestamp as string) || '').slice(0, 10),
      });
    }
  }
  return sessions;
}

export function readSessionDigests(): string[] {
  if (!existsSync(DIGESTS_DIR)) return [];
  return readdirSync(DIGESTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .reverse()
    .slice(0, 30)
    .map((f) => join(DIGESTS_DIR, f));
}

export function readReflectionOutputs(): SynthOutput[] {
  if (!existsSync(REFLECTIONS_DIR)) return [];
  return readdirSync(REFLECTIONS_DIR)
    .filter((f) => f.startsWith('reflection-') && f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, 20)
    .map((f) => loadJson<SynthOutput>(join(REFLECTIONS_DIR, f), null as unknown as SynthOutput))
    .filter(Boolean);
}

export function readKnowledgeBaseVaultFiles(): string[] {
  const files: string[] = [];
  if (!existsSync(KB_VAULT)) return files;
  function walk(dir: string): void {
    try {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory() && !e.name.startsWith('.')) walk(full);
        else if (e.name.endsWith('.md')) files.push(full);
      }
    } catch {
      /* skip unreadable */
    }
  }
  try {
    walk(KB_VAULT);
  } catch {
    /* vault not available */
  }
  return files.slice(0, 100);
}

export function getMetricsSummary(): Record<string, number> {
  const m = loadJson<Record<string, unknown>>(METRICS_FILE, {});
  const s = (m.summary as Record<string, number>) || {};
  return {
    delegations: (s.total_delegations as number) || 0,
    corrections: (s.total_corrections as number) || 0,
    qualityScore: (s.quality_score as number) || 100,
    uptimeSeconds: (s.uptime_seconds as number) || 0,
  };
}

export function getGitActivity(): {
  commits: number;
  changedFiles: number;
  recentMessages: string[];
} {
  try {
    const since = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    const log = runSync('git', ['log', `--since=${since}`, '--format=%s', '--name-only'], {
      cwd: ROOT,
      timeout: 5000,
    }).stdout.trim();
    if (!log) return { commits: 0, changedFiles: 0, recentMessages: [] };
    const sections = log.split('\n\n');
    const messages = sections.map((s) => s.split('\n')[0]).filter(Boolean);
    const files = sections
      .flatMap((s) => s.split('\n').slice(1))
      .filter((f) => f.trim() && !f.startsWith(' '));
    return {
      commits: messages.length,
      changedFiles: [...new Set(files)].length,
      recentMessages: messages.slice(-10),
    };
  } catch {
    return { commits: 0, changedFiles: 0, recentMessages: [] };
  }
}
