#!/usr/bin/env node
/**
 * Engram Auto-Update — Checks, installs, and validates engram updates.
 *
 * This script is designed to run as part of the session-autostart pipeline
 * to keep engram current without breaking the stack.
 *
 * Usage:
 *   npx tsx src/knowledge/engram-auto-update.ts [--check-only] [--force]
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { runSync } from '../core/run-command.js';
import { getExternalApiTimeouts } from '../core/timeout-config';

// ─── Config ───────────────────────────────────────────────────────────────────

const ROOT = resolve(process.cwd());
const AUDIT_DIR = join(ROOT, '.session', 'audit', 'logs');
const STATE_FILE = join(ROOT, '.runtime', 'engram-update-state.json');

// ─── Types ───────────────────────────────────────────────────────────────────

interface UpdateResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  updated: boolean;
  validationPassed: boolean;
  errors: string[];
  timestamp: string;
}

// ─── Logger ───────────────────────────────────────────────────────────────────

function log(message: string, level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS' = 'INFO'): void {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const colors: Record<string, string> = {
    INFO: '\x1b[36m',
    WARN: '\x1b[33m',
    ERROR: '\x1b[31m',
    SUCCESS: '\x1b[32m',
  };
  console.log(`${colors[level]}[${timestamp}] [ENGRAM-UPDATE] [${level}] ${message}\x1b[0m`);
}

// ─── Version Parsing ─────────────────────────────────────────────────────────

function parseVersion(output: string): string | null {
  // Match patterns like "v1.20.0", "1.20.0", "engram version 1.20.0"
  const match = output.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

function compareVersions(current: string, latest: string): number {
  const c = current.split('.').map(Number);
  const l = latest.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    if (c[i] !== l[i]) return c[i] - l[i];
  }
  return 0;
}

// ─── GitHub API ───────────────────────────────────────────────────────────────

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 3,
  delay = 1000,
): Promise<Response | null> {
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        getExternalApiTimeouts()?.http_client_default_ms ?? 10000,
      );

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeout);
      return response;
    } catch (err: unknown) {
      const isLastAttempt = i === retries - 1;
      const errorMsg = (err as Error)?.message || String(err);

      // Handle UV_HANDLE_CLOSING and other fetch errors
      if (errorMsg.includes('UV_HANDLE_CLOSING') || errorMsg.includes('fetch failed')) {
        log(`Fetch attempt ${i + 1}/${retries} failed: ${errorMsg}`, 'WARN');
        if (!isLastAttempt) {
          log(`Waiting ${delay}ms before retry...`, 'INFO');
          await new Promise((resolve) => setTimeout(resolve, delay)); // delay from param (1000ms default)
          continue;
        }
      }

      if (isLastAttempt) {
        log(`All ${retries} fetch attempts failed: ${errorMsg}`, 'ERROR');
        return null;
      }
    }
  }
  return null;
}

async function getLatestVersion(): Promise<string | null> {
  try {
    const response = await fetchWithRetry(
      'https://api.github.com/repos/Gentleman-Programming/engram/releases/latest',
      {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Gentle-Vanguard/1.0',
        },
      },
    );

    if (!response) {
      log('Failed to fetch from GitHub API after retries', 'ERROR');
      return null;
    }

    if (!response.ok) {
      log(`GitHub API error: ${response.status}`, 'ERROR');
      return null;
    }

    const data = (await response.json()) as { tag_name?: string };
    if (data.tag_name) {
      return data.tag_name.replace(/^v/, '');
    }
    return null;
  } catch (err) {
    log(
      `Failed to fetch latest version: ${err instanceof Error ? err.message : String(err)}`,
      'ERROR',
    );
    return null;
  }
}

// ─── Engram Operations ───────────────────────────────────────────────────────

function getCurrentVersion(): string | null {
  try {
    // Include Go bin path to find engram
    const goBinPath = join(
      process.env.GOPATH || join(process.env.HOME || process.env.USERPROFILE || '', 'go'),
      'bin',
    );
    const enhancedPath = `${goBinPath}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH || ''}`;
    const output = runSync('engram', ['--version'], {
      env: { ...process.env, PATH: enhancedPath },
    }).stdout;
    return parseVersion(output);
  } catch {
    return null;
  }
}

function installEngram(): boolean {
  try {
    log('Installing engram@latest...', 'INFO');
    runSync('go', ['install', 'github.com/Gentleman-Programming/engram/cmd/engram@latest'], {
      stdio: 'pipe',
    });
    return true;
  } catch (err) {
    log(`Installation failed: ${err instanceof Error ? err.message : String(err)}`, 'ERROR');
    return false;
  }
}

function validateEngram(): boolean {
  try {
    const version = getCurrentVersion();
    if (!version) {
      log('Validation failed: engram --version returned nothing', 'ERROR');
      return false;
    }

    // Include Go bin path for validation
    const goBinPath = join(
      process.env.GOPATH || join(process.env.HOME || process.env.USERPROFILE || '', 'go'),
      'bin',
    );
    const enhancedPath = `${goBinPath}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH || ''}`;

    // Try a simple engram command to verify it works
    runSync('engram', ['doctor', '--json'], {
      stdio: 'pipe',
      env: { ...process.env, PATH: enhancedPath },
    });
    log(`Validation passed: engram ${version} is working`, 'SUCCESS');
    return true;
  } catch (err) {
    log(`Validation failed: ${err instanceof Error ? err.message : String(err)}`, 'ERROR');
    return false;
  }
}

// ─── State Management ─────────────────────────────────────────────────────────

function saveState(state: { lastCheck: string; lastVersion: string }): void {
  mkdirSync(join(ROOT, '.runtime'), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function logAudit(result: UpdateResult): void {
  const dateStr = new Date().toISOString().slice(0, 10);
  const auditFile = join(AUDIT_DIR, `engram-update-${dateStr}.jsonl`);

  mkdirSync(AUDIT_DIR, { recursive: true });
  const entry = JSON.stringify({
    ...result,
    loggedAt: new Date().toISOString(),
  });

  const existing = existsSync(auditFile) ? readFileSync(auditFile, 'utf-8') : '';
  writeFileSync(auditFile, existing + entry + '\n', 'utf-8');
}

// ─── Main Logic ───────────────────────────────────────────────────────────────

async function runUpdate(checkOnly = false, force = false): Promise<UpdateResult> {
  const result: UpdateResult = {
    currentVersion: 'unknown',
    latestVersion: 'unknown',
    updateAvailable: false,
    updated: false,
    validationPassed: false,
    errors: [],
    timestamp: new Date().toISOString(),
  };

  // Get current version
  const current = getCurrentVersion();
  if (!current) {
    result.errors.push('engram not installed or not in PATH');
    log('engram not found in PATH', 'ERROR');
    return result;
  }
  result.currentVersion = current;
  log(`Current version: ${current}`, 'INFO');

  // Get latest version from GitHub
  const latest = await getLatestVersion();
  if (!latest) {
    result.errors.push('Failed to get latest version from GitHub');
    log('Failed to fetch latest version', 'ERROR');
    return result;
  }
  result.latestVersion = latest;
  log(`Latest version: ${latest}`, 'INFO');

  // Compare versions
  const comparison = compareVersions(current, latest);
  result.updateAvailable = comparison < 0;

  if (!result.updateAvailable && !force) {
    log('Already up-to-date', 'SUCCESS');
    saveState({ lastCheck: new Date().toISOString(), lastVersion: current });
    result.validationPassed = true;
    return result;
  }

  if (checkOnly) {
    log(`Update available: ${current} -> ${latest} (check-only mode)`, 'INFO');
    return result;
  }

  // Install update
  log(`Updating engram: ${current} -> ${latest}`, 'INFO');
  const installed = installEngram();

  if (!installed) {
    result.errors.push('Installation failed');
    logAudit(result);
    return result;
  }

  result.updated = true;

  // Validate installation
  result.validationPassed = validateEngram();

  if (!result.validationPassed) {
    result.errors.push('Validation failed after installation');
    log('Update installed but validation failed!', 'ERROR');
  } else {
    log(`Successfully updated to ${latest}`, 'SUCCESS');
  }

  // Save state and audit
  saveState({ lastCheck: new Date().toISOString(), lastVersion: latest });
  logAudit(result);

  return result;
}

// ─── CLI Entry ─────────────────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void (async () => {
    const args = process.argv.slice(2);
    const checkOnly = args.includes('--check-only');
    const force = args.includes('--force');

    try {
      const result = await runUpdate(checkOnly, force);
      console.log(JSON.stringify(result, null, 2));

      // Exit code: 0 = success, 1 = update available but not done, 2 = error
      if (result.errors.length > 0) {
        process.exit(2);
      }
      if (result.updateAvailable && !result.updated) {
        process.exit(1);
      }
      process.exit(0);
    } catch (err) {
      log(`Fatal error: ${err instanceof Error ? err.message : String(err)}`, 'ERROR');
      process.exit(2);
    }
  })();
}

export type { UpdateResult };
