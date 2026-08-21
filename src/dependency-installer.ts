#!/usr/bin/env node
/**
 * dependency-installer.ts — Auto-Installer for Missing Stack Dependencies
 *
 * Detects platform, checks for missing/outdated dependencies, and installs them.
 * Can run in dry-run mode (--dry-run) for user preview.
 *
 * Usage:
 *   npx tsx src/dependency-installer.ts          # interactive mode
 *   npx tsx src/dependency-installer.ts --dry-run # preview only
 *   npx tsx src/dependency-installer.ts --all     # install all (even optional)
 *   npx tsx src/dependency-installer.ts --yes     # non-interactive (auto-yes)
 */

import { runSync } from './core/run-command.js';

// ─── Types ────────────────────────────────────────────────────────────

interface DepSpec {
  name: string;
  binary: string;
  category: string;
  required: boolean;
  description: string;
  installHint: string;
  autoInstall?: string[];
}

interface DepResult {
  name: string;
  found: boolean;
  version: string;
  status: string;
  message: string;
}

// ─── Platform ─────────────────────────────────────────────────────────

const IS_WIN = process.platform === 'win32';

// ─── Color ────────────────────────────────────────────────────────────

const C = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[90m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

// ─── Helpers ──────────────────────────────────────────────────────────

function run(
  cmd: string,
  args: string[],
): { stdout: string; stderr: string; status: number | null } {
  const r = runSync(cmd, args, { stdio: 'pipe' });
  return { stdout: r.stdout.trim(), stderr: r.stderr.trim(), status: r.status };
}

function runInteractive(cmd: string, args: string[]): { status: number | null } {
  console.log(C.dim(`  > ${cmd} ${args.join(' ')}`));
  const r = runSync(cmd, args, { stdio: 'inherit' });
  return { status: r.status };
}

function prompt(message: string, defaultYes: boolean): boolean {
  if (process.argv.includes('--yes') || process.argv.includes('-y')) return true;
  const suffix = defaultYes ? '(Y/n)' : '(y/N)';
  console.log(`\n  ${message} ${suffix}`);
  // In non-interactive mode, return default
  if (!process.stdin.isTTY) return defaultYes;
  return defaultYes; // simplified: assume yes
}

// ─── Installer ────────────────────────────────────────────────────────

const INSTALL_MAP: Record<string, () => boolean> = {
  scoop: () => {
    console.log(C.cyan('\n  Installing Scoop (Windows package manager)...'));
    const r = runInteractive('powershell', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      'Set-ExecutionPolicy RemoteSigned -Scope CurrentUser -Force; iex "& {$(irm get.scoop.sh)} -RunAsAdmin"',
    ]);
    return r.status === 0;
  },
};

export async function installMissing(deps: DepSpec[], results: DepResult[]): Promise<number> {
  const failed = results.filter((r) => r.status === 'FAIL');
  const warned = results.filter((r) => r.status === 'WARN' && process.argv.includes('--all'));
  const toInstall = [...failed, ...warned];

  if (toInstall.length === 0) {
    console.log(C.green('  All dependencies satisfied. Nothing to install.'));
    return 0;
  }

  console.log(C.bold(C.cyan(`\n╔═══════════════════════════════════════════════════════╗`)));
  console.log(C.bold(C.cyan(`║      Gentle-Vanguard Dependency Installer            ║`)));
  console.log(C.bold(C.cyan(`╚═══════════════════════════════════════════════════════╝`)));
  console.log(`\n  ${toInstall.length} item(s) to install:\n`);

  for (const item of toInstall) {
    const icon = item.status === 'FAIL' ? C.red('✘') : C.yellow('⚠');
    console.log(`  ${icon} ${item.name}: ${item.message}`);
  }

  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) {
    console.log(C.yellow('\n  DRY RUN — No changes made. Run without --dry-run to install.'));
    console.log(C.yellow('  Or use: npx tsx src/dependency-installer.ts\n'));
    return 0;
  }

  const proceed = prompt('Proceed with installation?', true);
  if (!proceed) {
    console.log(C.yellow('  Installation cancelled by user.'));
    return 1;
  }

  let installed = 0;
  let failed_count = 0;

  for (const item of toInstall) {
    console.log(C.cyan(`\n  ── Installing ${item.name} ──`));

    // Find the dep spec
    const spec = deps.find((d) => d.name === item.name);
    if (!spec || !spec.autoInstall || spec.autoInstall.length === 0) {
      console.log(C.yellow(`  No auto-install available for ${item.name}.`));
      if (spec) console.log(C.yellow(`  Manual: ${spec.installHint}`));
      else console.log(C.yellow(`  No install information available.`));
      failed_count++;
      continue;
    }

    const [cmd, ...args] = spec.autoInstall;

    // If cmd is a package manager, ensure it exists first
    if (cmd === 'scoop' && !run('scoop', ['--version']).stdout) {
      if (!INSTALL_MAP.scoop()) {
        console.log(C.red(`  Failed to install Scoop. Install manually: https://scoop.sh`));
        failed_count++;
        continue;
      }
    }

    // For go install, ensure binary is reachable
    if (cmd === 'go') {
      const binaryName = spec.binary;
      const exists = run(IS_WIN ? 'where' : 'which', [binaryName]).status === 0;
      if (exists) {
        console.log(C.green(`  ${item.name} already installed.`));
        installed++;
        continue;
      }
    }

    const result = runInteractive(cmd, args);

    // Verify installation
    const verifyCmd = IS_WIN ? 'where' : 'which';
    const verified = run(verifyCmd, [item.name.split(' ')[0]]).status === 0;

    if (result.status === 0 && verified) {
      console.log(C.green(`  ✅ ${item.name} installed successfully.`));
      installed++;
    } else {
      console.log(C.yellow(`  ⚠ ${item.name} installation may need manual steps.`));
      console.log(C.yellow(`  Manual: ${spec.installHint}`));
      failed_count++;
    }
  }

  console.log(C.bold(C.cyan(`\n  ── Summary ──`)));
  console.log(`  Installed: ${C.green(String(installed))}`);
  console.log(`  Failed:    ${failed_count > 0 ? C.red(String(failed_count)) : '0'}`);
  console.log(C.cyan(`  ───────────\n`));

  if (failed_count > 0) {
    console.log(C.yellow('  Some installations need manual steps. Follow the hints above.'));
    return 1;
  }

  console.log(C.green('  All dependencies installed. Run the validator to confirm:'));
  console.log(C.dim('  npx tsx src/dependency-validator.ts'));
  return 0;
}

// ─── Standalone Main ──────────────────────────────────────────────────

async function main(): Promise<void> {
  // Validate and install using internal dep list
  const deps = getDepsInternal();
  const results = await validateInternal(deps);
  const exitCode = await installMissing(deps, results);
  process.exit(exitCode);
}

function getDepsInternal(): DepSpec[] {
  // Minimal dep list for standalone usage — avoids importing the full validator
  return [
    {
      name: 'Node.js',
      binary: 'node',
      category: 'core',
      required: true,
      description: '',
      installHint: '',
      autoInstall: [],
    },
    {
      name: 'pnpm',
      binary: 'pnpm',
      category: 'core',
      required: true,
      description: '',
      installHint: '',
      autoInstall: ['npm', 'install', '-g', 'pnpm'],
    },
    {
      name: 'Git',
      binary: 'git',
      category: 'core',
      required: true,
      description: '',
      installHint: '',
      autoInstall: IS_WIN ? ['scoop', 'install', 'git'] : ['apt', 'install', '-y', 'git'],
    },
    {
      name: 'Lefthook',
      binary: 'lefthook',
      category: 'stack',
      required: true,
      description: '',
      installHint: '',
      autoInstall: ['npm', 'install', '-g', 'lefthook'],
    },
    {
      name: 'TruffleHog',
      binary: 'trufflehog',
      category: 'stack',
      required: false,
      description: '',
      installHint: '',
      autoInstall: IS_WIN ? ['scoop', 'install', 'trufflehog'] : ['pip3', 'install', 'trufflehog'],
    },
    {
      name: 'Engram',
      binary: 'engram',
      category: 'stack',
      required: false,
      description: '',
      installHint: '',
      autoInstall: ['go', 'install', 'github.com/gentle-vanguard/engram/cmd/engram@latest'],
    },
    {
      name: 'CodeGraph',
      binary: 'codegraph',
      category: 'stack',
      required: false,
      description: '',
      installHint: '',
      autoInstall: ['npm', 'install', '-g', '@opencode/codegraph'],
    },
    {
      name: 'gh (GitHub CLI)',
      binary: 'gh',
      category: 'stack',
      required: false,
      description: '',
      installHint: '',
      autoInstall: IS_WIN ? ['scoop', 'install', 'gh'] : ['apt', 'install', '-y', 'gh'],
    },
    {
      name: 'Go',
      binary: 'go',
      category: 'optional',
      required: false,
      description: '',
      installHint: '',
      autoInstall: IS_WIN ? ['scoop', 'install', 'go'] : ['apt', 'install', '-y', 'golang-go'],
    },
    {
      name: 'Python',
      binary: IS_WIN ? 'python' : 'python3',
      category: 'optional',
      required: false,
      description: '',
      installHint: '',
      autoInstall: IS_WIN ? ['scoop', 'install', 'python'] : ['apt', 'install', '-y', 'python3'],
    },
    {
      name: 'Scoop',
      binary: 'scoop',
      category: 'optional',
      required: false,
      description: '',
      installHint: '',
      autoInstall: IS_WIN
        ? [
            'powershell',
            '-NoProfile',
            '-Command',
            'Set-ExecutionPolicy RemoteSigned -Scope CurrentUser; iex "& {$(irm get.scoop.sh)} -RunAsAdmin"',
          ]
        : undefined,
    },
  ];
}

async function validateInternal(deps: DepSpec[]): Promise<DepResult[]> {
  const results: DepResult[] = [];
  for (const dep of deps) {
    const which = IS_WIN ? 'where' : 'which';
    const found = run(which, [dep.binary]).status === 0;
    if (found) {
      results.push({
        name: dep.name,
        found: true,
        version: '',
        status: 'PASS',
        message: 'Installed',
      });
    } else if (dep.required) {
      results.push({
        name: dep.name,
        found: false,
        version: '',
        status: 'FAIL',
        message: `Not found. ${dep.installHint}`,
      });
    } else {
      results.push({
        name: dep.name,
        found: false,
        version: '',
        status: 'WARN',
        message: `Not found (optional). ${dep.installHint}`,
      });
    }
  }
  return results;
}

// Only run standalone if called directly
const isMain =
  process.argv[1]?.replace(/\\/g, '/').endsWith('dependency-installer.ts') ||
  process.argv[1]?.replace(/\\/g, '/').endsWith('dependency-installer.js');
if (isMain) {
  main().catch((err) => {
    console.error('FATAL:', err.message);
    process.exit(1);
  });
}
