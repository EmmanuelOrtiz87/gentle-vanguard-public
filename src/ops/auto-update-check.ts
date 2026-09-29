#!/usr/bin/env tsx
/**
 * auto-update-check — detects updates in the 3 git repos and notifies the user
 * at session start. Runs as a lazy step in session-autostart (Phase 2, ventanas
 * fantasma + onboarding completeness, 2026-09-16).
 *
 * Three repos monitored:
 *   - origin     = EmmanuelOrtiz87/gentle-vanguard         ("privado" emmanuel, develop)
 *   - public     = EmmanuelOrtiz87/gentle-vanguard-public  (publico emmanuel, releases .exe)
 *   - gentlevanguard/gentlevanguard.github.io              (landing oficial URL de marca)
 *
 * What it checks:
 *   1. Private repo: new commits on origin/develop since local HEAD (git rev-parse).
 *   2. Public repo: new tags (releases) on public main since last seen tag.
 *   3. Landing repo: new commits on gentlevanguard main since local cache
 *      (cached in .runtime/auto-update-state.json).
 *
 * State persisted to .runtime/auto-update-state.json. Idempotent — same state
 * means no notification. Failures (offline, no auth) are silent.
 *
 * Exit codes: 0 = checked (notification or not); 1 = unexpected error.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runSync } from '../core/run-command.js';

const ROOT = resolve(process.cwd());
const STATE_PATH = join(ROOT, '.runtime', 'auto-update-state.json');
const LOG_PATH = join(ROOT, '.runtime', 'auto-update-check.log');

interface State {
  checkedAt: string;
  privateHead?: string;
  publicLatestTag?: string;
  publicLatestTagCommit?: string;
  gentlevanguardLandingHead?: string;
}

interface Notification {
  kind: 'private-commits' | 'public-release' | 'landing-commits';
  summary: string;
  command: string;
}

function log(line: string): void {
  try {
    const ts = new Date().toISOString().slice(0, 19);
    const { appendFileSync } = require('node:fs') as typeof import('node:fs');
    appendFileSync(LOG_PATH, `[${ts}] ${line}\n`);
  } catch {
    /* best-effort */
  }
}

function loadState(): State {
  try {
    if (!existsSync(STATE_PATH)) {
      return { checkedAt: '1970-01-01T00:00:00Z' };
    }
    return JSON.parse(readFileSync(STATE_PATH, 'utf-8')) as State;
  } catch {
    return { checkedAt: '1970-01-01T00:00:00Z' };
  }
}

function saveState(state: State): void {
  try {
    mkdirSync(join(ROOT, '.runtime'), { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    log(`saveState failed: ${err}`);
  }
}

function gitRev(ref: string, remote?: string): string | null {
  try {
    const args = remote ? ['ls-remote', remote, ref] : ['rev-parse', ref];
    const r = runSync('git', args, { cwd: ROOT, timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] });
    const out = (r.stdout ?? '').trim();
    if (!out) return null;
    // ls-remote returns "<sha>\t<ref>"; rev-parse returns "<sha>"
    return out.split(/\s+/)[0] ?? null;
  } catch {
    return null;
  }
}

function latestPublicTag(): { tag: string; commit: string } | null {
  try {
    const r = runSync('git', ['ls-remote', '--tags', '--refs', 'public'], {
      cwd: ROOT,
      timeout: 8000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const out = (r.stdout ?? '').trim();
    if (!out) return null;
    // Parse lines: "<sha>\trefs/tags/vX.Y.Z"
    const tags = out
      .split('\n')
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 2) return null;
        const ref = parts[1];
        const m = ref.match(/^refs\/tags\/(v\d+\.\d+\.\d+)$/);
        if (!m) return null;
        return { tag: m[1], commit: parts[0] };
      })
      .filter((x): x is { tag: string; commit: string } => x !== null);
    if (tags.length === 0) return null;
    // Highest semver wins (X.Y.Z format, simple lexical since digits are fixed width).
    tags.sort((a, b) => {
      const pa = a.tag.slice(1).split('.').map(Number);
      const pb = b.tag.slice(1).split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        const da = pa[i] ?? 0;
        const db = pb[i] ?? 0;
        if (da !== db) return db - da;
      }
      return 0;
    });
    return tags[0]!;
  } catch {
    return null;
  }
}

function main(): number {
  const prev = loadState();
  const notifications: Notification[] = [];
  const next: State = { checkedAt: new Date().toISOString() };

  // 1. Private repo (origin/develop) — new commits since local HEAD.
  const originHead = gitRev('develop', 'origin');
  if (originHead) {
    next.privateHead = originHead;
    if (prev.privateHead && prev.privateHead !== originHead) {
      notifications.push({
        kind: 'private-commits',
        summary: `Tu repo privado (emmanuel/gentle-vanguard) tiene commits nuevos en develop`,
        command: 'git pull origin develop',
      });
    }
  }

  // 2. Public repo (EmmanuelOrtiz87/gentle-vanguard-public) — new release tags.
  const latest = latestPublicTag();
  if (latest) {
    next.publicLatestTag = latest.tag;
    next.publicLatestTagCommit = latest.commit;
    if (prev.publicLatestTag && prev.publicLatestTag !== latest.tag) {
      notifications.push({
        kind: 'public-release',
        summary: `Nueva release disponible del stack: ${latest.tag} (emmanuel-public)`,
        command: 'gh release download --repo EmmanuelOrtiz87/gentle-vanguard-public --pattern "*.exe" --dir ./downloads',
      });
    }
  }

  // 3. Landing repo (gentlevanguard/gentlevanguard.github.io) — new commits.
  // Use ls-remote since we don't always have this as a local remote.
  const landingHead = gitRev('main', 'https://github.com/gentlevanguard/gentlevanguard.github.io.git');
  if (landingHead) {
    next.gentlevanguardLandingHead = landingHead;
    if (prev.gentlevanguardLandingHead && prev.gentlevanguardLandingHead !== landingHead) {
      notifications.push({
        kind: 'landing-commits',
        summary: `La landing oficial (gentlevanguard.github.io) tiene cambios nuevos`,
        command: 'gh api repos/gentlevanguard/gentlevanguard.github.io/commits | jq -r \".[0:5] | .[] | .sha[0:7] + \\\" \\\" + .message\"',
      });
    }
  }

  // Persist state regardless of notifications (so we don't re-notify).
  saveState(next);

  if (notifications.length === 0) {
    log(`check OK — no updates (private=${!!originHead} public=${!!latest} landing=${!!landingHead})`);
    return 0;
  }

  // Print notifications (only on first detection per state).
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  🔔 ACTUALIZACIONES DETECTADAS                              ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  for (const n of notifications) {
    console.log(`║  • ${n.summary}`);
    console.log(`║    → ${n.command}`);
  }
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  log(`notified ${notifications.length} update(s)`);

  return 0;
}

main();
