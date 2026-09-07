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
import { runSync } from '../core/run-command.js';

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

/** Recursively collect all file paths under a directory (skips node_modules/.git). */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
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
    'docs/brand',
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

  // 7. Installer exe — prefer the newest versioned installer (Gentle-Vanguard-Setup-<ver>.exe),
  //    falling back to the legacy unversioned name.
  const versionedInstallers = fs
    .readdirSync(distDir)
    .filter((f) => /^Gentle-Vanguard-Setup-\d+\.\d+\.\d+\.exe$/.test(f))
    .sort()
    .reverse();
  const newestInstaller = versionedInstallers[0] || 'Gentle-Vanguard.exe';
  if (fs.existsSync(path.join(distDir, newestInstaller))) {
    for (const old of ['Gentle-Vanguard-Launcher.exe', 'Gentle-Vanguard-Setup.exe']) {
      rmIf(path.join(targetDir, old));
    }
    copyIf(path.join(distDir, newestInstaller), path.join(targetDir, 'Gentle-Vanguard.exe'));
    // Ship the matching checksum alongside the installer when present.
    const shaPath = path.join(distDir, `${newestInstaller}.sha256`);
    if (fs.existsSync(shaPath)) {
      copyIf(shaPath, path.join(targetDir, 'Gentle-Vanguard.exe.sha256'));
    }
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

  // 9b. Legacy PowerShell scripts are never part of the public distribution:
  // the stack migrated to TypeScript (NORM-TS-001). Remove every .ps1 that
  // survived from previous syncs (bootstrap is shipped as TS in
  // scripts/gentle-vanguard/).
  const ps1Files = walkFiles(targetDir).filter((f) => f.endsWith('.ps1'));
  for (const f of ps1Files) {
    rmIf(f);
  }

  // 9c. Legacy top-level directories that are no longer part of the public
  // distribution. The sync copies an explicit allowlist (docs, protected,
  // public, demos, src, adapters, tests/unit, tests/smoke, scripts/gentle-vanguard,
  // config examples + a few runtime configs). Anything else that survived from
  // previous syncs is stale and must be removed so the public repo stays
  // homologated: no apps, no .ps1, no internal reports/rules/research.
  for (const staleDir of [
    'reports',
    'templates',
    'docs-archive',
    'rules',
    'rules-archive',
    'research',
    'tools',
    'legacy-foundation',
    'openspec',
    'plugins',
    'releases',
    'client',
    'gentle-vanguard',
    '.ft',
    '.cursor',
    '.continue',
    '.engram',
    '.codex',
    '.antigravity',
    '.devcontainer',
    '.cline',
    '.engram-data',
    '.workspace',
    '.windsurf',
    '.event-bus',
  ]) {
    rmIf(path.join(targetDir, staleDir), { recurse: true });
  }

  // 9d. Stale root files that are not part of the public allowlist. The sync
  // copies an explicit set of root files (README, LICENSE, CONTRIBUTING,
  // SECURITY, CHANGELOG, BUILD-README, INSTALLATION, docker-compose*, Dockerfile,
  // .gitleaks.toml, package.json, .prettier*, VERSION, pnpm-*, tsconfig.json,
  // config/*.example, installer-manifest.json, runtime configs, presentation,
  // installer exe). Anything else at the root that survived from previous syncs
  // is stale and must be removed.
  for (const staleFile of [
    'README-PUBLIC.md',
    'CLAUDE.md',
    'AGENTS.md',
    'opencode.json',
    'pyproject.toml',
    'renovate.json',
    'skills-lock.json',
    '.cursorrules',
    '.clinerules',
    '.clineignore',
    '.orchestrator-active',
    '.graphifyignore',
    '.eslintrc.json',
    '.eslintignore',
    '.env.example',
    '.env.local.example',
    '.lefthook.yml',
    '.markdownlint.json',
    '.secretlintrc.json',
    '.secretlintignore',
    '.trivyignore',
    '.editorconfig',
    '.npmrc',
    '.nvmrc',
    '.node-version',
  ]) {
    rmIf(path.join(targetDir, staleFile));
  }

  // 10. Public runtime and CI inputs.
  // The public distribution is executable source, but its workflow is deliberately
  // narrower than the private engineering CI.
  rmIf(path.join(targetDir, 'src'), { recurse: true });
  copyIf(path.join(privateRepo, 'src'), path.join(targetDir, 'src'), { recurse: true });
  // Runtime state is local-only and must never cross the publication boundary.
  rmIf(path.join(targetDir, 'src', '.gateguard-state.json'));
  rmIf(path.join(targetDir, '.runtime'), { recurse: true });
  rmIf(path.join(targetDir, '.session'), { recurse: true });
  rmIf(path.join(targetDir, '.telemetry'), { recurse: true });

  // Apps are local-first products (ADR-0017): they must never cross the
  // publication boundary. Remove any legacy apps/ tree from the target.
  rmIf(path.join(targetDir, 'apps'), { recurse: true });

  const ciScripts = [
    'src/installer-doctor.ts',
    'src/installer-bootstrap.ts',
    'src/core/run-command.ts',
    'src/review/test-runner-optimized.ts',
    'src/mcp/fetch-server-native.ts',
    'src/web/web-crawler.ts',
    'src/npm-ci-check.ts',
    'src/validate-tool-configs.ts',
    'src/integrations/cross-workspace-validator.ts',
    'src/monitor/enforce-error-budget.ts',
    'src/monitor/performance-slo-monitor.ts',
    'src/sdd/check-sdd-gate.ts',
    'src/security/generate-sbom.ts',
    'src/tools/generate-management-report.ts',
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
  for (const runtimeConfig of [
    'config/session-autostart.config.json',
    'config/model-router.json',
  ]) {
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

  // 10d. Public workflow only. Private CI and release workflows must not run against
  // the public distribution: their assertions include private operational assets.
  const workflowSrcDir = path.join(privateRepo, '.github', 'workflows');
  const workflowDstDir = path.join(targetDir, '.github', 'workflows');
  rmIf(workflowDstDir, { recurse: true });
  mkdirp(workflowDstDir);
  for (const wf of ['public-smoke.yml']) {
    const src = path.join(workflowSrcDir, wf);
    if (!fs.existsSync(src)) continue;
    let content = fs.readFileSync(src, 'utf-8');
    content = content.replace(/branches:\s*\[\s*develop\s*\]/g, 'branches: [main]');
    content = content.replace(/branches:\s*\[(.*?develop.*?)\]/g, 'branches: [main]');
    fs.writeFileSync(path.join(workflowDstDir, wf), content, 'utf-8');
  }
}

/**
 * Commit and push to distribution branches (main, develop).
 *
 * Git commands use array form (runSync) — never shell strings — because
 * `cmd /d /s /c` + Node arg quoting strips inner quotes, turning
 * `git commit -m "sync: automated ..."` into pathspec errors (silent no-op).
 * Every command's exit status is validated; failures are loud.
 */
function pushToAllBranches(opts: SyncOptions): void {
  const { publicRepo } = opts;
  const git = (args: string[]): string => {
    const r = runSync('git', args, { cwd: publicRepo, timeout: 180000 });
    if (r.status !== 0) {
      throw new Error(
        `git ${args.join(' ')} → exit ${r.status}: ${(r.stderr || r.stdout).slice(0, 300)}`,
      );
    }
    return r.stdout;
  };

  try {
    git(['fetch', 'origin', '--prune']);
  } catch {
    console.log('[WARN] git fetch origin failed — continuing with current refs');
  }

  let remoteBranches: string[] = [];
  try {
    remoteBranches = git(['branch', '-r'])
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^origin\/(\S+)/.test(l) && !l.includes('->'))
      .map((l) => l.replace(/^origin\//, ''));
  } catch {
    // no remote refs
  }
  if (remoteBranches.length === 0) remoteBranches = ['main'];
  // Only sync real distribution branches — never dependabot/feature PR branches.
  const SYNC_BRANCHES = new Set(['main', 'develop']);
  const skipped = remoteBranches.filter((b) => !SYNC_BRANCHES.has(b));
  remoteBranches = remoteBranches.filter((b) => SYNC_BRANCHES.has(b));
  if (skipped.length > 0) {
    console.log(`[SKIP] Non-distribution branches excluded from sync: ${skipped.join(', ')}`);
  }
  console.log(`[DETECT] Remote branches: ${remoteBranches.join(', ')}`);

  let priorBranch = 'main';
  try {
    priorBranch = git(['branch', '--show-current']).trim();
  } catch {
    // detached
  }

  for (const branch of remoteBranches) {
    console.log(`[BRANCH] Syncing to '${branch}'...`);

    const localBranch = (() => {
      try {
        return git(['branch', '--list', branch]);
      } catch {
        return '';
      }
    })();

    try {
      if (localBranch.trim().length === 0) {
        git(['checkout', '-B', branch, `origin/${branch}`]);
      } else {
        git(['checkout', branch]);
      }
    } catch (err) {
      console.log(`[WARN] Could not checkout ${branch}: ${String(err)}`);
      continue;
    }

    try {
      git(['reset', '--hard', `origin/${branch}`]);
    } catch (err) {
      console.log(`[WARN] Could not reset to origin/${branch} — skipping: ${String(err)}`);
      continue;
    }

    syncFilesToBranch(opts, publicRepo);

    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const commitMsg = `sync: automated sync from private repo - ${timestamp}`;
    const addResult = runSync('git', ['add', '.'], { cwd: publicRepo, timeout: 120000 });
    if (addResult.status !== 0) {
      console.log(`[FAIL] git add . on '${branch}': ${(addResult.stderr || '').slice(0, 300)}`);
      continue;
    }
    const commitResult = runSync('git', ['commit', '-m', commitMsg], {
      cwd: publicRepo,
      timeout: 60000,
    });
    if (commitResult.status === 0) {
      console.log(`[OK] Committed to '${branch}': ${commitMsg}`);
    } else if (/nothing to commit/i.test(`${commitResult.stdout}${commitResult.stderr}`)) {
      console.log(`i  Nothing to commit on '${branch}' — up to date`);
      continue;
    } else {
      console.log(
        `[FAIL] Commit on '${branch}' → exit ${commitResult.status}: ${(commitResult.stderr || commitResult.stdout).slice(0, 300)}`,
      );
      continue;
    }
    const pushResult = runSync('git', ['push', 'origin', branch], {
      cwd: publicRepo,
      timeout: 180000,
    });
    if (pushResult.status === 0) {
      console.log(`[OK] Pushed to origin/${branch}`);
    } else {
      console.log(
        `[FAIL] Push to ${branch} → exit ${pushResult.status}: ${(pushResult.stderr || pushResult.stdout).slice(0, 300)}`,
      );
    }
  }

  try {
    git(['checkout', priorBranch]);
  } catch (err) {
    console.log(`[WARN] Could not restore prior branch '${priorBranch}': ${String(err)}`);
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
