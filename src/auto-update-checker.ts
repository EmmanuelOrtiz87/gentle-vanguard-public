#!/usr/bin/env node
/**
 * Auto-Update Checker
 *
 * Checks for new releases from GitHub and provides update instructions.
 * Can be run manually or as part of the session autostart pipeline.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { pathToFileURL } from 'url';
import { join, resolve } from 'path';
import * as https from 'https';

const ROOT = resolve(process.cwd());
const UPDATE_STATE_FILE = join(ROOT, '.runtime', 'auto-update-state.json');
const GITHUB_API = 'https://api.github.com/repos/EmmanuelOrtiz87/gentle-vanguard/releases/latest';
const PUBLIC_REPO = 'https://github.com/EmmanuelOrtiz87/gentle-vanguard-public';

interface UpdateState {
  lastCheck: string;
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  releaseNotes: string | null;
}

interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  html_url: string;
  published_at: string;
}

function log(msg: string, level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS' = 'INFO'): void {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const colors: Record<string, string> = {
    INFO: '\x1b[36m',
    WARN: '\x1b[33m',
    ERROR: '\x1b[31m',
    SUCCESS: '\x1b[32m',
  };
  console.log(`${colors[level] ?? ''}[${ts}] [AUTO-UPDATE] [${level}] ${msg}\x1b[0m`);
}

function getCurrentVersion(): string {
  const versionFile = join(ROOT, 'VERSION');
  const packageJson = join(ROOT, 'package.json');

  if (existsSync(versionFile)) {
    return readFileSync(versionFile, 'utf-8').trim();
  }

  if (existsSync(packageJson)) {
    try {
      const pkg = JSON.parse(readFileSync(packageJson, 'utf-8'));
      return pkg.version ?? '0.0.0';
    } catch {
      return '0.0.0';
    }
  }

  return '0.0.0';
}

function loadUpdateState(): UpdateState {
  if (!existsSync(UPDATE_STATE_FILE)) {
    return {
      lastCheck: new Date(0).toISOString(),
      currentVersion: getCurrentVersion(),
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: null,
      releaseNotes: null,
    };
  }

  try {
    return JSON.parse(readFileSync(UPDATE_STATE_FILE, 'utf-8'));
  } catch {
    return {
      lastCheck: new Date(0).toISOString(),
      currentVersion: getCurrentVersion(),
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: null,
      releaseNotes: null,
    };
  }
}

function saveUpdateState(state: UpdateState): void {
  const runtimeDir = join(ROOT, '.runtime');
  if (!existsSync(runtimeDir)) mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(UPDATE_STATE_FILE, JSON.stringify(state, null, 2));
}

function fetchLatestRelease(): Promise<GitHubRelease | null> {
  return new Promise((resolve) => {
    const req = https.get(
      GITHUB_API,
      {
        headers: {
          'User-Agent': 'gentle-vanguard-auto-update',
          Accept: 'application/vnd.github.v3+json',
        },
        timeout: 10000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          log(`GitHub API returned ${res.statusCode}`, 'WARN');
          resolve(null);
          return;
        }

        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const release = JSON.parse(data) as GitHubRelease;
            resolve(release);
          } catch (err) {
            log(`Failed to parse release JSON: ${err}`, 'ERROR');
            resolve(null);
          }
        });
      },
    );

    req.on('error', (err) => {
      log(`Failed to fetch release: ${err.message}`, 'WARN');
      resolve(null);
    });

    req.on('timeout', () => {
      req.destroy();
      log('Request timeout', 'WARN');
      resolve(null);
    });
  });
}

function compareVersions(current: string, latest: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const c = parse(current);
  const l = parse(latest);

  for (let i = 0; i < Math.max(c.length, l.length); i++) {
    const cv = c[i] ?? 0;
    const lv = l[i] ?? 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
}

async function checkForUpdates(force = false): Promise<UpdateState> {
  const state = loadUpdateState();
  const currentVersion = getCurrentVersion();

  // Check if we should skip (checked within last hour)
  const lastCheck = new Date(state.lastCheck);
  const hoursSinceCheck = (Date.now() - lastCheck.getTime()) / (1000 * 60 * 60);

  if (!force && hoursSinceCheck < 1) {
    log(`Skipping check (last check: ${hoursSinceCheck.toFixed(1)}h ago)`, 'INFO');
    return state;
  }

  log(`Checking for updates (current: ${currentVersion})...`, 'INFO');

  const release = await fetchLatestRelease();

  if (!release) {
    log('Could not fetch latest release', 'WARN');
    return state;
  }

  const latestVersion = release.tag_name;
  const updateAvailable = compareVersions(currentVersion, latestVersion);

  const newState: UpdateState = {
    lastCheck: new Date().toISOString(),
    currentVersion,
    latestVersion,
    updateAvailable,
    releaseUrl: release.html_url,
    releaseNotes: release.body,
  };

  saveUpdateState(newState);

  if (updateAvailable) {
    log(`Update available: ${currentVersion} → ${latestVersion}`, 'SUCCESS');
    log(`Release notes: ${release.html_url}`, 'INFO');
  } else {
    log(`Up to date (${currentVersion})`, 'INFO');
  }

  return newState;
}

function showUpdateInstructions(): void {
  const state = loadUpdateState();

  if (!state.updateAvailable) {
    log('No update available', 'INFO');
    return;
  }

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                    UPDATE AVAILABLE                        ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║  Current:  ${state.currentVersion.padEnd(48)} ║`);
  console.log(`║  Latest:   ${(state.latestVersion ?? 'unknown').padEnd(48)} ║`);
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log('║  Update commands:                                          ║');
  console.log('║                                                            ║');
  console.log('║  1. git fetch origin                                       ║');
  console.log('║  2. git pull origin develop                                ║');
  console.log('║  3. pnpm install --frozen-lockfile                         ║');
  console.log('║                                                            ║');
  console.log(`║  Release: ${(state.releaseUrl ?? PUBLIC_REPO).substring(0, 48).padEnd(48)} ║`);
  console.log('╚════════════════════════════════════════════════════════════╝\n');
}

// CLI usage
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href ||
  process.argv[1]?.includes('auto-update-checker');

if (isMain) {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const checkOnly = args.includes('--check-only');

  checkForUpdates(force)
    .then((state) => {
      if (!checkOnly && state.updateAvailable) {
        showUpdateInstructions();
      }
      console.log(
        `\n[RESULT] Current: ${state.currentVersion}, Latest: ${state.latestVersion ?? 'unknown'}, Update available: ${state.updateAvailable}`,
      );
      process.exit(0);
    })
    .catch((err) => {
      log(`Error: ${err}`, 'ERROR');
      process.exit(1);
    });
}

export { checkForUpdates, showUpdateInstructions, loadUpdateState };
