#!/usr/bin/env node

/**
 * verify-installer.ts — Clean-machine style verification for the NSIS installer.
 *
 * Executes only on an ephemeral GitHub-hosted Windows runner. A destination
 * directory alone does not isolate the installer registry and Start menu writes.
 *   1. Verifies SHA256 checksum against the published .sha256 file.
 *   2. Runs the installer silently (/S) into a sandbox directory.
 *   3. Validates the staged payload (bootstrap.cmd, repair.cmd, sources, lockfile).
 *   4. Runs the silent uninstaller and validates cleanup.
 *
 * Usage:
 *   node --import tsx src/cli/verify-installer.ts --json
 * Failed installations are preserved for inspection on the disposable runner.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(process.cwd());
const DIST_DIR = join(ROOT, 'dist');

const args = process.argv.slice(2);
const jsonOut = args.includes('--json');

interface CheckResult {
  check: string;
  status: 'pass' | 'fail' | 'skip';
  detail?: string;
}

interface VerifyReport {
  installer: string;
  version: string;
  timestamp: string;
  sandboxDir: string;
  results: CheckResult[];
  success: boolean;
}

function findLatestInstaller(
  distDir: string = DIST_DIR,
): { exe: string; sha256File: string } | null {
  if (!existsSync(distDir)) return null;
  const candidates = readdirSync(distDir)
    .filter((f) => /^Gentle-Vanguard-Setup-.*\.exe$/.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, {numeric:true}));
  const exe = candidates[candidates.length - 1];
  if (!exe) return null;
  return { exe: join(distDir, exe), sha256File: join(distDir, `${exe}.sha256`) };
}

function sha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

export { findLatestInstaller, sha256 };

export function isIsolatedWindowsRunner(platform: string, env: NodeJS.ProcessEnv): boolean {
  return platform === 'win32' && env.GITHUB_ACTIONS === 'true' &&
    env.RUNNER_ENVIRONMENT === 'github-hosted';
}

const uninstallKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Gentle-Vanguard';
function registryEntryPresent(): boolean {
  const query = spawnSync('reg.exe', ['query', uninstallKey], { windowsHide: true });
  if (query.error || (query.status !== 0 && query.status !== 1)) {
    throw new Error('Unable to inspect installer registry entry');
  }
  return query.status === 0;
}

/** Run a program detached-safe and wait for completion. */
function runExe(
  exePath: string,
  args: string[],
  timeoutMs: number,
): { code: number | null; error?: string } {
  const result = spawnSync(exePath, args, { timeout: timeoutMs, windowsHide: true });
  if (result.error) return { code: null, error: result.error.message };
  return { code: result.status };
}

function main(): void {
  const report: VerifyReport = {
    installer: '',
    version: '',
    timestamp: new Date().toISOString(),
    sandboxDir: '',
    results: [],
    success: false,
  };

  const found = findLatestInstaller();
  if (!found) {
    report.results.push({
      check: 'installer-found',
      status: 'fail',
      detail: `No Gentle-Vanguard-Setup-*.exe in ${DIST_DIR}. Run npm run gv:installer first.`,
    });
    finish(report);
    return;
  }
  report.installer = found.exe;
  report.version = /Setup-(.+)\.exe$/.exec(found.exe)?.[1] ?? 'unknown';

  // Check 1: checksum integrity
  const actualHash = sha256(found.exe);
  if (existsSync(found.sha256File)) {
    const expectedHash = readFileSync(found.sha256File, 'utf8')
      .trim()
      .split(/\s+/)[0]
      .toLowerCase();
    report.results.push({
      check: 'sha256-checksum',
      status: actualHash === expectedHash ? 'pass' : 'fail',
      detail:
        actualHash === expectedHash ? actualHash : `expected ${expectedHash}, got ${actualHash}`,
    });
  } else {
    report.results.push({
      check: 'sha256-checksum',
      status: 'fail',
      detail: '.sha256 file missing',
    });
  }

  // Fail closed before any installation or profile mutation.
  report.results.push({
    check: 'isolated-windows-runner',
    status: isIsolatedWindowsRunner(process.platform, process.env) ? 'pass' : 'fail',
    detail: 'Execution requires an ephemeral GitHub-hosted Windows runner; never spoof these variables on an operator profile.',
  });
  if (report.results.some((r) => r.status === 'fail')) { finish(report); return; }
  const shortcuts = join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Gentle-Vanguard');
  if (registryEntryPresent() || existsSync(shortcuts)) {
    report.results.push({ check: 'clean-profile', status: 'fail', detail: 'Existing installation metadata; refusing to overwrite it' });
    finish(report); return;
  }

  // Check 2: silent install into sandbox
  const sandbox = join(tmpdir(), `gv-installer-verify-${Date.now()}`);
  report.sandboxDir = sandbox;
  if (existsSync(sandbox)) throw new Error('Verification directory already exists');
  const installRun = runExe(found.exe, ['/S', `/D=${sandbox}`], 180000);
  const installedOk =
    installRun.code === 0 &&
    existsSync(join(sandbox, 'bootstrap.cmd')) &&
    existsSync(join(sandbox, 'package.json'));
  report.results.push({
    check: 'silent-install',
    status: installedOk ? 'pass' : 'fail',
    detail:
      installRun.code === 0
        ? `installed to ${sandbox}`
        : `exit=${installRun.code ?? 'error'}${installRun.error ? ` (${installRun.error})` : ''}`,
  });

  // Check 3: payload completeness (honest bootstrapper contract)
  if (installedOk) {
    const expectedEntries = ['repair.cmd', 'pnpm-lock.yaml', 'tsconfig.json', join('src', 'cli')];
    const missing = expectedEntries.filter((e) => !existsSync(join(sandbox, e)));
    report.results.push({
      check: 'payload-completeness',
      status: missing.length === 0 ? 'pass' : 'fail',
      detail:
        missing.length === 0
          ? `${expectedEntries.length} key entries present`
          : `missing: ${missing.join(', ')}`,
    });

    report.results.push({ check: 'installation-metadata',
      status: registryEntryPresent() && ['Gentle-Vanguard.lnk', 'Repair Gentle-Vanguard.lnk', 'Uninstall.lnk']
        .every((name) => existsSync(join(shortcuts, name))) ? 'pass' : 'fail' });

    // Check 4: no secrets in installed payload (defense in depth)
    const secretHits: string[] = [];
    const scanForSecrets = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (/^(node_modules|\.git|apps|\.runtime|\.session|\.telemetry|keys|dist)$/i.test(entry.name)) {
            secretHits.push(full);
            continue;
          }
          scanForSecrets(full);
        } else if (/\.(key|pem)$|master\.key|^\.env(?:\..+)?$/i.test(entry.name) && !/^\.env\.example$/i.test(entry.name)) {
          secretHits.push(full);
        }
      }
    };
    scanForSecrets(sandbox);
    report.results.push({
      check: 'no-secrets-in-payload',
      status: secretHits.length === 0 ? 'pass' : 'fail',
      detail: secretHits.length === 0 ? 'no key/pem/env files' : `FOUND: ${secretHits.join(', ')}`,
    });
  }

  // Check 5: silent uninstall + cleanup
  if (installedOk) {
    const uninstaller = join(sandbox, 'uninstall.exe');
    if (!existsSync(uninstaller)) {
      report.results.push({
        check: 'silent-uninstall',
        status: 'fail',
        detail: 'uninstall.exe not found',
      });
    } else {
      const unRun = runExe(uninstaller, ['/S'], 120000);
      // NSIS uninstaller copies itself to temp and returns immediately; poll for cleanup.
      const isClean = (): boolean => !existsSync(sandbox) && !existsSync(shortcuts) && !registryEntryPresent();
      let cleaned = isClean();
      const deadline = Date.now() + 30000;
      while (!cleaned && Date.now() < deadline) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
        cleaned = isClean();
      }
      report.results.push({
        check: 'silent-uninstall',
        status: !unRun.error && unRun.code === 0 && cleaned ? 'pass' : 'fail',
        detail: unRun.error
          ? unRun.error
          : cleaned
            ? 'uninstaller removed installation'
            : 'uninstaller ran (sandbox kept for inspection)',
      });
    }
  }

  // Preserve failures for inspection; manual deletion would mask uninstall defects.

  report.success = report.results.every((r) => r.status !== 'fail');
  finish(report);
}

function finish(report: VerifyReport): void {
  if (jsonOut) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('\n═══ Installer Verification ═══');
    console.log(`Installer: ${report.installer || '(not found)'}`);
    console.log(`Version:   ${report.version}`);
    for (const r of report.results) {
      const icon = r.status === 'pass' ? '✅' : r.status === 'skip' ? '⏭️ ' : '❌';
      console.log(`  ${icon} ${r.check}${r.detail ? ` — ${r.detail}` : ''}`);
    }
    console.log(`Result: ${report.success ? 'PASS' : 'FAIL'}\n`);
  }
  process.exit(report.success ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
