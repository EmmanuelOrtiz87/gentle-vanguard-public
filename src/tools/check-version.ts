#!/usr/bin/env node

import { existsSync, readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface SemverParts {
  Major: number;
  Minor: number;
  Patch: number;
}

interface GitHubRelease {
  tag_name: string;
  assets: { name: string; browser_download_url: string }[];
}

function parseArgs(): { quiet: boolean; preRelease: boolean } {
  const args = process.argv.slice(2);
  let quiet = false;
  let preRelease = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--quiet':
      case '-Quiet':
        quiet = true;
        break;
      case '--pre-release':
      case '-PreRelease':
        preRelease = true;
        break;
    }
  }

  return { quiet, preRelease };
}

function getSemverParts(version: string): SemverParts {
  const parts = version.split('.');
  return {
    Major: parseInt(parts[0], 10),
    Minor: parseInt(parts[1], 10),
    Patch: parseInt(parts[2], 10),
  };
}

function compareSemver(local: string, remote: string): number {
  const a = getSemverParts(local);
  const b = getSemverParts(remote);
  if (a.Major !== b.Major) return a.Major - b.Major;
  if (a.Minor !== b.Minor) return a.Minor - b.Minor;
  return a.Patch - b.Patch;
}

function log(msg: string, color?: string): void {
  const colors: Record<string, string> = {
    Cyan: '\x1b[36m',
    Green: '\x1b[32m',
    Gray: '\x1b[90m',
    Red: '\x1b[31m',
  };
  const code = color ? colors[color] || '' : '';
  const reset = code ? '\x1b[0m' : '';
  console.log(`${code}${msg}${reset}`);
}

async function getLatestRelease(preRelease: boolean): Promise<GitHubRelease> {
  // Repo público de releases (el repo privado `gentle-vanguard` devuelve 404).
  // Override opcional via GENTLE_VANGUARD_GH_REPO (formato owner/repo).
  const ghRepo = process.env.GENTLE_VANGUARD_GH_REPO || 'EmmanuelOrtiz87/gentle-vanguard-public';
  const baseUrl = `https://api.github.com/repos/${ghRepo}/releases`;
  const url = preRelease ? baseUrl : `${baseUrl}/latest`;

  const response = await fetch(url, {
    headers: { Accept: 'application/vnd.github.v3+json' },
  });

  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status}: ${response.statusText}`);
  }

  if (preRelease) {
    const releases = (await response.json()) as GitHubRelease[];
    if (!releases || releases.length === 0) {
      throw new Error('No releases found');
    }
    const sorted = releases.sort((a, b) => {
      const va = a.tag_name.replace(/^v/, '');
      const vb = b.tag_name.replace(/^v/, '');
      return compareSemver(vb, va);
    });
    return sorted[0];
  }

  return response.json() as Promise<GitHubRelease>;
}

function getProjectRoot(): string {
  return resolve(__dirname, '..', '..');
}

async function main(): Promise<void> {
  const { quiet, preRelease } = parseArgs();
  const projectRoot = getProjectRoot();
  const versionFile = join(projectRoot, 'VERSION');

  try {
    if (!existsSync(versionFile)) {
      throw new Error(`VERSION file not found at ${versionFile}`);
    }

    const localVersion = readFileSync(versionFile, 'utf-8').trim();
    if (!localVersion) {
      throw new Error('VERSION file is empty');
    }

    if (!quiet) {
      log('Checking for updates...', 'Cyan');
      log(`Local version: v${localVersion}`, 'Gray');
    }

    const release = await getLatestRelease(preRelease);
    const latestVersion = release.tag_name.replace(/^v/, '');
    const downloadAsset = release.assets.find((a) => a.name.endsWith('.exe'));
    const downloadUrl = downloadAsset ? downloadAsset.browser_download_url : '';

    if (!latestVersion) {
      throw new Error('Could not determine latest version from GitHub response');
    }

    if (!quiet) {
      log(`Latest version: v${latestVersion}`, 'Gray');
    }

    const comparison = compareSemver(localVersion, latestVersion);

    if (comparison < 0) {
      if (!quiet) {
        log(`Update available: v${localVersion} -> v${latestVersion}`, 'Green');
      }
      console.log(`UPDATE_AVAILABLE|${localVersion}|${latestVersion}|${downloadUrl}`);
      process.exit(1);
    } else {
      if (!quiet) {
        log(`You are on the latest version (v${localVersion})`, 'Green');
      }
      console.log(`UP_TO_DATE|${localVersion}`);
      process.exit(0);
    }
  } catch (e) {
    const errorMsg = (e instanceof Error ? e.message : String(e)).replace(/\|/g, '-');
    if (!quiet) {
      log(`Version check failed: ${errorMsg}`, 'Red');
    }
    console.log(`CHECK_FAILED|${errorMsg}`);
    process.exit(2);
  }
}

if (
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith('check-version.ts'))
) {
  main().catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`CHECK_FAILED|${msg.replace(/\|/g, '-')}`);
    process.exit(2);
  });
}
