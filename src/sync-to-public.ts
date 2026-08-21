#!/usr/bin/env tsx
/**
 * sync-to-public.ts — Sync changes from private repo to public repo.
 *
 * TS migration of scripts/utilities/ops/DEPLOYMENT/sync-to-public.ps1
 * (original deleted in commit 8d6ed7dd without a TS replacement — this file
 * closes that migration gap).
 *
 * Copies ONLY public-safe files:
 *   - Bootstrap scripts (plain text - needed for onboarding)
 *   - Public documentation (README, LICENSE, docs/, demos/)
 *   - Marketing CMS & presentations (docs/presentations/ — resources-index.html, studios, social assets)
 *   - Example configs (no secrets)
 *   - Pre-built encrypted artifacts (build/protected/)
 *   - Public skill stubs (build/public/)
 *   - Single installer executable: Gentle-Vanguard.exe
 *
 * Does NOT copy:
 *   - Plain-text scripts, configs, or skills (should be encrypted in protected/)
 *   - Internal documentation
 *
 * Usage:
 *   npx tsx src/sync-to-public.ts [--private-repo <path>] [--public-repo <path>]
 *                                 [--public-repo-slug <owner/repo>] [--skip-push]
 */

import * as fs from 'fs';
import * as path from 'path';
import { runSyncShell } from './core/run-command.js';

interface SyncOptions {
  privateRepo: string;
  publicRepo: string;
  publicRepoSlug: string;
  skipPush: boolean;
}

function resolveRoot(startDir: string): string {
  if (process.env.GENTLE_VANGUARD_BASE_DIR) return process.env.GENTLE_VANGUARD_BASE_DIR!;
  let dir = startDir;
  while (dir && !fs.existsSync(path.join(dir, 'config', 'orchestrator.json'))) {
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dir;
}

function parseArgs(): SyncOptions {
  const args = process.argv.slice(2);
  const extract = (name: string): string | undefined => {
    const idx = args.indexOf(name);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };

  const resolvedRoot = resolveRoot(process.cwd());
  const privateRepo = extract('--private-repo') || process.env.PRIVATE_REPO || resolvedRoot;

  const publicRepo =
    extract('--public-repo') ||
    process.env.PUBLIC_REPO ||
    path.join(path.dirname(resolvedRoot), 'gentle-vanguard-public');

  return {
    privateRepo,
    publicRepo,
    publicRepoSlug:
      extract('--public-repo-slug') ||
      process.env.PUBLIC_REPO_SLUG ||
      'EmmanuelOrtiz87/gentle-vanguard-public',
    skipPush: args.includes('--skip-push'),
  };
}

function mkdirp(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function copyIf(src: string, dst: string, { recurse = false } = {}): void {
  if (!fs.existsSync(src)) return;
  if (recurse) {
    fs.cpSync(src, dst, { recursive: true, force: true });
  } else {
    mkdirp(path.dirname(dst));
    fs.copyFileSync(src, dst);
  }
}

function rmIf(p: string, { recurse = false } = {}): void {
  if (!fs.existsSync(p)) return;
  if (recurse) {
    fs.rmSync(p, { recursive: true, force: true });
  } else {
    fs.unlinkSync(p);
  }
}

/**
 * Sync-FilesToBranch — runs file-by-file copy operations for one branch.
 */
function syncFilesToBranch(opts: SyncOptions, targetDir: string): void {
  const { privateRepo } = opts;
  const buildDir = path.join(privateRepo, 'build');
  const distDir = path.join(privateRepo, 'dist');

  console.log(`  ── populating ${targetDir} ──`);

  // 0. Bootstrap scripts (TS versions after PS1→TS migration)
  const bootstrapDir = path.join(targetDir, 'scripts', 'gentle-vanguard');
  mkdirp(bootstrapDir);
  for (const tsFile of ['bootstrap.ts', 'bootstrap-machine.ts', 'setup-multi-machine.ts']) {
    copyIf(path.join(privateRepo, 'src', tsFile), path.join(bootstrapDir, tsFile));
  }

  // 1. Public root docs
  copyIf(path.join(privateRepo, 'README-PUBLIC.md'), path.join(targetDir, 'README.md'));
  copyIf(path.join(privateRepo, 'LICENSE'), path.join(targetDir, 'LICENSE'));
  copyIf(path.join(privateRepo, 'CONTRIBUTING.md'), path.join(targetDir, 'CONTRIBUTING.md'));
  if (fs.existsSync(path.join(privateRepo, 'SECURITY.md'))) {
    copyIf(path.join(privateRepo, 'SECURITY.md'), path.join(targetDir, 'SECURITY.md'));
  } else if (fs.existsSync(path.join(privateRepo, 'docs', 'SECURITY.md'))) {
    copyIf(path.join(privateRepo, 'docs', 'SECURITY.md'), path.join(targetDir, 'SECURITY.md'));
  }
  copyIf(path.join(privateRepo, 'CHANGELOG.md'), path.join(targetDir, 'CHANGELOG.md'));
  copyIf(path.join(privateRepo, 'BUILD-README.md'), path.join(targetDir, 'BUILD-README.md'));
  copyIf(path.join(privateRepo, 'INSTALLATION.md'), path.join(targetDir, 'INSTALLATION.md'));

  // 2. Public docs dir
  rmIf(path.join(targetDir, 'docs'), { recurse: true });
  mkdirp(path.join(targetDir, 'docs'));
  for (const dir of [
    'docs/getting-started',
    'docs/guides',
    'docs/marketing',
    'docs/supplementary',
    'docs/presentations',
  ]) {
    const src = path.join(privateRepo, dir);
    if (fs.existsSync(src)) {
      copyIf(src, path.join(targetDir, dir), { recurse: true });
    }
  }
  // Public architecture and publication guidance. Keep the technical reference
  // explicit so README links remain valid without exposing internal docs.
  for (const file of ['docs/technical/STACK-DOCUMENTATION.md', 'docs/REPOSITORY-PUBLICATION.md']) {
    copyIf(path.join(privateRepo, file), path.join(targetDir, file));
  }
  const refDir = path.join(targetDir, 'docs', 'reference');
  mkdirp(refDir);
  for (const f of [
    'docs/reference/ARCHITECTURE.md',
    'docs/ROADMAP.md',
    'docs/reference/SKILL-ORGANIZATION.md',
    'docs/reference/SKILL-RESOLVER-PROTOCOL.md',
    'docs/reference/SUBAGENT-ARCHITECTURE.md',
    'docs/reference/PLUGIN-ARCHITECTURE.md',
    'docs/reference/REAL-TOKEN-TRACKING.md',
  ]) {
    copyIf(path.join(privateRepo, f), path.join(refDir, path.basename(f)));
  }
  if (fs.existsSync(path.join(privateRepo, 'docs', 'architecture', 'README.md'))) {
    mkdirp(path.join(targetDir, 'docs', 'architecture'));
    copyIf(
      path.join(privateRepo, 'docs', 'architecture', 'README.md'),
      path.join(targetDir, 'docs', 'architecture', 'README.md'),
    );
  }
  copyIf(
    path.join(privateRepo, 'docs', 'EXAMPLES.md'),
    path.join(targetDir, 'docs', 'EXAMPLES.md'),
  );

  // 3. Example configs
  const exampleDir = path.join(targetDir, 'config');
  rmIf(exampleDir, { recurse: true });
  mkdirp(exampleDir);
  for (const example of [
    'workspace.example.json',
    'workspace.portable.example.json',
    'github-runner.example.json',
    'ai-review.example.json',
  ]) {
    copyIf(path.join(privateRepo, 'config', example), path.join(exampleDir, example));
  }
  copyIf(path.join(privateRepo, 'config', 'README.md'), path.join(exampleDir, 'README.md'));

  // 4. Encrypted protected/
  if (fs.existsSync(path.join(buildDir, 'protected'))) {
    rmIf(path.join(targetDir, 'protected'), { recurse: true });
    copyIf(path.join(buildDir, 'protected'), path.join(targetDir, 'protected'), { recurse: true });
  }

  // 5. Public skill stubs
  if (fs.existsSync(path.join(buildDir, 'public'))) {
    rmIf(path.join(targetDir, 'public'), { recurse: true });
    copyIf(path.join(buildDir, 'public'), path.join(targetDir, 'public'), { recurse: true });
  }

  // 6. Demos
  if (fs.existsSync(path.join(privateRepo, 'demos'))) {
    rmIf(path.join(targetDir, 'demos'), { recurse: true });
    copyIf(path.join(privateRepo, 'demos'), path.join(targetDir, 'demos'), { recurse: true });
  }

  // 6b. Presentation
  copyIf(
    path.join(privateRepo, 'gentle-vanguard-presentation.html'),
    path.join(targetDir, 'gentle-vanguard-presentation.html'),
  );

  // 7. Installer exe
  if (fs.existsSync(path.join(distDir, 'Gentle-Vanguard.exe'))) {
    for (const old of ['Gentle-Vanguard-Launcher.exe', 'Gentle-Vanguard-Setup.exe']) {
      rmIf(path.join(targetDir, old));
    }
    copyIf(path.join(distDir, 'Gentle-Vanguard.exe'), path.join(targetDir, 'Gentle-Vanguard.exe'));
  }

  // 8. Root infra files
  for (const f of ['docker-compose.yml', 'docker-compose.test.yml', 'Dockerfile']) {
    copyIf(path.join(privateRepo, f), path.join(targetDir, f));
  }

  // 9. Cleanup plain-text artifacts
  for (const dir of [
    'scripts/utilities',
    'scripts/monitoring',
    'scripts/security',
    'scripts/git-hooks',
    'scripts/validation',
    'scripts/project',
    'scripts/diagnostics',
    'scripts/docs',
    'scripts/testing',
    'scripts/sre',
    'scripts/core',
  ]) {
    rmIf(path.join(targetDir, dir), { recurse: true });
  }
  if (fs.existsSync(path.join(targetDir, 'scripts'))) {
    for (const f of fs.readdirSync(path.join(targetDir, 'scripts'))) {
      const full = path.join(targetDir, 'scripts', f);
      if (fs.statSync(full).isFile() && f !== 'run-tests-simple.ps1') rmIf(full);
    }
  }
  rmIf(path.join(targetDir, 'skills'), { recurse: true });
  if (fs.existsSync(exampleDir)) {
    for (const f of fs.readdirSync(exampleDir)) {
      if (!/\.example\..*/.test(f) && f !== 'README.md' && f !== 'PSScriptAnalyzerSettings.psd1') {
        rmIf(path.join(exampleDir, f));
      }
    }
  }

  // 10. CI scripts (TS migration: original .ps1 paths were migrated to src/)
  // The public distribution is executable source, not a documentation-only mirror.
  // Copy the complete TypeScript runtime so transitive imports cannot be orphaned.
  rmIf(path.join(targetDir, 'src'), { recurse: true });
  copyIf(path.join(privateRepo, 'src'), path.join(targetDir, 'src'), { recurse: true });
  // Runtime state is local-only and must never cross the publication boundary.
  rmIf(path.join(targetDir, 'src', '.gateguard-state.json'));
  rmIf(path.join(targetDir, '.runtime'), { recurse: true });
  rmIf(path.join(targetDir, '.session'), { recurse: true });
  rmIf(path.join(targetDir, '.telemetry'), { recurse: true });

  // The dashboard database manager is a runtime dependency of db-init.
  rmIf(path.join(targetDir, 'apps', 'web-dashboard'), { recurse: true });
  copyIf(path.join(privateRepo, 'apps', 'web-dashboard'), path.join(targetDir, 'apps', 'web-dashboard'), { recurse: true });

  const ciScripts = [
    'src/installer-doctor.ts',
    'src/installer-bootstrap.ts',
    'src/core/run-command.ts',
    'src/test-runner-optimized.ts',
    'src/mcp/fetch-server-native.ts',
    'src/web-crawler.ts',
    'src/npm-ci-check.ts',
    'src/validate-tool-configs.ts',
    'src/cross-workspace-validator.ts',
    'src/enforce-error-budget.ts',
    'src/performance-slo-monitor.ts',
    'src/check-sdd-gate.ts',
    'src/generate-sbom.ts',
    'src/generate-management-report.ts',
    'scripts/validation/validate-complete-system.ts',
    'scripts/validation/full-stack-verification.ts',
    'scripts/validation/final-validation.ts',
    'scripts/validation/validate-token-system.ts',
    'scripts/utilities/ops/receipt-manager.ts',
    'scripts/utilities/ops/staged-review.ts',
  ];
  for (const rel of ciScripts) {
    const src = path.join(privateRepo, rel);
    if (fs.existsSync(src)) {
      const dst = path.join(targetDir, rel);
      mkdirp(path.dirname(dst));
      fs.copyFileSync(src, dst);
    }
  }

  copyIf(
    path.join(privateRepo, 'config', 'installer-manifest.json'),
    path.join(targetDir, 'config', 'installer-manifest.json'),
  );
  for (const runtimeConfig of ['config/session-autostart.config.json', 'config/model-router.json']) {
    copyIf(path.join(privateRepo, runtimeConfig), path.join(targetDir, runtimeConfig));
  }

  // 10b. CI root files
  for (const f of [
    '.gitleaks.toml',
    'package.json',
    '.prettierrc',
    '.prettierignore',
    'VERSION',
    'INSTALLATION.md',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tsconfig.json',
  ]) {
    copyIf(path.join(privateRepo, f), path.join(targetDir, f));
  }

  // Adapters
  if (fs.existsSync(path.join(privateRepo, 'adapters'))) {
    rmIf(path.join(targetDir, 'adapters'), { recurse: true });
    copyIf(path.join(privateRepo, 'adapters'), path.join(targetDir, 'adapters'), { recurse: true });
  }

  const pssaSrc = path.join(privateRepo, 'config', 'PSScriptAnalyzerSettings.psd1');
  if (fs.existsSync(pssaSrc)) {
    copyIf(pssaSrc, path.join(targetDir, 'config', 'PSScriptAnalyzerSettings.psd1'));
  }

  // 10c. CI test files
  for (const td of ['tests/unit', 'tests/smoke']) {
    if (fs.existsSync(path.join(privateRepo, td))) {
      rmIf(path.join(targetDir, td), { recurse: true });
      copyIf(path.join(privateRepo, td), path.join(targetDir, td), { recurse: true });
    }
  }

  // 10d. CI workflows (adapted: branches develop → main)
  const workflowSrcDir = path.join(privateRepo, '.github', 'workflows');
  const workflowDstDir = path.join(targetDir, '.github', 'workflows');
  mkdirp(workflowDstDir);
  for (const wf of [
    'ci.yml',
    'security.yml',
    'reusable-lint.yml',
    'reusable-security.yml',
    'reusable-test.yml',
    'reusable-governance.yml',
    'dashboard-auto-refresh.yml',
    'labeler.yml',
    'pr.yml',
    'push.yml',
    'release.yml',
    'sync-public.yml',
  ]) {
    const src = path.join(workflowSrcDir, wf);
    if (!fs.existsSync(src)) continue;
    let content = fs.readFileSync(src, 'utf-8');
    content = content.replace(/branches:\s*\[\s*develop\s*\]/g, 'branches: [main]');
    content = content.replace(/branches:\s*\[(.*?develop.*?)\]/g, 'branches: [main]');
    fs.writeFileSync(path.join(workflowDstDir, wf), content, 'utf-8');
  }
}

/**
 * Commit and push to ALL remote branches.
 */
function pushToAllBranches(opts: SyncOptions): void {
  const { publicRepo } = opts;
  const run = (cmd: string, cwd?: string): string =>
    runSyncShell(cmd, { cwd: cwd ?? publicRepo, stdio: ['pipe', 'pipe', 'pipe'] }).stdout;

  try {
    run('git fetch origin --prune');
  } catch {
    console.log('[WARN] git fetch origin failed — continuing with current refs');
  }

  let remoteBranches: string[] = [];
  try {
    remoteBranches = run('git branch -r')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^origin\/(\S+)/.test(l) && !l.includes('->'))
      .map((l) => l.replace(/^origin\//, ''));
  } catch {
    // no remote refs
  }
  if (remoteBranches.length === 0) remoteBranches = ['main'];
  console.log(`[DETECT] Remote branches: ${remoteBranches.join(', ')}`);

  let priorBranch = 'main';
  try {
    priorBranch = run('git branch --show-current').trim();
  } catch {
    // detached
  }

  for (const branch of remoteBranches) {
    console.log(`[BRANCH] Syncing to '${branch}'...`);

    const localBranch = (() => {
      try {
        return run(`git branch --list ${branch}`);
      } catch {
        return '';
      }
    })();

    try {
      if (localBranch.trim().length === 0) {
        run(`git checkout -B ${branch} origin/${branch}`);
      } else {
        run(`git checkout ${branch}`);
      }
    } catch (err) {
      console.log(`[WARN] Could not checkout ${branch}: ${String(err)}`);
      continue;
    }

    try {
      run(`git reset --hard origin/${branch}`);
    } catch {
      console.log(`[WARN] Could not reset to origin/${branch} — skipping`);
      continue;
    }

    syncFilesToBranch(opts, publicRepo);

    try {
      run('git add .');
      const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
      const commitMsg = `sync: automated sync from private repo - ${timestamp}`;
      run(`git commit -m "${commitMsg}"`);
      console.log(`[OK] Committed to '${branch}': ${commitMsg}`);
      try {
        run(`git push origin ${branch}`);
        console.log(`[OK] Pushed to origin/${branch}`);
      } catch (err) {
        console.log(`[FAIL] Push to ${branch} failed: ${String(err)}`);
      }
    } catch {
      console.log(`i  Nothing to commit on '${branch}' — up to date`);
    }
  }

  try {
    run(`git checkout ${priorBranch}`);
  } catch {
    // ignore
  }
}

function main(): void {
  const opts = parseArgs();
  const { privateRepo, publicRepo } = opts;

  console.log('=== Syncing Private -> Public Repo ===');
  console.log(`[INFO] privateRepo=${privateRepo}`);
  console.log(`[INFO] publicRepo=${publicRepo}`);
  console.log('');

  if (!fs.existsSync(path.join(privateRepo, 'config', 'orchestrator.json'))) {
    console.log(
      '[WARN] privateRepo does not look like a Gentle-Vanguard root (missing config/orchestrator.json)',
    );
  }

  if (opts.skipPush) {
    console.log('[INFO] --skip-push enabled — running file sync only (no git ops)');
    mkdirp(publicRepo);
    syncFilesToBranch(opts, publicRepo);
    console.log('');
    console.log('=== Sync Complete (skipPush) ===');
    return;
  }

  if (!fs.existsSync(path.join(publicRepo, '.git'))) {
    console.log(`[FATAL] publicRepo is not a git repo: ${publicRepo}`);
    process.exit(1);
  }

  pushToAllBranches(opts);
  console.log('');
  console.log('=== Sync Complete ===');
}

main();
