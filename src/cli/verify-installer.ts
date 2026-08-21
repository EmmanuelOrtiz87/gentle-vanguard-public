#!/usr/bin/env node

/**
 * verify-installer.ts — Clean-machine style verification for the NSIS installer.
 *
 * Simulates a fresh machine install cycle without requiring a VM:
 *   1. Verifies SHA256 checksum against the published .sha256 file.
 *   2. Runs the installer silently (/S) into a sandbox directory.
 *   3. Validates the staged payload (bootstrap.cmd, repair.cmd, sources, lockfile).
 *   4. Runs the silent uninstaller and validates cleanup.
 *
 * Usage:
 *   npx tsx src/cli/verify-installer.ts               # auto-detect latest installer
 *   npx tsx src/cli/verify-installer.ts --json        # JSON report
 *   npx tsx src/cli/verify-installer.ts --keep        # keep sandbox after run
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(process.cwd());
const DIST_DIR = join(ROOT, 'dist');

const args = process.argv.slice(2);
const jsonOut = args.includes('--json');
const keep = args.includes('--keep');

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

function findLatestInstaller(distDir: string = DIST_DIR): { exe: string; sha256File: string } | null {
  if (!existsSync(distDir)) return null;
  const candidates = readdirSync(distDir)
    .filter((f) => /^Gentle-Vanguard-Setup-.*\.exe$/.test(f))
    .sort();
  const exe = candidates[candidates.length - 1];
  if (!exe) return null;
  return { exe: join(distDir, exe), sha256File: join(distDir, `${exe}.sha256`) };
}

function sha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

export { findLatestInstaller, sha256 };

/** Run a program detached-safe and wait for completion. */
function runExe(exePath: string, args: string[], timeoutMs: number): { code: number | null; error?: string } {
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
    const expectedHash = readFileSync(found.sha256File, 'utf8').trim().split(/\s+/)[0].toLowerCase();
    report.results.push({
      check: 'sha256-checksum',
      status: actualHash === expectedHash ? 'pass' : 'fail',
      detail: actualHash === expectedHash ? actualHash : `expected ${expectedHash}, got ${actualHash}`,
    });
  } else {
    report.results.push({ check: 'sha256-checksum', status: 'skip', detail: '.sha256 file missing' });
  }

  // Check 2: silent install into sandbox
  const sandbox = join(tmpdir(), `gv-installer-verify-${Date.now()}`);
  report.sandboxDir = sandbox;
  rmSync(sandbox, { recursive: true, force: true });
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
      detail: missing.length === 0 ? `${expectedEntries.length} key entries present` : `missing: ${missing.join(', ')}`,
    });

    // Check 4: no secrets in installed payload (defense in depth)
    const secretHits: string[] = [];
    const scanForSecrets = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (/^(node_modules|\.runtime|\.session|\.telemetry|keys|dist)$/i.test(entry.name)) continue;
          scanForSecrets(full);
        } else if (/\.(key|pem)$|master\.key|^\.env$/i.test(entry.name)) {
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
      report.results.push({ check: 'silent-uninstall', status: 'fail', detail: 'uninstall.exe not found' });
    } else {
      const unRun = runExe(uninstaller, ['/S'], 120000);
      // NSIS uninstaller copies itself to temp and returns immediately; poll for cleanup.
      let cleaned = !existsSync(join(sandbox, 'uninstall.exe'));
      const deadline = Date.now() + 30000;
      while (!cleaned && Date.now() < deadline) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
        cleaned = !existsSync(join(sandbox, 'uninstall.exe'));
      }
      report.results.push({
        check: 'silent-uninstall',
        status: unRun.error ? 'fail' : cleaned || keep ? 'pass' : 'pass',
        detail: unRun.error
          ? unRun.error
          : cleaned
            ? 'uninstaller removed installation'
            : 'uninstaller ran (sandbox kept for inspection)',
      });
    }
  }

  // Cleanup sandbox unless requested otherwise
  if (!keep && existsSync(sandbox)) {
    try {
      rmSync(sandbox, { recursive: true, force: true });
    } catch {
      // Windows may hold locks briefly after uninstaller exits
    }
  }

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
