#!/usr/bin/env node

import { existsSync, writeFileSync, copyFileSync, unlinkSync } from 'fs';
import { join, resolve, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { runSync, runNpxTsxSync } from './core/run-command.js';
import * as readline from 'readline';
import { tmpdir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface AutoUpdateArgs {
  force: boolean;
  dryRun: boolean;
}

function parseArgs(): AutoUpdateArgs {
  const args = process.argv.slice(2);
  let force = false;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--force':
      case '-Force':
        force = true;
        break;
      case '--dry-run':
      case '-DryRun':
        dryRun = true;
        break;
    }
  }

  return { force, dryRun };
}

function log(msg: string, color?: string): void {
  const colors: Record<string, string> = {
    Cyan: '\x1b[36m',
    Green: '\x1b[32m',
    Yellow: '\x1b[33m',
    Red: '\x1b[31m',
    Gray: '\x1b[90m',
  };
  const code = color ? colors[color] || '' : '';
  const reset = code ? '\x1b[0m' : '';
  console.log(`${code}${msg}${reset}`);
}

function askConfirmation(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(/^[Yy]/.test(answer));
    });
  });
}

function getCheckScriptPath(): string {
  return join(__dirname, 'check-version.ts');
}

function getProjectRoot(): string {
  return resolve(__dirname, '..');
}

function findExePath(projectRoot: string): string {
  // El binario SEA se genera como build/Gentle-Vanguard.exe (mayúsculas).
  // Buscar case-insensitive en build/, bin/ y la raíz.
  const candidates = [
    join(projectRoot, 'build', 'Gentle-Vanguard.exe'),
    join(projectRoot, 'bin', 'gentle-vanguard.exe'),
    join(projectRoot, 'gentle-vanguard.exe'),
    join(projectRoot, 'build', 'gentle-vanguard.exe'),
  ];
  for (const exePath of candidates) {
    if (existsSync(exePath)) return exePath;
  }

  log('Executable not found at the standard paths. Searching project root...', 'Yellow');

  const { stdout } = runSync(
    'powershell',
    [
      '-Command',
      `Get-ChildItem -Path '${projectRoot}' -Recurse -Filter '*.exe' -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'gentle.?vanguard' } | Select-Object -First 1 -ExpandProperty FullName`,
    ],
    { stdio: 'pipe' },
  );

  const found = stdout?.trim();
  if (found) return found;

  throw new Error('Could not find gentle-vanguard.exe. Ensure the project is built.');
}

async function main(): Promise<void> {
  const { force, dryRun } = parseArgs();
  const checkScript = getCheckScriptPath();

  try {
    const checkProc = runNpxTsxSync(checkScript, ['--quiet'], {
      stdio: 'pipe',
    });
    const exitCode = checkProc.status ?? -1;
    const checkResult = (checkProc.stdout || '').trim();

    if (exitCode === 2) {
      log(`Version check failed: ${checkResult}`, 'Red');
      process.exit(1);
    }

    if (exitCode === 0) {
      log('Gentle-Vanguard is already up to date.', 'Green');
      process.exit(0);
    }

    const parts = checkResult.split('|');
    if (parts[0] !== 'UPDATE_AVAILABLE') {
      log(`Unexpected check result: ${checkResult}`, 'Red');
      process.exit(1);
    }

    const currentVersion = parts[1];
    const latestVersion = parts[2];
    const downloadUrl = parts[3];

    log(`Update v${latestVersion} available (current: v${currentVersion}).`, 'Cyan');

    if (!force) {
      const confirmed = await askConfirmation(
        `Update v${latestVersion} available. Download and install? [Y/N] `,
      );
      if (!confirmed) {
        log('Update cancelled by user.', 'Yellow');
        process.exit(0);
      }
    }

    const projectRoot = getProjectRoot();
    let exePath: string;
    try {
      exePath = findExePath(projectRoot);
    } catch (err) {
      throw err;
    }

    const backupPath = exePath.replace(extname(exePath), '.backup.exe');
    const downloadPath = join(tmpdir(), `gentle-vanguard-${latestVersion}.exe`);

    log('Downloading v' + latestVersion + '...', 'Cyan');
    if (dryRun) {
      log(`[DRY-RUN] Would download: ${downloadUrl}`, 'Yellow');
      log(`[DRY-RUN] Would save to: ${downloadPath}`, 'Yellow');
    } else {
      try {
        const response = await fetch(downloadUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        writeFileSync(downloadPath, buffer);
        log('Download complete.', 'Green');
      } catch (err) {
        throw new Error(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      if (!existsSync(downloadPath)) {
        throw new Error(`Downloaded file not found at ${downloadPath}`);
      }
    }

    log('Creating backup...', 'Cyan');
    if (dryRun) {
      log(`[DRY-RUN] Would backup: ${exePath} -> ${backupPath}`, 'Yellow');
    } else {
      copyFileSync(exePath, backupPath);
      log(`Backup created: ${backupPath}`, 'Green');
    }

    log('Installing update...', 'Cyan');
    if (dryRun) {
      log(`[DRY-RUN] Would replace: ${exePath} with ${downloadPath}`, 'Yellow');
    } else {
      copyFileSync(downloadPath, exePath);
      log('Update installed.', 'Green');
    }

    log('Verifying new executable...', 'Cyan');
    if (dryRun) {
      log('[DRY-RUN] Would verify: ' + exePath + ' -Version', 'Yellow');
      log('[DRY-RUN] Update simulation complete. No changes were made.', 'Green');
      process.exit(0);
    } else {
      try {
        const verProc = runSync(exePath, ['-Version'], {
          stdio: 'pipe',
        });
        if (verProc.status !== 0) {
          throw new Error(`New executable exited with code ${verProc.status}`);
        }
        log(`Verification passed: ${(verProc.stdout || '').trim()}`, 'Green');
      } catch (err) {
        log(`Verification failed: ${err instanceof Error ? err.message : String(err)}`, 'Red');
        restoreBackup(exePath, backupPath);
        log('Update failed. Previous version restored.', 'Red');
        process.exit(1);
      }
    }

    try {
      unlinkSync(downloadPath);
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(backupPath);
    } catch {
      /* ignore */
    }

    log(`Update complete. You are now running v${latestVersion}.`, 'Green');
    process.exit(0);
  } catch (err) {
    log(`Auto-update failed: ${err instanceof Error ? err.message : String(err)}`, 'Red');
    process.exit(1);
  }
}

function restoreBackup(exePath: string, backupPath: string): void {
  if (existsSync(backupPath)) {
    log('Restoring backup...', 'Yellow');
    copyFileSync(backupPath, exePath);
    unlinkSync(backupPath);
    log('Backup restored.', 'Yellow');
  }
}

if (
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1].endsWith('auto-update.ts'))
) {
  main().catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    log(`Auto-update failed: ${msg}`, 'Red');
    process.exit(1);
  });
}
