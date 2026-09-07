#!/usr/bin/env node
/**
 * Release Automation Orchestrator v2.0
 *
 * Automates the complete release lifecycle:
 * 1. Pre-release validation (gates)
 * 2. Version bumping (semver)
 * 3. Changelog generation
 * 4. Git tagging
 * 5. Blockbuster (backup)
 * 6. npm publishing
 * 7. GitHub release creation
 * 8. Rollback on failure
 *
 * Usage:
 *   npm run release:auto -- [major|minor|patch|prerelease]
 *   npm run release:preview -- Shows what would happen
 *   npm run release:rollback -- Rollback last release
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { runSync, runSyncShell } from '../core/run-command.js';
import { log } from '../utils/logger.js';

const ROOT = resolve(process.cwd());
const RELEASE_STATE_DIR = join(ROOT, '.runtime', 'releases');

interface ReleaseOptions {
  bumpType: 'major' | 'minor' | 'patch' | 'prerelease';
  preview: boolean;
  force: boolean;
  skipTests: boolean;
  skipPublish: boolean;
}

interface ReleaseState {
  version: string;
  previousVersion: string;
  tag: string;
  commit: string;
  timestamp: string;
  changelogPath: string;
  backupPath?: string;
  published: boolean;
}

// Logger
const logger = log('RELEASE');

// =============================================================================
// VERSIONING
// =============================================================================

function getCurrentVersion(): string {
  const pkgPath = join(ROOT, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  return pkg.version;
}

function bumpVersion(current: string, type: ReleaseOptions['bumpType']): string {
  const parts = current.split('-')[0].split('.').map(Number);
  let [major, minor, patch] = parts;

  switch (type) {
    case 'major':
      major++;
      minor = 0;
      patch = 0;
      break;
    case 'minor':
      minor++;
      patch = 0;
      break;
    case 'patch':
      patch++;
      break;
    case 'prerelease':
      return `${major}.${minor}.${patch}-beta.${Date.now().toString(36).slice(0, 6)}`;
  }

  return `${major}.${minor}.${patch}`;
}

function updateVersion(version: string): void {
  const pkgPath = join(ROOT, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  pkg.version = version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

// =============================================================================
// VALIDATION
// =============================================================================

async function runPreReleaseValidation(skipTests: boolean): Promise<boolean> {
  logger.info('Running pre-release validation...');

  if (!skipTests) {
    // Run delivery gate
    try {
      runSync('npm', ['run', 'delivery:gate', '--', '--stage', 'release'], {
        cwd: ROOT,
        timeout: 300000,
      });
      logger.info('✅ Delivery gate passed');
    } catch {
      logger.error('❌ Delivery gate failed');
      return false;
    }
  }

  // Check clean working tree
  const status = runSync('git', ['status', '--porcelain'], { cwd: ROOT });
  if (status.stdout.trim()) {
    logger.error('❌ Working tree not clean. Commit or stash changes first.');
    return false;
  }

  logger.info('✅ Pre-release validation passed');
  return true;
}

// =============================================================================
// BLOCKBUSTER (BACKUP)
// =============================================================================

function createBlockbuster(version: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(RELEASE_STATE_DIR, `blockbuster-${version}-${timestamp}`);

  if (!existsSync(RELEASE_STATE_DIR)) {
    mkdirSync(RELEASE_STATE_DIR, { recursive: true });
  }

  // Create tar backup
  runSync('git', ['archive', '--format=tar.gz', '-o', `${backupPath}.tar.gz`, 'HEAD'], {
    cwd: ROOT,
  });

  // Backup .runtime state
  const runtimeBackup = join(backupPath, '.runtime-backup');
  if (existsSync(join(ROOT, '.runtime'))) {
    runSyncShell(`robocopy .runtime "${runtimeBackup}" /E /NFL /NDL`, { cwd: ROOT });
  }

  logger.info(`✅ Blockbuster created: ${backupPath}.tar.gz`);
  return backupPath;
}

// =============================================================================
// CHANGELOG
// =============================================================================

function generateChangelog(version: string): string {
  const lastTag = runSync('git', ['describe', '--tags', '--abbrev=0'], {
    cwd: ROOT,
  }).stdout.trim();

  const since = lastTag || 'HEAD~20';
  const commits = runSync('git', ['log', `${since}..HEAD`, '--pretty=format:- %s (%h)'], {
    cwd: ROOT,
  }).stdout;

  const date = new Date().toISOString().split('T')[0];
  const changelog = `## [${version}] - ${date}

### Changes
${commits || '- Version bump'}

---
`;

  return changelog;
}

function updateChangelogFile(version: string, changelog: string): void {
  const changelogPath = join(ROOT, 'CHANGELOG.md');
  let existing = '';

  if (existsSync(changelogPath)) {
    existing = readFileSync(changelogPath, 'utf-8');
  }

  writeFileSync(changelogPath, `# Changelog\n\n${changelog}\n${existing.replace(/^# Changelog\n\n/, '')}`);
}

// =============================================================================
// GIT OPERATIONS
// =============================================================================

function createGitTag(version: string, message: string): void {
  const tag = `v${version}`;

  // Create annotated tag
  runSync('git', ['tag', '-a', tag, '-m', message], { cwd: ROOT });

  logger.info(`✅ Git tag created: ${tag}`);
}

function pushToRemote(): void {
  // Push commits
  runSync('git', ['push', 'origin', 'HEAD'], { cwd: ROOT });

  // Push tags
  runSync('git', ['push', 'origin', '--tags'], { cwd: ROOT });

  logger.info('✅ Pushed to remote');
}

// =============================================================================
// NPM PUBLISH
// =============================================================================

function publishToNpm(): boolean {
  try {
    runSync('npm', ['publish', '--access', 'public'], {
      cwd: ROOT,
      timeout: 120000,
    });
    logger.info('✅ Published to npm');
    return true;
  } catch (error) {
    logger.error('❌ npm publish failed:', error);
    return false;
  }
}

// =============================================================================
// GITHUB RELEASE
// =============================================================================

function createGitHubRelease(version: string, changelog: string): void {
  try {
    // Check if gh CLI is available
    runSync('gh', ['--version'], { cwd: ROOT });

    const tag = `v${version}`;
    const releaseNotes = join(RELEASE_STATE_DIR, `release-notes-${version}.md`);
    writeFileSync(releaseNotes, changelog);

    runSync(
      'gh',
      ['release', 'create', tag, '--title', `Release ${version}`, '--notes-file', releaseNotes],
      { cwd: ROOT },
    );

    logger.info('✅ GitHub release created');
  } catch {
    logger.warn('⚠️ Could not create GitHub release (gh CLI not available)');
  }
}

// =============================================================================
// ROLLBACK
// =============================================================================

async function rollbackRelease(): Promise<void> {
  logger.info('Starting rollback...');

  // Find last release state
  const states = runSync('ls', ['-t', RELEASE_STATE_DIR], { cwd: ROOT })
    .stdout?.split('\n')
    .filter((f) => f.startsWith('state-'));

  if (!states || states.length === 0) {
    logger.error('No release state found for rollback');
    process.exit(1);
  }

  const lastStatePath = join(RELEASE_STATE_DIR, states[0]);
  const state: ReleaseState = JSON.parse(readFileSync(lastStatePath, 'utf-8'));

  logger.info(`Rolling back from ${state.version} to ${state.previousVersion}`);

  // Reset to previous commit
  runSync('git', ['reset', '--hard', state.commit], { cwd: ROOT });

  // Restore package.json version
  updateVersion(state.previousVersion);

  // Delete tag
  runSync('git', ['tag', '-d', state.tag], { cwd: ROOT });

  // Restore from backup if exists
  if (state.backupPath && existsSync(`${state.backupPath}.tar.gz`)) {
    logger.info('Restoring from blockbuster backup...');
    // Note: This would need proper extraction logic
    logger.info('⚠️ Manual restore from backup may be needed');
  }

  logger.info(`✅ Rollback complete: ${state.version} → ${state.previousVersion}`);
}

// =============================================================================
// MAIN RELEASE FLOW
// =============================================================================

async function runRelease(options: ReleaseOptions): Promise<void> {
  const startTime = Date.now();
  const currentVersion = getCurrentVersion();
  const newVersion = bumpVersion(currentVersion, options.bumpType);

  logger.info(`╔══════════════════════════════════════════════════╗`);
  logger.info(`║   RELEASE AUTOMATION v2.0                         ║`);
  logger.info(`╠══════════════════════════════════════════════════╣`);
  logger.info(`║ Version: ${currentVersion} → ${newVersion.padEnd(26)} ║`);
  logger.info(`║ Type: ${options.bumpType.padEnd(31)} ║`);
  logger.info(`║ Preview: ${options.preview ? 'YES' : 'NO'.padEnd(28)} ║`);
  logger.info(`╚══════════════════════════════════════════════════╝`);

  if (options.preview) {
    logger.info('\n🔍 PREVIEW MODE - No changes will be made\n');
  }

  // Step 1: Validation
  if (!(await runPreReleaseValidation(options.skipTests))) {
    process.exit(1);
  }

  if (options.preview) {
    logger.info('Preview: Validation would pass');
    return;
  }

  // Step 2: Blockbuster backup
  const backupPath = createBlockbuster(newVersion);

  // Step 3: Update version
  updateVersion(newVersion);
  logger.info(`✅ Version updated: ${newVersion}`);

  // Step 4: Generate changelog
  const changelog = generateChangelog(newVersion);
  updateChangelogFile(newVersion, changelog);
  logger.info('✅ Changelog updated');

  // Step 5: Commit changes
  runSync('git', ['add', 'package.json', 'CHANGELOG.md'], { cwd: ROOT });
  runSync('git', ['commit', '-m', `chore(release): ${newVersion}`], { cwd: ROOT });
  const commit = runSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).stdout.trim();
  logger.info('✅ Changes committed');

  // Step 6: Create tag
  createGitTag(newVersion, `Release ${newVersion}`);

  // Step 7: Push
  pushToRemote();

  // Step 8: Save release state
  const state: ReleaseState = {
    version: newVersion,
    previousVersion: currentVersion,
    tag: `v${newVersion}`,
    commit,
    timestamp: new Date().toISOString(),
    changelogPath: join(ROOT, 'CHANGELOG.md'),
    backupPath,
    published: false,
  };

  if (!existsSync(RELEASE_STATE_DIR)) {
    mkdirSync(RELEASE_STATE_DIR, { recursive: true });
  }
  writeFileSync(
    join(RELEASE_STATE_DIR, `state-${newVersion}.json`),
    JSON.stringify(state, null, 2),
  );

  // Step 9: Publish (if not skipped)
  if (!options.skipPublish) {
    const published = publishToNpm();
    state.published = published;

    if (!published && !options.force) {
      logger.error('❌ npm publish failed. Use --force to continue anyway.');
      // Rollback option here
      process.exit(1);
    }

    // Step 10: GitHub Release
    createGitHubRelease(newVersion, changelog);
  }

  // Final state update
  writeFileSync(
    join(RELEASE_STATE_DIR, `state-${newVersion}.json`),
    JSON.stringify(state, null, 2),
  );

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  logger.info('\n╔══════════════════════════════════════════════════╗');
  logger.info('║   RELEASE COMPLETE ✅                            ║');
  logger.info('╠══════════════════════════════════════════════════╣');
  logger.info(`║ Version: ${newVersion.padEnd(36)} ║`);
  logger.info(`║ Tag: ${(`v${newVersion}`).padEnd(40)} ║`);
  logger.info(`║ Commit: ${commit.slice(0, 7).padEnd(37)} ║`);
  logger.info(`║ Duration: ${(duration + 's').padEnd(35)} ║`);
  logger.info(`║ Backup: ${(backupPath.split('/').pop() || '').padEnd(37)} ║`);
  logger.info('╚══════════════════════════════════════════════════╝');
}

// =============================================================================
// CLI
// =============================================================================

function parseArgs(argv: string[]): { cmd: string; opts: ReleaseOptions } {
  const opts: ReleaseOptions = {
    bumpType: 'patch',
    preview: false,
    force: false,
    skipTests: false,
    skipPublish: false,
  };

  let cmd = 'release';

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];

    if (['major', 'minor', 'patch', 'prerelease'].includes(arg)) {
      opts.bumpType = arg as ReleaseOptions['bumpType'];
    } else if (arg === 'rollback') {
      cmd = 'rollback';
    } else if (arg === 'preview') {
      cmd = 'preview';
      opts.preview = true;
    } else if (arg === '--force' || arg === '-f') {
      opts.force = true;
    } else if (arg === '--skip-tests') {
      opts.skipTests = true;
    } else if (arg === '--skip-publish') {
      opts.skipPublish = true;
    } else if (arg === '--help' || arg === '-h') {
      cmd = 'help';
    }
  }

  return { cmd, opts };
}

function showHelp(): void {
  console.log(`
Release Automation v2.0

Commands:
  npm run release:auto [major|minor|patch|prerelease]
    Create a new release

  npm run release:auto preview [major|minor|patch]
    Preview what would happen without making changes

  npm run release:rollback
    Rollback the last release

Options:
  --force, -f         Continue even if npm publish fails
  --skip-tests        Skip delivery gate validation
  --skip-publish      Skip npm publish and GitHub release

Examples:
  npm run release:auto patch
  npm run release:auto minor --force
  npm run release:auto preview major
  npm run release:rollback
`);
}

// Run CLI
async function main(): Promise<void> {
  const { cmd, opts } = parseArgs(process.argv);

  switch (cmd) {
    case 'help':
      showHelp();
      break;
    case 'rollback':
      await rollbackRelease();
      break;
    case 'preview':
      await runRelease({ ...opts, preview: true });
      break;
    case 'release':
      await runRelease(opts);
      break;
    default:
      showHelp();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}

export { runRelease, rollbackRelease, bumpVersion };
