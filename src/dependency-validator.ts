#!/usr/bin/env node
/**
 * dependency-validator.ts — Comprehensive Stack Dependency Validator
 *
 * Checks ALL stack dependencies, validates versions, reports PASS/WARN/FAIL.
 * Designed to be run before any session, integrated into bootstrap.ts,
 * and usable as a standalone tool.
 *
 * Usage:
 *   npx tsx src/dependency-validator.ts          # full check
 *   npx tsx src/dependency-validator.ts --quiet   # summary only
 *   npx tsx src/dependency-validator.ts --json    # machine-readable
 *   npx tsx src/dependency-validator.ts --install # auto-install missing
 */

import { runSync } from './core/run-command.js';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────

interface DependencySpec {
  name: string;
  binary: string; // command to check
  category: 'core' | 'stack' | 'optional' | 'platform';
  minVersion?: string; // semver or plain string comparison
  maxVersion?: string;
  versionCmd?: string; // how to get version (default: '<binary> --version')
  versionExtract?: string; // regex to extract version from output
  required: boolean; // FAIL if missing?
  description: string;
  installHint: string; // how to install
  autoInstall?: string[]; // [cmd, arg1, arg2, ...] for auto-install

  // For `platform` category — file/directory existence check instead of binary
  checkPath?: string; // relative path to check for existence
  isDir?: boolean; // true = directory check, false = file check
  detailCmd?: string; // optional command to get details (e.g., node count)
  detailExtract?: string; // regex to extract detail from output
  installCmd?: string; // command to auto-install/initialize this component
}

interface DepResult {
  name: string;
  category: string;
  found: boolean;
  version: string;
  required: boolean;
  status: 'PASS' | 'WARN' | 'FAIL' | 'SKIP';
  message: string;
}

// ─── Platform Detection ───────────────────────────────────────────────

const PLATFORM: string =
  process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';

function win(): boolean {
  return PLATFORM === 'windows';
}
function mac(): boolean {
  return PLATFORM === 'macos';
}

// ─── Helpers ──────────────────────────────────────────────────────────

function cmdExists(cmd: string): boolean {
  const which = win() ? 'where' : 'which';
  const r = runSync(which, [cmd], { stdio: 'pipe' });
  return r.status === 0;
}

function run(
  cmd: string,
  args: string[],
): { stdout: string; stderr: string; status: number | null } {
  const r = runSync(cmd, args, { stdio: 'pipe' });
  return { stdout: r.stdout.trim(), stderr: r.stderr.trim(), status: r.status };
}

function getVersion(binary: string, versionCmd?: string, extract?: string): string {
  let raw = '';
  try {
    const cmd = versionCmd ?? `${binary} --version`;
    const parts = cmd.split(/\s+/);
    const r = run(parts[0], parts.slice(1));
    raw = r.stdout || r.stderr;
  } catch {
    return '';
  }

  if (extract) {
    const m = raw.match(new RegExp(extract));
    return m ? m[1] : raw.split('\n')[0];
  }
  return raw.split('\n')[0];
}

/** Simple semver-like comparison. Supports ">=x.y.z", ">x.y.z", "x.y.z" */
function versionSatisfies(version: string, constraint: string | undefined): boolean {
  if (!constraint) return true;
  const v = parseVersion(version);
  if (!v) return true; // can't parse, skip check

  const op = constraint.startsWith('>=')
    ? '>='
    : constraint.startsWith('>')
      ? '>'
      : constraint.startsWith('<=')
        ? '<='
        : constraint.startsWith('<')
          ? '<'
          : constraint.startsWith('=')
            ? '='
            : '>=';
  const rawVer = constraint.replace(/^[>=<]+/, '');
  const c = parseVersion(rawVer);
  if (!c) return true;

  for (let i = 0; i < 3; i++) {
    const vi = v[i] ?? 0;
    const ci = c[i] ?? 0;
    if (op === '>=' && vi < ci) return false;
    if (op === '>' && vi <= ci) return false;
    if (op === '<=' && vi > ci) return false;
    if (op === '<' && vi >= ci) return false;
    if (op === '=' && vi !== ci) return false;
  }
  return true;
}

function parseVersion(v: string): number[] | null {
  const m = v.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])] : null;
}

// ─── Color ────────────────────────────────────────────────────────────

const C = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[90m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

// ─── Dependency Catalog ───────────────────────────────────────────────

function getDependencies(): DependencySpec[] {
  const ROOT = resolve(process.cwd());
  const nodeVer = existsSync(join(ROOT, '.node-version'))
    ? readFileSync(join(ROOT, '.node-version'), 'utf-8').trim()
    : '>=20.0.0';
  const pnpmVer = '>=11.0.0';

  return [
    // ═══ CORE ═════════════════════════════════════════════════════════
    {
      name: 'Node.js',
      binary: 'node',
      category: 'core',
      minVersion: nodeVer.replace(/^v/, '').replace(/.*?(\d+\.\d+\.\d+).*/, '$1'),
      versionCmd: 'node --version',
      versionExtract: 'v?(\\d+\\.\\d+\\.\\d+)',
      required: true,
      description: 'JavaScript runtime — base of the entire stack',
      installHint: win()
        ? 'scoop install nodejs && scoop update nodejs  (or: winget install OpenJS.NodeJS)'
        : mac()
          ? 'brew install node'
          : 'curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt install -y nodejs',
      autoInstall: win()
        ? ['scoop', 'install', 'nodejs']
        : mac()
          ? ['brew', 'install', 'node']
          : ['apt', 'install', '-y', 'nodejs'],
    },
    {
      name: 'pnpm',
      binary: 'pnpm',
      category: 'core',
      minVersion: pnpmVer,
      versionCmd: 'pnpm --version',
      versionExtract: '(\\d+\\.\\d+\\.\\d+)',
      required: true,
      description: 'Package manager — faster, stricter npm alternative',
      installHint: 'npm install -g pnpm  (or: winget install pnpm)',
      autoInstall: ['npm', 'install', '-g', 'pnpm'],
    },
    {
      name: 'Git',
      binary: 'git',
      category: 'core',
      minVersion: '>=2.0.0',
      versionCmd: 'git --version',
      versionExtract: '(\\d+\\.\\d+\\.\\d+)',
      required: true,
      description: 'Version control — required for stack updates and hooks',
      installHint: win()
        ? 'scoop install git  (or: winget install Git.Git)'
        : mac()
          ? 'brew install git'
          : 'apt install -y git',
      autoInstall: win()
        ? ['scoop', 'install', 'git']
        : mac()
          ? ['brew', 'install', 'git']
          : ['apt', 'install', '-y', 'git'],
    },
    {
      name: 'npm',
      binary: 'npm',
      category: 'core',
      versionCmd: 'npm --version',
      versionExtract: '(\\d+\\.\\d+\\.\\d+)',
      required: true,
      description: 'Node package manager — bundled with Node.js',
      installHint: 'Included with Node.js. If missing, reinstall Node.',
      autoInstall: undefined,
    },

    // ═══ STACK TOOLS ═════════════════════════════════════════════════
    {
      name: 'TruffleHog',
      binary: 'trufflehog',
      category: 'stack',
      versionCmd: 'trufflehog --version',
      versionExtract: 'trufflehog (\\d+\\.\\d+\\.\\d+)',
      required: false,
      description: 'Secret scanner — pre-commit hook detects leaked credentials',
      installHint: win()
        ? 'scoop install trufflehog  (or: pip install trufflehog)'
        : mac()
          ? 'brew install trufflehog'
          : 'pip3 install trufflehog',
      autoInstall: win()
        ? ['scoop', 'install', 'trufflehog']
        : mac()
          ? ['brew', 'install', 'trufflehog']
          : ['pip3', 'install', 'trufflehog'],
    },
    {
      name: 'Lefthook',
      binary: 'lefthook',
      category: 'stack',
      versionCmd: 'lefthook version',
      versionExtract: '(\\d+\\.\\d+\\.\\d+)',
      required: true,
      description: 'Git hooks manager — runs pre-commit, pre-push, post-commit validation',
      installHint: 'npm install -g lefthook',
      autoInstall: ['npm', 'install', '-g', 'lefthook'],
    },
    {
      name: 'Engram',
      binary: 'engram',
      category: 'stack',
      versionCmd: 'engram version',
      versionExtract: '(\\d+\\.\\d+\\.\\d+)',
      required: false,
      description: 'Persistent memory — cross-session context retention',
      installHint: 'go install github.com/gentle-vanguard/engram/cmd/engram@latest',
      autoInstall: ['go', 'install', 'github.com/gentle-vanguard/engram/cmd/engram@latest'],
    },
    {
      name: 'CodeGraph',
      binary: 'codegraph',
      category: 'stack',
      versionCmd: 'codegraph --version',
      versionExtract: '(\\d+\\.\\d+\\.\\d+)',
      required: false,
      description: 'MCP symbol intelligence — AST-based code navigation',
      installHint: 'npm install -g @opencode/codegraph',
      autoInstall: ['npm', 'install', '-g', '@opencode/codegraph'],
    },
    {
      name: 'gh (GitHub CLI)',
      binary: 'gh',
      category: 'stack',
      versionCmd: 'gh --version',
      versionExtract: '(\\d+\\.\\d+\\.\\d+)',
      required: false,
      description: 'GitHub CLI — PR management, CI checks, releases',
      installHint: win()
        ? 'scoop install gh  (or: winget install GitHub.cli)'
        : mac()
          ? 'brew install gh'
          : 'apt install -y gh',
      autoInstall: win()
        ? ['scoop', 'install', 'gh']
        : mac()
          ? ['brew', 'install', 'gh']
          : ['apt', 'install', '-y', 'gh'],
    },

    // ═══ OPTIONAL ════════════════════════════════════════════════════
    {
      name: 'Go',
      binary: 'go',
      category: 'optional',
      versionCmd: 'go version',
      versionExtract: 'go(\\d+\\.\\d+\\.\\d+)',
      required: false,
      description: 'Go language — for Go-based tools and model-router-tui',
      installHint: win()
        ? 'scoop install go  (or: winget install GoLang.Go)'
        : mac()
          ? 'brew install go'
          : 'apt install -y golang-go',
      autoInstall: win()
        ? ['scoop', 'install', 'go']
        : mac()
          ? ['brew', 'install', 'go']
          : ['apt', 'install', '-y', 'golang-go'],
    },
    {
      name: 'Python',
      binary: win() ? 'python' : 'python3',
      category: 'optional',
      versionCmd: win() ? 'python --version' : 'python3 --version',
      versionExtract: '(\\d+\\.\\d+\\.\\d+)',
      required: false,
      description: 'Python — for ML research scripts, document analysis sidecar',
      installHint: win()
        ? 'scoop install python  (or: winget install Python.Python)'
        : mac()
          ? 'brew install python'
          : 'apt install -y python3 python3-pip',
      autoInstall: win()
        ? ['scoop', 'install', 'python']
        : mac()
          ? ['brew', 'install', 'python']
          : ['apt', 'install', '-y', 'python3'],
    },
    {
      name: 'Scoop',
      binary: 'scoop',
      category: 'optional',
      versionCmd: 'scoop --version',
      versionExtract: '(\\d+\\.\\d+\\.\\d+)',
      required: false,
      description: 'Windows package manager — installs dev tools easily (Windows only)',
      installHint:
        'powershell -Command "Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser; iex \"& {$(irm get.scoop.sh)} -RunAsAdmin\""',
      autoInstall: win()
        ? [
            'powershell',
            '-NoProfile',
            '-Command',
            'Set-ExecutionPolicy RemoteSigned -Scope CurrentUser; iex "& {$(irm get.scoop.sh)} -RunAsAdmin"',
          ]
        : undefined,
    },

    // ═══ PLATFORM — Stack Infrastructure Components ══════════════════
    // These are NOT binaries; they are file/directory existence checks
    // that validate the stack is properly configured and initialized.
    {
      name: 'Nexus DB',
      binary: '',
      category: 'platform',
      checkPath: '.runtime/gentle-vanguard.db',
      isDir: false,
      required: true,
      description: 'SQLite operational database — metrics, sessions, traces, alerts',
      installHint: 'Run: npm run db:init',
      installCmd: 'npm run db:init',
    },
    {
      name: 'Graphify Graph',
      binary: '',
      category: 'platform',
      checkPath: 'graphify-out/graph.json',
      isDir: false,
      detailCmd:
        "node -e \"const f=require('fs');const j=JSON.parse(f.readFileSync('graphify-out/graph.json','utf8'));console.log((j.nodes||[]).length+' '+(j.links||[]).length)\"",
      detailExtract: '(\\d+) (\\d+)',
      required: true,
      description: 'Knowledge graph — codebase analysis with node/edge relationships',
      installHint: 'Run: npm run graphify -- update .',
      installCmd: 'npm run graphify -- update .',
    },
    {
      name: 'Obsidian Vault',
      binary: '',
      category: 'platform',
      checkPath: 'knowledge-base',
      isDir: true,
      required: true,
      description: 'Knowledge management — session notes, architecture, decisions',
      installHint: 'Create: mkdir -p knowledge-base knowledge-base/04-sessions',
    },
    {
      name: 'OpenCode Config',
      binary: '',
      category: 'platform',
      checkPath: 'opencode.json',
      isDir: false,
      required: true,
      description: 'OpenCode configuration — agent profiles, MCP, permissions',
      installHint: 'File: opencode.json in project root',
    },
    {
      name: 'OpenCode Skills',
      binary: '',
      category: 'platform',
      checkPath: '.opencode/skills',
      isDir: true,
      detailCmd: win()
        ? 'cmd /c "dir /b .opencode\\skills 2>nul | find /c /v \"\""'
        : 'ls -1 .opencode/skills 2>/dev/null | wc -l',
      detailExtract: '(\\d+)',
      required: true,
      description: 'OpenCode skills — specialized workflow instructions for agents',
      installHint: 'Run: git submodule update --init or reinstall opencode',
    },
    {
      name: 'MCP Registry',
      binary: '',
      category: 'platform',
      checkPath: 'config/mcp-registry.json',
      isDir: false,
      required: true,
      description: 'MCP server registry — codegraph, browser-tools, engram bridges',
      installHint: 'File: config/mcp-registry.json',
    },
    {
      name: 'Session Pipeline',
      binary: '',
      category: 'platform',
      checkPath: 'config/session-autostart.config.json',
      isDir: false,
      required: true,
      description: 'Session autostart pipeline — 53-step bootstrap configuration',
      installHint: 'File: config/session-autostart.config.json',
    },
    {
      name: 'Security Policies',
      binary: '',
      category: 'platform',
      checkPath: 'config/security-policy.json',
      isDir: false,
      required: true,
      description: 'Security policy configuration — encryption, auth, audit',
      installHint: 'File: config/security-policy.json',
    },
    {
      name: 'Lefthook Hooks',
      binary: '',
      category: 'platform',
      checkPath: '.git/hooks/pre-commit',
      isDir: false,
      required: false,
      description: 'Installed git hooks — pre-commit, pre-push, post-commit validation',
      installHint: 'Run: npx lefthook install',
      installCmd: 'npx lefthook install',
    },
    {
      name: 'Lefthook Config',
      binary: '',
      category: 'platform',
      checkPath: '.lefthook.yml',
      isDir: false,
      required: true,
      description: 'Lefthook YAML config — hook definitions and rules',
      installHint: 'File: .lefthook.yml in project root',
    },
    {
      name: 'pnpm Lockfile',
      binary: '',
      category: 'platform',
      checkPath: 'pnpm-lock.yaml',
      isDir: false,
      required: true,
      description: 'Package lock — reproducible dependency installs',
      installHint: 'Run: pnpm install (creates lockfile)',
    },
    {
      name: 'node_modules',
      binary: '',
      category: 'platform',
      checkPath: 'node_modules',
      isDir: true,
      required: true,
      description: 'Installed dependencies — required for stack operation',
      installHint: 'Run: pnpm install',
      installCmd: 'pnpm install',
    },
    {
      name: 'Config Directory',
      binary: '',
      category: 'platform',
      checkPath: 'config',
      isDir: true,
      required: true,
      description: 'Stack configuration directory — routing, registry, policies',
      installHint: 'Directory: config/ in project root',
    },
  ];
}

// ─── Check Cache ──────────────────────────────────────────────────────

let _cache: DependencySpec[] | null = null;
function getDeps(): DependencySpec[] {
  if (!_cache) _cache = getDependencies();
  return _cache;
}

// ─── Validator ────────────────────────────────────────────────────────

async function validateAll(deps: DependencySpec[]): Promise<DepResult[]> {
  const ROOT = resolve(process.cwd());
  const results: DepResult[] = [];

  for (const dep of deps) {
    // Platform category: file/directory existence check
    if (dep.category === 'platform') {
      const path = join(ROOT, dep.checkPath ?? '');
      const found = dep.isDir ? existsSync(path) : existsSync(path);
      let status: 'PASS' | 'WARN' | 'FAIL' | 'SKIP' = 'SKIP';
      let message = '';

      if (!found) {
        if (dep.required) {
          status = 'FAIL';
          message = `Missing — ${dep.installHint}`;
          if (dep.installCmd) message += ` (→ ${dep.installCmd})`;
        } else {
          status = 'WARN';
          message = `Missing — optional. ${dep.installHint}`;
          if (dep.installCmd) message += ` (→ ${dep.installCmd})`;
        }
      } else {
        // Get detail (node count, file count, etc.) if configured
        let detail = '';
        if (dep.detailCmd) {
          try {
            const parts = dep.detailCmd.split(/\s+/);
            const r = run(parts[0], parts.slice(1));
            const out = r.stdout.trim();
            if (dep.detailExtract) {
              const m = out.match(new RegExp(dep.detailExtract));
              if (m) {
                if (m[2]) detail = `${m[1]} nodes, ${m[2]} edges`;
                else detail = `${m[1]} items`;
              }
            } else {
              detail = out;
            }
          } catch {
            detail = 'available';
          }
        }
        status = 'PASS';
        message = detail ? detail : dep.isDir ? 'Directory exists' : 'File exists';
      }
      results.push({
        name: dep.name,
        category: 'platform',
        found,
        version: '',
        required: dep.required,
        status,
        message,
      });
      continue;
    }

    // Binary dependency check
    const found = cmdExists(dep.binary);
    let version = '';
    let status: 'PASS' | 'WARN' | 'FAIL' | 'SKIP' = 'SKIP';
    let message = '';

    if (!found) {
      if (dep.required) {
        status = 'FAIL';
        message = `Not found — ${dep.installHint}`;
      } else {
        status = 'WARN';
        message = `Not found — optional. ${dep.installHint}`;
      }
    } else {
      version = getVersion(dep.binary, dep.versionCmd, dep.versionExtract);
      if (dep.minVersion && !versionSatisfies(version, dep.minVersion)) {
        status = 'FAIL';
        message = `Found v${version} but requires ${dep.minVersion}. ${dep.installHint}`;
      } else {
        status = 'PASS';
        message = `v${version}`;
      }
    }
    results.push({
      name: dep.name,
      category: dep.category,
      found,
      version,
      required: dep.required,
      status,
      message,
    });
  }
  return results;
}

// ─── Reporter ─────────────────────────────────────────────────────────

function printResults(results: DepResult[], quiet: boolean, json: boolean): void {
  if (json) {
    const summary = { passed: 0, warned: 0, failed: 0, skipped: 0 };
    for (const r of results) {
      if (r.status === 'PASS') summary.passed++;
      else if (r.status === 'WARN') summary.warned++;
      else if (r.status === 'FAIL') summary.failed++;
      else summary.skipped++;
    }
    console.log(JSON.stringify({ results, summary }, null, 2));
    return;
  }

  if (!quiet) {
    console.log(C.bold(C.cyan('\n╔═══════════════════════════════════════════════════════╗')));
    console.log(C.bold(C.cyan('║        Gentle-Vanguard Dependency Validator           ║')));
    console.log(C.bold(C.cyan('╚═══════════════════════════════════════════════════════╝')));
    console.log(`  Platform: ${PLATFORM}`);
    console.log(`  Node required: ${readVersion('>=20.0.0')}`);
    console.log('');
  }

  const categories = ['core', 'stack', 'optional', 'platform'] as const;
  const labels: Record<string, string> = {
    core: 'CORE',
    stack: 'STACK',
    optional: 'OPTIONAL',
    platform: 'PLATFORM',
  };

  for (const cat of categories) {
    const items = results.filter((r) => r.category === cat);
    if (items.length === 0) continue;
    if (!quiet) console.log(C.bold(C.cyan(`  ── ${labels[cat]} ──`)));

    for (const item of items) {
      const icon =
        item.status === 'PASS' ? C.green('✔') : item.status === 'WARN' ? C.yellow('⚠') : C.red('✘');
      const msg = item.status === 'PASS' ? C.dim(item.message) : item.message;
      if (!quiet) {
        console.log(`  ${icon} ${item.name.padEnd(18)} ${msg}`);
      } else {
        // In quiet mode, only show non-PASS
        if (item.status !== 'PASS') {
          console.log(`  ${icon} ${item.name.padEnd(18)} ${msg}`);
        }
      }
    }
    if (!quiet) console.log('');
  }

  // Summary
  const passed = results.filter((r) => r.status === 'PASS').length;
  const warned = results.filter((r) => r.status === 'WARN').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;
  const total = results.length;

  console.log(
    C.bold(
      `  Result: ${C.green(`${passed} PASS`)} | ${C.yellow(`${warned} WARN`)} | ${failed > 0 ? C.red(`${failed} FAIL`) : `${failed} FAIL`} | ${C.dim(`${skipped} SKIP`)} | ${total} total`,
    ),
  );

  if (failed > 0) {
    console.log(C.red('\n  ✘ Some required dependencies are missing. Run with --install to fix.'));
    console.log(C.yellow('  ✘ Or run: npx tsx src/dependency-installer.ts'));
  }
  console.log('');
}

function readVersion(label: string): string {
  return label;
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const quiet = args.includes('--quiet') || args.includes('-q');
  const json = args.includes('--json') || args.includes('-j');
  const doInstall = args.includes('--install') || args.includes('-i');

  const deps = getDeps();
  const results = await validateAll(deps);
  printResults(results, quiet, json);

  const failed = results.filter((r) => r.status === 'FAIL');
  const exitCode = failed.length > 0 ? 1 : 0;

  if (doInstall && failed.length > 0) {
    console.log(C.cyan('\n  Auto-install mode: installing missing dependencies...\n'));
    const installer = await import('./dependency-installer.js');
    await installer.installMissing(deps, results);
  }

  process.exit(exitCode);
}

// Only run main() when called directly, not when imported
const isMain =
  process.argv[1]?.replace(/\\/g, '/').endsWith('dependency-validator.ts') ||
  process.argv[1]?.replace(/\\/g, '/').endsWith('dependency-validator.js');
if (isMain) {
  main().catch((err) => {
    console.error('FATAL:', err.message);
    process.exit(1);
  });
}

// ─── Exports for programmatic use ─────────────────────────────────────
export type { DependencySpec, DepResult };
export { getDeps, validateAll, printResults };
