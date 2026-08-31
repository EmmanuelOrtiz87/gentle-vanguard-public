/**
 * version-sync.ts — single source of truth enforcement for stack versions.
 *
 * Fails (exit 1) when any of these disagree:
 *   - VERSION file vs package.json "version"
 *   - apps/web-dashboard/package.json vs root package.json
 *   - CHANGELOG.md newest released entry newer than package.json (impossible state)
 *   - releases/latest-version.json newer than package.json (published ahead of code)
 *
 * Warns (exit 0) when package.json version has no CHANGELOG entry and no
 * [Unreleased] section exists — that is a release-process gap, not drift.
 *
 * Usage: npm run version:check
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');

function readText(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readText(rel)) as Record<string, unknown>;
}

function semverGt(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}

const VERSION_RE = /^## \[(\d+\.\d+\.\d+)\]/;

function newestChangelogVersion(changelog: string): string | null {
  for (const line of changelog.split('\n')) {
    const m = VERSION_RE.exec(line);
    if (m) return m[1];
  }
  return null;
}

interface Failure {
  file: string;
  expected: string;
  actual: string;
}

const failures: Failure[] = [];
const warnings: string[] = [];

const pkgVersion = readJson('package.json')['version'] as string;

// 1. VERSION file
const versionFile = readText('VERSION').trim();
if (versionFile !== pkgVersion) {
  failures.push({ file: 'VERSION', expected: pkgVersion, actual: versionFile });
}

// 2. Dashboard workspace member
const dashboardPath = join(ROOT, 'apps', 'web-dashboard', 'package.json');
if (existsSync(dashboardPath)) {
  const dashVersion = readJson('apps/web-dashboard/package.json')['version'] as string;
  if (dashVersion !== pkgVersion) {
    failures.push({
      file: 'apps/web-dashboard/package.json',
      expected: pkgVersion,
      actual: dashVersion,
    });
  }
}

// 3. CHANGELOG must not be ahead of code
const changelog = readText('CHANGELOG.md');
const changelogNewest = newestChangelogVersion(changelog);
if (changelogNewest && semverGt(changelogNewest, pkgVersion)) {
  failures.push({
    file: 'CHANGELOG.md (newest entry)',
    expected: `<= ${pkgVersion}`,
    actual: changelogNewest,
  });
}

// 4. Published manifest must not be ahead of code
const latestVersionPath = join(ROOT, 'releases', 'latest-version.json');
if (existsSync(latestVersionPath)) {
  const manifest = readJson('releases/latest-version.json');
  const published = manifest['version'] as string;
  if (semverGt(published, pkgVersion)) {
    failures.push({
      file: 'releases/latest-version.json',
      expected: `<= ${pkgVersion}`,
      actual: published,
    });
  }
  if (!manifest['sha256']) {
    failures.push({
      file: 'releases/latest-version.json',
      expected: 'non-empty sha256',
      actual: '(empty)',
    });
  }
}

// 5. Warn when the current version lacks a CHANGELOG entry and nothing is unreleased
const hasUnreleased = /^## \[Unreleased\]/m.test(changelog);
const currentEntry = `## [${pkgVersion}]`;
if (!changelog.includes(currentEntry) && !hasUnreleased) {
  warnings.push(
    `CHANGELOG.md has no [${pkgVersion}] entry and no [Unreleased] section — ` +
      `document the release before tagging.`,
  );
}

for (const w of warnings) console.warn(`[version-sync] WARN: ${w}`);

if (failures.length > 0) {
  console.error('[version-sync] Version drift detected:');
  for (const f of failures) {
    console.error(`  - ${f.file}: expected ${f.expected}, found ${f.actual}`);
  }
  console.error(
    '\nFix by syncing all sources in the same commit (VERSION, package.json, ' +
      'apps/web-dashboard/package.json, CHANGELOG.md, releases/latest-version.json).',
  );
  process.exit(1);
}

console.log(
  `[version-sync] OK — all sources aligned on ${pkgVersion}` +
    (changelogNewest ? ` (changelog newest: ${changelogNewest})` : '') +
    (warnings.length ? ` — ${warnings.length} warning(s)` : ''),
);
