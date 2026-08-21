#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
  statSync,
} from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

interface SnapshotMeta {
  id: string;
  timestamp: string;
  label?: string;
  files: Record<string, string>;
}

interface SnapshotSummary {
  id: string;
  timestamp: string;
  label?: string | null;
  files: number;
  size: string;
  error?: string;
}

interface CleanupResult {
  removed: number;
  retentionDays: number;
}

const ROOT = resolve(process.cwd());
const SESSION_DIR = join(ROOT, '.session');
const SNAPSHOT_DIR = join(SESSION_DIR, 'snapshots');

const CRITICAL_FILES = [
  'session-state.json',
  'token-usage.json',
  'metrics-report.json',
  'health.json',
  // Note: cloud-metrics.json and hybrid-metrics.json removed - stack operates local-only
];

function log(message: string, level: 'INFO' | 'WARN' | 'SUCCESS' = 'INFO', quiet = false): void {
  if (quiet) return;
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const colors: Record<string, string> = {
    INFO: '\x1b[35m',
    WARN: '\x1b[33m',
    SUCCESS: '\x1b[32m',
  };
  console.log(`${colors[level]}[${ts}] [SNAP] [${level}] ${message}\x1b[0m`);
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function snapshotId(): string {
  const d = new Date();
  const y = d.getFullYear();
  const M = pad(d.getMonth() + 1);
  const D = pad(d.getDate());
  const h = pad(d.getHours());
  const m = pad(d.getMinutes());
  const s = pad(d.getSeconds());
  return `snap-${y}${M}${D}-${h}${m}${s}`;
}

function formatSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function actionSnapshot(label?: string, quiet = false): SnapshotMeta {
  if (!existsSync(SNAPSHOT_DIR)) mkdirSync(SNAPSHOT_DIR, { recursive: true });

  const snapshot: SnapshotMeta = {
    id: snapshotId(),
    timestamp: new Date().toISOString(),
    label,
    files: {},
  };

  for (const f of CRITICAL_FILES) {
    const fp = join(SESSION_DIR, f);
    if (existsSync(fp)) {
      try {
        snapshot.files[f] = readFileSync(fp, 'utf-8');
      } catch (err) {
        log(
          `Failed to read ${f}: ${err instanceof Error ? err.message : String(err)}`,
          'WARN',
          quiet,
        );
      }
    }
  }

  const snapshotPath = join(SNAPSHOT_DIR, `${snapshot.id}.json`);
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf-8');
  log(
    `Snapshot ${snapshot.id} saved (${Object.keys(snapshot.files).length} files)`,
    'SUCCESS',
    quiet,
  );

  return snapshot;
}

function actionList(_quiet = false): SnapshotSummary[] {
  if (!existsSync(SNAPSHOT_DIR)) return [];

  const entries = readdirSync(SNAPSHOT_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => {
      const fp = join(SNAPSHOT_DIR, e.name);
      let st;
      try {
        st = statSync(fp);
      } catch {
        st = null;
      }
      return { name: e.name, path: fp, mtime: st ? st.mtimeMs : 0 };
    })
    .sort((a, b) => b.mtime - a.mtime);

  const snapshots: SnapshotSummary[] = [];
  for (const f of entries) {
    try {
      const content = JSON.parse(readFileSync(f.path, 'utf-8')) as SnapshotMeta;
      const st = statSync(f.path);
      snapshots.push({
        id: content.id,
        timestamp: content.timestamp,
        label: content.label ?? null,
        files: Object.keys(content.files).length,
        size: formatSize(st.size),
      });
    } catch {
      const st = statSync(f.path);
      snapshots.push({
        id: f.name.replace('.json', ''),
        timestamp: new Date(st.mtimeMs).toISOString(),
        error: 'corrupted',
        files: 0,
        size: formatSize(st.size),
      });
    }
  }

  return snapshots;
}

function actionCleanup(retentionDays = 7, quiet = false): CleanupResult {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;

  if (existsSync(SNAPSHOT_DIR)) {
    const files = readdirSync(SNAPSHOT_DIR, { withFileTypes: true }).filter(
      (e) => e.isFile() && e.name.endsWith('.json'),
    );

    for (const f of files) {
      const fp = join(SNAPSHOT_DIR, f.name);
      try {
        const content = JSON.parse(readFileSync(fp, 'utf-8')) as SnapshotMeta;
        if (new Date(content.timestamp).getTime() < cutoff) {
          rmSync(fp, { force: true });
          removed++;
          log(`Removed expired snapshot: ${f.name}`, 'INFO', quiet);
        }
      } catch {
        const st = existsSync(fp) ? statSync(fp) : null;
        if (st && st.mtimeMs < cutoff) {
          rmSync(fp, { force: true });
          removed++;
        }
      }
    }
  }

  log(
    `Cleanup complete: ${removed} snapshots removed (retention: ${retentionDays}d)`,
    'SUCCESS',
    quiet,
  );
  return { removed, retentionDays };
}

async function actionSchedule(
  intervalSeconds = 300,
  retentionDays = 7,
  quiet = false,
): Promise<void> {
  log(
    `Snapshot scheduler started (interval: ${intervalSeconds}s, retention: ${retentionDays}d)`,
    'INFO',
    quiet,
  );
  log('Press Ctrl+C to stop', 'INFO', quiet);
  let counter = 0;
  let running = true;

  const shutdown = () => {
    running = false;
    log('Scheduler stopped gracefully', 'INFO', quiet);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  while (running) {
    counter++;
    actionSnapshot(`auto-${counter}`, quiet);
    if (counter % 10 === 0) {
      actionCleanup(retentionDays, quiet);
    }
    await new Promise((r) => setTimeout(r, intervalSeconds * 1000));
  }
}

function parseArgs(): {
  action: string;
  label?: string;
  retentionDays: number;
  intervalSeconds: number;
  quiet: boolean;
} {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };
  const has = (flag: string): boolean => args.includes(flag);

  return {
    action: get('--action') || 'snapshot',
    label: get('--label'),
    retentionDays: get('--retention-days') ? parseInt(get('--retention-days')!, 10) : 7,
    intervalSeconds: get('--interval-seconds') ? parseInt(get('--interval-seconds')!, 10) : 300,
    quiet: has('--quiet'),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void (async () => {
    const opts = parseArgs();

    switch (opts.action) {
      case 'snapshot': {
        console.log(JSON.stringify(actionSnapshot(opts.label, opts.quiet), null, 2));
        break;
      }
      case 'list': {
        console.log(JSON.stringify(actionList(opts.quiet), null, 2));
        break;
      }
      case 'cleanup': {
        console.log(JSON.stringify(actionCleanup(opts.retentionDays, opts.quiet), null, 2));
        break;
      }
      case 'schedule': {
        await actionSchedule(opts.intervalSeconds, opts.retentionDays, opts.quiet);
        break;
      }
      default:
        console.error(`Unknown action: ${opts.action}. Valid: snapshot, list, cleanup, schedule`);
        process.exit(1);
    }
  })();
}
